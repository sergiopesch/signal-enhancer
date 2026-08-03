import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("DATABASE_URL is required to run migrations.");

const migrationsUrl = new URL("../migrations/", import.meta.url);
const migrationNames = (await readdir(migrationsUrl))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

if (migrationNames.length === 0) {
  throw new Error("No versioned SQL migrations were found.");
}

const sql = neon(databaseUrl);
await sql.query(`
  CREATE TABLE IF NOT EXISTS "schema_migrations" (
    "name" text PRIMARY KEY,
    "checksum" text NOT NULL,
    "applied_at" timestamp with time zone DEFAULT now() NOT NULL
  )
`);

let statementCount = 0;
let migrationCount = 0;

for (const migrationName of migrationNames) {
  const source = await readFile(new URL(migrationName, migrationsUrl), "utf8");
  const checksum = createHash("sha256").update(source).digest("hex");
  const appliedRows = await sql.query(
    `SELECT "checksum" FROM "schema_migrations" WHERE "name" = $1`,
    [migrationName],
  );
  const appliedChecksum = appliedRows[0]?.checksum;
  if (appliedChecksum !== undefined) {
    if (appliedChecksum !== checksum) {
      throw new Error(
        `Applied migration ${migrationName} no longer matches its recorded checksum.`,
      );
    }
    continue;
  }

  const statements = source
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  await sql.transaction((transaction) => [
    ...statements.map((statement) => transaction.query(statement)),
    transaction.query(
      `INSERT INTO "schema_migrations" ("name", "checksum") VALUES ($1, $2)`,
      [migrationName, checksum],
    ),
  ]);
  statementCount += statements.length;
  migrationCount += 1;
}

console.log(
  `Applied ${statementCount} statements from ${migrationCount} migrations; ${migrationNames.length - migrationCount} already current.`,
);
