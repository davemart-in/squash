import { v4 as uuidv4 } from "uuid";
import { getDb } from "./schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Repo {
  id: string;
  name: string;
  local_path: string;
  github_owner: string | null;
  github_repo: string | null;
  linear_team_key: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createRepo(
  data: Omit<Repo, "id" | "created_at">,
): Repo {
  const db = getDb();
  const id = uuidv4();

  db.prepare(
    `INSERT INTO repos (id, name, local_path, github_owner, github_repo, linear_team_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.name,
    data.local_path,
    data.github_owner ?? null,
    data.github_repo ?? null,
    data.linear_team_key ?? null,
  );

  return getRepo(id)!;
}

export function getRepo(id: string): Repo | null {
  const db = getDb();
  return (db.prepare("SELECT * FROM repos WHERE id = ?").get(id) as Repo) ?? null;
}

export function listRepos(): Repo[] {
  const db = getDb();
  return db.prepare("SELECT * FROM repos ORDER BY created_at DESC").all() as Repo[];
}

export function findRepoByGitHub(owner: string, repo: string): Repo | null {
  const db = getDb();
  return (
    db
      .prepare("SELECT * FROM repos WHERE github_owner = ? AND github_repo = ?")
      .get(owner, repo) as Repo
  ) ?? null;
}

export function findRepoByLinearTeam(teamKey: string): Repo | null {
  const db = getDb();
  return (
    db
      .prepare("SELECT * FROM repos WHERE linear_team_key = ?")
      .get(teamKey) as Repo
  ) ?? null;
}

export function deleteRepo(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM repos WHERE id = ?").run(id);
}
