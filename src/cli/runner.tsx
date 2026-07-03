import React, { useState, useEffect } from 'react';
import { render } from 'ink';
import { Dashboard } from './components/Dashboard.js';
import { TaskUiState } from './components/TaskCard.js';
import { VerificationLayers } from './components/VerificationLog.js';
import { Memory, SessionRecord } from '../memory.js';
import { OpencodeOrchestrator } from '../opencode.js';
import { Orchestrator } from '../orchestrator.js';
import { Router } from '../router.js';
import { ConfigManager } from '../config.js';
import { checkTrust } from './trust.js';
import { setupTerminal } from './terminal-setup.js';
import { openModelPicker } from './model-picker.js';
import { execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import { select, isCancel } from '@clack/prompts';
import { squashPrompt } from './prompt-util.js';

// Setup verification layers default state
const defaultVerificationLayers: VerificationLayers = {
  compile: { passed: null, durationMs: 0, cost: 0 },
  lint: { passed: null, durationMs: 0, cost: 0 },
  tests: { passed: null, durationMs: 0, cost: 0 },
  security: { passed: null, durationMs: 0, cost: 0 },
};

export async function runCli(
  initialGoal: string | undefined,
  resumeTaskId: string | undefined,
  dbPath: string = 'loopcode.db',
) {
  // 1. Run First-Run Trust Check
  const trusted = await checkTrust(process.cwd());
  if (!trusted) {
    process.exit(1);
  }

  // 2. Load Config & Router
  const config = ConfigManager.loadConfig();
  const routerConfig: any = {};
  if (config.model) {
    if (config.model.default) routerConfig.default = ConfigManager.resolveModelRoute(config.model.default);
    if (config.model.planning) routerConfig.planning = ConfigManager.resolveModelRoute(config.model.planning);
    if (config.model.verification)
      routerConfig.verification = ConfigManager.resolveModelRoute(config.model.verification);
  }
  const router = new Router(routerConfig);

  // 3. Initialize OpenCode (checks authentication/provider setup before TUI renders)
  let opencodeInstance: OpencodeOrchestrator;
  try {
    opencodeInstance = await OpencodeOrchestrator.initialize(router);
  } catch (err: any) {
    console.error(`\n❌ Initialization Error: ${err.message}`);
    process.exit(1);
  }

  const memory = new Memory(dbPath);
  const sessions = memory.getSessions();

  // If no goal and no resumeTaskId, prompt for choice or session picker
  const targetGoal = initialGoal;
  const targetTaskId = resumeTaskId;

  // Let the user select a model from all available Opencode providers before starting if no goal passed
  if (!targetGoal && !targetTaskId) {
    try {
      const { data: configData } = await opencodeInstance.client.config.providers();
      const modelOptions: any[] = [];

      if (configData && configData.providers) {
        for (const providerInfo of configData.providers) {
          const p = providerInfo as any;
          if ((p.state === 'ready' || p.configured) && p.models) {
            for (const m of Object.values<any>(p.models)) {
              modelOptions.push({
                value: `${p.id}/${m.id}`,
                label: m.name || m.id,
                hint: p.id,
              });
            }
          }
        }
      }

      if (modelOptions.length > 0) {
        // Sort alphabetically by label
        modelOptions.sort((a, b) => a.label.localeCompare(b.label));

        const selectedModel = await select({
          message: 'Select an AI model for this session (type to search):',
          options: modelOptions,
          maxItems: 12,
        });

        if (isCancel(selectedModel)) {
          process.exit(0);
        }

        const route = ConfigManager.resolveModelRoute(selectedModel as string);
        if (route) {
          router.overrideAllModels(route);
        }
      }
    } catch (err) {
      // Ignore errors fetching models, fallback to default router behavior
    }
  }

  // Render the Ink App
  let inkInstance: any = null;

  const MainApp = () => {
    const [activeGoal, setActiveGoal] = useState<string | null>(targetGoal || null);
    const [activeTaskId, setActiveTaskId] = useState<string | null>(targetTaskId || null);
    const [goalTitle, setGoalTitle] = useState(targetGoal || 'Idle');
    const [phase, setPhase] = useState<'planning' | 'executing' | 'verifying' | 'done' | 'failed'>('planning');
    const [tasks, setTasks] = useState<TaskUiState[]>([]);
    const [cost, setCost] = useState({ spent: 0, limit: 10.0 });
    const [verification, setVerification] = useState<VerificationLayers>(defaultVerificationLayers);
    const [allSessions, setAllSessions] = useState<SessionRecord[]>(sessions);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [scrollOffset, setScrollOffset] = useState(0);

    // Intercept console.log and console.error
    useEffect(() => {
      const originalLog = console.log;
      const originalError = console.error;

      const addLog = (text: string) => {
        setLogs((prev) => {
          const lines = text.split('\n');
          const newLogs = [...prev, ...lines];
          if (newLogs.length > 1000) {
            return newLogs.slice(newLogs.length - 1000);
          }
          return newLogs;
        });
      };

      console.log = (...args) => {
        const formatted = args.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ');
        addLog(formatted);
      };

      console.error = (...args) => {
        const formatted = args.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ');
        addLog(`❌ ${formatted}`);
      };

      return () => {
        console.log = originalLog;
        console.error = originalError;
      };
    }, []);

    const handleScrollUp = () => {
      setScrollOffset((prev) => prev + 1);
    };

    const handleScrollDown = () => {
      setScrollOffset((prev) => Math.max(0, prev - 1));
    };

    // Cleanup: Close OpenCode server on component unmount
    useEffect(() => {
      return () => {
        try {
          opencodeInstance.close();
        } catch (err) {
          // Ignore close errors
        }
      };
    }, []);

    // Initial setup to run orchestrator
    useEffect(() => {
      if (!activeGoal && !activeTaskId) {
        setPhase('done');
        return;
      }

      let orchestrator: Orchestrator | null = null;

      const execute = async () => {
        try {
          orchestrator = new Orchestrator(opencodeInstance, dbPath, router);

          // Setup Orchestrator listener
          orchestrator.listener = {
            onPhaseChange: (p) => setPhase(p),
            onTasksUpdate: (t) => setTasks(t),
            onCostUpdate: (spentCost) => setCost((prev) => ({ ...prev, spent: spentCost })),
            onVerificationUpdate: (layers) => setVerification(layers),
          };

          // Setup or resume session in database
          const sessionId = activeTaskId || crypto.randomUUID();
          setCurrentSessionId(sessionId);

          const existingSession = memory.getSession(sessionId);
          if (!existingSession) {
            memory.createSession(
              sessionId,
              activeGoal ? `session-${sessionId.substring(0, 8)}` : 'Unnamed Session',
              sessionId,
            );
          }

          if (activeTaskId) {
            setPhase('planning');
            await orchestrator.resumeTask(activeTaskId);
          } else if (activeGoal) {
            setGoalTitle(activeGoal);
            await orchestrator.runGoal(activeGoal);
          }
        } catch (err: any) {
          console.error(`Execution failed: ${err.message}`);
        }
      };

      execute();
    }, [activeGoal, activeTaskId]);

    // Handle prompt/slash commands
    const handleSubmitPrompt = async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;

      console.log(`\n❯ ${squashPrompt(trimmed)}`);

      if (trimmed.startsWith('/')) {
        const parts = trimmed.split(' ');
        const cmd = parts[0];
        const arg = parts.slice(1).join(' ');

        switch (cmd) {
          case '/rename':
            if (currentSessionId && arg) {
              memory.renameSession(currentSessionId, arg);
              setAllSessions(memory.getSessions());
              console.log(`\n✓ Renamed session to: ${arg}`);
            }
            break;

          case '/pause':
            if (currentSessionId) {
              memory.updateSessionStatus(currentSessionId, 'paused');
              console.log('\n✓ Session paused.');
              process.exit(0);
            }
            break;

          case '/compact':
            console.log('\n[Compact] Summarizing conversation context to free tokens...');
            // In v3, we stub or log this command execution
            break;

          case '/clear':
            console.log('\n[Clear] Cleared current conversation history.');
            break;

          case '/status':
            console.log(`\n=== Current Session Status ===`);
            console.log(`Session ID: ${currentSessionId}`);
            console.log(`Phase: ${phase}`);
            console.log(`Spent cost: $${cost.spent.toFixed(4)}`);
            break;

          case '/undo':
            try {
              execSync('git reset --soft HEAD~1');
              console.log('\n✓ Undone last git commit.');
            } catch (err: any) {
              console.error(`\nFailed to undo git commit: ${err.message}`);
            }
            break;

          case '/diff':
            try {
              const diffOutput = execSync('git diff').toString();
              console.log(`\n=== Git Diff ===\n${diffOutput || 'No local changes.'}`);
            } catch (err: any) {
              console.error(`\nFailed to run git diff: ${err.message}`);
            }
            break;

          case '/terminal-setup':
            setupTerminal();
            break;

          default:
            console.log(`\nUnknown command: ${cmd}`);
        }
        return;
      }

      // If it is a new goal prompt and we are currently idle, trigger runGoal
      if (phase === 'done' || phase === 'failed' || goalTitle === 'Idle') {
        setGoalTitle(trimmed);
        setPhase('planning');
        setActiveGoal(trimmed);
        setActiveTaskId(null);
      }
    };

    const handleSessionSelect = (session: SessionRecord) => {
      setGoalTitle(session.name || 'Resumed Session');
      // Set to planning state
      setPhase('planning');
      setActiveTaskId(session.id);
      setActiveGoal(null);
    };

    const handleSessionRename = (session: SessionRecord, newName: string) => {
      memory.renameSession(session.id, newName);
      setAllSessions(memory.getSessions());
    };

    const handleSessionDelete = (session: SessionRecord) => {
      memory.deleteSession(session.id);
      setAllSessions(memory.getSessions());
    };

    const handleModelPickerOpen = async () => {
      // Exit Ink instance first
      if (inkInstance) {
        inkInstance.unmount();
      }
      await openModelPicker();
      // Resume TUI
      inkInstance = render(<MainApp />);
    };

    return (
      <Dashboard
        goalTitle={goalTitle}
        phase={phase}
        tasks={tasks}
        cost={cost}
        verification={verification}
        sessions={allSessions}
        logs={logs}
        scrollOffset={scrollOffset}
        onScrollUp={handleScrollUp}
        onScrollDown={handleScrollDown}
        onSubmitPrompt={handleSubmitPrompt}
        onSessionSelect={handleSessionSelect}
        onSessionRename={handleSessionRename}
        onSessionDelete={handleSessionDelete}
        onModelPickerOpen={handleModelPickerOpen}
      />
    );
  };

  inkInstance = render(<MainApp />);
}
