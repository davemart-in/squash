import "dotenv/config";
import { getDb } from "./db/schema.js";

const db = getDb();
console.log("squash: db ready");
