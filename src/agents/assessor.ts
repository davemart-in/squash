import Anthropic from "@anthropic-ai/sdk";
import { getIssue, updateIssue, appendLog } from "../db/issues.js";
import { NotFoundError } from "../db/errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AssessmentResult {
  should_attempt: boolean;
  complexity_score: number;
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a complexity rater for an autonomous bug-fixing agent called Squash. Your job is to assess whether a given issue is suitable for the agent to fix on its own.

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
// Public API
// ---------------------------------------------------------------------------

export async function assessIssue(issueId: string): Promise<AssessmentResult> {
  const issue = getIssue(issueId);
  if (!issue) throw new NotFoundError("Issue", issueId);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const client = new Anthropic({ apiKey });

  const userMessage = [
    `**Issue title:** ${issue.title ?? "(no title)"}`,
    "",
    `**Issue body:**`,
    issue.body ?? "(no body)",
    "",
    issue.labels.length ? `**Labels:** ${issue.labels.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  // Strip markdown code fences if the model wraps the JSON
  const jsonStr = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
  let result: AssessmentResult;
  try {
    result = JSON.parse(jsonStr) as AssessmentResult;
  } catch {
    throw new Error(`Assessor returned non-JSON response: ${text.slice(0, 200)}`);
  }

  // Persist to DB
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
