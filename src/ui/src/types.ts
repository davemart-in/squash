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
  context: string | null;
  repo_id: string | null;
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

export interface Repo {
  id: string;
  name: string;
  local_path: string;
  github_owner: string | null;
  github_repo: string | null;
  linear_team_key: string | null;
  created_at: string;
}

export const STEP_NAMES = [
  "Queue",
  "Fetch",
  "Assess",
  "Branch",
  "Plan",
  "Fix",
  "PR",
  "Review",
  "Done",
] as const;
