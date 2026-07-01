import { execSync } from 'child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskNode, TaskEdge } from '../ir/task.js';

export class GitWorktreeScheduler {
  private baseDir: string;
  private client?: any;

  constructor(baseDir: string = '.loopcode/worktrees', client?: any) {
    this.baseDir = path.resolve(baseDir);
    this.client = client;
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

    // Auto-generate dependencies for writeAllowlist overlaps to avoid merge conflicts
    const fileToTasks = new Map<string, string[]>();
    for (const t of tasks) {
      for (const file of t.writeAllowlist || []) {
        if (!fileToTasks.has(file)) {
          fileToTasks.set(file, []);
        }
        fileToTasks.get(file)!.push(t.id);
      }
    }

    const implicitEdges: TaskEdge[] = [];
    for (const [_file, taskIds] of fileToTasks.entries()) {
      for (let i = 0; i < taskIds.length - 1; i++) {
        implicitEdges.push({ from: taskIds[i], to: taskIds[i + 1], type: 'dependency' });
      }
    }

    const allEdges = [...edges, ...implicitEdges];

    for (const edge of allEdges) {
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
  async mergeBranch(targetBranch: string, sourceBranch: string): Promise<{ success: boolean; conflicts: string[] }> {
    try {
      execSync(`git checkout ${targetBranch}`, { stdio: 'pipe' });
      execSync(`git merge ${sourceBranch} -m "Merge branch ${sourceBranch}"`, { stdio: 'pipe' });
      return { success: true, conflicts: [] };
    } catch (err: any) {
      const conflicts = this.detectMergeConflicts(process.cwd());
      if (conflicts.length > 0 && this.client) {
        console.log(
          `[WorktreeScheduler] Detected conflicts in ${conflicts.length} files. Attempting LLM resolution...`,
        );
        let allResolved = true;

        for (const file of conflicts) {
          try {
            const fileContent = fs.readFileSync(file, 'utf8');
            const { data: session } = await this.client.session.create({ body: { title: 'Conflict Resolution' } });
            if (!session) {
              allResolved = false;
              break;
            }

            const prompt = `Resolve the following git merge conflicts in ${file}. 
Return the fully resolved file content with conflict markers (<<<<<<<, =======, >>>>>>>) removed.
Preserve the correct logic from both branches where applicable.

File content:
${fileContent}`;

            const { data: result } = await this.client.session.prompt({
              path: { id: session.id },
              body: { parts: [{ type: 'text', text: prompt }] } as any,
            });

            const resolvedContent = result?.text;
            if (resolvedContent && !resolvedContent.includes('<<<<<<<')) {
              let finalContent = resolvedContent;
              if (finalContent.startsWith('```')) {
                finalContent = finalContent.replace(/^```[\\w]*\\n/, '').replace(/\\n```$/, '');
              }
              fs.writeFileSync(file, finalContent);
              execSync(`git add ${file}`, { stdio: 'pipe' });
            } else {
              allResolved = false;
            }
            await this.client.session.delete({ path: { id: session.id } }).catch(() => {});
          } catch (e) {
            allResolved = false;
          }
        }

        if (allResolved) {
          try {
            execSync(`git commit -m "Auto-resolved merge conflicts from ${sourceBranch}"`, { stdio: 'pipe' });
            return { success: true, conflicts: [] };
          } catch (e) {
            // Commit failed
            try {
              execSync('git merge --abort', { stdio: 'pipe' });
            } catch (e) {
              /* ignore */
            }
            return { success: false, conflicts };
          }
        } else {
          try {
            execSync('git merge --abort', { stdio: 'pipe' });
          } catch (e) {
            /* ignore */
          }
          return { success: false, conflicts };
        }
      }

      try {
        execSync('git merge --abort', { stdio: 'pipe' });
      } catch (e) {
        /* ignore */
      }
      return { success: false, conflicts };
    }
  }
}
