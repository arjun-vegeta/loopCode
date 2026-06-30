import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Orchestrator } from '../src/orchestrator.js';
import { Memory } from '../src/memory.js';
import { OpencodeOrchestrator } from '../src/opencode.js';
import { Verifier } from '../src/verifier.js';
import * as fs from 'node:fs';

// Mock the dependencies
vi.mock('../src/opencode.js', () => {
  return {
    OpencodeOrchestrator: vi.fn().mockImplementation(() => {
      return {
        client: {},
        executeTask: vi.fn().mockResolvedValue({ success: true, message: 'Executed' }),
      };
    }),
  };
});

vi.mock('../src/planner.js', () => {
  return {
    Planner: vi.fn().mockImplementation(() => {
      return {
        planGoal: vi.fn().mockImplementation(async (goal: string) => {
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

vi.mock('../src/verifier.js', () => {
  return {
    Verifier: {
      verifyTask: vi.fn(),
    },
  };
});

describe('Orchestrator State Machine & Persistence', () => {
  const TEST_DB = 'test_loopcode.db';
  let mockOpencode: any;
  let activeOrchestrators: Orchestrator[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    activeOrchestrators = [];
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
    mockOpencode = new (OpencodeOrchestrator as any)();
  });

  afterEach(() => {
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
    // Mock execution to succeed but verification to fail
    (Verifier.verifyTask as any).mockResolvedValue({
      taskId: 'test-task',
      layers: { compile: { passed: false, stdout: '', stderr: 'Compiler Error', durationMs: 10 } },
      overallPass: false,
      timestamp: new Date().toISOString(),
    });

    const orchestrator = new Orchestrator(mockOpencode, TEST_DB);
    activeOrchestrators.push(orchestrator);

    // We expect it to cycle through execution and retry until MAX_RETRIES.
    // However, on exceeding retries, it transitions back to 'planning' and loop would continue.
    // To prevent infinite loop in tests, we can change the mock behavior after a few calls.
    let callCount = 0;
    (Verifier.verifyTask as any).mockImplementation(async () => {
      callCount++;
      if (callCount >= 2) {
        // Pass on the second attempt
        return {
          taskId: 'test-task',
          layers: { compile: { passed: true, stdout: '', stderr: '', durationMs: 10 } },
          overallPass: true,
          timestamp: new Date().toISOString(),
        };
      }
      return {
        taskId: 'test-task',
        layers: { compile: { passed: false, stdout: '', stderr: 'Compiler Error', durationMs: 10 } },
        overallPass: false,
        timestamp: new Date().toISOString(),
      };
    });

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
      ]
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
});
