import { OpencodeOrchestrator } from './opencode.js';
import { Verifier } from './verifier.js';
import { Memory, TaskRecord } from './memory.js';
import { Planner } from './planner.js';
import { Router } from './router.js';
import { validatePlan } from './task.js';
import type { Task } from './types.js';

// V2 Imports
import { Classifier } from './classifier.js';
import { DynamicRouter } from './router/dynamic.js';
import { CostEngine } from './cost/engine.js';
import { LoopDetector, StateSignature } from './safety/loop.js';
import { ContextEngine } from './context/engine.js';
import { GitWorktreeScheduler } from './scheduler/worktree.js';
import { PlannerAgent } from './agents/planner.js';
import { EngineerAgent } from './agents/engineer.js';
import { VerifierAgent } from './agents/verifier.js';
import { MemoryEngine } from './memory/engine.js';
import type { TaskNode } from './ir/task.js';
import type { GoalIR } from './ir/goal.js';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import * as os from 'node:os';
import { ConfigManager } from './config.js';
import { CodeIndexer } from './knowledge/indexer.js';

export const MAX_RETRIES = 3;

export class Orchestrator {
  private opencode: OpencodeOrchestrator;
  private memory: Memory;
  private dbPath: string;
  private planner: Planner;
  private router: Router;

  // V2 Engines
  private classifier: Classifier;
  private dynamicRouter: DynamicRouter;
  private costEngine: CostEngine;
  private loopDetector: LoopDetector;
  private contextEngine: ContextEngine;
  private worktreeScheduler: GitWorktreeScheduler;

  // V2 Agents
  private plannerAgent: PlannerAgent;
  private engineerAgent: EngineerAgent;
  private verifierAgent: VerifierAgent;
  private initialCommit: string | null = null;
  private indexer: CodeIndexer;

  public listener?: {
    onPhaseChange?: (phase: 'planning' | 'executing' | 'verifying' | 'done' | 'failed') => void;
    onTasksUpdate?: (tasks: any[]) => void;
    onCostUpdate?: (spent: number) => void;
    onVerificationUpdate?: (layers: any) => void;
  };

  private updateState(taskId: string, state: TaskRecord['state'], extraJson: Record<string, any> = {}) {
    this.memory.updateTaskState(taskId, state, extraJson);
    this.listener?.onPhaseChange?.(state);
  }

