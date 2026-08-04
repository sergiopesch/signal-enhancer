import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("cleanup deployment schedule", () => {
  it("uses the bounded low-volume Hobby retention profile", () => {
    const configuration = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as {
      fluid?: boolean;
      crons?: Array<{ path?: string; schedule?: string }>;
    };

    expect(configuration.fluid).toBe(true);
    expect(configuration.crons).toContainEqual({
      path: "/api/internal/cleanup",
      schedule: "17 3 * * *",
    });
  });
});
