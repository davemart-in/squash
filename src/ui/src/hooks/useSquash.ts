import { useState, useEffect, useCallback, useRef } from "react";
import type { Issue, LogEntry, Repo } from "../types";

const API = "";

export function useSquash() {
  const [issues, setIssues] = useState<Record<string, Issue>>({});
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({});
  const [repos, setRepos] = useState<Record<string, Repo>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [showFixIt, setShowFixIt] = useState(false);

  // Fetch all issues and repos on mount
  useEffect(() => {
    fetch(`${API}/api/issues`)
      .then((r) => r.json())
      .then((list: Issue[]) => {
        const map: Record<string, Issue> = {};
        for (const issue of list) map[issue.id] = issue;
        setIssues(map);

        // Fetch logs for each issue
        for (const issue of list) {
          fetch(`${API}/api/issues/${issue.id}/logs`)
            .then((r) => r.json())
            .then((entries: LogEntry[]) => {
              setLogs((prev) => ({ ...prev, [issue.id]: entries }));
            });
        }
      });

    fetch(`${API}/api/repos`)
      .then((r) => r.json())
      .then((list: Repo[]) => {
        const map: Record<string, Repo> = {};
        for (const repo of list) map[repo.id] = repo;
        setRepos(map);
      });
  }, []);

  // WebSocket connection
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "issue_updated") {
        const issue = data.payload as Issue;
        setIssues((prev) => {
          const old = prev[issue.id];
          if (issue.status === "running" && old && old.status !== "running") {
            setShowFixIt(true);
            setTimeout(() => setShowFixIt(false), 2000);
          }
          return { ...prev, [issue.id]: issue };
        });
      }

      if (data.type === "log_appended") {
        const log = data.payload as LogEntry;
        setLogs((prev) => ({
          ...prev,
          [log.issue_id]: [...(prev[log.issue_id] ?? []), log],
        }));
      }

      if (data.type === "issue_deleted") {
        const { id } = data.payload as { id: string };
        setIssues((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setLogs((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setSelectedId((prev) => (prev === id ? null : prev));
      }
    };

    return () => ws.close();
  }, []);

  /** Check if a repo mapping exists for a GitHub owner/repo or Linear team key. */
  const lookupRepo = useCallback(async (params: { owner: string; repo: string } | { team: string }): Promise<Repo | null> => {
    const qs = "owner" in params
      ? `owner=${encodeURIComponent(params.owner)}&repo=${encodeURIComponent(params.repo)}`
      : `team=${encodeURIComponent(params.team)}`;
    const res = await fetch(`${API}/api/repos/lookup?${qs}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
  }, []);

  /** Register a new repo mapping. */
  const registerRepo = useCallback(async (data: {
    name: string;
    local_path: string;
    github_owner?: string;
    github_repo?: string;
    linear_team_key?: string;
  }): Promise<Repo> => {
    const res = await fetch(`${API}/api/repos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    const repo: Repo = await res.json();
    setRepos((prev) => ({ ...prev, [repo.id]: repo }));
    return repo;
  }, []);

  const addIssue = useCallback(async (url: string, context?: string, repo_id?: string) => {
    const res = await fetch(`${API}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, context: context || undefined, repo_id: repo_id || undefined }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    const issue: Issue = await res.json();
    setIssues((prev) => ({ ...prev, [issue.id]: issue }));
    setSelectedId(issue.id);
    return issue;
  }, []);

  const removeIssue = useCallback(async (id: string) => {
    const res = await fetch(`${API}/api/issues/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) throw new Error("Failed to delete issue");
    setIssues((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setLogs((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSelectedId((prev) => (prev === id ? null : prev));
  }, []);

  const retryIssue = useCallback(async (id: string) => {
    const res = await fetch(`${API}/api/issues/${id}/retry`, { method: "POST" });
    if (!res.ok) throw new Error((await res.json()).error);
    const issue: Issue = await res.json();
    setIssues((prev) => ({ ...prev, [issue.id]: issue }));
  }, []);

  const markComplete = useCallback(async (id: string) => {
    const res = await fetch(`${API}/api/issues/${id}/complete`, { method: "POST" });
    if (!res.ok) throw new Error((await res.json()).error);
    const issue: Issue = await res.json();
    setIssues((prev) => ({ ...prev, [issue.id]: issue }));
  }, []);

  return { issues, logs, repos, selectedId, setSelectedId, addIssue, removeIssue, retryIssue, markComplete, lookupRepo, registerRepo, showFixIt };
}