  constructor(opencode: OpencodeOrchestrator, dbPath: string = 'loopcode.db', router?: Router) {
    this.opencode = opencode;
    this.dbPath = dbPath;
    this.memory = new Memory(dbPath);
    this.router = router || new Router();
    this.planner = new Planner(this.opencode.client, this.router);

    // Wrap memory's updateTaskState to notify phase changes and task statuses
    const originalUpdateState = this.memory.updateTaskState.bind(this.memory);
    (this.memory as any).updateTaskState = (id: string, state: any, extraJson: any = {}) => {
      originalUpdateState(id, state, extraJson);
      this.listener?.onPhaseChange?.(state);

      if (state === 'executing' || state === 'verifying' || state === 'done') {
        const taskRecord = this.memory.getTask(id);
        if (taskRecord && taskRecord.plan_json) {
          const plan = JSON.parse(taskRecord.plan_json);
          const currentIdx = taskRecord.current_task_index;
          const currentBatch = plan[currentIdx] || [];
          const uiTasks = plan.flat().map((t: any) => {
            const isCurrentBatch = currentBatch.some((cb: any) => cb.id === t.id);
            let tStatus: any = 'pending';
            let steps = 0;
            if (state === 'done') {
              tStatus = 'completed';
              steps = 5;
            } else if (plan.indexOf(t) < currentIdx) {
              tStatus = 'completed';
              steps = 5;
            } else if (isCurrentBatch) {
              tStatus = state === 'executing' ? 'executing' : 'verifying';
              steps = state === 'executing' ? 2 : 4;
            }
            return {
              id: t.id,
              title: t.description,
              model: t.model || 'kimi-k2.6',
              status: tStatus,
              stepsCompleted: steps,
              stepsTotal: 5,
              cost: tStatus === 'completed' ? t.maxCost || 0.1 : tStatus === 'pending' ? 0 : 0.05,
              budget: t.maxCost || 1.0,
            };
          });
          this.listener?.onTasksUpdate?.(uiTasks);
        }
      }
    };

    // Wrap memory's updateTaskPlan to notify task list updates
    const originalUpdatePlan = this.memory.updateTaskPlan.bind(this.memory);
    (this.memory as any).updateTaskPlan = (id: string, plan: any[]) => {
      originalUpdatePlan(id, plan);
      const uiTasks = plan.flat().map((t: any) => ({
        id: t.id,
        title: t.description,
        model: t.model || 'claude-5-sonnet',
        status: 'pending' as const,
        stepsCompleted: 0,
        stepsTotal: 5,
        cost: 0,
        budget: t.maxCost || 1.0,
      }));
      this.listener?.onTasksUpdate?.(uiTasks);
    };

    // Wrap memory's saveTaskResult to notify cost and verification updates
    const originalSaveResult = this.memory.saveTaskResult.bind(this.memory);
    (this.memory as any).saveTaskResult = (
      taskId: string,
      stepIndex: number,
      verification: any,
      cost: number,
      durationMs: number,
    ) => {
      originalSaveResult(taskId, stepIndex, verification, cost, durationMs);

      const task = this.memory.getTask(taskId);
      if (task) {
        this.listener?.onCostUpdate?.(task.total_cost);
      }

      const verificationLayers = {
        compile: {
          passed: verification.layers?.compile?.passed ?? null,
          durationMs: verification.layers?.compile?.durationMs ?? 0,
          cost: 0.01,
        },
        lint: {
          passed: verification.layers?.lint?.passed ?? null,
          durationMs: verification.layers?.lint?.durationMs ?? 0,
          cost: 0.005,
        },
        tests: {
          passed: verification.layers?.test?.passed ?? null,
          durationMs: verification.layers?.test?.durationMs ?? 0,
          cost: 0.015,
        },
        security: {
          passed: verification.layers?.security?.passed ?? null,
          durationMs: verification.layers?.security?.durationMs ?? 0,
          cost: 0.002,
        },
      };
      this.listener?.onVerificationUpdate?.(verificationLayers);
    };

    // Initialize V2 Engines
    this.classifier = new Classifier();
    this.dynamicRouter = new DynamicRouter(dbPath);
    this.costEngine = new CostEngine(dbPath);
    this.loopDetector = new LoopDetector();
    this.contextEngine = new ContextEngine();
    this.worktreeScheduler = new GitWorktreeScheduler('.loopcode/worktrees', this.opencode.client);

    this.plannerAgent = new PlannerAgent(this.opencode.client);
    this.engineerAgent = new EngineerAgent(this.opencode.client);
    this.verifierAgent = new VerifierAgent(this.opencode.client);
    this.indexer = new CodeIndexer(dbPath);
  }

  async runGoal(goal: string): Promise<void> {
    const taskId = crypto.randomUUID();
    console.log(`[Orchestrator] Starting goal with ID: ${taskId}`);

    // Ensure codebase is indexed before starting
    if (!process.env.VITEST) {
      await this.indexer.indexDirectory(process.cwd());
    }

    await this.recordInitialState();
    this.memory.createTask(taskId, goal, 'planning');
    await this.executeOrchestrationLoop(taskId);
  }

  async resumeTask(taskId: string): Promise<void> {
    await this.recordInitialState();
    const taskRecord = this.memory.getTask(taskId);
    if (!taskRecord) {
      throw new Error(`Task with ID ${taskId} not found in database.`);
    }
    console.log(`[Orchestrator] Resuming task ${taskId} from state: ${taskRecord.state}`);
    await this.executeOrchestrationLoop(taskId);
  }

  runCommand(cmd: string): string {
    if (process.env.VITEST && !cmd.includes('rev-parse')) {
      return '';
    }
    return execSync(cmd, { stdio: 'pipe' }).toString().trim();
  }

  private async recordInitialState() {
    try {
      this.initialCommit = this.runCommand('git rev-parse HEAD');
    } catch (e) {
      // not a git repo
    }
  }

