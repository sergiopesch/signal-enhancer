import { afterEach, describe, expect, it, vi } from "vitest";

import { safeErrorResponse } from "../errors";

describe("safe server errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never writes an unexpected error message to logs or the response", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const secret = "hf_secret_that_must_not_escape";

    const response = safeErrorResponse(
      new Error(`upstream rejected ${secret}`),
    );

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(secret);
    expect(consoleError).toHaveBeenCalledOnce();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
  });
});
