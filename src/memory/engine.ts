import { Database } from 'bun:sqlite';
import { SemanticMemory } from './semantic.js';

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

      db.prepare(
        `
        CREATE TABLE IF NOT EXISTS task_plans (
          task_id TEXT PRIMARY KEY,
          goal_id TEXT NOT NULL,
          plan_json TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
      ).run();

      db.prepare(
        `
        CREATE TABLE IF NOT EXISTS task_executions (
          task_id TEXT PRIMARY KEY,
          execution_json TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
      ).run();

      db.prepare(
        `
        CREATE TABLE IF NOT EXISTS task_reviews (
          task_id TEXT PRIMARY KEY,
          review_json TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
      ).run();

      db.prepare(
        `
        CREATE TABLE IF NOT EXISTS code_graph_nodes (
          id TEXT PRIMARY KEY,
          file_path TEXT NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          line_start INTEGER,
          line_end INTEGER,
          signature TEXT,
          docstring TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
      ).run();

      db.prepare(
        `
        CREATE TABLE IF NOT EXISTS code_graph_edges (
          source_id TEXT,
          target_id TEXT,
          relationship TEXT,
          PRIMARY KEY (source_id, target_id, relationship)
        )
      `,
      ).run();

      db.prepare(
        `
        CREATE VIRTUAL TABLE IF NOT EXISTS code_search USING fts5(
          id UNINDEXED,
          file_path,
          name,
          signature,
          docstring
        )
      `,
      ).run();
    } finally {
      db.close();
    }
  }

  // --- Code Graph Memory ---

  saveCodeGraphNodes(nodes: any[]) {
    const db = this.getDb();
    try {
      const insertNode = db.prepare(`
        INSERT INTO code_graph_nodes (id, file_path, name, type, line_start, line_end, signature, docstring)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          file_path = excluded.file_path,
          name = excluded.name,
          type = excluded.type,
          line_start = excluded.line_start,
          line_end = excluded.line_end,
          signature = excluded.signature,
          docstring = excluded.docstring,
          updated_at = CURRENT_TIMESTAMP
      `);

      const insertFTS = db.prepare(`
        INSERT INTO code_search (id, file_path, name, signature, docstring)
        VALUES (?, ?, ?, ?, ?)
      `);

      const deleteFTS = db.prepare(`DELETE FROM code_search WHERE id = ?`);

      const insertEdge = db.prepare(`
        INSERT OR IGNORE INTO code_graph_edges (source_id, target_id, relationship)
        VALUES (?, ?, ?)
      `);

      db.transaction(() => {
        for (const node of nodes) {
          insertNode.run(
            node.id,
            node.path,
            node.name,
            node.type,
            node.lineStart,
            node.lineEnd,
            node.signature,
            node.docstring || null,
          );

          deleteFTS.run(node.id);
          insertFTS.run(node.id, node.path, node.name, node.signature, node.docstring || '');

          if (node.children && Array.isArray(node.children)) {
            for (const childId of node.children) {
              insertEdge.run(node.id, childId, 'contains');
            }
          }
        }
      })();
    } finally {
      db.close();
    }
  }

  deleteCodeGraphForFile(filePath: string) {
    const db = this.getDb();
    try {
      db.prepare(
        `
        DELETE FROM code_graph_edges 
        WHERE source_id IN (SELECT id FROM code_graph_nodes WHERE file_path = ?)
           OR target_id IN (SELECT id FROM code_graph_nodes WHERE file_path = ?)
      `,
      ).run(filePath, filePath);

      db.prepare(`DELETE FROM code_search WHERE file_path = ?`).run(filePath);
      db.prepare(`DELETE FROM code_graph_nodes WHERE file_path = ?`).run(filePath);
    } finally {
      db.close();
    }
  }

  getSymbolsForFile(filePath: string): any[] {
    const db = this.getDb();
    try {
      const rows = db
        .prepare(
          `
        SELECT id, file_path as path, name, type, line_start as lineStart, line_end as lineEnd, signature
        FROM code_graph_nodes WHERE file_path = ?
      `,
        )
        .all(filePath);
      return rows;
    } catch (e) {
      return [];
    } finally {
      db.close();
    }
  }

  async searchCodebase(query: string, limit: number = 10): Promise<any[]> {
    const results: any[] = [];

    // 1. FTS5 Search
    const db = this.getDb();
    try {
      // Basic escaping for FTS query
      const ftsQuery = query.replace(/["']/g, '');
      const ftsRows = db
        .prepare(
          `
        SELECT id, file_path, name, signature, docstring, rank as score
        FROM code_search
        WHERE code_search MATCH ?
        ORDER BY rank
        LIMIT ?
      `,
        )
        .all(`"${ftsQuery}"*`, limit);
      for (const row of ftsRows) {
        results.push({ ...(row as any), source: 'fts' });
      }
    } catch (e) {
      // FTS syntax errors or empty graph
    } finally {
      db.close();
    }

    // 2. Vector Search
    try {
      const semanticMemory = new SemanticMemory(this.dbPath);
      const vecResults = await semanticMemory.search(query, limit);
      for (const res of vecResults) {
        results.push({ ...res, source: 'semantic' });
      }
    } catch (e) {
      // Semantic memory might not be initialized
    }

    // Sort combined results by score/distance loosely (Note: they are in different scales)
    // FTS score is usually negative (more negative is better), distance is positive (closer to 0 is better).
    // For now, we'll just return the concatenated list since we don't have a normalized reciprocal rank fusion.
    return results;
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
      db.prepare(
        `
        INSERT INTO task_plans (task_id, goal_id, plan_json)
        VALUES (?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET plan_json = excluded.plan_json
      `,
      ).run(taskId, goalId, planJson);
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
      db.prepare(
        `
        INSERT INTO task_executions (task_id, execution_json)
        VALUES (?, ?)
        ON CONFLICT(task_id) DO UPDATE SET execution_json = excluded.execution_json
      `,
      ).run(taskId, executionJson);
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
      db.prepare(
        `
        INSERT INTO task_reviews (task_id, review_json)
        VALUES (?, ?)
        ON CONFLICT(task_id) DO UPDATE SET review_json = excluded.review_json
      `,
      ).run(taskId, reviewJson);
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
