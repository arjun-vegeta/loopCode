import Database from 'better-sqlite3';

export interface PerformanceLog {
  model: string;
  taskType: string;
  complexity: string;
  success: boolean;
  cost: number;
  durationMs: number;
}

export class MemoryEngine {
  private dbPath: string;

  constructor(dbPath: string = 'loopcode.db') {
    this.dbPath = dbPath;
    this.initializeTables();
  }

  private getDb() {
    return new Database(this.dbPath);
  }

  private initializeTables() {
    const db = this.getDb();
    try {
      db.prepare(
        `
        CREATE TABLE IF NOT EXISTS working_memory (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
      ).run();

      db.prepare(
        `
        CREATE TABLE IF NOT EXISTS project_memory (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          source_task_id TEXT,
          confidence REAL DEFAULT 1.0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
      ).run();

      db.prepare(`
        CREATE TABLE IF NOT EXISTS task_plans (
          task_id TEXT PRIMARY KEY,
          goal_id TEXT NOT NULL,
          plan_json TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();

      db.prepare(`
        CREATE TABLE IF NOT EXISTS task_executions (
          task_id TEXT PRIMARY KEY,
          execution_json TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();

      db.prepare(`
        CREATE TABLE IF NOT EXISTS task_reviews (
          task_id TEXT PRIMARY KEY,
          review_json TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
    } finally {
      db.close();
    }
  }

  /**
   * Log model routing performance for future routing heuristics.
   */
  logPerformance(log: PerformanceLog) {
    const db = this.getDb();
    try {
      db.prepare(
        `
        INSERT INTO model_performance (model, task_type, task_complexity, success, cost, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      ).run(
        log.model,
        log.taskType,
        log.complexity === 'complex' ? 5 : 1,
        log.success ? 1 : 0,
        log.cost,
        log.durationMs,
      );
    } catch (err) {
      // fallback
    } finally {
      db.close();
    }
  }

  /**
   * Store prompt/response cache entries.
   */
  storeCache(promptHash: string, response: string, cost: number) {
    const db = this.getDb();
    try {
      db.prepare(
        `
        INSERT INTO cache_entries (id, query_embedding, response, model, cost)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET cost = cost + excluded.cost
      `,
      ).run(promptHash, Buffer.alloc(0), response, 'unknown', cost);
    } catch (err) {
      // ignore
    } finally {
      db.close();
    }
  }

  /**
   * Get cache entries by prompt hash.
   */
  getCache(promptHash: string): string | null {
    const db = this.getDb();
    try {
      const row = db.prepare('SELECT response FROM cache_entries WHERE id = ?').get(promptHash) as any;
      return row?.response || null;
    } catch (err) {
      return null;
    } finally {
      db.close();
    }
  }

  /**
   * Store lessons learned and project conventions.
   */
  addProjectLesson(conventions: string, lessons: string) {
    const db = this.getDb();
    try {
      if (conventions) {
        db.prepare("INSERT INTO project_memory (category, key, value) VALUES ('convention', 'general', ?)").run(
          conventions,
        );
      }
      if (lessons) {
        db.prepare("INSERT INTO project_memory (category, key, value) VALUES ('lesson', 'general', ?)").run(lessons);
      }
    } finally {
      db.close();
    }
  }

  /**
   * Query conventions from past projects.
   */
  getConventions(): string[] {
    const db = this.getDb();
    try {
      const rows = db
        .prepare("SELECT value FROM project_memory WHERE category = 'convention' ORDER BY id DESC LIMIT 5")
        .all() as any[];
      return rows.map((r) => r.value).filter(Boolean);
    } finally {
      db.close();
    }
  }

  // --- Shared Memory Agent Communication ---

  saveTaskPlan(taskId: string, goalId: string, planJson: string) {
    const db = this.getDb();
    try {
      db.prepare(`
        INSERT INTO task_plans (task_id, goal_id, plan_json)
        VALUES (?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET plan_json = excluded.plan_json
      `).run(taskId, goalId, planJson);
    } finally {
      db.close();
    }
  }

  getTaskPlan(taskId: string): string | null {
    const db = this.getDb();
    try {
      const row = db.prepare('SELECT plan_json FROM task_plans WHERE task_id = ?').get(taskId) as any;
      return row?.plan_json || null;
    } catch (err) {
      return null;
    } finally {
      db.close();
    }
  }

  saveTaskExecution(taskId: string, executionJson: string) {
    const db = this.getDb();
    try {
      db.prepare(`
        INSERT INTO task_executions (task_id, execution_json)
        VALUES (?, ?)
        ON CONFLICT(task_id) DO UPDATE SET execution_json = excluded.execution_json
      `).run(taskId, executionJson);
    } finally {
      db.close();
    }
  }

  getTaskExecution(taskId: string): string | null {
    const db = this.getDb();
    try {
      const row = db.prepare('SELECT execution_json FROM task_executions WHERE task_id = ?').get(taskId) as any;
      return row?.execution_json || null;
    } catch (err) {
      return null;
    } finally {
      db.close();
    }
  }

  saveTaskReview(taskId: string, reviewJson: string) {
    const db = this.getDb();
    try {
      db.prepare(`
        INSERT INTO task_reviews (task_id, review_json)
        VALUES (?, ?)
        ON CONFLICT(task_id) DO UPDATE SET review_json = excluded.review_json
      `).run(taskId, reviewJson);
    } finally {
      db.close();
    }
  }

  getTaskReview(taskId: string): string | null {
    const db = this.getDb();
    try {
      const row = db.prepare('SELECT review_json FROM task_reviews WHERE task_id = ?').get(taskId) as any;
      return row?.review_json || null;
    } catch (err) {
      return null;
    } finally {
      db.close();
    }
  }
}
