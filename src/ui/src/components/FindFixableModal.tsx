import { useState, useCallback } from "react";
import { X, ChevronDown, ChevronRight, Check, Loader2, FolderOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Repo } from "../types";

// ---------------------------------------------------------------------------
// Types (matches backend DiscoveredIssue)
// ---------------------------------------------------------------------------

interface DiscoveredIssue {
  url: string;
  ref: string;
  source: "github" | "linear";
  title: string;
  body: string | null;
  labels: string[];
  assignee: string | null;
  should_attempt: boolean;
  complexity_score: number;
  reasoning: string;
}

export interface DiscoverState {
  issues: DiscoveredIssue[];
  sourceUrl: string;
  queuedUrls: Set<string>;
  repoId?: string;
  nextPage?: number;
  nextCursor?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  open: boolean;
  onClose: () => void;
  onQueue: (url: string, repoId?: string) => Promise<void>;
  onLookupRepo: (params: { owner: string; repo: string } | { team: string }) => Promise<Repo | null>;
  onRegisterRepo: (data: { name: string; local_path: string; github_owner?: string; github_repo?: string; linear_team_key?: string }) => Promise<Repo>;
  state: DiscoverState | null;
  onStateChange: (state: DiscoverState) => void;
}

export function FindFixableModal({ open, onClose, onQueue, onLookupRepo, onRegisterRepo, state, onStateChange }: Props) {
  const [url, setUrl] = useState(state?.sourceUrl ?? "");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Repo prompting state
  const [repoPrompt, setRepoPrompt] = useState<{
    parsed: { type: "github"; owner: string; repo: string } | { type: "linear"; team: string };
    localPath: string;
    error: string | null;
  } | null>(null);

  if (!open) return null;

  const parseRepoUrl = (u: string): { type: "github"; owner: string; repo: string } | { type: "linear"; team: string } | null => {
    const gh = u.match(/github\.com\/([^/]+)\/([^/\s?#]+)/);
    if (gh) return { type: "github", owner: gh[1], repo: gh[2].replace(/\.git$/, "") };
    const lin = u.match(/linear\.app\/[^/]+\/team\/([^/\s?#]+)/i);
    if (lin) return { type: "linear", team: lin[1] };
    return null;
  };

  /** Ensure we have a repo mapping before scanning. Returns repo ID or null. */
  const ensureRepo = async (targetUrl: string): Promise<string | null | "prompt"> => {
    const parsed = parseRepoUrl(targetUrl);
    if (!parsed) return null;
    const lookupParams = parsed.type === "github"
      ? { owner: parsed.owner, repo: parsed.repo }
      : { team: parsed.team };
    const existing = await onLookupRepo(lookupParams);
    if (existing) return existing.id;
    setRepoPrompt({ parsed, localPath: "", error: null });
    return "prompt";
  };

  const doScan = async (repoId?: string, pageOrCursor?: { page?: number; cursor?: string }) => {
    const targetUrl = url.trim();
    if (!targetUrl) return;

    setLoading(true);
    setError(null);
    setProgress("Fetching issues…");

    try {
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: targetUrl,
          page: pageOrCursor?.page,
          cursor: pageOrCursor?.cursor,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Request failed");
      }

      setProgress("Assessing fixability…");

      const data = await res.json();
      const newIssues = data.issues as DiscoveredIssue[];
      const existing = state?.sourceUrl === targetUrl ? state.issues : [];
      const existingQueued = state?.sourceUrl === targetUrl ? state.queuedUrls : new Set<string>();

      onStateChange({
        issues: [...existing, ...newIssues],
        sourceUrl: targetUrl,
        queuedUrls: existingQueued,
        repoId: repoId ?? state?.repoId,
        nextPage: data.nextPage,
        nextCursor: data.nextCursor,
      });

      setProgress(`Found ${newIssues.length} fixable out of ${data.all_count} scanned`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress("");
    } finally {
      setLoading(false);
    }
  };

  const scan = async (pageOrCursor?: { page?: number; cursor?: string }) => {
    // For paginated requests, repo is already resolved
    if (pageOrCursor) {
      await doScan(state?.repoId, pageOrCursor);
      return;
    }
    // First scan — check repo mapping
    const repoId = await ensureRepo(url.trim());
    if (repoId === "prompt") return; // Wait for user to provide local path
    await doScan(repoId ?? undefined);
  };

  const handleRepoPromptSubmit = async () => {
    if (!repoPrompt || !repoPrompt.localPath.trim()) return;
    const { parsed, localPath } = repoPrompt;
    try {
      const repoData = parsed.type === "github"
        ? { name: `${parsed.owner}/${parsed.repo}`, local_path: localPath.trim(), github_owner: parsed.owner, github_repo: parsed.repo }
        : { name: parsed.team, local_path: localPath.trim(), linear_team_key: parsed.team };
      const repo = await onRegisterRepo(repoData);
      setRepoPrompt(null);
      await doScan(repo.id);
    } catch (err) {
      setRepoPrompt({ ...repoPrompt, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleQueue = async (issueUrl: string) => {
    await onQueue(issueUrl, state?.repoId);
    if (state) {
      const newQueued = new Set(state.queuedUrls);
      newQueued.add(issueUrl);
      onStateChange({ ...state, queuedUrls: newQueued });
    }
  };

  const issues = state?.issues ?? [];
  const queuedUrls = state?.queuedUrls ?? new Set();
  const hasMore = !!(state?.nextPage || state?.nextCursor);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <h2 className="text-sm font-medium text-zinc-900">Find fixable issues</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-4 border-b border-zinc-100">
          <div className="flex gap-2">
            <Input
              placeholder="github.com/owner/repo or linear.app/team/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && scan()}
              className="text-sm h-8"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => scan()}
              disabled={loading || !url.trim()}
            >
              {loading ? "Scanning…" : "Scan"}
            </Button>
          </div>
          {progress && (
            <div className="text-xs text-zinc-400 mt-2">{progress}</div>
          )}
          {error && (
            <div className="text-xs text-red-500 mt-2">{error}</div>
          )}
          {repoPrompt && (
            <div className="mt-3 p-3 rounded-md border border-amber-200 bg-amber-50">
              <div className="text-xs text-amber-800 mb-1.5">
                {repoPrompt.parsed.type === "github" ? (
                  <>
                    <span className="font-medium">
                      Squash needs a local clone of {repoPrompt.parsed.owner}/{repoPrompt.parsed.repo}
                    </span>
                    {" "}to create branches and open PRs. Where is it on your machine?
                  </>
                ) : (
                  <>
                    <span className="font-medium">
                      Squash needs a local clone of the GitHub repo for the {repoPrompt.parsed.team} team
                    </span>
                    {" "}to create branches and open PRs. Where is it on your machine?
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="/Users/…/repo"
                  value={repoPrompt.localPath}
                  onChange={(e) => setRepoPrompt({ ...repoPrompt, localPath: e.target.value, error: null })}
                  onKeyDown={(e) => e.key === "Enter" && handleRepoPromptSubmit()}
                  className="text-sm h-7 flex-1"
                  autoFocus
                />
                <Button
                  variant="ghost"
                  size="xs"
                  title="Browse"
                  onClick={async () => {
                    const res = await fetch("/api/repos/pick-folder", { method: "POST" });
                    const { path } = await res.json();
                    if (path) setRepoPrompt({ ...repoPrompt, localPath: path, error: null });
                  }}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="xs" onClick={handleRepoPromptSubmit}>
                  Save & Scan
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setRepoPrompt(null)}>
                  Cancel
                </Button>
              </div>
              {repoPrompt.error && (
                <div className="text-xs text-red-500 mt-1">{repoPrompt.error}</div>
              )}
            </div>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {issues.length === 0 && !loading ? (
            <div className="text-sm text-zinc-400 px-6 py-8 text-center">
              {state ? "No fixable issues found" : "Paste a repo or team URL and click Scan"}
            </div>
          ) : (
            <div>
              {issues.map((issue) => (
                <DiscoveredRow
                  key={issue.url}
                  issue={issue}
                  queued={queuedUrls.has(issue.url)}
                  expanded={expandedId === issue.url}
                  onToggle={() => setExpandedId(expandedId === issue.url ? null : issue.url)}
                  onQueue={() => handleQueue(issue.url)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Load more */}
        {hasMore && (
          <div className="px-6 py-3 border-t border-zinc-100">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={loading}
              onClick={() => scan({ page: state?.nextPage, cursor: state?.nextCursor })}
            >
              Load more
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Discovered issue row
// ---------------------------------------------------------------------------

function DiscoveredRow({
  issue,
  queued,
  expanded,
  onToggle,
  onQueue,
}: {
  issue: DiscoveredIssue;
  queued: boolean;
  expanded: boolean;
  onToggle: () => void;
  onQueue: () => void;
}) {
  const [creating, setCreating] = useState(false);

  const handleQueue = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setCreating(true);
    try {
      await onQueue();
    } finally {
      setCreating(false);
    }
  }, [onQueue]);

  const busy = creating || queued;
  const scoreColor =
    issue.complexity_score <= 3
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-amber-50 text-amber-700 border-amber-200";

  return (
    <div className={`border-b border-zinc-100 ${busy ? "bg-zinc-50" : ""}`}>
      <div
        className={`flex items-center gap-3 px-6 py-3 cursor-pointer ${busy ? "" : "hover:bg-zinc-50"}`}
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex gap-2 items-baseline">
            <span className={`font-mono text-xs whitespace-nowrap ${busy ? "text-zinc-300" : "text-zinc-400"}`}>
              {issue.ref}
            </span>
            <span className={`text-sm font-medium truncate ${busy ? "text-zinc-400" : "text-zinc-900"}`}>
              {issue.title}
            </span>
          </div>
        </div>
        <Badge variant="outline" className={`text-xs flex-shrink-0 ${busy ? "opacity-50" : ""} ${scoreColor}`}>
          {issue.complexity_score}/10
        </Badge>
        {queued ? (
          <span className="flex items-center gap-1 text-xs text-emerald-500 flex-shrink-0 px-2 py-1">
            <Check className="w-3 h-3" />
            Queued
          </span>
        ) : creating ? (
          <span className="flex items-center gap-1 text-xs text-zinc-400 flex-shrink-0 px-2 py-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            Creating…
          </span>
        ) : (
          <button
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-900 flex-shrink-0 px-2 py-1 rounded hover:bg-zinc-100"
            onClick={handleQueue}
          >
            Create PR
          </button>
        )}
      </div>
      {expanded && (
        <div className="px-6 pb-4 pl-12">
          <div className="text-xs text-zinc-500 mb-2">{issue.reasoning}</div>
          {issue.body && (
            <div className="text-xs text-zinc-400 whitespace-pre-wrap line-clamp-6">
              {issue.body}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
