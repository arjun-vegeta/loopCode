import type { OpencodeClient } from '@opencode-ai/sdk';
import { EventBus, type AppEvent } from './events.js';
import type { LoopcodeConfig } from '../config/schema.js';
import type { Catalog, ProviderInfo } from '../auth/provider-catalog.js';
import { AuthService, type OAuthSession } from '../auth/auth-service.js';
import { startWebOnboarding } from '../auth/web-onboard.js';
import { AntigravityProxy } from '../proxy/antigravity.js';
import { acceptRisk, hasAcceptedRisk } from '../proxy/consent.js';
import { registerAntigravityProvider } from '../proxy/registration.js';
import { Memory } from '../memory.js';
import { MemoryEngine } from '../memory/engine.js';
import { CostEngine } from '../cost/engine.js';
import { DynamicRouter } from '../router/dynamic.js';
import { Orchestrator } from '../orchestrator.js';
import { OpencodeOrchestrator } from '../opencode.js';
import { configStore } from '../config/store.js';
import { setPermissionMode, getPermissionMode } from '../cli/state.js';
import { checkTrust } from '../cli/trust.js';
import { git } from '../scheduler/worktree.js';
import type { SessionController, Snapshot, TaskSnapshot, VerificationSnapshot } from './session-controller.js';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export interface CreateControllerOptions {
  dbPath: string;
  config: LoopcodeConfig;
}

export class SessionControllerImpl implements SessionController {
  readonly bus: EventBus;
  readonly client: OpencodeClient;
  readonly config: LoopcodeConfig;

  private authService: AuthService;
  private proxy: AntigravityProxy;
  private memory: Memory;
  private memoryEngine: MemoryEngine;
  private costEngine: CostEngine;
  private router: DynamicRouter;
  private opencodeOrchestrator: OpencodeOrchestrator;
  private orchestrator: Orchestrator;

  private activeAbortController: AbortController | null = null;
  private currentGoalId: string | null = null;
  private currentSessionId: string | null = null;
  private activeRunPromise: Promise<void> | null = null;

  // Snapshot cache state
  private snapshotState: {
    phase: Snapshot['phase'];
    detail?: string;
    startedAt?: number;
    tasks: Map<string, TaskSnapshot>;
    verifications: Map<string, VerificationSnapshot>;
    goalSpentUsd: number;
    monthSpentUsd: number;
  };

  private trustedSessionDirs = new Set<string>();

  constructor(options: CreateControllerOptions, opencodeOrchestrator: OpencodeOrchestrator) {
    this.config = options.config;
    this.opencodeOrchestrator = opencodeOrchestrator;
    this.client = opencodeOrchestrator.client;

    this.bus = new EventBus();
    this.memory = new Memory(options.dbPath);
    this.memoryEngine = new MemoryEngine(options.dbPath);
    this.costEngine = new CostEngine(options.dbPath);
    this.router = new DynamicRouter(options.dbPath);
    this.authService = new AuthService(this.client, this.bus);
    this.proxy = new AntigravityProxy(this.bus);

    this.orchestrator = new Orchestrator(
      this.opencodeOrchestrator,
      options.dbPath,
      undefined,
      this.bus,
      this.costEngine,
      this.memoryEngine,
    );

    this.snapshotState = {
      phase: 'idle',
      tasks: new Map(),
      verifications: new Map(),
      goalSpentUsd: 0,
      monthSpentUsd: 0,
    };

    this.setupEventSubscriptions();
  }

  private setupEventSubscriptions(): void {
    this.bus.subscribe((event: AppEvent) => {
      switch (event.kind) {
        case 'phase':
          this.snapshotState.phase = event.phase;
          this.snapshotState.detail = event.detail;
          if (event.phase === 'planning' || event.phase === 'executing') {
            if (!this.snapshotState.startedAt) this.snapshotState.startedAt = Date.now();
          } else {
            this.snapshotState.startedAt = undefined;
          }
          break;
        case 'task-state': {
          const existing: TaskSnapshot = this.snapshotState.tasks.get(event.taskId) || {
            id: event.taskId,
            title: event.title,
            batchIndex: event.batchIndex,
            status: event.status,
          };
          this.snapshotState.tasks.set(event.taskId, {
            ...existing,
            title: event.title,
            batchIndex: event.batchIndex,
            status: event.status,
            model: event.model ?? existing.model,
            costUsd: event.costUsd ?? existing.costUsd,
            durationMs: event.durationMs ?? existing.durationMs,
            attempt: event.attempt ?? existing.attempt,
          });
          break;
        }
        case 'verification': {
          const existing: VerificationSnapshot = this.snapshotState.verifications.get(event.taskId) || {
            taskId: event.taskId,
            layers: [],
            overallPass: null,
          };
          existing.layers = event.layers;
          existing.overallPass = event.overallPass;
          existing.retryHint = event.retryHint;
          this.snapshotState.verifications.set(event.taskId, existing);
          break;
        }
        case 'cost':
          this.snapshotState.goalSpentUsd = event.goalUsd;
          break;
      }
    });
  }

