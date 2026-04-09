# Squash

Squash is a local tool that autonomously fixes bugs. Paste a GitHub or Linear issue URL, and an AI agent takes it from there — reading the issue, assessing whether it can handle it, making the fix, and opening a draft PR for your review. Multiple issues run in parallel without interfering with each other.

<img width="2394" height="1420" alt="image" src="https://github.com/user-attachments/assets/adf19021-bf64-4188-b9af-6afc9cc94029" />

## Prerequisites

- **Node 20+**
- **Claude Code CLI** installed and authenticated (`claude` command available)
- **GitHub CLI** installed and authenticated (`gh auth status` should pass)

## Quick setup with Claude Code

If you have [Claude Code](https://claude.ai/claude-code) installed, paste this prompt to have it set everything up for you:

> Clone https://github.com/davemart-in/squash.git, install dependencies (including inside src/ui), then walk me through creating the .env file. I'll need help getting my ANTHROPIC_API_KEY, GITHUB_TOKEN, and LINEAR_API_KEY. Once .env is ready, start the dev server.

Claude Code will clone the repo, run the installs, ask you for each API key one at a time, create the `.env` file, and start Squash. No terminal knowledge required.

## Manual setup

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
| `REPO_PATH` | No | Default repo path (can also be set per-repo in the UI) |
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

- **No skip override.** If the assessor rejects an issue (complexity score 7+), there's no way to force it through yet.
- **Draft PRs only.** The agent never opens a ready-for-review PR — you decide when to promote it.