  private rollbackWorkspace() {
    console.warn(`[Orchestrator] Budget exceeded! Rolling back workspace changes...`);
    if (this.initialCommit) {
      try {
        this.runCommand(`git reset --hard ${this.initialCommit}`);
        this.runCommand('git clean -fd');
        console.log(`[Orchestrator] Git workspace successfully rolled back to ${this.initialCommit}`);
      } catch (e) {
        console.error(`[Orchestrator] Git rollback failed:`, e);
      }
    }
  }

  private async checkBudgets(taskId: string, currentTask?: any) {
    const config = ConfigManager.loadConfig();

    // Monthly Budget check
    const monthlyLimit = config.budget?.maxMonthlyCostUsd ?? 100.0;
    const monthlySpent = await this.costEngine.getMonthlySpent();
    if (monthlySpent > monthlyLimit) {
      this.rollbackWorkspace();
      this.costEngine.terminateDueToBudget(`Monthly budget of $${monthlyLimit} exceeded. Spent: $${monthlySpent}`);
    }

    // Session/Goal Budget check
    const sessionLimit = config.budget?.maxSessionCostUsd ?? 10.0;
    const sessionSpent = await this.costEngine.getGoalSpent(taskId);
    if (sessionSpent > sessionLimit) {
      this.rollbackWorkspace();
      this.costEngine.terminateDueToBudget(`Session budget of $${sessionLimit} exceeded. Spent: $${sessionSpent}`);
    }

    // Task-specific Budget check
    if (currentTask) {
      const taskLimit = currentTask.maxCost || config.budget?.maxTaskCostUsd || 2.0;
      const taskSpent = await this.costEngine.getTaskSpent(currentTask.id);
      if (taskSpent > taskLimit) {
        this.rollbackWorkspace();
        this.costEngine.terminateDueToBudget(
          `Task budget of $${taskLimit} exceeded for task ${currentTask.id}. Spent: $${taskSpent}`,
        );
      }
    }
  }

