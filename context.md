# squash — project context

## What this is

Squash is a local tool that autonomously fixes bugs. You paste a GitHub or
Linear issue URL, and an AI agent takes it from there — reading the issue,
assessing whether it can handle it, making the fix, and opening a draft PR for
your review. Multiple issues can run at the same time without interfering with
each other.

---

## The problem it solves

Small bugs and well-scoped issues pile up in every codebase. They're not
complex enough to prioritize, but there are too many to ignore. Squash works
through that backlog autonomously, handling the mechanical work of branching,
fixing, committing, and opening PRs — so you only get involved when a fix is
ready for your eyes.

---

## How it works

When you queue an issue, Squash works through a linear sequence of steps:

1. **Fetch** — pulls the full issue description, labels, and metadata
2. **Assess** — decides whether the issue is suitable for an agent to fix, or
   too complex and better left to a human
3. **Branch** — creates an isolated working environment so it can't affect
   anything else
4. **Plan and fix** — reads the relevant code, forms a plan, and makes the
   changes
5. **Open a draft PR** — commits the fix and creates a pull request in draft
   state
6. **Review** — looks at its own diff and checks for code quality, consistency,
   and security issues
7. **Finalize** — corrects anything it flagged in the review, then signals that
   the PR is ready for you

At each step the UI shows you what the agent is doing in real time. When it
needs your attention — either because something went wrong or because a PR is
ready — the issue row is flagged so you know where to look.

---

## Guardrails to keep in mind

**It will skip complex issues.** The assessor scores each issue from 1-10 and
skips anything that looks too broad, too architectural, or too risky for an
agent to handle safely. You can review skipped issues to calibrate whether the
threshold feels right.

**It works on one repo at a time.** The current version is scoped to a single
codebase. Each agent gets its own isolated branch and working directory, so
parallel runs are safe — but they're all operating against the same repo.

**PRs always start as drafts.** The agent never opens a ready-for-review PR on
its own. You decide when to promote it.

**It can't clean up after itself yet.** If an agent errors out mid-run, the
branch and working directory it created will still be there. You'll need to
remove those manually.

**There's no skip override in v1.** If the assessor rejects an issue, there's
no "run it anyway" button yet. That's a planned addition.