import { execSync } from "child_process";
import path from "path";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { getIssue, updateIssue, appendLog } from "../db/issues.js";
import { NotFoundError } from "../db/errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stepLog(issueId: string, step: number, message: string): void {
  appendLog(issueId, step, "cmd", message);
}

function advanceStep(issueId: string, step: number): void {
  updateIssue(issueId, { current_step: step as any });
}

/** Run a query() call, stream all activity to the log, return the result text. */
async function runAgent(
  issueId: string,
  step: number,
  prompt: string,
  opts: Partial<Options>,
): Promise<string> {
  const q = query({
    prompt,
    options: opts as Options,
  });

  let resultText = "";

  for await (const message of q) {
    const msg = message as any;

    switch (message.type) {
      case "assistant": {
        for (const block of msg.message?.content ?? []) {
          if (block.type === "text" && block.text) {
            appendLog(issueId, step, "cmd", block.text);
          }
          if (block.type === "tool_use") {
            const inputSummary = summarizeToolInput(block.name, block.input);
            appendLog(issueId, step, "dim", `→ ${block.name}${inputSummary}`);
          }
        }
        break;
      }

      case "tool_use_summary": {
        const name = msg.tool_name ?? "tool";
        const result = msg.result ?? "";
        if (result) {
          const truncated = result.length > 200 ? result.slice(0, 200) + "…" : result;
          appendLog(issueId, step, "dim", `← ${name}: ${truncated}`);
        }
        break;
      }

      case "tool_progress": {
        const name = msg.tool_name ?? "tool";
        appendLog(issueId, step, "dim", `⋯ ${name} (${Math.round(msg.elapsed_time_seconds ?? 0)}s)`);
        break;
      }

      case "system": {
        const text = msg.message ?? msg.content ?? "";
        if (text) appendLog(issueId, step, "dim", text);
        break;
      }

      case "result": {
        if (msg.subtype === "success") {
          resultText = msg.result ?? "";
          appendLog(issueId, step, "ok", `Done (${msg.num_turns} turns, $${(msg.total_cost_usd ?? 0).toFixed(3)})`);
        } else {
          const errors = (msg.errors ?? []).join("; ");
          throw new Error(`Agent failed (${msg.subtype}): ${errors}`);
        }
        break;
      }
    }
  }

  return resultText;
}

