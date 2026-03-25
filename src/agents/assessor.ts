import Anthropic from "@anthropic-ai/sdk";
import { getIssue, updateIssue, appendLog } from "../db/issues.js";
import { NotFoundError } from "../db/errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssessmentResult {
  should_attempt: boolean;
  complexity_score: number;
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const ASSESSMENT_SYSTEM_PROMPT = `You are a complexity rater for an autonomous bug-fixing agent called Squash. Your job is to assess whether a given issue is suitable for the agent to fix on its own.

The agent works well for:
- Well-scoped bug fixes with clear reproduction steps
- Small, contained changes (typos, off-by-one errors, missing null checks)
- Simple feature additions with clear requirements
- Test fixes and minor refactors

The agent struggles with:
- Architectural changes or large refactors
- Issues requiring deep domain knowledge or external system access
- Vague or underspecified issues with no clear acceptance criteria
- Security-sensitive changes that need careful human review
- Performance optimizations requiring profiling
- Issues that span many files or modules

Rate the issue on a scale of 1-10:
- 1-3: Simple, well-scoped — the agent should handle this
- 4-6: Moderate — the agent can likely handle it but may need review
- 7-10: Complex — better left to a human

Respond with JSON only, no other text:
{ "should_attempt": boolean, "complexity_score": number, "reasoning": string }

Set should_attempt to false if complexity_score is 7 or higher.`;

// ---------------------------------------------------------------------------
// Shared assessment logic (no DB dependency)
// ---------------------------------------------------------------------------

export async function assessRaw(
  title: string,
  body: string | null,
  labels: string[],
): Promise<AssessmentResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const client = new Anthropic({ apiKey });

  const userMessage = [
    `**Issue title:** ${title || "(no title)"}`,
    "",
    `**Issue body:**`,
    body ?? "(no body)",
    "",
    labels.length ? `**Labels:** ${labels.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: ASSESSMENT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const jsonStr = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
  return JSON.parse(jsonStr) as AssessmentResult;
}

// ---------------------------------------------------------------------------
// DB-backed assessment (used by the main pipeline)
// ---------------------------------------------------------------------------

export async function assessIssue(issueId: string): Promise<AssessmentResult> {
  const issue = getIssue(issueId);
  if (!issue) throw new NotFoundError("Issue", issueId);

  const result = await assessRaw(
    issue.title ?? "(no title)",
    issue.body,
    issue.labels,
  );

  updateIssue(issueId, { complexity_score: result.complexity_score });

  if (!result.should_attempt) {
    updateIssue(issueId, {
      status: "skipped",
      skip_reason: result.reasoning,
    });
    appendLog(issueId, 2, "warn", `Skipped (score ${result.complexity_score}): ${result.reasoning}`);
  } else {
    appendLog(issueId, 2, "ok", `Assessment passed (score ${result.complexity_score}): ${result.reasoning}`);
  }

  return result;
}
