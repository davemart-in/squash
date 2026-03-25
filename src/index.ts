import "dotenv/config";
import { getDb } from "./db/schema.js";

// Initialize DB
getDb();

// Start API server (registers WebSocket broadcast hook on import)
import "./api/server.js";
