import { assessRaw, type AssessmentResult } from "./assessor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RawIssue {
  url: string;
  ref: string;
  source: "github" | "linear";
  title: string;
  body: string | null;
  labels: string[];
  assignee: string | null;
}

export interface DiscoveredIssue extends RawIssue {
  should_attempt: boolean;
  complexity_score: number;
  reasoning: string;
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

function parseGitHubRepoUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com\/([^/]+)\/([^/\s?#]+)/);
  if (!match) throw new Error(`Cannot parse GitHub repo URL: ${url}`);
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

interface GitHubListIssue {
  html_url: string;
  number: number;
  title: string;
  body: string | null;
  labels: Array<{ name: string }>;
  assignee: { login: string } | null;
  pull_request?: unknown;
}

export async function discoverFromGitHub(
  repoUrl: string,
  page: number = 1,
): Promise<RawIssue[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");

  const { owner, repo } = parseGitHubRepoUrl(repoUrl);

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues?state=open&assignee=none&per_page=25&page=${page}&sort=created&direction=desc`,
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
    throw new Error(`GitHub API returned ${res.status}: ${text}`);
  }

  const data = (await res.json()) as GitHubListIssue[];

  return data
    .filter((i) => !i.pull_request) // Exclude PRs (GitHub lists them as issues)
    .map((i) => ({
      url: i.html_url,
      ref: `GH-${i.number}`,
      source: "github" as const,
      title: i.title,
      body: i.body,
      labels: i.labels.map((l) => l.name),
      assignee: i.assignee?.login ?? null,
    }));
}

// ---------------------------------------------------------------------------
// Linear
// ---------------------------------------------------------------------------

function parseLinearTeamUrl(url: string): string {
  // https://linear.app/{workspace}/team/{TEAM}/...
  const match = url.match(/linear\.app\/[^/]+\/team\/([^/\s?#]+)/i);
  if (!match) throw new Error(`Cannot parse Linear team URL: ${url}`);
  return match[1];
}

interface LinearIssuesResponse {
  data?: {
    issues: {
      nodes: Array<{
        identifier: string;
        url: string;
        title: string;
        description: string | null;
        labels: { nodes: Array<{ name: string }> };
        assignee: { name: string } | null;
      }>;
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

export async function discoverFromLinear(
  teamUrl: string,
  cursor?: string,
): Promise<{ issues: RawIssue[]; nextCursor: string | null }> {
  const token = process.env.LINEAR_API_KEY;
  if (!token) throw new Error("LINEAR_API_KEY is not set");

  const teamKey = parseLinearTeamUrl(teamUrl);

  const query = `
    query DiscoverIssues($teamKey: String!, $cursor: String) {
      issues(
        filter: {
          team: { key: { eq: $teamKey } }
          state: { type: { in: ["backlog", "unstarted"] } }
          assignee: { null: true }
        }
        first: 25
        after: $cursor
        orderBy: createdAt
      ) {
        nodes {
          identifier
          url
          title
          description
          labels { nodes { name } }
          assignee { name }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: { teamKey, cursor: cursor || null },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Linear API returned ${res.status}: ${text}`);
  }

  const json = (await res.json()) as LinearIssuesResponse;

  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  const nodes = json.data?.issues.nodes ?? [];
  const pageInfo = json.data?.issues.pageInfo;

  return {
    issues: nodes.map((i) => ({
      url: i.url,
      ref: i.identifier,
      source: "linear" as const,
      title: i.title,
      body: i.description,
      labels: i.labels.nodes.map((l) => l.name),
      assignee: i.assignee?.name ?? null,
    })),
    nextCursor: pageInfo?.hasNextPage ? (pageInfo.endCursor ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Assess in bulk (batched to avoid rate limits)
// ---------------------------------------------------------------------------

export async function discoverAndAssess(
  issues: RawIssue[],
): Promise<DiscoveredIssue[]> {
  const BATCH_SIZE = 5;
  const results: DiscoveredIssue[] = [];

  for (let i = 0; i < issues.length; i += BATCH_SIZE) {
    const batch = issues.slice(i, i + BATCH_SIZE);
    const assessed = await Promise.all(
      batch.map(async (issue) => {
        try {
          const result = await assessRaw(issue.title, issue.body, issue.labels);
          return { ...issue, ...result };
        } catch {
          // If assessment fails, mark as not fixable
          return {
            ...issue,
            should_attempt: false,
            complexity_score: 10,
            reasoning: "Assessment failed",
          };
        }
      }),
    );
    results.push(...assessed);
  }

  return results;
}
