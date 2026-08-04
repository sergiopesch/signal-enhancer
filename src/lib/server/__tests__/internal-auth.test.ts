import { describe, expect, it } from "vitest";

import { SignalError } from "../errors";
import { requireInternalBearerAuthorization } from "../internal-auth";

const SECRET = "a".repeat(32);

function request(authorization?: string) {
  return new Request("https://signal-enhancer.example/api/internal/check", {
    ...(authorization ? { headers: { authorization } } : {}),
  });
}

describe("internal bearer authorization", () => {
  it("accepts only the exact bearer credential", () => {
    expect(() =>
      requireInternalBearerAuthorization(request(`Bearer ${SECRET}`), SECRET),
    ).not.toThrow();

    for (const authorization of [
      undefined,
      SECRET,
      `bearer ${SECRET}`,
      `Bearer ${SECRET}x`,
      `Bearer ${"b".repeat(32)}`,
    ]) {
      expect(() =>
        requireInternalBearerAuthorization(request(authorization), SECRET),
      ).toThrow(SignalError);
    }
  });
});
