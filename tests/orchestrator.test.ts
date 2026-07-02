import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
mock.module('../src/opencode.js', () => {
  return {
    OpencodeOrchestrator: mock(() => {
      return {
        client: {},
        executeTask: mock().mockResolvedValue({ success: true, message: 'Executed' }),
      };
    }),
  };
});

mock.module('../src/planner.js', () => {
  return {
    Planner: mock(() => {
      return {
        planGoal: mock().mockImplementation(async (goal: string) => {
          return [
            {
              id: 'mocked-task-id',
              description: 'Initial Task',
              goal: goal,
              category: 'feature' as const,
              systemPrompt: 'Implement the requested change.',
              expectedOutputs: [],
              writeAllowlist: [],
              verification: [{ type: 'compile', command: 'npm run build', expectedExitCode: 0 }],
              maxCost: 2.0,
              timeout: 300,
            },
          ];
        }),
      };
    }),
  };
});

mock.module('../src/verifier.js', () => {
  return {
    Verifier: {
      verifyTask: mock(),
    },
  };
});

import { Orchestrator } from '../src/orchestrator.js';
import { Memory } from '../src/memory.js';
import { OpencodeOrchestrator } from '../src/opencode.js';
import { Verifier } from '../src/verifier.js';
import { MemoryEngine } from '../src/memory/engine.js';
import * as fs from 'node:fs';

process.env.VITEST = '1';

