import { getDb } from "./schema.js";
import { NotFoundError, ConflictError } from "./errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IssueStatus =
  | "queued"
  | "running"
  | "needs-review"
  | "done"
  | "skipped"
  | "error";

export type IssueStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface Issue {
  id: string;
  ref: string;
  source: string;
  url: string;
  title: string | null;
  body: string | null;
  labels: string[];
  assignee: string | null;
  status: IssueStatus;
  current_step: IssueStep;
  pr_url: string | null;
  pr_number: string | null;
  branch: string | null;
  worktree_path: string | null;
  complexity_score: number | null;
  skip_reason: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  elapsed_seconds: number | null;
  created_at: string;
}

export interface LogEntry {
  id: number;
  issue_id: string;
  step: number | null;
  type: "cmd" | "ok" | "warn" | "err" | "dim";
  message: string;
  created_at: string;
}

export interface AgentRun {
  id: string;
  issue_id: string;
  step: number;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  status: "success" | "error" | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Row ↔ Issue helpers
// ---------------------------------------------------------------------------

interface IssueRow {
  id: string;
  ref: string;
  source: string;
  url: string;
  title: string | null;
  body: string | null;
  labels: string | null;
  assignee: string | null;
  status: IssueStatus;
  current_step: IssueStep;
  pr_url: string | null;
  pr_number: string | null;
  branch: string | null;
  worktree_path: string | null;
  complexity_score: number | null;
  skip_reason: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  elapsed_seconds: number | null;
  created_at: string;
}

function rowToIssue(row: IssueRow): Issue {
  return {
    ...row,
    labels: row.labels ? JSON.parse(row.labels) : [],
  };
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export function createIssue(
  data: Pick<Issue, "id" | "ref" | "source" | "url">,
): Issue {
  const db = getDb();

  const existing = db
    .prepare("SELECT id FROM issues WHERE id = ?")
    .get(data.id);
  if (existing) throw new ConflictError("Issue", data.id);

  db.prepare(
    "INSERT INTO issues (id, ref, source, url) VALUES (?, ?, ?, ?)",
  ).run(data.id, data.ref, data.source, data.url);

  return getIssue(data.id)!;
}

export function getIssue(id: string): Issue | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM issues WHERE id = ?").get(id) as
    | IssueRow
    | undefined;
  return row ? rowToIssue(row) : null;
}

export function listIssues(status?: IssueStatus | IssueStatus[]): Issue[] {
  const db = getDb();

  if (!status) {
    return (db.prepare("SELECT * FROM issues ORDER BY created_at DESC").all() as IssueRow[]).map(
      rowToIssue,
    );
  }

  const statuses = Array.isArray(status) ? status : [status];
  const placeholders = statuses.map(() => "?").join(", ");
  return (
    db
      .prepare(
        `SELECT * FROM issues WHERE status IN (${placeholders}) ORDER BY created_at DESC`,
      )
      .all(...statuses) as IssueRow[]
  ).map(rowToIssue);
}

export function updateIssue(id: string, patch: Partial<Issue>): Issue {
  const db = getDb();

  const existing = getIssue(id);
  if (!existing) throw new NotFoundError("Issue", id);

  const entries = Object.entries(patch).filter(
    ([key]) => key !== "id" && key !== "created_at",
  );
  if (entries.length === 0) return existing;

  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of entries) {
    sets.push(`${key} = ?`);
    values.push(key === "labels" ? JSON.stringify(value) : value);
  }
  values.push(id);

  db.prepare(`UPDATE issues SET ${sets.join(", ")} WHERE id = ?`).run(
    ...values,
  );

  return getIssue(id)!;
}

export function deleteIssue(id: string): void {
  const db = getDb();

  const existing = getIssue(id);
  if (!existing) throw new NotFoundError("Issue", id);

  db.prepare("DELETE FROM logs WHERE issue_id = ?").run(id);
  db.prepare("DELETE FROM agent_runs WHERE issue_id = ?").run(id);
  db.prepare("DELETE FROM issues WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export function appendLog(
  issueId: string,
  step: number,
  type: LogEntry["type"],
  message: string,
): LogEntry {
  const db = getDb();

  const issue = getIssue(issueId);
  if (!issue) throw new NotFoundError("Issue", issueId);

  const result = db
    .prepare(
      "INSERT INTO logs (issue_id, step, type, message) VALUES (?, ?, ?, ?)",
    )
    .run(issueId, step, type, message);

  return db
    .prepare("SELECT * FROM logs WHERE id = ?")
    .get(result.lastInsertRowid) as LogEntry;
}

export function getLogsForIssue(issueId: string): LogEntry[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM logs WHERE issue_id = ? ORDER BY id ASC")
    .all(issueId) as LogEntry[];
}

// ---------------------------------------------------------------------------
// Agent runs
// ---------------------------------------------------------------------------

export function recordAgentRun(data: Omit<AgentRun, "created_at">): void {
  const db = getDb();

  db.prepare(
    `INSERT INTO agent_runs (id, issue_id, step, model, input_tokens, output_tokens, cost_usd, latency_ms, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    data.id,
    data.issue_id,
    data.step,
    data.model ?? null,
    data.input_tokens ?? null,
    data.output_tokens ?? null,
    data.cost_usd ?? null,
    data.latency_ms ?? null,
    data.status ?? null,
  );
}
