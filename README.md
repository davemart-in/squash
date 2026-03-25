# Squash

Squash is a local tool that autonomously fixes bugs. Paste a GitHub or Linear issue URL, and an AI agent takes it from there — reading the issue, assessing whether it can handle it, making the fix, and opening a draft PR for your review. Multiple issues run in parallel without interfering with each other.

## Prerequisites

- **Node 20+**
- **Claude Code CLI** installed and authenticated (`claude` command available)
- **GitHub CLI** installed and authenticated (`gh auth status` should pass)

## Setup

```bash
git clone https://github.com/davemart-in/squash.git
cd squash
npm install
cd src/ui && npm install && cd ../..
cp .env.example .env
```

Fill in your `.env` values:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | API key for the assessor agent |
| `GITHUB_TOKEN` | For GitHub issues | Personal access token with repo scope |
| `LINEAR_API_KEY` | For Linear issues | Linear API key |
| `REPO_PATH` | Recommended | Absolute path to the repo being fixed |
| `PORT` | No | API server port (default: 3001) |
| `DB_PATH` | No | SQLite database path (default: squash.db) |
| `MAX_CONCURRENT_AGENTS` | No | Max parallel agents (default: 10) |

## Running

### Development

```bash
npm run dev
```

This starts both the API server (with hot reload) and the Vite dev server concurrently. The UI is available at `http://localhost:5173` and proxies API requests to port 3001.

### Production

```bash
npm run build
npm start
```

The `build` command compiles the React frontend into `src/api/public/`. The `start` command runs the server, which serves both the API and the static frontend on a single port.

### Reset the database

```bash
npm run db:reset
```

This deletes `squash.db` and re-creates the schema.

## How worktrees work

Each agent runs in an isolated [git worktree](https://git-scm.com/docs/git-worktree) under `./worktrees/{issueId}` on a branch named `fix/{issueId}`. This means agents can work in parallel without interfering with each other or your main working directory.

If an agent errors out mid-run, the worktree and branch will still exist. Clean them up manually:

```bash
# List active worktrees
git worktree list

# Remove a specific worktree
git worktree remove ./worktrees/{issueId}

# Delete the branch
git branch -D fix/{issueId}

# Or remove all worktrees at once
rm -rf ./worktrees
git worktree prune
```

## Known limitations

- **Single repo per instance.** Squash operates on one codebase at a time. All agents share the same repository.
- **No skip override.** If the assessor rejects an issue (complexity score 7+), there's no way to force it through yet.
- **No automatic cleanup.** Failed runs leave behind worktrees and branches that need manual removal.
- **Draft PRs only.** The agent never opens a ready-for-review PR — you decide when to promote it.