  snapshot(): Snapshot {
    const cwd = process.cwd();
    const projectName = path.basename(cwd);
    const gitRes = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    const gitBranch = gitRes.ok ? gitRes.stdout.trim() : 'main';

    const sessions = this.memory.getSessions();

    return {
      phase: this.snapshotState.phase,
      detail: this.snapshotState.detail,
      startedAt: this.snapshotState.startedAt,
      projectName,
      gitBranch,
      activeModel: this.config.model?.default || 'default',
      permissionMode: getPermissionMode(),
      goalSpentUsd: this.snapshotState.goalSpentUsd,
      goalLimitUsd: this.config.budget.maxGoalCostUsd,
      monthSpentUsd: this.snapshotState.monthSpentUsd,
      monthLimitUsd: this.config.budget.maxMonthlyCostUsd,
      quota: null,
      tasks: Array.from(this.snapshotState.tasks.values()),
      verifications: Array.from(this.snapshotState.verifications.values()),
      sessions,
      proxy: {
        running: false,
        healthy: false,
        port: this.config.proxy.port,
      },
    };
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  async runGoal(goal: string): Promise<void> {
    const sessionId = crypto.randomUUID();
    const goalId = crypto.randomUUID();

    this.currentSessionId = sessionId;
    this.currentGoalId = goalId;
    this.activeAbortController = new AbortController();

    const gitBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim() || 'main';
    this.memory.createTask(goalId, goal, 'planning');
    this.memory.createSession(sessionId, goal.slice(0, 30), goalId, null, null, gitBranch);

    this.snapshotState.tasks.clear();
    this.snapshotState.verifications.clear();
    this.snapshotState.goalSpentUsd = 0;

    this.activeRunPromise = (async () => {
      try {
        await this.orchestrator.runGoal(goal, goalId);
      } catch (err: any) {
        if (err.name === 'AbortError' || err.message?.includes('aborted')) {
          this.bus.emit({
            kind: 'phase',
            id: crypto.randomUUID(),
            at: Date.now(),
            phase: 'done',
            detail: 'Interrupted',
          });
        } else {
          this.bus.emit({
            kind: 'notice',
            id: crypto.randomUUID(),
            at: Date.now(),
            level: 'error',
            text: `Goal execution failed: ${err.message}`,
          });
          this.bus.emit({ kind: 'phase', id: crypto.randomUUID(), at: Date.now(), phase: 'failed' });
        }
      } finally {
        this.activeAbortController = null;
      }
    })();

    await this.activeRunPromise;
  }

  async resume(id: string): Promise<void> {
    const session = this.memory.getSession(id);
    const taskId = session?.goal_id ?? id;
    const task = this.memory.getTask(taskId);

    if (!task) {
      this.bus.emit({
        kind: 'notice',
        id: crypto.randomUUID(),
        at: Date.now(),
        level: 'error',
        text: `Nothing to resume for ${id}.`,
      });
      return;
    }

    this.currentGoalId = taskId;
    this.activeAbortController = new AbortController();

    this.activeRunPromise = (async () => {
      try {
        await this.orchestrator.resumeTask(taskId);
      } catch (err: any) {
        this.bus.emit({
          kind: 'notice',
          id: crypto.randomUUID(),
          at: Date.now(),
          level: 'error',
          text: `Resume failed: ${err.message}`,
        });
      } finally {
        this.activeAbortController = null;
      }
    })();

    await this.activeRunPromise;
  }

  async interrupt(): Promise<void> {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
    this.orchestrator.abortActiveSessions();
    this.bus.emit({ kind: 'phase', id: crypto.randomUUID(), at: Date.now(), phase: 'done', detail: 'Interrupted' });
  }

  async shutdown(): Promise<void> {
    await this.interrupt();
    this.orchestrator.close();
    this.memory.close();
    this.memoryEngine.close();
    this.costEngine.close();
    this.router.close();
    if ((this.proxy as any).owned) {
      await this.proxy.stop();
    }
  }

  // ── commands ───────────────────────────────────────────────────────────

  async runCommand(input: string, hooks: { openOverlay: (name: string) => void }): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      await this.runGoal(trimmed);
      return;
    }

    const spaceIdx = trimmed.indexOf(' ');
    const cmdName = (spaceIdx >= 0 ? trimmed.slice(1, spaceIdx) : trimmed.slice(1)).toLowerCase();

