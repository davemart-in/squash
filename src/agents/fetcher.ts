import { getIssue, updateIssue, appendLog } from "../db/issues.js";
import { NotFoundError } from "../db/errors.js";
import { FetchError } from "./errors.js";

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

interface GitHubIssue {
  title: string;
  body: string | null;
  labels: Array<{ name: string }>;
  assignee: { login: string } | null;
}

function parseGitHubUrl(url: string): { owner: string; repo: string; number: string } {
  // https://github.com/{owner}/{repo}/issues/{number}
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/,
  );
  if (!match) throw new FetchError("github", `Cannot parse GitHub URL: ${url}`);
  return { owner: match[1], repo: match[2], number: match[3] };
}

async function fetchGitHub(url: string): Promise<{
  title: string;
  body: string | null;
  labels: string[];
  assignee: string | null;
}> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new FetchError("github", "GITHUB_TOKEN is not set");

  const { owner, repo, number } = parseGitHubUrl(url);

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${number}`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "squash-agent",
      },
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new FetchError("github", `API returned ${res.status}: ${text}`);
  }

  const data = (await res.json()) as GitHubIssue;

  return {
    title: data.title,
    body: data.body,
    labels: data.labels.map((l) => l.name),
    assignee: data.assignee?.login ?? null,
  };
}

// ---------------------------------------------------------------------------
// Linear
// ---------------------------------------------------------------------------

function parseLinearIdentifier(url: string): string {
  // https://linear.app/{workspace}/issue/{TEAM-123}/slug
  const match = url.match(/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/i);
  if (!match) throw new FetchError("linear", `Cannot parse Linear URL: ${url}`);
  return match[1];
}

interface LinearResponse {
  data?: {
    issue: {
      title: string;
      description: string | null;
      labelNames: string[];
      assignee: { name: string } | null;
    } | null;
  };
  errors?: Array<{ message: string }>;
}

async function fetchLinear(url: string): Promise<{
  title: string;
  body: string | null;
  labels: string[];
  assignee: string | null;
}> {
  const token = process.env.LINEAR_API_KEY;
  if (!token) throw new FetchError("linear", "LINEAR_API_KEY is not set");

  const identifier = parseLinearIdentifier(url);

  const query = `
    query IssueByIdentifier($id: String!) {
      issue(id: $id) {
        title
        description
        labelNames
        assignee { name }
      }
    }
  `;

  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { id: identifier } }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new FetchError("linear", `API returned ${res.status}: ${text}`);
  }

  const json = (await res.json()) as LinearResponse;

  if (json.errors?.length) {
    throw new FetchError("linear", json.errors.map((e) => e.message).join("; "));
  }

  const issue = json.data?.issue;
  if (!issue) {
    throw new FetchError("linear", `Issue not found: ${identifier}`);
  }

  return {
    title: issue.title,
    body: issue.description,
    labels: issue.labelNames ?? [],
    assignee: issue.assignee?.name ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchAndEnrichIssue(issueId: string): Promise<void> {
  const issue = getIssue(issueId);
  if (!issue) throw new NotFoundError("Issue", issueId);

  try {
    const fetcher = issue.source === "github" ? fetchGitHub : fetchLinear;
    const data = await fetcher(issue.url);

    updateIssue(issueId, {
      title: data.title,
      body: data.body,
      labels: data.labels,
      assignee: data.assignee,
    });

    appendLog(issueId, 1, "ok", `Fetched ${issue.source} issue: ${data.title}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendLog(issueId, 1, "err", message);
    throw err instanceof FetchError
      ? err
      : new FetchError(issue.source, message);
  }
}
