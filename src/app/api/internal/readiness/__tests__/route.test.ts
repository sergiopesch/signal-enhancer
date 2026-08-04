import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const blobMocks = vi.hoisted(() => ({ assertPrivateBlobReady: vi.fn() }));
const databaseMocks = vi.hoisted(() => ({ assertDatabaseReady: vi.fn() }));
const environmentMocks = vi.hoisted(() => ({
  requireLiveEnvironment: vi.fn(),
}));
const workerMocks = vi.hoisted(() => ({ probeProductionWorker: vi.fn() }));

vi.mock("@/lib/server/blob", () => blobMocks);
vi.mock("@/lib/server/db", () => databaseMocks);
vi.mock("@/lib/server/env", () => environmentMocks);
vi.mock("@/lib/server/worker", () => workerMocks);

import { GET } from "../route";

const CRON_SECRET = "c".repeat(32);

function request(secret?: string) {
  return new Request("https://signal.example/api/internal/readiness", {
    ...(secret ? { headers: { authorization: `Bearer ${secret}` } } : {}),
  });
}

describe("protected production readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    environmentMocks.requireLiveEnvironment.mockReturnValue({
      CRON_SECRET,
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
    });
    databaseMocks.assertDatabaseReady.mockResolvedValue(undefined);
    blobMocks.assertPrivateBlobReady.mockResolvedValue(undefined);
    workerMocks.probeProductionWorker.mockResolvedValue({});
  });

  afterEach(() => vi.restoreAllMocks());

  it("authenticates before touching any live integration", async () => {
    const response = await GET(request("wrong-secret"));

    expect(response.status).toBe(401);
    expect(databaseMocks.assertDatabaseReady).not.toHaveBeenCalled();
    expect(blobMocks.assertPrivateBlobReady).not.toHaveBeenCalled();
    expect(workerMocks.probeProductionWorker).not.toHaveBeenCalled();
  });

  it("confirms all three live dependency boundaries", async () => {
    const response = await GET(request(CRON_SECRET));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      checks: {
        database: "ready",
        privateBlob: "ready",
        worker: "ready",
      },
    });
  });

  it("returns only component status when a dependency error contains a secret", async () => {
    const secret = "signed-url-that-must-not-escape";
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    workerMocks.probeProductionWorker.mockRejectedValue(
      new Error(`worker rejected ${secret}`),
    );

    const response = await GET(request(CRON_SECRET));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).not.toContain(secret);
    expect(body).toContain('"worker":"failed"');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
  });
});
