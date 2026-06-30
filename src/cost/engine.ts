import Database from 'better-sqlite3';

export interface BudgetLimit {
  maxCostUsd: number;
  maxDurationSeconds: number;
  maxTokens: number;
}

export class CostEngine {
  private dbPath: string;
  private goalBudget: number = 10.0;
  private taskBudget: number = 2.0;

  constructor(dbPath: string = 'loopcode.db') {
    this.dbPath = dbPath;
    this.initializeTable();
  }

  private initializeTable() {
    const db = this.getDb();
    try {
      db.prepare(
        `
        CREATE TABLE IF NOT EXISTS cost_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          goal_id TEXT NOT NULL,
          task_id TEXT,
          model TEXT,
          tokens_spent INTEGER,
          cost_spent REAL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
      ).run();
    } finally {
      db.close();
    }
  }

  private getDb(): any {
    return new Database(this.dbPath);
  }

  async getGoalSpent(goalId: string): Promise<number> {
    const db = this.getDb();
    try {
      const row = db.prepare('SELECT SUM(cost_spent) as spent FROM cost_log WHERE goal_id = ?').get(goalId) as any;
      return row?.spent || 0.0;
    } finally {
      db.close();
    }
  }

  async canSpend(goalId: string, estimatedCost: number, goalLimit: number): Promise<boolean> {
    const spent = await this.getGoalSpent(goalId);
    if (spent + estimatedCost > goalLimit) {
      console.error(`[CostEngine] Budget violation! Spent: ${spent}, Estimated: ${estimatedCost}, Limit: ${goalLimit}`);
      return false;
    }
    return true;
  }

  async recordSpend(goalId: string, taskId: string, model: string, tokens: number, cost: number): Promise<void> {
    const db = this.getDb();
    try {
      db.prepare(
        `
        INSERT INTO cost_log (goal_id, task_id, model, tokens_spent, cost_spent)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(goalId, taskId, model, tokens, cost);
    } finally {
      db.close();
    }
  }

  /**
   * Hard budget termination with custom exit code 77.
   */
  terminateDueToBudget(message: string): never {
    console.error(`[CostEngine] BUDGET TERMINATION: ${message}`);
    process.exit(77);
  }
}
