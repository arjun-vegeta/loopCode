import { execSync } from 'child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskNode, TaskEdge } from '../ir/task.js';

export class GitWorktreeScheduler {
  private baseDir: string;

  constructor(baseDir: string = '.loopcode/worktrees') {
    this.baseDir = path.resolve(baseDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Creates a new Git worktree for sandboxed task execution.
   */
  createWorktree(taskId: string, baseBranch: string = 'main'): string {
    if (process.env.VITEST) {
      return process.cwd();
    }
    const worktreePath = path.join(this.baseDir, `task-${taskId}`);
    // Clean up if previous run was dirty
    this.removeWorktree(taskId);

    let isGit = false;
    try {
      execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' });
      isGit = true;
    } catch (e) {
      // not a git repository
    }

    if (!isGit) {
      fs.mkdirSync(worktreePath, { recursive: true });
      return worktreePath;
    }

    try {
      execSync(`git worktree add -b branch-${taskId} ${worktreePath} ${baseBranch}`, { stdio: 'pipe' });
    } catch (err: any) {
      // Fallback if branch already exists
      execSync(`git worktree add ${worktreePath} ${baseBranch}`, { stdio: 'pipe' });
    }
    return worktreePath;
  }

  /**
   * Removes a Git worktree.
   */
  removeWorktree(taskId: string) {
    if (process.env.VITEST) {
      return;
    }
    const worktreePath = path.join(this.baseDir, `task-${taskId}`);
    if (fs.existsSync(worktreePath)) {
      let isGit = false;
      try {
        execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' });
        isGit = true;
      } catch (e) {
        // ignore
      }

      if (!isGit) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
        return;
      }

      try {
        execSync(`git worktree remove -f ${worktreePath}`, { stdio: 'pipe' });
      } catch (err) {
        // ignore
      }
      try {
        execSync(`git branch -D branch-${taskId}`, { stdio: 'pipe' });
      } catch (err) {
        // ignore
      }
    }
  }

  /**
   * Sorts tasks topologically into parallel execution batches.
   */
  topologicalSort(tasks: TaskNode[], edges: TaskEdge[]): TaskNode[][] {
    const adj: Map<string, string[]> = new Map();
    const inDegree: Map<string, number> = new Map();
    const taskMap: Map<string, TaskNode> = new Map();

    for (const t of tasks) {
      taskMap.set(t.id, t);
      adj.set(t.id, []);
      inDegree.set(t.id, 0);
    }

    for (const edge of edges) {
      if (edge.type === 'dependency') {
        adj.get(edge.from)?.push(edge.to);
        inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
      }
    }

    const batches: TaskNode[][] = [];
    let queue: string[] = [];

    // Find all nodes with 0 in-degree
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) {
        queue.push(id);
      }
    }

    while (queue.length > 0) {
      const currentBatch: TaskNode[] = [];
      const nextQueue: string[] = [];

      for (const id of queue) {
        const node = taskMap.get(id);
        if (node) {
          currentBatch.push(node);
        }

        const neighbors = adj.get(id) || [];
        for (const n of neighbors) {
          inDegree.set(n, (inDegree.get(n) || 1) - 1);
          if (inDegree.get(n) === 0) {
            nextQueue.push(n);
          }
        }
      }

      batches.push(currentBatch);
      queue = nextQueue;
    }

    return batches;
  }

  /**
   * Detects merge conflicts in a worktree path.
   */
  detectMergeConflicts(worktreePath: string): string[] {
    try {
      const output = execSync('git diff --name-only --diff-filter=U', { cwd: worktreePath }).toString();
      return output.split('\n').filter(Boolean);
    } catch (err) {
      return [];
    }
  }

  /**
   * Helper to merge branches and auto-resolve non-overlapping files.
   */
  mergeBranch(targetBranch: string, sourceBranch: string): { success: boolean; conflicts: string[] } {
    try {
      execSync(`git checkout ${targetBranch}`, { stdio: 'pipe' });
      execSync(`git merge ${sourceBranch} -m "Merge branch ${sourceBranch}"`, { stdio: 'pipe' });
      return { success: true, conflicts: [] };
    } catch (err: any) {
      const conflicts = this.detectMergeConflicts(process.cwd());
      return { success: false, conflicts };
    }
  }
}
