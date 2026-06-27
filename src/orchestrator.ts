import { OpencodeOrchestrator } from './opencode.js';
import { Verifier } from './verifier.js';
import { Memory, TaskRecord } from './memory.js';
import { Planner } from './planner.js';
import { Router } from './router.js';
import { validatePlan } from './task.js';
import type { Task, VerificationReport } from './types.js';

export const MAX_RETRIES = 3;

export class Orchestrator {
  private opencode: OpencodeOrchestrator;
  private memory: Memory;
  private dbPath: string;
  private planner: Planner;
  private router: Router;

  constructor(opencode: OpencodeOrchestrator, dbPath: string = 'loopcode.db', router?: Router) {
    this.opencode = opencode;
    this.dbPath = dbPath;
    this.memory = new Memory(dbPath);
    this.router = router || new Router();
    this.planner = new Planner(this.opencode.client, this.router);
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
   * Call the planner to decompose the goal into tasks.
   */
  private async handlePlanning(record: TaskRecord): Promise<void> {
    console.log(`[Orchestrator] [PLANNING] Planning tasks for goal: "${record.goal}"`);
    
    // In Milestone 2/3, we will use the actual Planner.
    // For Milestone 2, we stub the planning phase if not already populated.
    let plan: Task[] = [];
    if (record.plan_json) {
      plan = JSON.parse(record.plan_json);
    } else {
      try {
        plan = await this.planner.planGoal(record.goal);
        const validation = validatePlan(plan);
        if (validation.warnings.length > 0) {
          console.warn(`[Orchestrator] [PLANNING] Plan warnings:`);
          validation.warnings.forEach(w => console.warn(`  - ${w}`));
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

    // Move to executing state
    this.memory.updateTaskState(record.id, 'executing', { plan });
  }

  /**
   * State: EXECUTING
   * Execute the current task in the plan.
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

    const startTime = Date.now();
    const result = await this.opencode.executeTask(currentTask);
    const durationMs = Date.now() - startTime;

    // Transition to verifying state with result
    this.memory.updateTaskState(record.id, 'verifying', { 
      result, 
      durationMs 
    });
  }

  /**
   * State: VERIFYING
   * Verify the execution output of the current task.
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
    
    // Run Layer 1 verification
    const report = await Verifier.verifyTask(currentTask);

    // Save task results to DB (Step index tracking)
    // For Milestone 2: We track costs as a mock 0.05 per call since we do not have full cost tracking yet.
    this.memory.saveTaskResult(record.id, currentIndex, report, 0.05, report.layers.compile?.durationMs || 0);

    if (report.overallPass) {
      console.log(`[Orchestrator] [VERIFYING] Task passed verification!`);
      const nextIndex = currentIndex + 1;
      
      if (nextIndex >= plan.length) {
        // All tasks done
        this.memory.updateTaskState(record.id, 'done');
      } else {
        // Move to next task
        this.memory.updateTaskProgress(record.id, nextIndex, record.total_cost + 0.05);
        this.memory.updateTaskState(record.id, 'executing');
      }
    } else {
      console.error(`[Orchestrator] [VERIFYING] Task failed verification.`);
      
      // Get the number of attempts for the current task
      const logs = this.memory.getStateLogs(record.id);
      const attempts = logs.filter((l: any) => l.phase === 'executing').length;

      if (attempts < MAX_RETRIES) {
        console.log(`[Orchestrator] [VERIFYING] Retrying task (Attempt ${attempts + 1}/${MAX_RETRIES})`);
        
        // Milestone 2 Fix (Retry loop feeds back failure evidence)
        const failureEvidence = `
=== PREVIOUS ATTEMPT FAILED ===
Compiler output:
STDOUT:
${report.layers.compile?.stdout || 'No stdout'}
STDERR:
${report.layers.compile?.stderr || 'No stderr'}
===============================
`;
        // Inject failure evidence into task system prompt
        const updatedTask = {
          ...currentTask,
          systemPrompt: `${currentTask.systemPrompt}\n${failureEvidence}`
        };

        plan[currentIndex] = updatedTask;
        this.memory.updateTaskPlan(record.id, plan);

        // Transition back to executing
        this.memory.updateTaskState(record.id, 'executing', { retryAttempt: attempts + 1 });
      } else {
        console.error(`[Orchestrator] [VERIFYING] Max retries exhausted. Initiating re-planning...`);
        // Re-plan: In v1, re-planning means moving back to PLANNING state to regenerate the rest of the tasks
        // We clear the remaining plan but keep the current index so we plan from here.
        this.memory.updateTaskState(record.id, 'planning', { replanFromIndex: currentIndex });
      }
    }
  }
}
