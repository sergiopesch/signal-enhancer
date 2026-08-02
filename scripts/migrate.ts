import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("DATABASE_URL is required to run migrations.");

const migrationUrl = new URL(
  "../migrations/0000_signal_foundation.sql",
  import.meta.url,
);
const source = await readFile(fileURLToPath(migrationUrl), "utf8");
const statements = source
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);
const sql = neon(databaseUrl);

for (const statement of statements) {
  await sql.query(statement);
}

console.log(`Applied ${statements.length} idempotent migration statements.`);
