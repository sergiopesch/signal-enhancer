import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { requireLiveEnvironment } from "./env";
import * as schema from "./schema";

let database: ReturnType<typeof createDatabase> | undefined;

function createDatabase() {
  const environment = requireLiveEnvironment();
  return drizzle(neon(environment.DATABASE_URL), { schema });
}

export function getDatabase() {
  database ??= createDatabase();
  return database;
}
