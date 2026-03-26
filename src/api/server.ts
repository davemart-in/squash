import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { getIssue, getLogsForIssue, setBroadcast, type IssueStatus } from "../db/issues.js";
import { queueIssue, getStatus, listAll, retryIssue, completeIssue, cancelAndDeleteIssue } from "../agents/orchestrator.js";
import { discoverFromGitHub, discoverFromLinear, discoverAndAssess } from "../agents/discoverer.js";
import { createRepo, listRepos, findRepoByGitHub, findRepoByLinearTeam, deleteRepo } from "../db/repos.js";

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// POST /api/issues — queue a new issue
app.post("/api/issues", async (req, res) => {
  try {
    const { url, context, repo_id } = req.body;
    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "Missing or invalid 'url' in request body" });
      return;
    }
    const issue = await queueIssue(url, context, repo_id);
    res.status(201).json(issue);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// GET /api/issues — list issues, optionally filtered by status
app.get("/api/issues", (_req, res) => {
  try {
    const statusParam = _req.query.status as string | undefined;
    let filter: IssueStatus | IssueStatus[] | undefined;

    if (statusParam) {
      filter = statusParam.includes(",")
        ? (statusParam.split(",") as IssueStatus[])
        : (statusParam as IssueStatus);
    }

    res.json(listAll(filter));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// GET /api/issues/:id — single issue
app.get("/api/issues/:id", (req, res) => {
  try {
    res.json(getStatus(req.params.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: message });
  }
});

// GET /api/issues/:id/logs — logs for an issue
app.get("/api/issues/:id/logs", (req, res) => {
  try {
    const issue = getIssue(req.params.id);
    if (!issue) {
      res.status(404).json({ error: `Issue not found: ${req.params.id}` });
      return;
    }
    res.json(getLogsForIssue(req.params.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// POST /api/discover — find fixable issues from a repo or team
app.post("/api/discover", async (req, res) => {
  try {
    const { url, page, cursor } = req.body;
    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "Missing or invalid 'url' in request body" });
      return;
    }

    const isGitHub = url.includes("github.com");
    const isLinear = url.includes("linear.app");

    if (!isGitHub && !isLinear) {
      res.status(400).json({ error: "URL must be a GitHub repo or Linear team URL" });
      return;
    }

    let rawIssues;
    let nextPage: number | undefined;
    let nextCursor: string | undefined;

    if (isGitHub) {
      rawIssues = await discoverFromGitHub(url, page ?? 1);
      if (rawIssues.length === 25) nextPage = (page ?? 1) + 1;
    } else {
      const result = await discoverFromLinear(url, cursor);
      rawIssues = result.issues;
      nextCursor = result.nextCursor ?? undefined;
    }

    const allAssessed = await discoverAndAssess(rawIssues);
    const fixable = allAssessed.filter((i) => i.should_attempt);

    res.json({
      issues: fixable,
      all_count: rawIssues.length,
      nextPage,
      nextCursor,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// POST /api/issues/:id/retry — retry a failed issue from where it left off
app.post("/api/issues/:id/retry", (req, res) => {
  try {
    const issue = retryIssue(req.params.id);
    res.json(issue);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

// POST /api/issues/:id/complete — mark an issue as done
app.post("/api/issues/:id/complete", (req, res) => {
  try {
    const issue = completeIssue(req.params.id);
    res.json(issue);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

// GET /api/issues/:id/diff — get the git diff for an issue's branch
app.get("/api/issues/:id/diff", (req, res) => {
  try {
    const issue = getIssue(req.params.id);
    if (!issue) {
      res.status(404).json({ error: `Issue not found: ${req.params.id}` });
      return;
    }
    if (!issue.worktree_path || !issue.branch) {
      res.status(400).json({ error: "No worktree or branch for this issue" });
      return;
    }
    const diff = execSync(`git -C ${issue.worktree_path} diff HEAD~1 --no-color`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    res.type("text/plain").send(diff);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// DELETE /api/issues/:id — cancel and delete an issue
app.delete("/api/issues/:id", (req, res) => {
  try {
    cancelAndDeleteIssue(req.params.id);
    res.status(204).end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

// GET /api/repos — list all registered repos
app.get("/api/repos", (_req, res) => {
  try {
    res.json(listRepos());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// GET /api/repos/lookup — check if a repo mapping exists
app.get("/api/repos/lookup", (req, res) => {
  try {
    const { owner, repo, team } = req.query as { owner?: string; repo?: string; team?: string };
    let found = null;
    if (owner && repo) {
      found = findRepoByGitHub(owner, repo);
    } else if (team) {
      found = findRepoByLinearTeam(team);
    } else {
      res.status(400).json({ error: "Provide owner+repo or team query params" });
      return;
    }
    if (found) {
      res.json(found);
    } else {
      res.status(404).json({ error: "No repo mapping found" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// POST /api/repos — register a new repo
app.post("/api/repos", (req, res) => {
  try {
    const { name, local_path, github_owner, github_repo, linear_team_key } = req.body;
    if (!name || !local_path) {
      res.status(400).json({ error: "name and local_path are required" });
      return;
    }
    // Validate it's a git repo
    try {
      execSync(`git -C ${local_path} rev-parse --git-dir`, { stdio: "pipe" });
    } catch {
      res.status(400).json({ error: `${local_path} is not a valid git repository` });
      return;
    }
    const repo = createRepo({ name, local_path, github_owner, github_repo, linear_team_key });
    res.status(201).json(repo);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// DELETE /api/repos/:id — unregister a repo
app.delete("/api/repos/:id", (req, res) => {
  try {
    deleteRepo(req.params.id);
    res.status(204).end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: message });
  }
});

// POST /api/repos/pick-folder — open native OS folder picker, return selected path
app.post("/api/repos/pick-folder", async (_req, res) => {
  try {
    const { platform } = process;
    let command: string;
    if (platform === "darwin") {
      command = `osascript -e 'POSIX path of (choose folder with prompt "Select the local repo clone")'`;
    } else if (platform === "linux") {
      command = `zenity --file-selection --directory --title="Select the local repo clone" 2>/dev/null`;
    } else {
      res.status(501).json({ error: "Folder picker not supported on this OS" });
      return;
    }
    const selected = execSync(command, { encoding: "utf-8", timeout: 60000 }).trim();
    // Remove trailing slash
    const folder = selected.replace(/\/+$/, "");
    res.json({ path: folder });
  } catch {
    // User cancelled the dialog
    res.json({ path: null });
  }
});

// ---------------------------------------------------------------------------
// Static frontend (production)
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "public");
app.use(express.static(publicDir));
app.get("*splat", (_req, res, next) => {
  // Only serve index.html for non-API routes (SPA fallback)
  if (_req.path.startsWith("/api")) return next();
  res.sendFile(path.join(publicDir, "index.html"));
});

// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------

const server = createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
});

function broadcastUpdate(type: string, payload: unknown): void {
  const message = JSON.stringify({ type, payload });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Wire broadcast into the DB layer
setBroadcast(broadcastUpdate);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export function startServer(): void {
  const PORT = parseInt(process.env.PORT ?? "3001", 10);
  server.listen(PORT, () => {
    console.log(`squash: API server listening on http://localhost:${PORT}`);
  });
}

export { app, server, broadcastUpdate };
