import { drizzle } from "drizzle-orm/neon-http";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../db", () => ({ getDatabase: vi.fn() }));

import { getDatabase } from "../db";
import {
  claimCaptureVerification,
  createExperimentSession,
  listExpiredSessionsForCleanup,
  reserveCaptureUploadGrant,
  reserveUpgradeJob,
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
      }),
    ).resolves.toEqual(session);

    expect(client.transaction).toHaveBeenCalledOnce();
    expect(client).toHaveBeenCalledTimes(2);
    expect(client.mock.calls[0]?.[0]).toContain("pg_advisory_xact_lock");
    expect(client.mock.calls[1]?.[0]).toContain(
      'INSERT INTO "experiment_sessions"',
    );
  });

  it("rejects the fourth serialized session start", async () => {
    const { database } = neonHttpDatabase([[{}], []]);
    vi.mocked(getDatabase).mockReturnValue(database as never);

    await expect(
      createExperimentSession({
        publicId: PUBLIC_ID,
        sessionHash: "session-hash",
        networkHash: "network-hash",
      }),
    ).rejects.toMatchObject({ code: "session_rate_limited", status: 429 });
  });

  it("reserves job capacity and the ledger in the same Neon batch", async () => {
    const reservation = {
      globalJobs: 0,
      activeJobs: 0,
      id: INTERNAL_ID,
      publicId: PUBLIC_ID,
      ledgerUpdated: true,
    };
    const { client, database } = neonHttpDatabase([[{}], [reservation]]);
    vi.mocked(getDatabase).mockReturnValue(database as never);

    await expect(
      reserveUpgradeJob(
        INTERNAL_ID,
        "session-hash",
        "network-hash",
        new Date(Date.now() + 60 * 60 * 1000),
      ),
    ).resolves.toEqual({ id: INTERNAL_ID, publicId: PUBLIC_ID });

    expect(client.transaction).toHaveBeenCalledOnce();
    expect(client.mock.calls[1]?.[0]).toContain('INSERT INTO "usage_ledger"');
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
    vi.mocked(getDatabase).mockReturnValue({ select } as never);

    await expect(listExpiredSessionsForCleanup()).resolves.toEqual({
      sessionIds: [INTERNAL_ID],
      pathnames: [
        `sessions/${PUBLIC_ID}/captures/A-1.wav`,
        `sessions/${PUBLIC_ID}/captures/A-2.wav`,
        `sessions/${PUBLIC_ID}/captures/B-1.wav`,
        `sessions/${PUBLIC_ID}/captures/B-2.wav`,
      ],
    });
  });
});
