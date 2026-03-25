import "dotenv/config";
import { getDb } from "./db/schema.js";
import { startServer } from "./api/server.js";

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

const ENV_VARS = [
  { key: "ANTHROPIC_API_KEY", required: true },
  { key: "GITHUB_TOKEN", required: false },
  { key: "LINEAR_API_KEY", required: false },
  { key: "PORT", required: false },
  { key: "REPO_PATH", required: false },
  { key: "DB_PATH", required: false },
] as const;

console.log("squash: starting up…");
console.log("");

for (const { key, required } of ENV_VARS) {
  const set = !!process.env[key];
  const label = set ? "✓" : required ? "✗" : "–";
  console.log(`  ${label}  ${key}${set ? "" : required ? " (missing — required)" : " (not set)"}`);
}

console.log("");

// Initialize database
getDb();
console.log("squash: database ready");

// Start HTTP + WebSocket server
startServer();
