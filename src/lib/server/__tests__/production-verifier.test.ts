import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("production deployment verifier", () => {
  it("executes on the supported runtime and rejects a non-canonical target safely", () => {
    const cronSecret = "c".repeat(32);
    const result = spawnSync(
      process.execPath,
      [require.resolve("tsx/cli"), resolve("scripts/verify-production.ts")],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          PRODUCTION_APP_URL: " https://signal.example",
          CRON_SECRET: cronSecret,
          EXPECTED_WEB_RELEASE: "a".repeat(40),
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe(
      JSON.stringify({
        status: "not_ready",
        service: "signal-enhancer-web",
        code: "invalid_production_app_origin",
      }),
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain(cronSecret);
  });
});