    switch (cmdName) {
      case 'tasks':
      case 'verification':
      case 'budget':
      case 'sessions':
      case 'help':
      case 'proxy':
        hooks.openOverlay(cmdName);
        break;
      case 'clear':
        this.snapshotState.tasks.clear();
        this.snapshotState.verifications.clear();
        break;
      case 'mode':
        this.cyclePermissionMode();
        break;
      case 'login':
        await this.refreshCatalog();
        hooks.openOverlay('proxy');
        break;
      default:
        this.bus.emit({
          kind: 'notice',
          id: crypto.randomUUID(),
          at: Date.now(),
          level: 'warn',
          text: `Unknown command: /${cmdName}. Type /help for available commands.`,
        });
        break;
    }
  }

  // ── auth ───────────────────────────────────────────────────────────────

  async refreshCatalog(): Promise<Catalog> {
    const cat = await this.authService.refresh();
    this.router.setCatalog(cat);
    return cat;
  }

  catalog(): Catalog | null {
    return this.authService.current();
  }

  findProvider(id: string): ProviderInfo | undefined {
    return this.authService.current()?.providers.find((p: ProviderInfo) => p.id === id);
  }

  async setApiKey(providerId: string, key: string): Promise<{ ok: boolean; error?: string }> {
    return this.authService.setApiKey(providerId, key);
  }

  async startOAuth(providerId: string, methodIndex: number): Promise<OAuthSession> {
    return this.authService.startOAuth(providerId, methodIndex);
  }

  async awaitOAuth(
    session: OAuthSession,
    options?: { onTick?: (ms: number) => void; signal?: AbortSignal },
  ): Promise<{ ok: boolean; error?: string }> {
    return this.authService.awaitOAuth(session, options);
  }

  async completeOAuth(session: OAuthSession, code: string): Promise<{ ok: boolean; error?: string }> {
    return this.authService.completeOAuth(session, code);
  }

  async startWebOnboarding(): Promise<{ url: string; stop: () => void }> {
    const cat = await this.refreshCatalog();
    const handle = await startWebOnboarding(this.authService, cat);
    return { url: handle.url, stop: handle.stop };
  }

  async hasUsableProvider(): Promise<boolean> {
    try {
      const status = await this.opencodeOrchestrator.getAuthStatus();
      if (status.authenticated) return true;
    } catch {
      // client error
    }
    const cat = await this.refreshCatalog();
    return cat.providers.some((p) => p.connected);
  }

  // ── models ─────────────────────────────────────────────────────────────

  setModelForRole(role: string, providerID: string, modelID: string): void {
    const updated = {
      ...this.config,
      model: {
        ...this.config.model,
        [role]: `${providerID}/${modelID}`,
      },
    };
    configStore.save(updated as any);
  }

  // ── proxy ──────────────────────────────────────────────────────────────

  async enableProxy(): Promise<{ ok: boolean; error?: string; needsConsent?: boolean; needsInstall?: boolean }> {
    if (!hasAcceptedRisk()) {
      return { ok: false, needsConsent: true };
    }
    if (!this.proxy.detectInstalled().installed) {
      return { ok: false, needsInstall: true };
    }
    const started = await this.proxy.start();
    if (!started.healthy) return { ok: false, error: started.message };

    const registered = await registerAntigravityProvider(this.client);
    if (!registered.ok) {
      return { ok: false, error: registered.error || 'Failed to register proxy provider with OpenCode' };
    }
    return { ok: true };
  }

  async disableProxy(): Promise<void> {
    await this.proxy.stop();
  }

  async proxyStatus(): Promise<Snapshot['proxy']> {
    const health = await this.proxy.health();
    return {
      running: health.running,
      healthy: health.healthy,
      port: health.port,
      accounts: health.accounts,
      message: health.message,
    };
  }

  acceptProxyRisk(): void {
    acceptRisk();
  }

  // ── trust ──────────────────────────────────────────────────────────────

  trustDirectory(scope: 'session' | 'permanent'): void {
    const cwd = process.cwd();
    if (scope === 'session') {
      this.trustedSessionDirs.add(cwd);
    } else {
      checkTrust(cwd);
    }
  }

  isDirectoryTrusted(): boolean {
    const cwd = process.cwd();
    return this.trustedSessionDirs.has(cwd) || checkTrust(cwd) !== undefined;
  }

  // ── sessions ───────────────────────────────────────────────────────────

  renameSession(id: string, name: string): void {
    this.memory.renameSession(id, name);
  }

  deleteSession(id: string): void {
    this.memory.deleteSession(id);
  }

  // ── modes / approvals ──────────────────────────────────────────────────

  cyclePermissionMode(): void {
    const modes: Snapshot['permissionMode'][] = ['plan', 'acceptEdits', 'auto'];
    const current = getPermissionMode();
    const next = modes[(modes.indexOf(current as any) + 1) % modes.length];
    setPermissionMode(next);
  }

  resolveApproval(requestId: string, decision: 'yes' | 'always' | 'no'): void {
    this.orchestrator.resolveApproval(requestId, decision);
  }

  resolveEscalation(requestId: string, optionId: string, guidance?: string): void {
    this.orchestrator.resolveEscalation(requestId, optionId, guidance);
  }

  exitCode(): number {
    return 0;
  }
}

export async function createController(options: CreateControllerOptions): Promise<SessionControllerImpl> {
  const opencodeOrchestrator = await OpencodeOrchestrator.initialize();
  return new SessionControllerImpl(options, opencodeOrchestrator);
}
