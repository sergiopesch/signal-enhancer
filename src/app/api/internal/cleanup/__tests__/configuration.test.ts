import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("cleanup deployment schedule", () => {
  it("runs every five minutes so cleanup can drain a bounded backlog", () => {
    const configuration = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons?: Array<{ path?: string; schedule?: string }> };

    expect(configuration.crons).toContainEqual({
      path: "/api/internal/cleanup",
      schedule: "*/5 * * * *",
    });
  });
});
