import { drizzle } from "drizzle-orm/neon-http";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../db", () => ({
  getCleanupDatabase: vi.fn(),
  getDatabase: vi.fn(),
}));

import { getCleanupDatabase, getDatabase } from "../db";
import {
  attachWorkflowRun,
  cancelUnattachedUpgradeJobReservation,
  claimCaptureVerification,
  createExperimentSession,
  listExpiredSessionsForCleanup,
  releaseUpgradeJobReservation,
  reserveCaptureUploadGrant,
  reserveUpgradeJob,
  transitionJobStateIdempotently,
} from "../repository";
import * as schema from "../schema";

const PUBLIC_ID = "123e4567-e89b-42d3-a456-426614174000";
const INTERNAL_ID = "123e4567-e89b-42d3-a456-426614174001";
const CAPTURE_ID = "123e4567-e89b-42d3-a456-426614174002";
const SHA = "a".repeat(64);

function neonResult(rows: Record<string, unknown>[]) {
  return {
    rows,
    fields: [],
    rowCount: rows.length,
    command: "SELECT",
    rowAsArray: false,
  };
}

function neonHttpDatabase(responses: Record<string, unknown>[][]) {
  const pending = [...responses];
  const client = Object.assign(
    vi.fn(async (...args: unknown[]) => {
      void args;
      return neonResult(pending.shift() ?? []);
    }),
    {
      transaction: vi.fn(async (queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    },
  );
  return {
    client,
    database: drizzle(client as never, { schema }),
  };
}

describe("server-side resource reservations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the Neon HTTP batch transaction for lock then session insert", async () => {
    const session = { id: INTERNAL_ID, publicId: PUBLIC_ID };
    const { client, database } = neonHttpDatabase([[{}], [session]]);
    vi.mocked(getDatabase).mockReturnValue(database as never);

    await expect(
      createExperimentSession({
        publicId: PUBLIC_ID,
        sessionHash: "session-hash",
        networkHash: "network-hash",
        referenceId: "guided-reading-v1",
        referenceRevision: "1.0.0",
      }),
    ).resolves.toEqual(session);

    expect(client.transaction).toHaveBeenCalledOnce();
    expect(client).toHaveBeenCalledTimes(2);
    expect(client.mock.calls[0]?.[0]).toContain("pg_advisory_xact_lock");
    expect(client.mock.calls[1]?.[0]).toContain(
      'INSERT INTO "experiment_sessions"',
    );
    expect(client.mock.calls[1]?.[0]).toContain('"reference_id"');
    expect(client.mock.calls[1]?.[0]).toContain('"reference_revision"');
  });

  it("rejects the fourth serialized session start", async () => {
    const { database } = neonHttpDatabase([[{}], []]);
    vi.mocked(getDatabase).mockReturnValue(database as never);

    await expect(
      createExperimentSession({
        publicId: PUBLIC_ID,
        sessionHash: "session-hash",
        networkHash: "network-hash",
        referenceId: "guided-reading-v1",
        referenceRevision: "1.0.0",
      }),
    ).rejects.toMatchObject({ code: "session_rate_limited", status: 429 });
  });

  it("reserves job capacity and the ledger in the same Neon batch", async () => {
    const reservation = {
      globalJobs: 0,
      activeJobs: 0,
      id: INTERNAL_ID,
      publicId: PUBLIC_ID,
      workflowRunId: null,
      state: "queued",
      created: true,
      ledgerUpdated: true,
    };
    const { client, database } = neonHttpDatabase([[{}], [reservation]]);
    vi.mocked(getDatabase).mockReturnValue(database as never);

    await expect(
      reserveUpgradeJob(
        INTERNAL_ID,
        PUBLIC_ID,
        "session-hash",
        "network-hash",
        new Date(Date.now() + 60 * 60 * 1000),
      ),
    ).resolves.toEqual({
      id: INTERNAL_ID,
      publicId: PUBLIC_ID,
      workflowRunId: null,
      state: "queued",
      created: true,
    });

    expect(client.transaction).toHaveBeenCalledOnce();
    expect(client.mock.calls[0]?.[1]).toContain(
      "signal-enhancer:upgrade-capacity",
    );
    expect(client.mock.calls[1]?.[0]).toContain('"public_id"');
    expect(client.mock.calls[1]?.[0]).toContain('INSERT INTO "usage_ledger"');
    expect(client.mock.calls[1]?.[0]).toContain("FROM inserted_job");
    expect(client.mock.calls[1]?.[0]).toContain("reservation_clock");
    expect(client.mock.calls[1]?.[0]).toContain("clock_timestamp()");
    expect(
      (client.mock.calls[1]?.[0] as string).match(/clock_timestamp\(\)/g),
    ).toHaveLength(1);
    expect(client.mock.calls[1]?.[0]).toContain("AT TIME ZONE 'UTC'");
    expect(client.mock.calls[1]?.[0]).toContain('sum(ledger."reserved_jobs")');
    expect(client.mock.calls[1]?.[0]).toContain(
      'ledger."day_bucket" = reservation_clock.day_bucket',
    );
    expect(client.mock.calls[1]?.[0]).toContain('"created_at"');
    expect(client.mock.calls[1]?.[0]).not.toContain("T00:00:00.000Z");
  });

  it("reconciles the same client job without consuming quota again", async () => {
    const reservation = {
      globalJobs: 100,
      activeJobs: 1,
      id: INTERNAL_ID,
      publicId: PUBLIC_ID,
      workflowRunId: "run-existing",
      state: "warming",
      created: false,
      ledgerUpdated: true,
    };
    const { client, database } = neonHttpDatabase([[{}], [reservation]]);
    vi.mocked(getDatabase).mockReturnValue(database as never);

    await expect(
      reserveUpgradeJob(
        INTERNAL_ID,
        PUBLIC_ID,
        "session-hash",
        "network-hash",
        new Date(Date.now() + 60 * 60 * 1000),
      ),
    ).resolves.toMatchObject({
      id: INTERNAL_ID,
      publicId: PUBLIC_ID,
      workflowRunId: "run-existing",
      state: "warming",
      created: false,
    });

    expect(client.transaction).toHaveBeenCalledOnce();
    expect(client.mock.calls[1]?.[0]).toContain(
      "WHERE NOT EXISTS (SELECT 1 FROM existing_job)",
    );
  });

  it("does not reconcile a different client job for the same session", async () => {
    const reservation = {
      globalJobs: 0,
      activeJobs: 0,
      id: INTERNAL_ID,
      publicId: "123e4567-e89b-42d3-a456-426614174099",
      workflowRunId: "run-existing",
      state: "warming",
      created: false,
      ledgerUpdated: true,
    };
    const { database } = neonHttpDatabase([[{}], [reservation]]);
    vi.mocked(getDatabase).mockReturnValue(database as never);

    await expect(
      reserveUpgradeJob(
        INTERNAL_ID,
        PUBLIC_ID,
        "session-hash",
        "network-hash",
        new Date(Date.now() + 60 * 60 * 1000),
      ),
    ).rejects.toMatchObject({ code: "upgrade_already_used", status: 409 });
  });

  it("releases the outstanding ledger row without re-deriving its UTC bucket", async () => {
    const { client, database } = neonHttpDatabase([
      [{}],
      [{ released: true, ledgerUpdated: true }],
    ]);
    vi.mocked(getDatabase).mockReturnValue(database as never);

    await expect(
      releaseUpgradeJobReservation(
        INTERNAL_ID,
        "session-hash",
        "run-unattached",
      ),
    ).resolves.toBe(true);

    expect(client.transaction).toHaveBeenCalledOnce();
    expect(client.mock.calls[0]?.[0]).toContain("pg_advisory_xact_lock");
    expect(client.mock.calls[0]?.[1]).toContain(
      "signal-enhancer:upgrade-capacity",
    );
    expect(client.mock.calls[1]?.[0]).toContain('DELETE FROM "upgrade_jobs"');
    expect(client.mock.calls[1]?.[0]).toContain(
      '"reserved_jobs" = ledger."reserved_jobs" - 1',
    );
    expect(client.mock.calls[1]?.[0]).toContain(
      'ORDER BY ledger."updated_at" DESC',
    );
    expect(client.mock.calls[1]?.[0]).not.toContain('ledger."day_bucket"');
    expect(client.mock.calls[1]?.[1]).toContain("run-unattached");
  });

  it("tombstones an explicitly cancelled unattached job while releasing its ledger", async () => {
    const { client, database } = neonHttpDatabase([
      [{}],
      [{ tombstoned: true, ledgerUpdated: true }],
    ]);
    vi.mocked(getDatabase).mockReturnValue(database as never);

    await expect(
      cancelUnattachedUpgradeJobReservation(
        {
          sessionId: INTERNAL_ID,
          publicId: PUBLIC_ID,
          expiresAt: new Date("2026-08-05T00:30:00.000Z"),
        },
        "session-hash",
      ),
    ).resolves.toBe(true);

    expect(client.transaction).toHaveBeenCalledOnce();
    expect(client.mock.calls[0]?.[1]).toContain(
      "signal-enhancer:upgrade-capacity",
    );
    expect(client.mock.calls[1]?.[0]).toContain('UPDATE "upgrade_jobs"');
    expect(client.mock.calls[1]?.[0]).toContain("\"state\" = 'cancelled'");
    expect(client.mock.calls[1]?.[0]).not.toContain(
      'DELETE FROM "upgrade_jobs"',
    );
    expect(client.mock.calls[1]?.[0]).toContain('INSERT INTO "upgrade_jobs"');
    expect(client.mock.calls[1]?.[0]).toContain("inserted_tombstone");
    expect(client.mock.calls[1]?.[0]).toContain(
      '"reserved_jobs" = ledger."reserved_jobs" - 1',
    );
  });

  it("accepts an exact workflow attachment replay but rejects replacement", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set }));
    const attachedJob = {
      id: INTERNAL_ID,
      state: "warming",
      workflowRunId: "run-existing",
    };
    const limit = vi.fn().mockResolvedValue([attachedJob]);
    const selectWhere = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from }));
    vi.mocked(getDatabase).mockReturnValue({ update, select } as never);

    await expect(
      attachWorkflowRun(INTERNAL_ID, "run-existing"),
    ).resolves.toEqual(attachedJob);

    await expect(
      attachWorkflowRun(INTERNAL_ID, "run-different"),
    ).rejects.toMatchObject({
      code: "workflow_attachment_conflict",
      status: 409,
    });
  });

  it("bounds a capture slot to adapter-atomic immutable grants", async () => {
    const grant = {
      status: "grant",
      attempt: 1,
      pathname: `sessions/${PUBLIC_ID}/captures/A-1.wav`,
      captureId: null,
      authorizationCount: 1,
    };
    const { client, database } = neonHttpDatabase([[{}], [grant]]);
    vi.mocked(getDatabase).mockReturnValue(database as never);

    await expect(
      reserveCaptureUploadGrant(
        INTERNAL_ID,
        PUBLIC_ID,
        "A",
        1_920_044,
        SHA,
        new Date(Date.now() + 10 * 60 * 1000),
      ),
    ).resolves.toEqual({
      status: "grant",
      attempt: 1,
      pathname: grant.pathname,
      authorizationCount: 1,
    });

    expect(client.transaction).toHaveBeenCalledOnce();
    expect(client.mock.calls[1]?.[0]).toContain('"authorization_count" < 2');
    expect(client.mock.calls[1]?.[0]).toContain(
      'INSERT INTO "capture_upload_grants"',
    );
  });

  it("returns an idempotent receipt for an identical committed capture", async () => {
    const committed = {
      status: "committed",
      attempt: null,
      pathname: `sessions/${PUBLIC_ID}/captures/A-1.wav`,
      captureId: CAPTURE_ID,
      authorizationCount: null,
    };
    const { database } = neonHttpDatabase([[{}], [committed]]);
    vi.mocked(getDatabase).mockReturnValue(database as never);

    await expect(
      reserveCaptureUploadGrant(
        INTERNAL_ID,
        PUBLIC_ID,
        "A",
        1_920_044,
        SHA,
        new Date(Date.now() + 10 * 60 * 1000),
      ),
    ).resolves.toEqual({
      status: "committed",
      captureId: CAPTURE_ID,
      pathname: committed.pathname,
    });
  });

  it("claims at most a bounded Blob verification after proving the grant", async () => {
    const { client, database } = neonHttpDatabase([
      [{ status: "verify", captureId: null }],
    ]);
    vi.mocked(getDatabase).mockReturnValue(database as never);

    await expect(
      claimCaptureVerification(
        INTERNAL_ID,
        "A",
        `sessions/${PUBLIC_ID}/captures/A-1.wav`,
        1_920_044,
        SHA,
      ),
    ).resolves.toEqual({ status: "verify", captureId: null });

    expect(client.mock.calls[0]?.[0]).toContain('"verification_count" < 2');
    expect(client.mock.calls[0]?.[0]).toContain('"expected_sha256" = $');
  });

  it("accepts only an exact target state after an uncertain transition commit", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set }));
    const targetJob = { id: INTERNAL_ID, state: "warming" };
    const limit = vi.fn().mockResolvedValue([targetJob]);
    const selectWhere = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from }));
    vi.mocked(getDatabase).mockReturnValue({ update, select } as never);

    await expect(
      transitionJobStateIdempotently(INTERNAL_ID, "queued", "warming", {
        attemptCount: 1,
      }),
    ).resolves.toEqual({ job: targetJob, transitioned: false });

    limit.mockResolvedValueOnce([{ ...targetJob, state: "cancelled" }]);
    await expect(
      transitionJobStateIdempotently(INTERNAL_ID, "queued", "warming"),
    ).resolves.toBeNull();
  });

  it("re-sweeps all bounded paths before the post-expiry row cascade", async () => {
    const expired = [
      {
        id: INTERNAL_ID,
        publicId: PUBLIC_ID,
        expiresAt: new Date(Date.now() - 20 * 60 * 1000),
      },
    ];
    const limit = vi.fn().mockResolvedValue(expired);
    const orderBy = vi.fn(() => ({ limit }));
    const expiredWhere = vi.fn(() => ({ orderBy }));
    const expiredFrom = vi.fn(() => ({ where: expiredWhere }));
    const captureWhere = vi.fn().mockResolvedValue([]);
    const captureFrom = vi.fn(() => ({ where: captureWhere }));
    const grantWhere = vi.fn().mockResolvedValue([]);
    const grantFrom = vi.fn(() => ({ where: grantWhere }));
    const jobWhere = vi.fn().mockResolvedValue([]);
    const jobFrom = vi.fn(() => ({ where: jobWhere }));
    const select = vi
      .fn()
      .mockReturnValueOnce({ from: expiredFrom })
      .mockReturnValueOnce({ from: captureFrom })
      .mockReturnValueOnce({ from: grantFrom })
      .mockReturnValueOnce({ from: jobFrom });
    vi.mocked(getCleanupDatabase).mockReturnValue({ select } as never);

    await expect(listExpiredSessionsForCleanup()).resolves.toEqual({
      sessions: [
        {
          sessionId: INTERNAL_ID,
          pathnames: [
            `sessions/${PUBLIC_ID}/captures/A-1.wav`,
            `sessions/${PUBLIC_ID}/captures/A-2.wav`,
            `sessions/${PUBLIC_ID}/captures/B-1.wav`,
            `sessions/${PUBLIC_ID}/captures/B-2.wav`,
          ],
        },
      ],
      hasMore: false,
      oldestExpiredAt: expired[0]?.expiresAt.toISOString(),
    });
    expect(limit).toHaveBeenCalledWith(26);
  });

  it("does not enumerate artifacts during the post-expiry write drain", async () => {
    const recentlyExpired = [
      {
        id: INTERNAL_ID,
        publicId: PUBLIC_ID,
        expiresAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    ];
    const limit = vi.fn().mockResolvedValue(recentlyExpired);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn().mockReturnValue({ from });
    vi.mocked(getCleanupDatabase).mockReturnValue({ select } as never);

    await expect(listExpiredSessionsForCleanup()).resolves.toEqual({
      sessions: [],
      hasMore: false,
      oldestExpiredAt: null,
    });
    expect(select).toHaveBeenCalledOnce();
  });

  it("keeps the exact write-drain boundary ineligible for deletion", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-08-04T12:00:00.000Z");
    vi.setSystemTime(now);
    const boundaryRow = {
      id: INTERNAL_ID,
      publicId: PUBLIC_ID,
      expiresAt: new Date(now.getTime() - 15 * 60 * 1000),
    };
    const limit = vi.fn().mockResolvedValue([boundaryRow]);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn().mockReturnValue({ from });
    vi.mocked(getCleanupDatabase).mockReturnValue({ select } as never);

    try {
      await expect(listExpiredSessionsForCleanup()).resolves.toEqual({
        sessions: [],
        hasMore: false,
        oldestExpiredAt: null,
      });
      expect(select).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
