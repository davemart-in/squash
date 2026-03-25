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

/** Run a query() call, stream assistant text blocks to the log, return the result text. */
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
    if (message.type === "assistant") {
      for (const block of (message as any).message.content) {
        if (block.type === "text" && block.text) {
          appendLog(issueId, step, "cmd", block.text);
        }
      }
    }

    if (message.type === "result") {
      const result = message as any;
      if (result.subtype === "success") {
        resultText = result.result ?? "";
      } else {
        const errors = (result.errors ?? []).join("; ");
        throw new Error(`Agent failed (${result.subtype}): ${errors}`);
      }
    }
  }

  return resultText;
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
      permissionMode: "acceptEdits",
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
      `Run this exact shell command and return the output:`,
      ``,
      "```",
      `gh pr create --draft --title '${prTitle.replace(/'/g, `'\\''`)}' --body '${prBody.replace(/'/g, `'\\''`)}'`,
      "```",
      ``,
      `Return only the PR URL from the output.`,
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
      `1. Review the diff for code complexity, consistency, and security issues.`,
      `2. Fix anything you find.`,
      `3. If you made changes, amend the commit and force-push.`,
      `4. Summarize what you reviewed and any changes you made.`,
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
