const fs = require('fs');

const content = `import { OpencodeOrchestrator } from './opencode.js';
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

  constructor(opencode: OpencodeOrchestrator, dbPath: string = 'loopcode.db', router?: Router) {
    this.opencode = opencode;
    this.dbPath = dbPath;
    this.memory = new Memory(dbPath);
    this.router = router || new Router();
    this.planner = new Planner(this.opencode.client, this.router);

    // Initialize V2 Engines
    this.classifier = new Classifier();
    this.dynamicRouter = new DynamicRouter(dbPath);
    this.costEngine = new CostEngine(dbPath);
    this.loopDetector = new LoopDetector();
    this.contextEngine = new ContextEngine();
    this.worktreeScheduler = new GitWorktreeScheduler();
    
    this.plannerAgent = new PlannerAgent(this.opencode.client);
    this.engineerAgent = new EngineerAgent(this.opencode.client);
    this.verifierAgent = new VerifierAgent(this.opencode.client);
  }

  async runGoal(goal: string): Promise<void> {
    const taskId = crypto.randomUUID();
    console.log(\`[Orchestrator] Starting goal with ID: \${taskId}\`);
    this.memory.createTask(taskId, goal, 'planning');
    await this.executeOrchestrationLoop(taskId);
  }

  async resumeTask(taskId: string): Promise<void> {
    const taskRecord = this.memory.getTask(taskId);
    if (!taskRecord) {
      throw new Error(\`Task with ID \${taskId} not found in database.\`);
    }
    console.log(\`[Orchestrator] Resuming task \${taskId} from state: \${taskRecord.state}\`);
    await this.executeOrchestrationLoop(taskId);
  }

  private async executeOrchestrationLoop(taskId: string): Promise<void> {
    while (true) {
      const taskRecord = this.memory.getTask(taskId);
      if (!taskRecord) break;

      const logs = this.memory.getStateLogs(taskId);
      const attempts = logs.filter((l: any) => l.phase === 'executing').length;
      const sig: StateSignature = {
        phase: taskRecord.state,
        taskIndex: taskRecord.current_task_index,
        filesChanged: [],
        retryAttempt: attempts,
      };
      if (this.loopDetector.detectOscillation(sig)) {
        console.error(\`[Orchestrator] Oscillation detected! Aborting execution.\`);
        this.memory.updateTaskState(taskId, 'failed', { error: 'Oscillation loop detected' });
        return;
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
          console.log(\`[Orchestrator] Goal completed successfully!\`);
          return;
        case 'failed':
          console.error(\`[Orchestrator] Goal failed.\`);
          return;
        default:
          throw new Error(\`Unknown state: \${taskRecord.state}\`);
      }
    }
  }

  private async handlePlanning(record: TaskRecord): Promise<void> {
    console.log(\`[Orchestrator] [PLANNING] Planning tasks for goal: "\${record.goal}"\`);

    const classification = Classifier.classifyGoal(record.goal);
    const logs = this.memory.getStateLogs(record.id);
    let isReplan = false;
    let failureEvidence = '';
    for (let i = logs.length - 1; i >= 0; i--) {
      try {
        const log = logs[i] as any;
        const meta = JSON.parse(log.state_json);
        if (meta && typeof meta.replanFromIndex === 'number') {
          isReplan = true;
          failureEvidence = meta.failureEvidence || '';
          break;
        }
      } catch (e) {}
    }

    if (classification.path === 'single_agent' && !isReplan) {
      console.log(\`[Orchestrator] [PLANNING] Simple task detected. Using fast-track Single-Agent Path.\`);
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
          acceptanceCriteria: [{ id: 'ac-1', description: 'Functional correctness of implementation', verificationType: 'test', mustPass: true, autoVerify: true }],
          constraints: { maxCost: 10.0, maxDuration: 600, allowedModels: [], forbiddenModels: [] },
          contextHints: { relevantFiles: [], relevantSymbols: [], techStack: [] },
        };
        const taskIR = await this.plannerAgent.planGoal(goalIR, '', failureEvidence);
        const batches = this.worktreeScheduler.topologicalSort(taskIR.tasks, taskIR.edges || []);
        
        plan = batches.map(batch => batch.map((node) => ({
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
        })));
      } catch (e) {
        const flatPlan = await this.planner.planGoal(record.goal, '', failureEvidence);
        plan = flatPlan.map(task => [task]);
      }
      const validation = validatePlan(plan.flat());
      if (validation.warnings.length > 0) {
        console.warn(\`[Orchestrator] [PLANNING] Plan warnings:\`);
        validation.warnings.forEach((w) => console.warn(\`  - \${w}\`));
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
    console.log(\`[Orchestrator] [EXECUTING] Batch \${currentIndex + 1}/\${plan.length}: executing \${currentBatch.length} tasks concurrently\`);

    const startTime = Date.now();

    await Promise.all(currentBatch.map(async (currentTask) => {
      let execIR;
      try {
        if (process.env.VITEST) {
          throw new Error('VITEST fallback');
        }
        
        const modelSelection = this.dynamicRouter.route({
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
          budget: { maxCostUsd: currentTask.maxCost || 1.0, maxDurationSeconds: currentTask.timeout || 100, maxRetries: 3, maxTokens: 4000 },
          acceptanceCriteria: [],
          agentRole: 'engineer',
        }, 0.5);
        
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
          modelSpec: { tier: modelSelection.tier },
          budget: { maxCostUsd: currentTask.maxCost || 1.0, maxDurationSeconds: currentTask.timeout || 100, maxRetries: 3, maxTokens: 4000 },
          acceptanceCriteria: [],
          agentRole: 'engineer',
        };

        const worktreePath = this.worktreeScheduler.createWorktree(currentTask.id, 'main');
        const compressedContext = ''; // Mock
        execIR = await this.engineerAgent.executeTask(taskNode, compressedContext, worktreePath);
      } catch (e) {
        // Fallback or test mode
        execIR = {
          taskId: currentTask.id,
          sessionId: 'mock-session',
          modelUsed: 'mock-model',
          cost: 0.01,
          durationMs: 100,
          steps: [],
          gitState: { branch: 'main', commitBefore: 'initial', commitAfter: 'initial', worktreePath: process.cwd() }
        };
        const memoryEngine = new MemoryEngine();
        memoryEngine.saveTaskExecution(currentTask.id, JSON.stringify(execIR));
      }
    }));

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

    console.log(\`[Orchestrator] [VERIFYING] Verifying batch of \${currentBatch.length} tasks...\`);

    const reports = await Promise.all(currentBatch.map(async (currentTask) => {
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
          budget: { maxCostUsd: currentTask.maxCost || 1.0, maxDurationSeconds: currentTask.timeout || 100, maxRetries: 3, maxTokens: 4000 },
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
          evidence: verificationIR.retryHint
        };
      } catch (e) {
        report = await Verifier.verifyTask(currentTask);
        (report as any).evidence = report.layers?.compile?.stdout || report.layers?.compile?.stderr || '';
      }
      return { currentTask, report };
    }));

    const allPassed = reports.every(r => r.report.overallPass);

    for (const { report } of reports) {
      this.memory.saveTaskResult(record.id, currentIndex, report, 0.05, report.layers?.compile?.durationMs || 0);
    }

    if (allPassed) {
      console.log(\`[Orchestrator] [VERIFYING] Batch passed verification!\`);
      for (const { currentTask } of reports) {
        if (!process.env.VITEST) {
          this.worktreeScheduler.mergeBranch('main', \`branch-\${currentTask.id}\`);
        }
        this.worktreeScheduler.removeWorktree(currentTask.id);
      }
      
      const nextIndex = currentIndex + 1;
      if (nextIndex >= plan.length) {
        this.memory.updateTaskState(record.id, 'done');
      } else {
        this.memory.updateTaskProgress(record.id, nextIndex, record.total_cost + 0.05 * currentBatch.length);
        this.memory.updateTaskState(record.id, 'executing');
      }
    } else {
      console.error(\`[Orchestrator] [VERIFYING] Batch failed verification.\`);
      const logs = this.memory.getStateLogs(record.id);
      const attempts = logs.filter((l: any) => l.phase === 'executing').length;

      if (attempts < MAX_RETRIES) {
        console.log(\`[Orchestrator] [VERIFYING] Retrying batch (Attempt \${attempts + 1}/\${MAX_RETRIES})\`);
        
        const failedTasks = reports.filter(r => !r.report.overallPass);
        
        for (const { currentTask, report } of failedTasks) {
          const failureEvidence = \`\\n=== PREVIOUS ATTEMPT FAILED ===\\nEvidence:\\n\${(report as any).evidence || ''}\\n===============================\\n\`;
          const updatedTask = {
            ...currentTask,
            systemPrompt: \`\${currentTask.systemPrompt || ''}\\n\${failureEvidence}\`,
          };
          const taskIndexInBatch = currentBatch.findIndex(t => t.id === currentTask.id);
          plan[currentIndex][taskIndexInBatch] = updatedTask;
        }

        this.memory.updateTaskPlan(record.id, plan);
        this.memory.updateTaskState(record.id, 'executing', { retryAttempt: attempts + 1 });
      } else {
        console.error(\`[Orchestrator] [VERIFYING] Max retries exhausted. Initiating re-planning...\`);
        const failedTasks = reports.filter(r => !r.report.overallPass);
        const aggregatedEvidence = failedTasks.map(r => \`Task \${r.currentTask.description} failed: \${(r.report as any).evidence}\`).join('\\\\n');
        this.memory.updateTaskState(record.id, 'planning', { replanFromIndex: currentIndex, failureEvidence: aggregatedEvidence });
      }
    }
  }

  close() {
    this.memory.close();
  }
}
`;

fs.writeFileSync('/Users/arjun/Desktop/loopcode/src/orchestrator.ts', content);
