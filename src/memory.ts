import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Task, VerificationReport } from './types.js';

export interface TaskRecord {
  id: string;
  goal: string;
  state: 'planning' | 'executing' | 'verifying' | 'done' | 'failed';
  plan_json?: string;
  current_task_index: number;
  total_cost: number;
  created_at?: string;
  updated_at?: string;
}

export class Memory {
  private db: Database.Database;

  constructor(dbPath: string = 'loopcode.db') {
    const dbDir = path.dirname(dbPath);
    if (dbDir !== '.' && !fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  private initializeSchema() {
    // Read the schema.sql file
    const schemaPath = path.join(process.cwd(), 'db', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      this.db.exec(schema);
    } else {
      // Fallback schema if file not found
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          goal TEXT NOT NULL,
          state TEXT NOT NULL,
          plan_json TEXT,
          current_task_index INTEGER DEFAULT 0,
          total_cost REAL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS state_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          phase TEXT NOT NULL,
          state_json TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS task_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          step_index INTEGER NOT NULL,
          verification_json TEXT,
          cost REAL,
          duration_ms INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS file_index (
          path TEXT PRIMARY KEY,
          language TEXT,
          line_count INTEGER,
          last_modified DATETIME,
          symbols_json TEXT
        );
      `);
    }
  }

  // --- Task Methods ---

  createTask(id: string, goal: string, initialState: TaskRecord['state'] = 'planning') {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, goal, state, current_task_index, total_cost)
      VALUES (?, ?, ?, 0, 0.0)
    `);
    stmt.run(id, goal, initialState);
    this.logStateTransition(id, initialState, { goal, state: initialState });
  }

  updateTaskState(id: string, state: TaskRecord['state'], extraJson: Record<string, any> = {}) {
    const stmt = this.db.prepare(`
      UPDATE tasks 
      SET state = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(state, id);
    this.logStateTransition(id, state, { state, ...extraJson });
  }

  updateTaskPlan(id: string, plan: Task[]) {
    const planJson = JSON.stringify(plan);
    const stmt = this.db.prepare(`
      UPDATE tasks
      SET plan_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(planJson, id);
  }

  updateTaskProgress(id: string, currentTaskIndex: number, totalCost: number) {
    const stmt = this.db.prepare(`
      UPDATE tasks
      SET current_task_index = ?, total_cost = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(currentTaskIndex, totalCost, id);
  }

  getTask(id: string): TaskRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    return stmt.get(id) as TaskRecord | undefined;
  }

  getIncompleteTasks(): TaskRecord[] {
    const stmt = this.db.prepare("SELECT * FROM tasks WHERE state NOT IN ('done', 'failed')");
    return stmt.all() as TaskRecord[];
  }

  // --- State Log Methods ---

  private logStateTransition(taskId: string, phase: string, stateObj: Record<string, any>) {
    const stmt = this.db.prepare(`
      INSERT INTO state_log (task_id, phase, state_json)
      VALUES (?, ?, ?)
    `);
    stmt.run(taskId, phase, JSON.stringify(stateObj));
  }

  getStateLogs(taskId: string) {
    const stmt = this.db.prepare('SELECT * FROM state_log WHERE task_id = ? ORDER BY created_at ASC');
    return stmt.all(taskId);
  }

  // --- Task Results Methods ---

  saveTaskResult(
    taskId: string,
    stepIndex: number,
    verification: VerificationReport,
    cost: number,
    durationMs: number,
  ) {
    const stmt = this.db.prepare(`
      INSERT INTO task_results (task_id, step_index, verification_json, cost, duration_ms)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(taskId, stepIndex, JSON.stringify(verification), cost, durationMs);

    // Update cumulative cost in tasks table
    const task = this.getTask(taskId);
    if (task) {
      const newCost = task.total_cost + cost;
      const updateStmt = this.db.prepare('UPDATE tasks SET total_cost = ? WHERE id = ?');
      updateStmt.run(newCost, taskId);
    }
  }

  getTaskResults(taskId: string) {
    const stmt = this.db.prepare('SELECT * FROM task_results WHERE task_id = ? ORDER BY step_index ASC');
    return stmt.all(taskId);
  }

  close() {
    this.db.close();
  }
}