describe('Orchestrator State Machine & Persistence', () => {
  const TEST_DB = 'test_loopcode.db';
  let mockOpencode: any;
  let activeOrchestrators: Orchestrator[] = [];

  let getGoalSpentSpy: any = null;
  let terminateSpy: any = null;
  let runCommandSpy: any = null;
  let detectSpy: any = null;
  let promptSpy: any = null;
  let planSpy: any = null;

  beforeEach(() => {
    mock.clearAllMocks();
    activeOrchestrators = [];
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
    mockOpencode = new (OpencodeOrchestrator as any)();
  });

  afterEach(() => {
    if (getGoalSpentSpy) {
      getGoalSpentSpy.mockRestore();
      getGoalSpentSpy = null;
    }
    if (terminateSpy) {
      terminateSpy.mockRestore();
      terminateSpy = null;
    }
    if (runCommandSpy) {
      runCommandSpy.mockRestore();
      runCommandSpy = null;
    }
    if (detectSpy) {
      detectSpy.mockRestore();
      detectSpy = null;
    }
    if (promptSpy) {
      promptSpy.mockRestore();
      promptSpy = null;
    }
    if (planSpy) {
      planSpy.mockRestore();
      planSpy = null;
    }

    for (const o of activeOrchestrators) {
      try {
        o.close();
      } catch (err) {
        // ignore
      }
    }
    if (fs.existsSync(TEST_DB)) {
      try {
        fs.unlinkSync(TEST_DB);
      } catch (err) {
        // ignore
      }
    }
  });

  it('runs the goal and transitions planning -> executing -> verifying -> done on success', async () => {
    // Mock verification to pass
    (Verifier.verifyTask as any).mockResolvedValue({
      taskId: 'test-task',
      layers: { compile: { passed: true, stdout: '', stderr: '', durationMs: 10 } },
      overallPass: true,
      timestamp: new Date().toISOString(),
    });

    const orchestrator = new Orchestrator(mockOpencode, TEST_DB);
    activeOrchestrators.push(orchestrator);
    await orchestrator.runGoal('Mock Goal');

    const memory = new Memory(TEST_DB);
    const allTasks = (memory as any).db.prepare('SELECT id FROM tasks').all();
    expect(allTasks.length).toBe(1);
    const taskId = allTasks[0].id;

    const tasks = memory.getTaskResults(taskId);
    // Task index 0 should be completed and logged
    expect(tasks.length).toBe(1);

    memory.close();
  });

  it('retries when verification fails and increments attempt count', async () => {
    // Mock verification to fail first, then pass
    let verificationCount = 0;
    (Verifier.verifyTask as any).mockImplementation(async () => {
      verificationCount++;
      return {
        taskId: 'test-task',
        layers: {
          compile: {
            passed: verificationCount > 1,
            stdout: '',
            stderr: verificationCount > 1 ? '' : 'Compiler Error',
            durationMs: 10,
          },
        },
        overallPass: verificationCount > 1,
        timestamp: new Date().toISOString(),
      };
    });

    const orchestrator = new Orchestrator(mockOpencode, TEST_DB);
    activeOrchestrators.push(orchestrator);
    await orchestrator.runGoal('Mock Goal with failures');

    const memory = new Memory(TEST_DB);
    const allTasks = (memory as any).db.prepare('SELECT id FROM tasks').all();
    expect(allTasks.length).toBe(1);
    const taskId = allTasks[0].id;

    const logs = memory.getStateLogs(taskId);

    // We should see a transition from executing -> verifying -> executing (retry) -> verifying -> done
    const phases = logs.map((l: any) => l.phase);
    expect(phases).toContain('executing');
    expect(phases).toContain('verifying');

    memory.close();
  });

  it('re-plans when retry attempts are exhausted', async () => {
    // Keep failing to exhaust retries
    (Verifier.verifyTask as any).mockResolvedValue({
      taskId: 'test-task',
      layers: { compile: { passed: false, stdout: '', stderr: 'Compiler Error', durationMs: 10 } },
      overallPass: false,
      timestamp: new Date().toISOString(),
    });

    // To prevent an infinite planning-executing loop, we stub the planning state in memory after it transitions
    const orchestrator = new Orchestrator(mockOpencode, TEST_DB);
    activeOrchestrators.push(orchestrator);

    // Intercept planning execution by throwing to check if it entered planning again
    let planningCount = 0;
    const originalHandlePlanning = (orchestrator as any).handlePlanning;
    (orchestrator as any).handlePlanning = async function (record: any) {
      planningCount++;
      if (planningCount > 1) {
        // Transition task to failed manually to break the loop
        this.memory.updateTaskState(record.id, 'failed');
        return;
      }
      return originalHandlePlanning.call(this, record);
    };

    await orchestrator.runGoal('Failing Goal');

    expect(planningCount).toBe(2); // Initial planning + Re-planning after MAX_RETRIES exhausted

    const memory = new Memory(TEST_DB);
    const allTasks = (memory as any).db.prepare('SELECT id FROM tasks').all();
    expect(allTasks.length).toBe(1);
    const taskId = allTasks[0].id;

    const task = memory.getTask(taskId);
    expect(task?.state).toBe('failed');
    memory.close();
  });

  it('resumes correctly after process crash / restart', async () => {
    // Setup a task that was in "executing" state inside the DB
    const memory = new Memory(TEST_DB);
    const taskId = 'crash-task-id';
    memory.createTask(taskId, 'Resume Goal', 'executing');

    // Mock the plan so there is something to execute
    const plan = [
      [
        {
          id: crypto.randomUUID(),
          description: 'Mocked task to execute on resume',
          goal: 'Resume Goal',
          category: 'feature' as const,
          systemPrompt: '',
          expectedOutputs: [],
          writeAllowlist: [],
          verification: [],
          maxCost: 1,
          timeout: 100,
        },
      ],
    ];
    memory.updateTaskPlan(taskId, plan);
    memory.close();

    // Verify task mock
    (Verifier.verifyTask as any).mockResolvedValue({
      taskId: 'test-task',
      layers: { compile: { passed: true, stdout: '', stderr: '', durationMs: 10 } },
      overallPass: true,
      timestamp: new Date().toISOString(),
    });

    // Start a new orchestrator pointing to the same DB
    const orchestrator = new Orchestrator(mockOpencode, TEST_DB);
    activeOrchestrators.push(orchestrator);
    await orchestrator.resumeTask(taskId);

    const checkMemory = new Memory(TEST_DB);
    const task = checkMemory.getTask(taskId);
    expect(task?.state).toBe('done'); // Resumed and completed
    checkMemory.close();
  });

  it('logs project memory lessons and conventions on goal completion', async () => {
    const memoryEngine = new MemoryEngine(TEST_DB);
    const mockReview = {
      passed: true,
      comments: [
        { file: 'src/index.ts', line: 10, severity: 'nit', message: 'Use const instead of let' },
        { file: 'src/router.ts', line: 40, severity: 'issue', message: 'Potential null pointer here' },
      ],
      confidence: 0.95,
    };
    memoryEngine.saveTaskReview('mocked-task-id', JSON.stringify(mockReview));

    (Verifier.verifyTask as any).mockResolvedValue({
      taskId: 'mocked-task-id',
      layers: { compile: { passed: true, stdout: '', stderr: '', durationMs: 10 } },
      overallPass: true,
      timestamp: new Date().toISOString(),
    });

    const orchestrator = new Orchestrator(mockOpencode, TEST_DB);
    activeOrchestrators.push(orchestrator);
    await orchestrator.runGoal('Test Project Memory Goal');

    const conventions = memoryEngine.getConventions();
    expect(conventions.length).toBeGreaterThan(0);
    expect(conventions[0]).toContain('Use const instead of let');

    const db = (memoryEngine as any).getDb();
    const lessons = db.prepare("SELECT value FROM project_memory WHERE category = 'lesson'").all();
    db.close();

    expect(lessons.length).toBeGreaterThan(0);
    expect(lessons[0].value).toContain('Potential null pointer here');
  });

  it('terminates and rolls back workspace when session budget is exceeded', async () => {
    const { CostEngine } = await import('../src/cost/engine.js');
    getGoalSpentSpy = spyOn(CostEngine.prototype, 'getGoalSpent').mockResolvedValue(20.0);
    terminateSpy = spyOn(CostEngine.prototype, 'terminateDueToBudget').mockImplementation(() => {
      throw new Error('budget limit reached');
    });

    const orchestrator = new Orchestrator(mockOpencode, TEST_DB);
    activeOrchestrators.push(orchestrator);

    runCommandSpy = spyOn(orchestrator, 'runCommand').mockReturnValue('mock-hash');

    await expect(orchestrator.runGoal('Mock Goal')).rejects.toThrow('budget limit reached');

    expect(runCommandSpy).toHaveBeenCalledWith('git reset --hard mock-hash');
    expect(runCommandSpy).toHaveBeenCalledWith('git clean -fd');
    expect(terminateSpy).toHaveBeenCalled();
  });

  it('handles oscillation escalation choice replan correctly', async () => {
    const orchestrator = new Orchestrator(mockOpencode, TEST_DB);
    activeOrchestrators.push(orchestrator);

    const { LoopDetector } = await import('../src/safety/loop.js');
    detectSpy = spyOn(LoopDetector.prototype, 'detectOscillation').mockImplementation((sig) => {
      return sig.phase === 'executing';
    });
    promptSpy = spyOn(orchestrator as any, 'promptUserForEscalation').mockResolvedValue('replan');

    let callCount = 0;
    planSpy = spyOn(orchestrator as any, 'handlePlanning').mockImplementation(async (record: any) => {
      callCount++;
      if (callCount > 1) {
        throw new Error('stop loop');
      }
      orchestrator['memory'].updateTaskState(record.id, 'executing', { plan: [] });
    });

    await expect(orchestrator.runGoal('Mock Goal')).rejects.toThrow('stop loop');
    expect(promptSpy).toHaveBeenCalled();
    expect(planSpy).toHaveBeenCalledTimes(2);
  });
});
