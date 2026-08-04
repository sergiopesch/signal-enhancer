import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const blobMocks = vi.hoisted(() => ({ createPrivateDeleteUrl: vi.fn() }));
const environmentMocks = vi.hoisted(() => ({
  getEnvironment: vi.fn(),
  requireCleanupEnvironment: vi.fn(),
}));
const repositoryMocks = vi.hoisted(() => ({
  deleteExpiredSessionRecords: vi.fn(),
  listExpiredSessionsForCleanup: vi.fn(),
  pruneUsageLedger: vi.fn(),
}));

vi.mock("@/lib/server/blob", () => blobMocks);
vi.mock("@/lib/server/env", () => environmentMocks);
vi.mock("@/lib/server/repository", () => repositoryMocks);

import { GET } from "../route";

const CRON_SECRET = "c".repeat(32);

function request(secret = CRON_SECRET) {
  return new Request("https://signal.example/api/internal/cleanup", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe("private artifact cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    environmentMocks.getEnvironment.mockReturnValue({
      SIGNAL_MODE: "live",
      DATABASE_URL: "postgresql://signal.example/database",
      BLOB_STORE_ID: "private-store-id",
      CRON_SECRET,
    });
    environmentMocks.requireCleanupEnvironment.mockReturnValue({
      CRON_SECRET,
    });
    repositoryMocks.listExpiredSessionsForCleanup.mockResolvedValue({
      sessions: [
        {
          sessionId: "session-1",
          pathnames: ["sessions/session-1/captures/A-1.wav"],
        },
      ],
      hasMore: false,
      oldestExpiredAt: "2026-08-03T00:00:00.000Z",
    });
    blobMocks.createPrivateDeleteUrl.mockResolvedValue({
      url: "https://blob.example/delete",
    });
    repositoryMocks.deleteExpiredSessionRecords.mockResolvedValue(1);
    repositoryMocks.pruneUsageLedger.mockResolvedValue(2);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("authenticates before enumerating private data", async () => {
    const response = await GET(request("wrong-secret"));

    expect(response.status).toBe(401);
    expect(
      repositoryMocks.listExpiredSessionsForCleanup,
    ).not.toHaveBeenCalled();
  });

  it("deletes tracked objects before cascading their discovery records", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(
      blobMocks.createPrivateDeleteUrl.mock.invocationCallOrder[0],
    ).toBeLessThan(
      repositoryMocks.deleteExpiredSessionRecords.mock.invocationCallOrder[0] ??
        Infinity,
    );
    await expect(response.json()).resolves.toEqual({
      deletedArtifacts: 1,
      deletedSessions: 1,
      deletedLedgerRows: 2,
      failedSessions: 0,
      backlogRemaining: false,
      oldestExpiredAt: "2026-08-03T00:00:00.000Z",
    });
  });

  it("bounds object deletion concurrency", async () => {
    let activeDeletes = 0;
    let maximumActiveDeletes = 0;
    let releaseDeletes: (() => void) | undefined;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDeletes = resolve;
    });
    const pathnames = Array.from(
      { length: 11 },
      (_, index) => `sessions/session-1/artifact-${index}.wav`,
    );
    repositoryMocks.listExpiredSessionsForCleanup.mockResolvedValue({
      sessions: [{ sessionId: "session-1", pathnames }],
      hasMore: true,
      oldestExpiredAt: "2026-08-02T00:00:00.000Z",
    });
    vi.mocked(fetch).mockImplementation(async () => {
      activeDeletes += 1;
      maximumActiveDeletes = Math.max(maximumActiveDeletes, activeDeletes);
      await deleteGate;
      activeDeletes -= 1;
      return new Response(null, { status: 204 });
    });

    const cleanup = GET(request());
    await vi.waitFor(() => expect(activeDeletes).toBe(10));
    expect(maximumActiveDeletes).toBe(10);
    releaseDeletes?.();

    const response = await cleanup;
    expect(response.status).toBe(200);
    expect(maximumActiveDeletes).toBe(10);
    await expect(response.json()).resolves.toMatchObject({
      backlogRemaining: true,
      oldestExpiredAt: "2026-08-02T00:00:00.000Z",
    });
  });

  it("continues authenticated retention cleanup during a demo rollback", async () => {
    environmentMocks.getEnvironment.mockReturnValue({
      SIGNAL_MODE: "demo",
      DATABASE_URL: "postgresql://signal.example/database",
      BLOB_STORE_ID: "private-store-id",
      CRON_SECRET,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(environmentMocks.requireCleanupEnvironment).toHaveBeenCalledOnce();
    expect(
      repositoryMocks.listExpiredSessionsForCleanup,
    ).toHaveBeenCalledOnce();
  });

  it("safely no-ops in demo mode only when no cleanup infrastructure is configured", async () => {
    environmentMocks.getEnvironment.mockReturnValue({ SIGNAL_MODE: "demo" });

    const response = await GET(request("wrong-secret"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      mode: "demo",
      skipped: true,
    });
    expect(environmentMocks.requireCleanupEnvironment).not.toHaveBeenCalled();
    expect(
      repositoryMocks.listExpiredSessionsForCleanup,
    ).not.toHaveBeenCalled();
  });

  it("advances successful sessions while retaining a session whose object deletion fails", async () => {
    repositoryMocks.listExpiredSessionsForCleanup.mockResolvedValue({
      sessions: [
        {
          sessionId: "poison-session",
          pathnames: Array.from(
            { length: 11 },
            (_, index) => `sessions/poison-session/artifact-${index}.wav`,
          ),
        },
        {
          sessionId: "healthy-session",
          pathnames: ["sessions/healthy-session/captures/A-1.wav"],
        },
      ],
      hasMore: false,
      oldestExpiredAt: "2026-08-03T00:00:00.000Z",
    });
    blobMocks.createPrivateDeleteUrl.mockImplementation(
      async (pathname: string) => ({
        url: `https://blob.example/delete?pathname=${encodeURIComponent(pathname)}`,
      }),
    );
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).includes("artifact-10")
        ? new Response(null, { status: 503 })
        : new Response(null, { status: 204 }),
    );

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(repositoryMocks.deleteExpiredSessionRecords).toHaveBeenCalledWith([
      "healthy-session",
    ]);
    expect(repositoryMocks.pruneUsageLedger).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      deletedArtifacts: 11,
      deletedSessions: 1,
      failedSessions: 1,
      backlogRemaining: true,
    });
  });
});