/** Summarize tool input for logging. */
function summarizeToolInput(tool: string, input: any): string {
  if (!input) return "";
  switch (tool) {
    case "Read":
      return ` ${input.file_path ?? ""}`;
    case "Write":
      return ` ${input.file_path ?? ""}`;
    case "Edit":
      return ` ${input.file_path ?? ""}`;
    case "Bash":
      return ` ${(input.command ?? "").slice(0, 120)}`;
    case "Grep":
      return ` "${input.pattern ?? ""}"${input.path ? ` in ${input.path}` : ""}`;
    case "Glob":
      return ` ${input.pattern ?? ""}`;
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runAgentForIssue(issueId: string): Promise<void> {
  const issue = getIssue(issueId);
  if (!issue) throw new NotFoundError("Issue", issueId);

  try {
    // ------------------------------------------------------------------
    // Step 3 — Branch + worktree
    // ------------------------------------------------------------------
    advanceStep(issueId, 3);
    stepLog(issueId, 3, "Creating branch and worktree…");

    const worktreePath = path.resolve(`./worktrees/${issueId}`);
    const branch = `fix/${issueId}`;

    execSync(`git worktree add ${worktreePath} -b ${branch}`, {
      stdio: "pipe",
    });

    updateIssue(issueId, { branch, worktree_path: worktreePath });
    appendLog(issueId, 3, "ok", `Created worktree at ${worktreePath} on branch ${branch}`);

    // ------------------------------------------------------------------
    // Steps 4-5 — Plan and fix
    // ------------------------------------------------------------------
    advanceStep(issueId, 4);
    stepLog(issueId, 4, "Planning and implementing fix…");

    const agentOpts: Partial<Options> = {
      cwd: worktreePath,
      allowedTools: ["Read", "Edit", "Write", "Bash"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 30,
      maxBudgetUsd: 3.0,
    };

    const fixPrompt = [
      `You are fixing a bug in this codebase.`,
      ``,
      `**Issue title:** ${issue.title}`,
      ``,
      `**Issue body:**`,
      issue.body ?? "(no body)",
      ...(issue.context ? [``, `**Additional context:**`, issue.context] : []),
      ``,
      `Instructions:`,
      `1. Browse the codebase to understand the relevant code.`,
      `2. Form a plan for the fix.`,
      `3. Implement the fix.`,
      `4. Commit your changes with a descriptive commit message.`,
      ``,
      `IMPORTANT: Stop after committing. Do NOT verify, review, diff, push, or amend.`,
      `A separate review step will handle that.`,
    ].join("\n");

    await runAgent(issueId, 4, fixPrompt, agentOpts);

    advanceStep(issueId, 5);
    appendLog(issueId, 5, "ok", "Fix implemented and committed");

    // ------------------------------------------------------------------
    // Step 6 — Create draft PR
    // ------------------------------------------------------------------
    advanceStep(issueId, 6);
    stepLog(issueId, 6, "Creating draft PR…");

    const prTitle = `fix: ${issue.title ?? issueId}`;
    const prBody = `Fixes ${issue.ref}`;

    const prPrompt = [
      `Run these shell commands in order:`,
      ``,
      `1. git push -u origin ${branch}`,
      `2. gh pr create --draft --title "${prTitle.replace(/"/g, '\\"')}" --body "${prBody.replace(/"/g, '\\"')}"`,
      ``,
      `Return only the PR URL from the output. Do nothing else.`,
    ].join("\n");

    const prOutput = await runAgent(issueId, 6, prPrompt, {
      ...agentOpts,
      maxTurns: 5,
      maxBudgetUsd: 0.5,
    });

    // Parse PR URL from agent output
    const prUrlMatch = prOutput.match(
      /https:\/\/github\.com\/[^\s)]+\/pull\/\d+/,
    );
    const prUrl = prUrlMatch?.[0] ?? null;
    const prNumber = prUrl?.match(/\/pull\/(\d+)/)?.[1] ?? null;

    updateIssue(issueId, {
      pr_url: prUrl,
      pr_number: prNumber,
      status: "running",
    });
    advanceStep(issueId, 7);
    appendLog(issueId, 6, "ok", `Draft PR created: ${prUrl ?? "(URL not parsed)"}`);

    // ------------------------------------------------------------------
    // Steps 7-8 — Review and fix
    // ------------------------------------------------------------------
    stepLog(issueId, 7, "Reviewing diff…");

    const reviewPrompt = [
      `You are reviewing a pull request you just created.`,
      prUrl ? `PR: ${prUrl}` : "",
      ``,
      `Instructions:`,
      `1. Run "git diff HEAD~1" to review your changes.`,
      `2. Check for code complexity, consistency, and security issues.`,
      `3. If you find problems, fix them, amend the commit, and force-push.`,
      `4. If everything looks good, do nothing.`,
      `5. Summarize what you reviewed and any changes you made.`,
      ``,
      `Be concise. Do not re-read the entire codebase.`,
    ]
      .filter(Boolean)
      .join("\n");

    await runAgent(issueId, 7, reviewPrompt, {
      ...agentOpts,
      maxTurns: 20,
      maxBudgetUsd: 2.0,
    });

    advanceStep(issueId, 8);
    updateIssue(issueId, { status: "needs-review" });
    appendLog(issueId, 8, "ok", "Review complete — PR is ready for human review");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateIssue(issueId, { status: "error", error_message: message });
    appendLog(issueId, 0, "err", message);
    throw err;
  }
}
