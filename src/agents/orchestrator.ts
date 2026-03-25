import { execSync } from "child_process";
import { v4 as uuidv4 } from "uuid";
import {
  createIssue,
  getIssue,
  updateIssue,
  deleteIssue,
  listIssues,
  type Issue,
  type IssueStatus,
} from "../db/issues.js";
import { fetchAndEnrichIssue } from "./fetcher.js";
import { assessIssue } from "./assessor.js";
import { runAgentForIssue } from "./runner.js";

// ---------------------------------------------------------------------------
// Running agents
// ---------------------------------------------------------------------------

const running = new Map<string, AbortController>();

export function getRunningAgents(): Map<string, AbortController> {
  return running;
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

function parseIssueUrl(url: string): { source: "github" | "linear"; ref: string } {
  const ghMatch = url.match(/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
  if (ghMatch) return { source: "github", ref: `GH-${ghMatch[1]}` };

  const linearMatch = url.match(/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/i);
  if (linearMatch) return { source: "linear", ref: linearMatch[1] };

  throw new Error(`Unsupported issue URL: ${url}`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function queueIssue(url: string, context?: string): Promise<Issue> {
  const { source, ref } = parseIssueUrl(url);
  const id = uuidv4();

  const issue = createIssue({ id, ref, source, url, context: context || null });

  // Step 1 — Fetch
  await fetchAndEnrichIssue(id);

  // Step 2 — Assess
  const assessment = await assessIssue(id);

  if (assessment.should_attempt) {
    const controller = new AbortController();
    running.set(id, controller);

    // Fire and forget — run agent in background
    runAgentForIssue(id).finally(() => {
      running.delete(id);
    });
  }

  // Return the latest state (may have been updated by fetch/assess)
  return getIssue(id)!;
}

export function getStatus(issueId: string): Issue {
  const issue = getIssue(issueId);
  if (!issue) {
    throw new Error(`Issue not found: ${issueId}`);
  }
  return issue;
}

export function listAll(status?: IssueStatus | IssueStatus[]): Issue[] {
  return listIssues(status);
}

export function retryIssue(issueId: string): Issue {
  const issue = getIssue(issueId);
  if (!issue) throw new Error(`Issue not found: ${issueId}`);
  if (running.has(issueId)) throw new Error("Issue is already running");

  // If the worktree is gone, restart from step 3
  let resumeStep = issue.current_step;
  if (resumeStep > 3 && issue.worktree_path) {
    try {
      execSync(`test -d ${issue.worktree_path}`, { stdio: "pipe" });
    } catch {
      resumeStep = 3;
    }
  }

  updateIssue(issueId, { status: "running", error_message: null });

  const controller = new AbortController();
  running.set(issueId, controller);

  runAgentForIssue(issueId, resumeStep).finally(() => {
    running.delete(issueId);
  });

  return getIssue(issueId)!;
}

export function completeIssue(issueId: string): Issue {
  const issue = getIssue(issueId);
  if (!issue) throw new Error(`Issue not found: ${issueId}`);

  updateIssue(issueId, {
    status: "done",
    completed_at: new Date().toISOString(),
  });

  return getIssue(issueId)!;
}

export function cancelAndDeleteIssue(issueId: string): void {
  // Abort running agent (best-effort)
  const controller = running.get(issueId);
  if (controller) {
    controller.abort();
    running.delete(issueId);
  }

  // Clean up git worktree and branch in the target repo
  const issue = getIssue(issueId);
  const repoPath = process.env.REPO_PATH;
  if (issue && repoPath) {
    if (issue.worktree_path) {
      try { execSync(`git -C ${repoPath} worktree remove --force ${issue.worktree_path}`, { stdio: "pipe" }); } catch {}
    }
    if (issue.branch) {
      try { execSync(`git -C ${repoPath} branch -D ${issue.branch}`, { stdio: "pipe" }); } catch {}
    }
  }

  deleteIssue(issueId);
}
