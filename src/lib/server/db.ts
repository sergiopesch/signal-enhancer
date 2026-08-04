import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";

import { requireCleanupEnvironment, requireLiveEnvironment } from "./env";
import { REQUIRED_MIGRATIONS } from "./migration-manifest";
import * as schema from "./schema";

let liveDatabase: ReturnType<typeof createDatabase> | undefined;
let cleanupDatabase: ReturnType<typeof createDatabase> | undefined;

function createDatabase(databaseUrl: string) {
  return drizzle(neon(databaseUrl), { schema });
}

export function getDatabase() {
  const environment = requireLiveEnvironment();
  liveDatabase ??= createDatabase(environment.DATABASE_URL);
  return liveDatabase;
}

export function getCleanupDatabase() {
  const environment = requireCleanupEnvironment();
  cleanupDatabase ??= createDatabase(environment.DATABASE_URL);
  return cleanupDatabase;
}

export async function assertDatabaseReady() {
  const result = await getDatabase().execute<{
    migrationName: string;
    checksum: string;
    tablesReady: boolean;
    protocolReady: boolean;
  }>(sql`
    SELECT
      "name" AS "migrationName",
      "checksum",
      to_regclass('public.experiment_sessions') IS NOT NULL
        AND to_regclass('public.captures') IS NOT NULL
        AND to_regclass('public.capture_upload_grants') IS NOT NULL
        AND to_regclass('public.upgrade_jobs') IS NOT NULL
        AND to_regclass('public.job_events') IS NOT NULL
        AND to_regclass('public.usage_ledger') IS NOT NULL
        AS "tablesReady",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'experiment_sessions'
          AND column_name = 'reference_revision'
          AND is_nullable = 'NO'
      ) AS "protocolReady"
    FROM "schema_migrations"
  `);
  const applied = new Map(
    result.rows.map((row) => [row.migrationName, row.checksum]),
  );
  const schemaReady = result.rows.every(
    (row) => row.tablesReady === true && row.protocolReady === true,
  );
  const migrationsReady = REQUIRED_MIGRATIONS.every(
    (migration) => applied.get(migration.name) === migration.checksum,
  );
  if (
    result.rows.length !== REQUIRED_MIGRATIONS.length ||
    !schemaReady ||
    !migrationsReady
  ) {
    throw new Error("Database migrations are not current.");
  }
}