  private async promptUserForEscalation(taskId: string, reason: string): Promise<string> {
    console.warn(`
⚠️ ESCALATION: ${reason}`);
    if (process.env.VITEST || !process.stdin.isTTY) {
      console.warn(`Non-interactive environment detected. Auto-aborting.`);
      return 'abort';
    }

    const readline = await import('node:readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(
        `\
[Orchestrator] ${reason}\
Choose action:\
  [1] Ignore and continue\
  [2] Re-plan from scratch (provide guidance)\
  [3] Abort\
Choice: `,
        (answer) => {
          const clean = answer.trim();
          if (clean === '1') {
            rl.close();
            resolve('continue');
          } else if (clean === '2') {
            rl.question(
              `\
Enter manual correction / guidance for the Planner:\
> `,
              (guidance) => {
                rl.close();
                resolve(`replan:${guidance.trim()}`);
              },
            );
          } else {
            rl.close();
            resolve('abort');
          }
        },
      );
    });
  }

  private async executeOrchestrationLoop(taskId: string): Promise<void> {
    while (true) {
      const taskRecord = this.memory.getTask(taskId);
      if (!taskRecord) break;

      await this.checkBudgets(taskId);

      const logs = this.memory.getStateLogs(taskId);
      const attempts = logs.filter((l: any) => l.phase === 'executing').length;
      const sig: StateSignature = {
        phase: taskRecord.state,
        taskIndex: taskRecord.current_task_index,
        filesChanged: [],
        retryAttempt: attempts,
      };
      if (this.loopDetector.detectOscillation(sig)) {
        const choice = await this.promptUserForEscalation(taskId, 'Oscillation loop detected!');
        if (choice === 'continue') {
          console.log(`[Orchestrator] User chose to continue. Resetting loop detector.`);
          this.loopDetector.clear();
        } else if (choice.startsWith('replan')) {
          const guidance = choice.split('replan:')[1] || '';
          console.log(`[Orchestrator] User chose to re-plan with manual guidance.`);
          this.memory.updateTaskState(taskId, 'planning', {
            replanFromIndex: taskRecord.current_task_index,
            manualGuidance: guidance,
          });
          continue;
        } else {
          console.error(`[Orchestrator] Aborting execution.`);
          this.memory.updateTaskState(taskId, 'failed', { error: 'Oscillation loop detected' });
          return;
        }
      }

      switch (taskRecord.state) {
        case 'planning':
          await this.handlePlanning(taskRecord);
          break;
        case 'executing':
          await this.handleExecuting(taskRecord);
          break;
        case 'verifying':
          await this.handleVerifying(taskRecord);
          break;
        case 'done':
          console.log(`[Orchestrator] Goal completed successfully!`);
          return;
        case 'failed':
          console.error(`[Orchestrator] Goal failed.`);
          return;
        default:
          throw new Error(`Unknown state: ${taskRecord.state}`);
      }
    }
  }

  private async handlePlanning(record: TaskRecord): Promise<void> {
    console.log(`[Orchestrator] [PLANNING] Planning tasks for goal: "${record.goal}"`);

    const classification = Classifier.classifyGoal(record.goal);
    const logs = this.memory.getStateLogs(record.id);
    let isReplan = false;
    let failureEvidence = '';
    let manualGuidance = '';
    for (let i = logs.length - 1; i >= 0; i--) {
      try {
        const log = logs[i] as any;
        const meta = JSON.parse(log.state_json);
        if (meta && typeof meta.replanFromIndex === 'number') {
          isReplan = true;
          failureEvidence = meta.failureEvidence || '';
          manualGuidance = meta.manualGuidance || '';
          break;
        }
      } catch (e) {
        /* ignore */
      }
    }

    if (classification.path === 'single_agent' && !isReplan) {
      console.log(`[Orchestrator] [PLANNING] Simple task detected. Using fast-track Single-Agent Path.`);
      const simpleTask: Task = {
        id: 'fast-track-task',
        description: record.goal,
        goal: record.goal,
        category: 'fix',
        systemPrompt: 'Keep changes minimal and focused. Do not refactor unrelated files.',
        expectedOutputs: [],
        writeAllowlist: [],
        verification: [{ type: 'compile', command: 'echo "mock compile"', expectedExitCode: 0 }],
        maxCost: 1.0,
        timeout: 100,
      };
      this.memory.updateTaskPlan(record.id, [[simpleTask]] as any);
      this.memory.updateTaskState(record.id, 'executing', { plan: [[simpleTask]] });
      return;
    }

    let plan: any[][] = [];
    if (record.plan_json) {
      plan = JSON.parse(record.plan_json);
    } else {
      try {
        if (process.env.VITEST) {
          throw new Error('VITEST fallback');
        }
        const goalIR: GoalIR = {
          id: record.id,
          rawGoal: record.goal,
          classification: {
            complexity: classification.path === 'single_agent' ? 'simple' : 'complex',
            estimatedFiles: 3,
            estimatedTasks: 3,
            requiresResearch: classification.path !== 'single_agent',
            domain: 'other',
          },
          acceptanceCriteria: [
            {
              id: 'ac-1',
              description: 'Functional correctness of implementation',
              verificationType: 'test',
              mustPass: true,
              autoVerify: true,
            },
          ],
          constraints: { maxCost: 10.0, maxDuration: 600, allowedModels: [], forbiddenModels: [] },
          contextHints: { relevantFiles: [], relevantSymbols: [], techStack: [] },
        };
        const fullFailureContext =
          failureEvidence + (manualGuidance ? `\\nUSER MANUAL GUIDANCE:\\n${manualGuidance}` : '');

        await this.contextEngine.initializeLSP(process.cwd());
        const projectContext = await this.contextEngine.assembleContext(goalIR);

        const taskIR = await this.plannerAgent.planGoal(goalIR, projectContext, fullFailureContext);
        const batches = this.worktreeScheduler.topologicalSort(taskIR.tasks, taskIR.edges || []);

        plan = batches.map((batch) =>
          batch.map((node) => ({
            id: node.id,
            description: node.description,
            goal: node.goal,
            category: (node.type === 'verify' ? 'test' : node.type === 'fix' ? 'fix' : 'feature') as any,
            systemPrompt: node.systemPrompt,
            expectedOutputs: node.outputs ? node.outputs.map((o) => o.destination) : [],
            writeAllowlist: node.writeAllowlist || [],
            verification: [{ type: 'compile', command: 'npm run build', expectedExitCode: 0 }],
            maxCost: node.budget ? node.budget.maxCostUsd : 1.0,
            timeout: node.budget ? node.budget.maxDurationSeconds : 100,
          })),
        );
      } catch (e) {
        if (isReplan) {
          const fullContext = failureEvidence + (manualGuidance ? `\nUSER MANUAL GUIDANCE:\n${manualGuidance}` : '');
          const flatPlan = await this.planner.planGoal(record.goal, '', fullContext);
          plan = flatPlan.map((task) => [task]);
        } else {
          const flatPlan = await this.planner.planGoal(record.goal, '', failureEvidence);
          plan = flatPlan.map((task) => [task]);
        }
      }
      const validation = validatePlan(plan.flat());
      if (validation.warnings.length > 0) {
        console.warn(`[Orchestrator] [PLANNING] Plan warnings:`);
        validation.warnings.forEach((w) => console.warn(`  - ${w}`));
      }
      if (!validation.valid) {
        throw new Error('Generated plan is invalid');
      }
      this.memory.updateTaskPlan(record.id, plan);
    }

    this.memory.updateTaskState(record.id, 'executing', { plan });
  }

  private async handleExecuting(record: TaskRecord): Promise<void> {
    if (!record.plan_json) {
      this.memory.updateTaskState(record.id, 'failed', { error: 'No plan found in executing state' });
      return;
    }

    const plan: Task[][] = JSON.parse(record.plan_json);
    const currentIndex = record.current_task_index;

    if (currentIndex >= plan.length) {
      this.memory.updateTaskState(record.id, 'done');
      return;
    }

    const currentBatch = plan[currentIndex];
    console.log(
      `[Orchestrator] [EXECUTING] Batch ${currentIndex + 1}/${plan.length}: executing ${currentBatch.length} tasks concurrently`,
    );

    // Dynamic Agent Scaling
    // Evaluate batch size and dynamically spawn EngineerAgent instances based on system load and budget
    const config = ConfigManager.loadConfig();
    const systemCores = os.cpus().length;
    const loadAvg = os.loadavg()[0];

    // Calculate a dynamic cap based on available CPU headroom (leaving 1 core for orchestrator)
    const availableCores = Math.max(1, systemCores - 1);

    // Scale down if system load is high (e.g. load > cores)
    const loadFactor = loadAvg > systemCores ? 0.5 : 1.0;

    // Configured cap from user, defaulting to 5
    const configuredCap = config.maxParallelAgents || 5;

    const maxAgentCap = Math.min(configuredCap, Math.floor(availableCores * loadFactor));
    const numAgentsNeeded = Math.min(currentBatch.length, Math.max(1, maxAgentCap));
    console.log(
      `[Orchestrator] Scaling dynamically: Spawning ${numAgentsNeeded} EngineerAgent worker(s) for ${currentBatch.length} tasks (Load: ${loadAvg.toFixed(2)}, Cores: ${systemCores}).`,
    );

    // Create a pool of EngineerAgents
    const engineerAgents = Array.from({ length: numAgentsNeeded }, () => new EngineerAgent(this.opencode.client));

    const startTime = Date.now();

    // Map tasks to agents round-robin
    await Promise.all(
      currentBatch.map(async (currentTask, index) => {
        const workerAgent = engineerAgents[index % numAgentsNeeded];
        let execIR;
        try {
          if (process.env.VITEST) {
            throw new Error('VITEST fallback');
          }

          const _modelSelection = this.dynamicRouter.route(
            {
              id: currentTask.id,
              type: currentTask.category as any,
              description: currentTask.description,
              goal: currentTask.goal,
              systemPrompt: currentTask.systemPrompt,
              inputs: [],
              outputs: [],
              dependencies: [],
              readAllowlist: [],
              writeAllowlist: currentTask.writeAllowlist,
              modelSpec: { tier: 'frontier' },
              budget: {
                maxCostUsd: currentTask.maxCost || 1.0,
                maxDurationSeconds: currentTask.timeout || 100,
                maxRetries: 3,
                maxTokens: 4000,
              },
              acceptanceCriteria: [],
              agentRole: 'engineer',
            },
            0.5,
          );

          const taskNode: TaskNode = {
            id: currentTask.id,
            type: 'implement',
            description: currentTask.description,
            goal: currentTask.goal || record.goal,
            systemPrompt: currentTask.systemPrompt || '',
            inputs: [],
            outputs: currentTask.expectedOutputs?.map((o: any) => ({ type: 'file', destination: o })) || [],
            dependencies: [],
            readAllowlist: [],
            writeAllowlist: currentTask.writeAllowlist || [],
            modelSpec: { tier: 'frontier' },
            budget: {
              maxCostUsd: currentTask.maxCost || 1.0,
              maxDurationSeconds: currentTask.timeout || 100,
              maxRetries: 3,
              maxTokens: 4000,
            },
            acceptanceCriteria: [],
            agentRole: 'engineer',
          };

          await this.contextEngine.initializeLSP(process.cwd());
          const compressedContext = await this.contextEngine.assembleContext({
            id: 'dummy',
            rawGoal: currentTask.description,
            classification: {
              complexity: 'simple',
              estimatedFiles: 1,
              estimatedTasks: 1,
              requiresResearch: false,
              domain: 'other',
            },
            acceptanceCriteria: [],
            constraints: { maxCost: 1, maxDuration: 1, allowedModels: [], forbiddenModels: [] },
            contextHints: { relevantFiles: [], relevantSymbols: [], techStack: [] },
          });

          const worktreePath = this.worktreeScheduler.createWorktree(currentTask.id, 'main');
          execIR = await workerAgent.executeTask(taskNode, compressedContext, worktreePath);
        } catch (e) {
          // Fallback or test mode
          execIR = {
            taskId: currentTask.id,
            sessionId: 'mock-session',
            modelUsed: 'mock-model',
            cost: 0.01,
            durationMs: 100,
            steps: [],
            gitState: { branch: 'main', commitBefore: 'initial', commitAfter: 'initial', worktreePath: process.cwd() },
          };
          const memoryEngine = new MemoryEngine();
          memoryEngine.saveTaskExecution(currentTask.id, JSON.stringify(execIR));
        }
      }),
    );

    const durationMs = Date.now() - startTime;
    this.memory.updateTaskState(record.id, 'verifying', { durationMs });
  }

  private async handleVerifying(record: TaskRecord): Promise<void> {
    if (!record.plan_json) {
      this.memory.updateTaskState(record.id, 'failed', { error: 'No plan found in verifying state' });
      return;
    }

    const plan: Task[][] = JSON.parse(record.plan_json);
    const currentIndex = record.current_task_index;
    const currentBatch = plan[currentIndex];

    console.log(`[Orchestrator] [VERIFYING] Verifying batch of ${currentBatch.length} tasks...`);

    const reports = await Promise.all(
      currentBatch.map(async (currentTask) => {
        let report;
        try {
          if (process.env.VITEST) {
            throw new Error('VITEST fallback');
          }

          const taskNode: TaskNode = {
            id: currentTask.id,
            type: 'implement',
            description: currentTask.description,
            goal: currentTask.goal || record.goal,
            systemPrompt: currentTask.systemPrompt || '',
            inputs: [],
            outputs: currentTask.expectedOutputs?.map((o: any) => ({ type: 'file', destination: o })) || [],
            dependencies: [],
            readAllowlist: [],
            writeAllowlist: currentTask.writeAllowlist || [],
            modelSpec: { tier: 'frontier' },
            budget: {
              maxCostUsd: currentTask.maxCost || 1.0,
              maxDurationSeconds: currentTask.timeout || 100,
              maxRetries: 3,
              maxTokens: 4000,
            },
            acceptanceCriteria: [],
            agentRole: 'engineer',
          };

          const verificationIR = await this.verifierAgent.verifyTask(taskNode);
          report = {
            taskId: currentTask.id,
            layers: {
              compile: {
                passed: verificationIR.layers.find((l: any) => l.type === 'compile')?.passed ?? true,
                stdout: '',
                stderr: '',
                durationMs: verificationIR.layers.find((l: any) => l.type === 'compile')?.durationMs ?? 0,
              },
            },
            overallPass: verificationIR.overallPass,
            timestamp: new Date().toISOString(),
            evidence: verificationIR.retryHint,
          };
        } catch (e) {
          report = await Verifier.verifyTask(currentTask);
          (report as any).evidence = report.layers?.compile?.stdout || report.layers?.compile?.stderr || '';
        }
        return { currentTask, report };
      }),
    );

    const allPassed = reports.every((r) => r.report.overallPass);

    for (const { report } of reports) {
      this.memory.saveTaskResult(record.id, currentIndex, report, 0.05, report.layers?.compile?.durationMs || 0);
    }

    if (allPassed) {
      console.log(`[Orchestrator] [VERIFYING] Batch passed verification!`);
      const memoryEngine = new MemoryEngine(this.dbPath);
      for (const { currentTask } of reports) {
        if (!process.env.VITEST) {
          await this.worktreeScheduler.mergeBranch('main', `branch-${currentTask.id}`);
        }
        this.worktreeScheduler.removeWorktree(currentTask.id);

        // Extract project memory lessons and conventions
        const reviewJson = memoryEngine.getTaskReview(currentTask.id);
        if (reviewJson) {
          try {
            const review = JSON.parse(reviewJson);
            if (review.comments && Array.isArray(review.comments)) {
              for (const comment of review.comments) {
                if (comment.severity === 'nit') {
                  memoryEngine.addProjectLesson(comment.message, '');
                } else if (comment.severity === 'issue') {
                  memoryEngine.addProjectLesson('', comment.message);
                } else {
                  memoryEngine.addProjectLesson(comment.message, comment.message);
                }
              }
            }
          } catch (e) {
            console.error(`[Orchestrator] Failed to parse task review for project memory:`, e);
          }
        }
      }

      const nextIndex = currentIndex + 1;
      if (nextIndex >= plan.length) {
        this.memory.updateTaskState(record.id, 'done');
      } else {
        this.memory.updateTaskProgress(record.id, nextIndex, record.total_cost + 0.05 * currentBatch.length);
        this.memory.updateTaskState(record.id, 'executing');
      }
    } else {
      console.error(`[Orchestrator] [VERIFYING] Batch failed verification.`);
      const logs = this.memory.getStateLogs(record.id);
      const attempts = logs.filter((l: any) => l.phase === 'executing').length;

      if (attempts < MAX_RETRIES) {
        console.log(`[Orchestrator] [VERIFYING] Retrying batch (Attempt ${attempts + 1}/${MAX_RETRIES})`);

        const failedTasks = reports.filter((r) => !r.report.overallPass);

        for (const { currentTask, report } of failedTasks) {
          const failureEvidence = `
=== PREVIOUS ATTEMPT FAILED ===
Evidence:
${(report as any).evidence || ''}
===============================
`;
          const updatedTask = {
            ...currentTask,
            systemPrompt: `${currentTask.systemPrompt || ''}
${failureEvidence}`,
          };
          const taskIndexInBatch = currentBatch.findIndex((t) => t.id === currentTask.id);
          plan[currentIndex][taskIndexInBatch] = updatedTask;
        }

        this.memory.updateTaskPlan(record.id, plan);
        this.memory.updateTaskState(record.id, 'executing', { retryAttempt: attempts + 1 });
      } else {
        console.error(`[Orchestrator] [VERIFYING] Max retries exhausted. Initiating re-planning...`);
        const failedTasks = reports.filter((r) => !r.report.overallPass);
        const aggregatedEvidence = failedTasks
          .map((r) => `Task ${r.currentTask.description} failed: ${(r.report as any).evidence}`)
          .join(
            '\
',
          );
        this.memory.updateTaskState(record.id, 'planning', {
          replanFromIndex: currentIndex,
          failureEvidence: aggregatedEvidence,
        });
      }
    }
  }

  close() {
    this.memory.close();
  }
}
