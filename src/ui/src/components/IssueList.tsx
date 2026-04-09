import { useState } from "react";
import { Trash2, RotateCcw, Check, Search, FolderOpen, Download, Loader2 } from "lucide-react";
import { FindFixableModal } from "./FindFixableModal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { Issue, IssueStatus, Repo } from "../types";
import { STEP_NAMES } from "../types";

// ---------------------------------------------------------------------------
// Dot color per status
// ---------------------------------------------------------------------------

const dotColor: Record<IssueStatus, string> = {
  running: "bg-blue-500",
  "needs-review": "bg-amber-500",
  error: "bg-red-500",
  done: "bg-green-500",
  skipped: "bg-zinc-300",
  queued: "bg-blue-500",
};

// ---------------------------------------------------------------------------
// Tab filters
// ---------------------------------------------------------------------------

const TAB_FILTERS: Record<string, (i: Issue) => boolean> = {
  progress: (i) => ["queued", "running", "needs-review", "error"].includes(i.status),
  completed: (i) => i.status === "done",
  skipped: (i) => i.status === "skipped",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Parse owner/repo from a GitHub URL, or linear team key from a Linear URL. */
function parseRepoFromUrl(url: string): { type: "github"; owner: string; repo: string } | { type: "linear"; team: string } | null {
  const gh = url.match(/github\.com\/([^/]+)\/([^/\s?#]+)/);
  if (gh) return { type: "github", owner: gh[1], repo: gh[2].replace(/\.git$/, "") };
  const lin = url.match(/linear\.app\/[^/]+\/(?:issue\/([A-Z]+)-|team\/([^/\s?#]+))/i);
  if (lin) return { type: "linear", team: lin[1] ?? lin[2] };
  return null;
}

interface Props {
  issues: Record<string, Issue>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (url: string, context?: string, repoId?: string) => Promise<void>;
  onLookupRepo: (params: { owner: string; repo: string } | { team: string }) => Promise<Repo | null>;
  onRegisterRepo: (data: { name: string; local_path: string; github_owner?: string; github_repo?: string; linear_team_key?: string }) => Promise<Repo>;
  onDelete: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  onComplete: (id: string) => Promise<void>;
}

export function IssueList({ issues, selectedId, onSelect, onAdd, onLookupRepo, onRegisterRepo, onDelete, onRetry, onComplete }: Props) {
  const [url, setUrl] = useState("");
  const [context, setContext] = useState("");
  const [showContext, setShowContext] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);
  const [discoverState, setDiscoverState] = useState<any>(null);

  // Repo prompting state
  const [pendingRepoPrompt, setPendingRepoPrompt] = useState<{
    parsed: { type: "github"; owner: string; repo: string } | { type: "linear"; team: string };
    localPath: string;
    error: string | null;
    cloning: boolean;
  } | null>(null);

  /** Resolve repo_id for a URL, returning it if found or null to trigger a prompt. */
  const resolveRepoId = async (issueUrl: string): Promise<string | null | "prompt"> => {
    const parsed = parseRepoFromUrl(issueUrl);
    if (!parsed) return null; // Can't parse — proceed without repo_id (fallback to REPO_PATH)
    const lookupParams = parsed.type === "github"
      ? { owner: parsed.owner, repo: parsed.repo }
      : { team: parsed.team };
    const existing = await onLookupRepo(lookupParams);
    if (existing) return existing.id;
    // Need to prompt
    setPendingRepoPrompt({ parsed, localPath: "", error: null, cloning: false });
    return "prompt";
  };

  const handleSubmit = async () => {
    if (!url.trim() || submitting) return;
    setSubmitting(true);
    try {
      const repoId = await resolveRepoId(url.trim());
      if (repoId === "prompt") {
        // Stop — user will fill in local path, then we continue
        setSubmitting(false);
        return;
      }
      await onAdd(url.trim(), context.trim() || undefined, repoId ?? undefined);
      setUrl("");
      setContext("");
      setShowContext(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRepoPromptSubmit = async () => {
    if (!pendingRepoPrompt || !pendingRepoPrompt.localPath.trim()) return;
    const { parsed, localPath } = pendingRepoPrompt;
    try {
      const repoData = parsed.type === "github"
        ? { name: `${parsed.owner}/${parsed.repo}`, local_path: localPath.trim(), github_owner: parsed.owner, github_repo: parsed.repo }
        : { name: parsed.team, local_path: localPath.trim(), linear_team_key: parsed.team };
      const repo = await onRegisterRepo(repoData);
      setPendingRepoPrompt(null);
      // Now add the issue with the new repo_id
      await onAdd(url.trim(), context.trim() || undefined, repo.id);
      setUrl("");
      setContext("");
      setShowContext(false);
    } catch (err) {
      setPendingRepoPrompt({ ...pendingRepoPrompt, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const allIssues = Object.values(issues).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const counts = {
    progress: allIssues.filter(TAB_FILTERS.progress).length,
    completed: allIssues.filter(TAB_FILTERS.completed).length,
    skipped: allIssues.filter(TAB_FILTERS.skipped).length,
  };

  return (
    <div className="w-[350px] flex-shrink-0 flex flex-col border-r border-zinc-200 h-full">
      {/* URL input */}
      <div className="p-4 border-b border-zinc-100">
        <div className="flex gap-2">
          <Input
            placeholder="github.com/… or linear.app/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !showContext && handleSubmit()}
            className="text-sm h-8"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || !url.trim()}
          >
            Add
          </Button>
        </div>
        <div className="flex gap-3 mt-1.5">
          {!showContext ? (
            <button
              className="text-xs text-zinc-400 hover:text-zinc-600"
              onClick={() => setShowContext(true)}
            >
              Add context
            </button>
          ) : null}
          <button
            className="text-xs text-zinc-400 hover:text-zinc-600 flex items-center gap-1"
            onClick={() => setShowDiscover(true)}
          >
            <Search className="w-3 h-3" />
            Find fixable issues
          </button>
        </div>
        {showContext && (
          <textarea
            placeholder="Additional context for the agent…"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            className="mt-2 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 resize-none"
            rows={3}
          />
        )}
        {pendingRepoPrompt && (
          <div className="mt-2 p-3 rounded-md border border-amber-200 bg-amber-50">
            <div className="text-xs text-zinc-600 mb-1.5">
              {pendingRepoPrompt.parsed.type === "github" ? (
                <>
                  <span className="font-medium">
                    Squash needs a local clone of {pendingRepoPrompt.parsed.owner}/{pendingRepoPrompt.parsed.repo}
                  </span>
                  {" "}to create branches and open PRs.
                </>
              ) : (
                <>
                  <span className="font-medium">
                    Squash needs a local clone of the GitHub repo for the {pendingRepoPrompt.parsed.team} team
                  </span>
                  {" "}to create branches and open PRs. Where is it on your machine?
                </>
              )}
            </div>
            {pendingRepoPrompt.parsed.type === "github" && (
              <Button
                variant="outline"
                size="xs"
                className="w-full mb-2"
                disabled={pendingRepoPrompt.cloning}
                onClick={async () => {
                  if (pendingRepoPrompt.parsed.type !== "github") return;
                  const { owner, repo } = pendingRepoPrompt.parsed;
                  setPendingRepoPrompt({ ...pendingRepoPrompt, cloning: true, error: null });
                  try {
                    const res = await fetch("/api/repos/clone", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ owner, repo }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error);
                    // Auto-register and continue
                    const repoData = { name: `${owner}/${repo}`, local_path: data.path, github_owner: owner, github_repo: repo };
                    const registered = await onRegisterRepo(repoData);
                    setPendingRepoPrompt(null);
                    await onAdd(url.trim(), context.trim() || undefined, registered.id);
                    setUrl("");
                    setContext("");
                    setShowContext(false);
                  } catch (err) {
                    setPendingRepoPrompt({ ...pendingRepoPrompt, cloning: false, error: err instanceof Error ? err.message : String(err) });
                  }
                }}
              >
                {pendingRepoPrompt.cloning ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Cloning…</>
                ) : (
                  <><Download className="w-3.5 h-3.5 mr-1.5" /> Clone it for me</>
                )}
              </Button>
            )}
            {pendingRepoPrompt.parsed.type === "github" && !pendingRepoPrompt.cloning && (
              <div className="text-xs text-zinc-400 mb-1.5">or point to an existing clone</div>
            )}
            {!pendingRepoPrompt.cloning && (
              <div className="flex gap-2">
                <Input
                  placeholder="/Users/…/repo"
                  value={pendingRepoPrompt.localPath}
                  onChange={(e) => setPendingRepoPrompt({ ...pendingRepoPrompt, localPath: e.target.value, error: null })}
                  onKeyDown={(e) => e.key === "Enter" && handleRepoPromptSubmit()}
                  className="text-sm h-7 flex-1"
                  autoFocus={pendingRepoPrompt.parsed.type !== "github"}
                />
                <Button
                  variant="ghost"
                  size="xs"
                  title="Browse"
                  onClick={async () => {
                    const res = await fetch("/api/repos/pick-folder", { method: "POST" });
                    const { path } = await res.json();
                    if (path) setPendingRepoPrompt({ ...pendingRepoPrompt, localPath: path, error: null });
                  }}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="xs" onClick={handleRepoPromptSubmit}>
                  Save
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setPendingRepoPrompt(null)}>
                  Cancel
                </Button>
              </div>
            )}
            {pendingRepoPrompt.error && (
              <div className="text-xs text-red-500 mt-1">{pendingRepoPrompt.error}</div>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="progress" className="flex-1 flex flex-col min-h-0">
        <TabsList variant="line" className="px-4 pt-2 gap-2">
          <TabsTrigger value="progress" className="text-xs">
            In progress
            <Badge variant="secondary" className="text-xs ml-1.5 rounded-full h-4 px-1.5">
              {counts.progress}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="completed" className="text-xs">
            Completed
            <Badge variant="secondary" className="text-xs ml-1.5 rounded-full h-4 px-1.5">
              {counts.completed}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="skipped" className="text-xs">
            Skipped
            <Badge variant="secondary" className="text-xs ml-1.5 rounded-full h-4 px-1.5">
              {counts.skipped}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {(["progress", "completed", "skipped"] as const).map((tab) => (
          <TabsContent key={tab} value={tab} className="flex-1 overflow-y-auto">
            {allIssues.filter(TAB_FILTERS[tab]).length === 0 ? (
              <div className="text-sm text-zinc-400 px-4 py-8">No issues yet</div>
            ) : (
              allIssues.filter(TAB_FILTERS[tab]).map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  selected={issue.id === selectedId}
                  showDelete={tab !== "completed"}
                  onClick={() => onSelect(issue.id)}
                  onDelete={() => onDelete(issue.id)}
                  onRetry={() => onRetry(issue.id)}
                  onComplete={() => onComplete(issue.id)}
                />
              ))
            )}
          </TabsContent>
        ))}
      </Tabs>

      <FindFixableModal
        open={showDiscover}
        onClose={() => setShowDiscover(false)}
        onQueue={async (issueUrl, repoId) => { await onAdd(issueUrl, undefined, repoId); }}
        onLookupRepo={onLookupRepo}
        onRegisterRepo={onRegisterRepo}
        state={discoverState}
        onStateChange={setDiscoverState}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue row
// ---------------------------------------------------------------------------

function IssueRow({
  issue,
  selected,
  showDelete,
  onClick,
  onDelete,
  onRetry,
  onComplete,
}: {
  issue: Issue;
  selected: boolean;
  showDelete: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onComplete: () => void;
}) {
  const stepName = STEP_NAMES[issue.current_step] ?? "…";

  return (
    <div
      className={`group px-4 py-3 cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 ${
        selected ? "bg-zinc-50" : ""
      }`}
      onClick={onClick}
    >
      <div className="flex gap-2">
        <div
          className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${dotColor[issue.status]}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex gap-2 items-baseline">
            <span className="font-mono text-xs text-zinc-400 whitespace-nowrap">{issue.ref}</span>
            <span className="text-xs text-zinc-400 whitespace-nowrap">
              {stepName} · {issue.current_step}/8
            </span>
          </div>
          <div className="text-sm text-zinc-900 font-medium truncate mt-0.5">
            {issue.title ?? "Untitled"}
          </div>
          {issue.status === "needs-review" && issue.pr_url ? (
            <a
              href={issue.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <Badge
                variant="outline"
                className="mt-1 text-xs border-amber-300 text-amber-600 hover:bg-amber-50 cursor-pointer"
              >
                PR needs review
              </Badge>
            </a>
          ) : issue.status === "needs-review" ? (
            <Badge
              variant="outline"
              className="mt-1 text-xs border-amber-300 text-amber-600"
            >
              PR needs review
            </Badge>
          ) : null}
        </div>
        {showDelete && (
          <div className="opacity-0 group-hover:opacity-100 flex gap-0.5 flex-shrink-0">
            {issue.pr_url && issue.status !== "done" && (
              <button
                className="mt-1 p-1 text-zinc-400 hover:text-green-500 transition-colors"
                onClick={(e) => { e.stopPropagation(); onComplete(); }}
                title="Mark as completed"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            )}
            {issue.status === "error" && (
              <button
                className="mt-1 p-1 text-zinc-400 hover:text-blue-500 transition-colors"
                onClick={(e) => { e.stopPropagation(); onRetry(); }}
                title="Retry from where it left off"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              className="mt-1 p-1 text-zinc-400 hover:text-red-500 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Delete ${issue.ref}? This will remove the worktree and branch.`)) {
                  onDelete();
                }
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
