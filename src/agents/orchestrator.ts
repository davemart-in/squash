import { v4 as uuidv4 } from "uuid";
import {
  createIssue,
  getIssue,
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

export async function queueIssue(url: string): Promise<Issue> {
  const { source, ref } = parseIssueUrl(url);
  const id = uuidv4();

  const issue = createIssue({ id, ref, source, url });

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
