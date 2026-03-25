import path from "path";
import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { getIssue, getLogsForIssue, setBroadcast, type IssueStatus } from "../db/issues.js";
import { queueIssue, getStatus, listAll } from "../agents/orchestrator.js";

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// POST /api/issues — queue a new issue
app.post("/api/issues", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "Missing or invalid 'url' in request body" });
      return;
    }
    const issue = await queueIssue(url);
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

// ---------------------------------------------------------------------------
// Static frontend (production)
// ---------------------------------------------------------------------------

const publicDir = path.resolve(import.meta.dirname, "public");
app.use(express.static(publicDir));
app.get("*", (_req, res, next) => {
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
