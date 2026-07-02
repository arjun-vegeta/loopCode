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
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value_json TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
      ).run();

      db.prepare(
        `
        CREATE TABLE IF NOT EXISTS project_memory (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conventions TEXT,
          lessons TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
      ).run();
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
        INSERT INTO model_performance (model, task_type, input_count, success, cost, duration_ms)
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
      // fallback if table columns differ slightly
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
        INSERT INTO cache_entries (prompt_hash, response_text, cost_saved)
        VALUES (?, ?, ?)
        ON CONFLICT(prompt_hash) DO UPDATE SET cost_saved = cost_saved + excluded.cost_saved
      `,
      ).run(promptHash, response, cost);
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
      const row = db.prepare('SELECT response_text FROM cache_entries WHERE prompt_hash = ?').get(promptHash) as any;
      return row?.response_text || null;
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
      db.prepare(
        `
        INSERT INTO project_memory (conventions, lessons)
        VALUES (?, ?)
      `,
      ).run(conventions, lessons);
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
      const rows = db.prepare('SELECT conventions FROM project_memory ORDER BY id DESC LIMIT 5').all() as any[];
      return rows.map((r) => r.conventions).filter(Boolean);
    } finally {
      db.close();
    }
  }
}
