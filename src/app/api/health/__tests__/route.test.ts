import { afterEach, describe, expect, it, vi } from "vitest";

const environmentMocks = vi.hoisted(() => ({
  getEnvironment: vi.fn(),
  requireLiveEnvironment: vi.fn(),
}));

vi.mock("@/lib/server/env", () => environmentMocks);

import { GET } from "../route";

describe("public health route", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports the safe demo liveness contract", async () => {
    environmentMocks.getEnvironment.mockReturnValue({ SIGNAL_MODE: "demo" });

    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      mode: "demo",
      integrations: { database: false, privateBlob: false, worker: false },
    });
    expect(environmentMocks.requireLiveEnvironment).not.toHaveBeenCalled();
  });

  it("fails closed when live configuration is invalid", async () => {
    const secret = "configuration-secret-must-not-escape";
    environmentMocks.getEnvironment.mockReturnValue({ SIGNAL_MODE: "live" });
    environmentMocks.requireLiveEnvironment.mockImplementation(() => {
      throw new Error(`invalid ${secret}`);
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).not.toContain(secret);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
  });
});
