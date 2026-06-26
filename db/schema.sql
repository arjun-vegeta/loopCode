-- db/schema.sql
-- Tasks and their state
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  state TEXT NOT NULL,        -- 'planning', 'executing', 'verifying', 'done', 'failed'
  plan_json TEXT,             -- Array of Task objects
  current_task_index INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- State transitions (for recovery)
CREATE TABLE IF NOT EXISTS state_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  phase TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Task results
CREATE TABLE IF NOT EXISTS task_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  step_index INTEGER NOT NULL,
  verification_json TEXT,   -- VerificationReport
  cost REAL,
  duration_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Simple file index (no embeddings, no vectors)
CREATE TABLE IF NOT EXISTS file_index (
  path TEXT PRIMARY KEY,
  language TEXT,
  line_count INTEGER,
  last_modified DATETIME,
  symbols_json TEXT         -- Array of {name, type, line}
);
