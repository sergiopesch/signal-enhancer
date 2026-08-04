import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { REQUIRED_MIGRATIONS } from "../migration-manifest";

describe("migration release manifest", () => {
  it("exactly pins every checked-in migration checksum", () => {
    const migrationDirectory = resolve(process.cwd(), "migrations");
    const migrationNames = readdirSync(migrationDirectory)
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();

    expect(migrationNames).toEqual(
      REQUIRED_MIGRATIONS.map((migration) => migration.name),
    );
    for (const migration of REQUIRED_MIGRATIONS) {
      const checksum = createHash("sha256")
        .update(readFileSync(resolve(migrationDirectory, migration.name)))
        .digest("hex");
      expect(checksum).toBe(migration.checksum);
    }
  });
});
