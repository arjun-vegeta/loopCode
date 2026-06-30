import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import { CostEngine } from '../src/cost/engine.js';
import { LoopDetector } from '../src/safety/loop.js';
import { ContextEngine } from '../src/context/engine.js';
import { GitWorktreeScheduler } from '../src/scheduler/worktree.js';

vi.mock('child_process', () => {
  return {
    execSync: vi.fn().mockImplementation((cmd) => {
      if (cmd.includes('git diff')) {
        return 'src/opencode.ts\n';
      }
      return '';
    }),
  };
});

describe('V2 CostEngine', () => {
  const TEST_DB = 'test_v2_cost.db';

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
  });

  it('correctly tracks costs and detects budget limits', async () => {
    const engine = new CostEngine(TEST_DB);

    let canSpend = await engine.canSpend('goal-1', 1.5, 5.0);
    expect(canSpend).toBe(true);

    await engine.recordSpend('goal-1', 'task-1', 'claude-5-sonnet', 1000, 1.5);

    canSpend = await engine.canSpend('goal-1', 4.0, 5.0);
    expect(canSpend).toBe(false); // 1.5 + 4.0 = 5.5 > 5.0
  });

  it('triggers budget termination with exit code 77', () => {
    const engine = new CostEngine(TEST_DB);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit called');
    });

    expect(() => engine.terminateDueToBudget('Limit exceeded')).toThrow('exit called');
    expect(exitSpy).toHaveBeenCalledWith(77);
    exitSpy.mockRestore();
  });
});

describe('V2 LoopDetector', () => {
  it('correctly detects oscillations', () => {
    const detector = new LoopDetector();
    const sig = {
      phase: 'executing',
      taskIndex: 1,
      filesChanged: ['src/opencode.ts'],
    };

    let oscillation = detector.detectOscillation(sig);
    expect(oscillation).toBe(false);

    oscillation = detector.detectOscillation(sig);
    expect(oscillation).toBe(true); // Same signature without changes
  });
});

describe('V2 ContextEngine', () => {
  const TEST_FILE = 'test_context.ts';

  beforeEach(() => {
    fs.writeFileSync(
      TEST_FILE,
      `
      // This is a comment
      export class TestClass {
        /* Multi line
           comment */
        method() {}
      }
    `,
    );
  });

  afterEach(() => {
    if (fs.existsSync(TEST_FILE)) {
      fs.unlinkSync(TEST_FILE);
    }
  });

  it('compresses whitespace and removes comments', () => {
    const engine = new ContextEngine();
    const raw = fs.readFileSync(TEST_FILE, 'utf8');
    const compressed = engine.compressCode(raw);
    expect(compressed).toContain('export class TestClass');
    expect(compressed).not.toContain('// This is a comment');
    expect(compressed).not.toContain('Multi line');
  });

  it('supports hierarchical summarization', () => {
    const engine = new ContextEngine();
    const summaryL0 = engine.getSummarization(TEST_FILE, 0);
    expect(summaryL0).toContain('// This is a comment');

    const summaryL4 = engine.getSummarization(TEST_FILE, 4);
    expect(summaryL4).toBe('File: test_context.ts');
  });
});

describe('V2 GitWorktreeScheduler', () => {
  it('performs topological sorting of tasks', () => {
    const scheduler = new GitWorktreeScheduler();
    const tasks = [
      {
        id: '1',
        description: 'Task 1',
        goal: '',
        category: 'fix' as const,
        systemPrompt: '',
        expectedOutputs: [],
        writeAllowlist: [],
        verification: [],
        maxCost: 1,
        timeout: 60,
      },
      {
        id: '2',
        description: 'Task 2',
        goal: '',
        category: 'fix' as const,
        systemPrompt: '',
        expectedOutputs: [],
        writeAllowlist: [],
        verification: [],
        maxCost: 1,
        timeout: 60,
      },
      {
        id: '3',
        description: 'Task 3',
        goal: '',
        category: 'fix' as const,
        systemPrompt: '',
        expectedOutputs: [],
        writeAllowlist: [],
        verification: [],
        maxCost: 1,
        timeout: 60,
      },
    ];
    const edges = [
      { from: '1', to: '2', type: 'dependency' as const },
      { from: '2', to: '3', type: 'dependency' as const },
    ];

    const batches = scheduler.topologicalSort(tasks, edges);
    expect(batches.length).toBe(3);
    expect(batches[0][0].id).toBe('1');
    expect(batches[1][0].id).toBe('2');
    expect(batches[2][0].id).toBe('3');
  });
});
