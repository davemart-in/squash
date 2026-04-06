import { useRef, useEffect, useState, useCallback } from "react";
import { GitBranch, ExternalLink } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import type { Issue, LogEntry, IssueStep } from "../types";
import { STEP_NAMES } from "../types";

// ---------------------------------------------------------------------------
// Pipeline step indicator
// ---------------------------------------------------------------------------

function Pipeline({ step }: { step: IssueStep }) {
  return (
    <div className="mb-8">
      <div className="flex items-center">
        {STEP_NAMES.map((name, i) => {
          const isDone = i < step;
          const isActive = i === step;
          return (
            <div key={i} className="flex items-center flex-1 last:flex-initial">
              <div className="flex flex-col items-center">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono ${
                    isDone
                      ? "bg-zinc-900 text-white"
                      : isActive
                        ? "bg-white border-2 border-zinc-900 text-zinc-900"
                        : "bg-white border border-zinc-200 text-zinc-400"
                  }`}
                >
                  {i}
                </div>
                <span className="text-[10px] text-zinc-400 mt-1 text-center w-10 leading-tight">
                  {name}
                </span>
              </div>
              {i < STEP_NAMES.length - 1 && (
                <div
                  className={`flex-1 h-px mb-4 mx-0.5 ${
                    i < step ? "bg-zinc-900" : "bg-zinc-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab({ issue }: { issue: Issue }) {
  const stepName = STEP_NAMES[issue.current_step] ?? "…";
  const elapsed = issue.elapsed_seconds
    ? `${Math.floor(issue.elapsed_seconds / 60)}m ${issue.elapsed_seconds % 60}s`
    : "—";

  return (
    <div>
      <div className="flex flex-col gap-2 mb-6">
        <a
          href={issue.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md border border-zinc-200 px-4 py-2.5 text-sm text-zinc-900 hover:bg-zinc-50 transition-colors"
        >
          <ExternalLink className="w-4 h-4 text-zinc-400" />
          <span className="font-medium">{issue.ref}</span>
          <span className="text-zinc-400 truncate">{issue.title ?? issue.url}</span>
        </a>
        {issue.pr_url && (
          <a
            href={issue.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-md border border-zinc-200 px-4 py-2.5 text-sm text-zinc-900 hover:bg-zinc-50 transition-colors"
          >
            <GitBranch className="w-4 h-4 text-zinc-400" />
            <span className="font-medium">Pull Request #{issue.pr_number}</span>
            <span className="text-zinc-400 truncate">{issue.pr_url}</span>
          </a>
        )}
      </div>

      <Pipeline step={issue.current_step} />

      {/* Status line */}
      <div className="text-sm text-zinc-500 mb-6">
        {stepName} · step {issue.current_step}/8 · {elapsed}
        {issue.pr_url && (
          <>
            {" · "}
            <a
              href={issue.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-900 underline"
            >
              View PR
            </a>
          </>
        )}
      </div>

      {/* Needs-review banner */}
      {issue.status === "needs-review" && issue.pr_number && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-6">
          PR #{issue.pr_number} is ready for your review
        </div>
      )}

      {/* Issue metadata */}
      <div className="mb-6">
        <h2 className="text-base font-medium text-zinc-900 mb-1">
          {issue.title ?? "Untitled"}
        </h2>
        <div className="text-xs text-zinc-400 flex gap-4">
          <span className="flex items-center gap-1">
            {issue.source === "github" ? (
              <GitBranch className="w-3 h-3" />
            ) : (
              <span>◆</span>
            )}
            {issue.ref}
          </span>
          {issue.assignee && <span>@{issue.assignee}</span>}
          {issue.labels.length > 0 && <span>{issue.labels.join(", ")}</span>}
        </div>
      </div>

      <Separator className="mb-4" />

      {/* Issue body */}
      <div className="text-sm text-zinc-600 leading-relaxed whitespace-pre-wrap">
        {issue.body ?? "No description provided."}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live tab
// ---------------------------------------------------------------------------

const logColors: Record<string, string> = {
  cmd: "text-zinc-100",
  ok: "text-emerald-400",
  warn: "text-amber-400",
  err: "text-red-400",
  dim: "text-yellow-400",
};

function LiveTab({ issue, logs }: { issue: Issue; logs: LogEntry[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    userScrolled.current = !atBottom;
  }, []);

  useEffect(() => {
    if (!userScrolled.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="rounded-lg border border-zinc-100 bg-zinc-950 overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="p-4 font-mono text-xs leading-6 overflow-y-auto max-h-[560px]"
      >
        {logs.length === 0 ? (
          <div className="text-zinc-600 text-xs">Waiting for agent…</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className={logColors[log.type] ?? "text-zinc-300"}>
              {log.message}
            </div>
          ))
        )}
        {issue.status === "running" && (
          <span className="inline-block w-1.5 h-3.5 bg-zinc-300 ml-0.5 align-middle animate-pulse" />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff tab
// ---------------------------------------------------------------------------

function DiffTab({ issue }: { issue: Issue }) {
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fetched = useRef(false);

  useEffect(() => {
    if (!issue.worktree_path || fetched.current) return;
    fetched.current = true;
    setLoading(true);
    fetch(`/api/issues/${issue.id}/diff`)
      .then((r) => r.text())
      .then((text) => setDiff(text))
      .finally(() => setLoading(false));
  }, [issue.id, issue.worktree_path]);

  if (!issue.worktree_path) {
    return <div className="text-sm text-zinc-400">No changes yet.</div>;
  }

  if (loading) {
    return <div className="text-xs text-zinc-400">Loading diff…</div>;
  }

  if (!diff) {
    return <div className="text-xs text-zinc-400">No diff available.</div>;
  }

  return (
    <div className="rounded-lg border border-zinc-100 overflow-hidden">
      {diff.split("\n").map((line, i) => {
        let cls = "text-zinc-500";
        if (line.startsWith("+") && !line.startsWith("+++")) cls = "bg-emerald-50 text-emerald-800";
        else if (line.startsWith("-") && !line.startsWith("---")) cls = "bg-red-50 text-red-800";
        else if (line.startsWith("@@")) cls = "bg-zinc-50 text-blue-600 py-1 border-y border-zinc-100";
        return (
          <div key={i} className={`font-mono text-xs leading-5 px-4 ${cls}`}>
            {line || "\u00A0"}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main detail component
// ---------------------------------------------------------------------------

interface Props {
  issue: Issue | null;
  logs: LogEntry[];
}

export function IssueDetail({ issue, logs }: Props) {
  if (!issue) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-zinc-400">
        Select an issue
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
        <TabsList variant="line" className="px-6 border-b border-zinc-100 gap-2">
          <TabsTrigger value="overview" className="text-sm">Overview</TabsTrigger>
          <TabsTrigger value="live" className="text-sm">Live</TabsTrigger>
          {issue.status !== "done" && (
            <TabsTrigger
              value="diff"
              disabled={!issue.worktree_path}
              className={`text-sm ${!issue.worktree_path ? "text-zinc-300" : ""}`}
            >
              Diff
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="overview" className="flex-1 overflow-y-auto p-6">
          <OverviewTab issue={issue} />
        </TabsContent>

        <TabsContent value="live" className="flex-1 overflow-y-auto p-6">
          <LiveTab issue={issue} logs={logs} />
        </TabsContent>

        <TabsContent value="diff" className="flex-1 overflow-y-auto p-6">
          <DiffTab issue={issue} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
