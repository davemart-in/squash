import Database from "better-sqlite3";
import path from "path";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = process.env.DB_PATH || "squash.db";
  db = new Database(path.resolve(dbPath));

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      ref TEXT NOT NULL,
      source TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      body TEXT,
      labels TEXT,
      assignee TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      current_step INTEGER DEFAULT 0,
      pr_url TEXT,
      pr_number TEXT,
      branch TEXT,
      worktree_path TEXT,
      complexity_score INTEGER,
      skip_reason TEXT,
      context TEXT,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      elapsed_seconds INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id TEXT NOT NULL REFERENCES issues(id),
      step INTEGER,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issues(id),
      step INTEGER NOT NULL,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd REAL,
      latency_ms INTEGER,
      status TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  return db;
}
