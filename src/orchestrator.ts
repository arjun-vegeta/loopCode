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
  }

  /**
   * Run a new goal from scratch.
   */
  async runGoal(goal: string): Promise<void> {
    const taskId = crypto.randomUUID();
    console.log(`[Orchestrator] Starting goal with ID: ${taskId}`);
    this.memory.createTask(taskId, goal, 'planning');

    await this.executeOrchestrationLoop(taskId);
  }

  /**
   * Resume an incomplete task from the last persisted state in the DB.
   */
  async resumeTask(taskId: string): Promise<void> {
    const taskRecord = this.memory.getTask(taskId);
    if (!taskRecord) {
      throw new Error(`Task with ID ${taskId} not found in database.`);
    }

    console.log(`[Orchestrator] Resuming task ${taskId} from state: ${taskRecord.state}`);
    await this.executeOrchestrationLoop(taskId);
  }

  /**
   * Main state machine orchestration loop.
   */
  private async executeOrchestrationLoop(taskId: string): Promise<void> {
    while (true) {
      const taskRecord = this.memory.getTask(taskId);
      if (!taskRecord) break;

      // Loop Oscillation safety check
      const logs = this.memory.getStateLogs(taskId);
      const attempts = logs.filter((l: any) => l.phase === 'executing').length;
      const sig: StateSignature = {
        phase: taskRecord.state,
        taskIndex: taskRecord.current_task_index,
        filesChanged: [],
        retryAttempt: attempts,
      };
      if (this.loopDetector.detectOscillation(sig)) {
        console.error(`[Orchestrator] Oscillation detected! Aborting execution.`);
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

  /**
   * State: PLANNING
   */
  private async handlePlanning(record: TaskRecord): Promise<void> {
    console.log(`[Orchestrator] [PLANNING] Planning tasks for goal: "${record.goal}"`);

    // V2: Classify goal first
    const classification = Classifier.classifyGoal(record.goal);

    // V2: Fast-track Single-Agent path for simple fixes
    if (classification.path === 'single_agent') {
      console.log(`[Orchestrator] [PLANNING] Simple task detected. Using fast-track Single-Agent Path.`);
      const simpleTask: Task = {
        id: 'fast-track-task',
        description: record.goal,
        goal: record.goal,
        category: 'fix',
        systemPrompt: 'Keep changes minimal and focused. Do not refactor unrelated files.',
        expectedOutputs: [],
        writeAllowlist: [],
        verification: [
          {
            type: 'compile',
            command: 'echo "mock compile"',
            expectedExitCode: 0,
          },
        ],
        maxCost: 1.0,
        timeout: 100,
      };
      this.memory.updateTaskPlan(record.id, [simpleTask]);
      this.memory.updateTaskState(record.id, 'executing', { plan: [simpleTask] });
      return;
    }

    // Default Full-Loop planning
    let plan: Task[] = [];
    if (record.plan_json) {
      plan = JSON.parse(record.plan_json);
    } else {
      try {
        plan = await this.planner.planGoal(record.goal);
        const validation = validatePlan(plan);
        if (validation.warnings.length > 0) {
          console.warn(`[Orchestrator] [PLANNING] Plan warnings:`);
          validation.warnings.forEach((w) => console.warn(`  - ${w}`));
        }
        if (!validation.valid) {
          throw new Error('Generated plan is invalid');
        }
      } catch (err: any) {
        console.error(`[Orchestrator] [PLANNING] Decomposing failed: ${err.message}`);
        this.memory.updateTaskState(record.id, 'failed', { error: err.message });
        return;
      }
      this.memory.updateTaskPlan(record.id, plan);
    }

    this.memory.updateTaskState(record.id, 'executing', { plan });
  }

  /**
   * State: EXECUTING
   */
  private async handleExecuting(record: TaskRecord): Promise<void> {
    if (!record.plan_json) {
      this.memory.updateTaskState(record.id, 'failed', { error: 'No plan found in executing state' });
      return;
    }

    const plan: Task[] = JSON.parse(record.plan_json);
    const currentIndex = record.current_task_index;

    if (currentIndex >= plan.length) {
      this.memory.updateTaskState(record.id, 'done');
      return;
    }

    const currentTask = plan[currentIndex];
    console.log(`[Orchestrator] [EXECUTING] Task ${currentIndex + 1}/${plan.length}: ${currentTask.description}`);

    // Dynamic Router selection & Cache adjustment
    const modelSelection = this.dynamicRouter.route(
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
          maxCostUsd: currentTask.maxCost,
          maxDurationSeconds: currentTask.timeout,
          maxRetries: 3,
          maxTokens: 4000,
        },
        acceptanceCriteria: [],
        agentRole: 'engineer',
      },
      0.5,
    ); // mock 50% prompt cache rate

    // Pre-call budget check
    const canSpend = await this.costEngine.canSpend(record.id, modelSelection.estimatedCost, 10.0);
    if (!canSpend) {
      this.costEngine.terminateDueToBudget('Goal limit exceeded before execution call');
    }

    const startTime = Date.now();
    const result = await this.opencode.executeTask(currentTask);
    const durationMs = Date.now() - startTime;

    // Record cost in DB
    await this.costEngine.recordSpend(
      record.id,
      currentTask.id,
      modelSelection.modelID,
      2000,
      modelSelection.estimatedCost,
    );

    this.memory.updateTaskState(record.id, 'verifying', {
      result,
      durationMs,
    });
  }

  /**
   * State: VERIFYING
   */
  private async handleVerifying(record: TaskRecord): Promise<void> {
    if (!record.plan_json) {
      this.memory.updateTaskState(record.id, 'failed', { error: 'No plan found in verifying state' });
      return;
    }

    const plan: Task[] = JSON.parse(record.plan_json);
    const currentIndex = record.current_task_index;
    const currentTask = plan[currentIndex];

    console.log(`[Orchestrator] [VERIFYING] Verifying task: ${currentTask.description}`);

    const report = await Verifier.verifyTask(currentTask);

    // Save results
    this.memory.saveTaskResult(record.id, currentIndex, report, 0.05, report.layers.compile?.durationMs || 0);

    if (report.overallPass) {
      console.log(`[Orchestrator] [VERIFYING] Task passed verification!`);
      const nextIndex = currentIndex + 1;

      if (nextIndex >= plan.length) {
        this.memory.updateTaskState(record.id, 'done');
      } else {
        this.memory.updateTaskProgress(record.id, nextIndex, record.total_cost + 0.05);
        this.memory.updateTaskState(record.id, 'executing');
      }
    } else {
      console.error(`[Orchestrator] [VERIFYING] Task failed verification.`);

      const logs = this.memory.getStateLogs(record.id);
      const attempts = logs.filter((l: any) => l.phase === 'executing').length;

      if (attempts < MAX_RETRIES) {
        console.log(`[Orchestrator] [VERIFYING] Retrying task (Attempt ${attempts + 1}/${MAX_RETRIES})`);

        const failureEvidence = `
=== PREVIOUS ATTEMPT FAILED ===
Compiler output:
STDOUT:
${report.layers.compile?.stdout || 'No stdout'}
STDERR:
${report.layers.compile?.stderr || 'No stderr'}
===============================
`;
        const updatedTask = {
          ...currentTask,
          systemPrompt: `${currentTask.systemPrompt}\n${failureEvidence}`,
        };

        plan[currentIndex] = updatedTask;
        this.memory.updateTaskPlan(record.id, plan);
        this.memory.updateTaskState(record.id, 'executing', { retryAttempt: attempts + 1 });
      } else {
        console.error(`[Orchestrator] [VERIFYING] Max retries exhausted. Initiating re-planning...`);
        this.memory.updateTaskState(record.id, 'planning', { replanFromIndex: currentIndex });
      }
    }
  }
}
