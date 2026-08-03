import "server-only";

import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";

import type { CommitCaptureInput } from "./contracts";
import { ARTIFACT_WRITE_DRAIN_MS, capturePathname } from "./blob";
import { getDatabase } from "./db";
import { getEnvironment } from "./env";
import { SignalError } from "./errors";
import {
  captureUploadGrants,
  captures,
  experimentSessions,
  jobEvents,
  upgradeJobs,
  usageLedger,
} from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_UPGRADE_WINDOW_MS = 30 * 60 * 1000;

export async function createExperimentSession(input: {
  sessionHash: string;
  networkHash: string;
  publicId: string;
  referenceId: string;
  referenceRevision: string;
  deviceMetadata?: Record<string, unknown>;
}) {
  const database = getDatabase();
  const expiresAt = new Date(Date.now() + DAY_MS);
  const [, result] = await database.batch([
    database.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`signal-enhancer:session:${input.networkHash}`}))`,
    ),
    database.execute<{ id: string; publicId: string }>(sql`
      WITH inserted_session AS (
      INSERT INTO "experiment_sessions" (
        "public_id",
        "session_hash",
        "network_hash",
        "reference_id",
        "reference_revision",
        "device_metadata",
        "expires_at"
      )
      SELECT
        ${input.publicId}::uuid,
        ${input.sessionHash},
        ${input.networkHash},
        ${input.referenceId},
        ${input.referenceRevision},
        ${JSON.stringify(input.deviceMetadata ?? {})}::jsonb,
        ${expiresAt.toISOString()}::timestamptz
      WHERE (
        SELECT count(*)
        FROM "experiment_sessions"
        WHERE "network_hash" = ${input.networkHash}
          AND "created_at" >= now() - interval '1 hour'
      ) < 3
      RETURNING "id", "public_id"
      )
      SELECT "id", "public_id" AS "publicId"
      FROM inserted_session
    `),
  ] as const);
  const [session] = result.rows;
  if (!session)
    throw new SignalError(
      "session_rate_limited",
      "This network has started three recent experiments. Please try again later.",
      429,
    );
  return session;
}

export async function requireOwnedSession(
  publicId: string,
  sessionHash: string,
) {
  const database = getDatabase();
  const [session] = await database
    .select()
    .from(experimentSessions)
    .where(
      and(
        eq(experimentSessions.publicId, publicId),
        eq(experimentSessions.sessionHash, sessionHash),
      ),
    )
    .limit(1);
  if (!session || session.expiresAt.getTime() <= Date.now()) {
    throw new SignalError(
      "session_not_found",
      "This experiment session is unavailable or has expired.",
      404,
    );
  }
  return session;
}

export async function reserveCaptureUploadGrant(
  sessionId: string,
  sessionPublicId: string,
  slot: "A" | "B",
  expectedBytes: number,
  expectedSha256: string,
  expiresAt: Date,
) {
  const database = getDatabase();
  const [, result] = await database.batch([
    database.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`signal-enhancer:capture:${sessionId}:${slot}`}))`,
    ),
    database.execute<{
      status: "committed" | "grant";
      attempt: 1 | 2 | null;
      pathname: string;
      captureId: string | null;
      authorizationCount: number | null;
    }>(sql`
      WITH existing_capture AS MATERIALIZED (
        SELECT "id", "pathname", "bytes", "sha256"
        FROM "captures"
        WHERE "session_id" = ${sessionId}::uuid
          AND "slot" = ${slot}
        LIMIT 1
      ),
      matching_grant AS MATERIALIZED (
        SELECT "session_id", "slot", "attempt"
        FROM "capture_upload_grants"
        WHERE "session_id" = ${sessionId}::uuid
          AND "slot" = ${slot}
          AND "expected_bytes" = ${expectedBytes}
          AND "expected_sha256" = ${expectedSha256}
          AND "authorization_count" < 2
        ORDER BY "attempt" DESC
        LIMIT 1
      ),
      reissued_grant AS (
        UPDATE "capture_upload_grants" AS grant
        SET
          "authorization_count" = grant."authorization_count" + 1,
          "expires_at" = ${expiresAt.toISOString()}::timestamptz
        FROM matching_grant
        WHERE grant."session_id" = matching_grant."session_id"
          AND grant."slot" = matching_grant."slot"
          AND grant."attempt" = matching_grant."attempt"
          AND NOT EXISTS (SELECT 1 FROM existing_capture)
        RETURNING
          grant."attempt",
          grant."pathname",
          grant."authorization_count"
      ),
      next_attempt AS (
        SELECT (coalesce(max("attempt"), 0) + 1)::integer AS attempt
        FROM "capture_upload_grants"
        WHERE "session_id" = ${sessionId}::uuid
          AND "slot" = ${slot}
      ),
      inserted_grant AS (
        INSERT INTO "capture_upload_grants" (
          "session_id",
          "slot",
          "attempt",
          "pathname",
          "expected_bytes",
          "expected_sha256",
          "expires_at"
        )
        SELECT
          ${sessionId}::uuid,
          ${slot},
          next_attempt.attempt,
          'sessions/' || ${sessionPublicId} || '/captures/' || ${slot} || '-' || next_attempt.attempt || '.wav',
          ${expectedBytes},
          ${expectedSha256},
          ${expiresAt.toISOString()}::timestamptz
        FROM next_attempt
        WHERE next_attempt.attempt <= 2
          AND NOT EXISTS (SELECT 1 FROM existing_capture)
          AND NOT EXISTS (SELECT 1 FROM reissued_grant)
        RETURNING "attempt", "pathname", "authorization_count"
      )
      SELECT
        'committed'::text AS status,
        NULL::integer AS attempt,
        "pathname",
        "id" AS "captureId",
        NULL::integer AS "authorizationCount"
      FROM existing_capture
      WHERE "bytes" = ${expectedBytes}
        AND "sha256" = ${expectedSha256}
      UNION ALL
      SELECT
        'grant',
        "attempt",
        "pathname",
        NULL::uuid,
        "authorization_count"
      FROM reissued_grant
      UNION ALL
      SELECT
        'grant',
        "attempt",
        "pathname",
        NULL::uuid,
        "authorization_count"
      FROM inserted_grant
    `),
  ] as const);
  const [reservation] = result.rows;
  if (!reservation)
    throw new SignalError(
      "capture_upload_conflict",
      "This capture slot is already committed to different audio or has exhausted its retry grants.",
      409,
    );
  if (reservation.status === "committed")
    return {
      status: "committed" as const,
      captureId: reservation.captureId,
      pathname: reservation.pathname,
    };
  return {
    status: "grant" as const,
    attempt: reservation.attempt as 1 | 2,
    pathname: reservation.pathname,
    authorizationCount: reservation.authorizationCount as 1 | 2,
  };
}

export async function releaseCaptureUploadGrant(
  sessionId: string,
  slot: "A" | "B",
  attempt: 1 | 2,
  authorizationCount: 1 | 2,
) {
  await getDatabase()
    .update(captureUploadGrants)
    .set({
      authorizationCount: sql`greatest(${captureUploadGrants.authorizationCount} - 1, 0)`,
    })
    .where(
      and(
        eq(captureUploadGrants.sessionId, sessionId),
        eq(captureUploadGrants.slot, slot),
        eq(captureUploadGrants.attempt, attempt),
        eq(captureUploadGrants.authorizationCount, authorizationCount),
      ),
    );
}

export async function claimCaptureVerification(
  sessionId: string,
  slot: "A" | "B",
  pathname: string,
  expectedBytes: number,
  expectedSha256: string,
) {
  const result = await getDatabase().execute<{
    status: "committed" | "verify";
    captureId: string | null;
  }>(sql`
    WITH existing_capture AS MATERIALIZED (
      SELECT "id", "pathname", "bytes", "sha256"
      FROM "captures"
      WHERE "session_id" = ${sessionId}::uuid
        AND "slot" = ${slot}
      LIMIT 1
    ),
    claimed_grant AS (
      UPDATE "capture_upload_grants"
      SET "verification_count" = "verification_count" + 1
      WHERE "session_id" = ${sessionId}::uuid
        AND "slot" = ${slot}
        AND "pathname" = ${pathname}
        AND "expected_bytes" = ${expectedBytes}
        AND "expected_sha256" = ${expectedSha256}
        AND "authorization_count" > 0
        AND "verification_count" < 2
        AND NOT EXISTS (SELECT 1 FROM existing_capture)
      RETURNING "session_id"
    )
    SELECT 'committed'::text AS status, "id" AS "captureId"
    FROM existing_capture
    WHERE "pathname" = ${pathname}
      AND "bytes" = ${expectedBytes}
      AND "sha256" = ${expectedSha256}
    UNION ALL
    SELECT 'verify', NULL::uuid
    FROM claimed_grant
  `);
  const [claim] = result.rows;
  if (!claim)
    throw new SignalError(
      "capture_verification_limit",
      "This capture is not an issued grant, differs from the committed audio, or exhausted verification retries.",
      409,
    );
  return claim;
}

export async function commitCapture(
  sessionId: string,
  sessionExpiresAt: Date,
  input: CommitCaptureInput,
) {
  const result = await getDatabase().execute<{ id: string; slot: "A" | "B" }>(
    sql`
      WITH inserted_capture AS (
        INSERT INTO "captures" (
        "session_id",
        "slot",
        "pathname",
        "bytes",
        "sha256",
        "codec",
        "duration_ms",
        "sample_rate",
        "channels",
        "metrics",
        "expires_at"
      )
      SELECT
        ${sessionId}::uuid,
        ${input.slot},
        ${input.pathname},
        ${input.bytes},
        ${input.sha256},
        ${input.codec},
        ${input.durationMs},
        ${input.sampleRate},
        ${input.channels},
        ${JSON.stringify(input.metrics)}::jsonb,
        ${sessionExpiresAt.toISOString()}::timestamptz
        FROM "capture_upload_grants"
        WHERE "session_id" = ${sessionId}::uuid
          AND "slot" = ${input.slot}
          AND "pathname" = ${input.pathname}
          AND "expected_bytes" = ${input.bytes}
          AND "expected_sha256" = ${input.sha256}
          AND "verification_count" > 0
        ON CONFLICT ("session_id", "slot") DO NOTHING
        RETURNING "id", "slot", "pathname", "bytes", "sha256"
      ),
      matching_capture AS (
        SELECT "id", "slot"
        FROM "captures"
        WHERE "session_id" = ${sessionId}::uuid
          AND "slot" = ${input.slot}
          AND "pathname" = ${input.pathname}
          AND "bytes" = ${input.bytes}
          AND "sha256" = ${input.sha256}
      )
      SELECT "id", "slot" FROM inserted_capture
      UNION ALL
      SELECT "id", "slot" FROM matching_capture
      WHERE NOT EXISTS (SELECT 1 FROM inserted_capture)
    `,
  );
  const [capture] = result.rows;
  if (!capture)
    throw new SignalError(
      "capture_commit_failed",
      "The capture grant was unavailable or this slot was already committed.",
      409,
    );
  return capture;
}

export async function getSessionCaptures(sessionId: string) {
  return getDatabase()
    .select()
    .from(captures)
    .where(eq(captures.sessionId, sessionId));
}

export async function getExperimentSessionById(sessionId: string) {
  const [session] = await getDatabase()
    .select()
    .from(experimentSessions)
    .where(eq(experimentSessions.id, sessionId))
    .limit(1);
  if (!session || session.expiresAt.getTime() <= Date.now())
    throw new SignalError(
      "session_not_found",
      "This experiment session is unavailable or has expired.",
      404,
    );
  return session;
}

export async function reserveUpgradeJob(
  sessionId: string,
  sessionHash: string,
  networkHash: string,
  sessionExpiresAt: Date,
) {
  const database = getDatabase();
  const environment = getEnvironment();
  const dayBucket = new Date().toISOString().slice(0, 10);
  if (sessionExpiresAt.getTime() - Date.now() < MIN_UPGRADE_WINDOW_MS)
    throw new SignalError(
      "session_expiring",
      "This experiment is too close to expiry to start a deeper upgrade.",
      409,
    );
  const expiresAt = sessionExpiresAt;
  const [, result] = await database.batch([
    database.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`signal-enhancer:${dayBucket}`}))`,
    ),
    database.execute<{
      globalJobs: number;
      activeJobs: number;
      id: string | null;
      publicId: string | null;
      ledgerUpdated: boolean;
    }>(sql`
    WITH capacity AS MATERIALIZED (
      SELECT
        (
          SELECT count(*)::integer
          FROM "upgrade_jobs"
          WHERE "created_at" >= ${`${dayBucket}T00:00:00.000Z`}::timestamptz
        ) AS global_jobs,
        (
          SELECT count(*)::integer
          FROM "upgrade_jobs"
          WHERE "state" IN ('queued', 'warming', 'processing', 'storing')
        ) AS active_jobs
    ),
    inserted_job AS (
      INSERT INTO "upgrade_jobs" ("session_id", "expires_at")
      SELECT ${sessionId}::uuid, ${expiresAt.toISOString()}::timestamptz
      FROM capacity
      WHERE global_jobs < ${environment.MAX_GLOBAL_JOBS_PER_DAY}
        AND active_jobs < ${environment.MAX_ACTIVE_GPU_JOBS}
      ON CONFLICT ("session_id") DO NOTHING
      RETURNING "id", "public_id"
    ),
    updated_ledger AS (
      INSERT INTO "usage_ledger" (
        "session_hash",
        "network_hash",
        "day_bucket",
        "reserved_jobs"
      )
      SELECT ${sessionHash}, ${networkHash}, ${dayBucket}, 1
      FROM inserted_job
      ON CONFLICT ("session_hash", "day_bucket") DO UPDATE
      SET
        "reserved_jobs" = "usage_ledger"."reserved_jobs" + 1,
        "updated_at" = now()
      RETURNING "id"
    )
    SELECT
      capacity.global_jobs AS "globalJobs",
      capacity.active_jobs AS "activeJobs",
      inserted_job.id,
      inserted_job.public_id AS "publicId",
      EXISTS (SELECT 1 FROM updated_ledger) AS "ledgerUpdated"
    FROM capacity
    LEFT JOIN inserted_job ON true
    `),
  ] as const);
  const [reservation] = result.rows;
  if (!reservation)
    throw new SignalError(
      "upgrade_reservation_failed",
      "The signal upgrade could not be reserved.",
      503,
    );
  if (reservation.globalJobs >= environment.MAX_GLOBAL_JOBS_PER_DAY)
    throw new SignalError(
      "daily_capacity_reached",
      "Today’s upgrade capacity has been reached. Your browser preview remains available.",
      429,
    );
  if (reservation.activeJobs >= environment.MAX_ACTIVE_GPU_JOBS)
    throw new SignalError(
      "upgrade_capacity_busy",
      "The upgrade engine is occupied. Your browser preview remains available.",
      429,
    );
  if (!reservation.id || !reservation.publicId || !reservation.ledgerUpdated)
    throw new SignalError(
      "upgrade_already_used",
      "This session has already used its signal upgrade.",
      409,
    );
  return { id: reservation.id, publicId: reservation.publicId };
}

export async function attachWorkflowRun(jobId: string, workflowRunId: string) {
  const [job] = await getDatabase()
    .update(upgradeJobs)
    .set({ workflowRunId })
    .where(eq(upgradeJobs.id, jobId))
    .returning();
  return job;
}

export async function getOwnedJob(publicId: string, sessionId: string) {
  const [job] = await getDatabase()
    .select()
    .from(upgradeJobs)
    .where(
      and(
        eq(upgradeJobs.publicId, publicId),
        eq(upgradeJobs.sessionId, sessionId),
      ),
    )
    .limit(1);
  if (!job)
    throw new SignalError(
      "upgrade_not_found",
      "This upgrade run is unavailable.",
      404,
    );
  return job;
}

export async function getOwnedJobBySessionHash(
  publicId: string,
  sessionHash: string,
) {
  const database = getDatabase();
  const [row] = await database
    .select({ job: upgradeJobs, session: experimentSessions })
    .from(upgradeJobs)
    .innerJoin(
      experimentSessions,
      eq(upgradeJobs.sessionId, experimentSessions.id),
    )
    .where(
      and(
        eq(upgradeJobs.publicId, publicId),
        eq(experimentSessions.sessionHash, sessionHash),
      ),
    )
    .limit(1);
  if (!row || row.session.expiresAt.getTime() <= Date.now()) {
    throw new SignalError(
      "upgrade_not_found",
      "This upgrade run is unavailable.",
      404,
    );
  }
  return row.job;
}

export async function getJobById(jobId: string) {
  const [job] = await getDatabase()
    .select()
    .from(upgradeJobs)
    .where(eq(upgradeJobs.id, jobId))
    .limit(1);
  if (!job)
    throw new SignalError(
      "upgrade_not_found",
      "This upgrade run is unavailable.",
      404,
    );
  return job;
}

export async function updateJobState(
  jobId: string,
  state: string,
  fields: Partial<typeof upgradeJobs.$inferInsert> = {},
) {
  const [job] = await getDatabase()
    .update(upgradeJobs)
    .set({ state, ...fields })
    .where(eq(upgradeJobs.id, jobId))
    .returning();
  if (!job)
    throw new SignalError(
      "upgrade_not_found",
      "This upgrade run is unavailable.",
      404,
    );
  return job;
}

export async function appendJobEvent(
  jobId: string,
  stage: string,
  status: string,
  detail: string,
) {
  const database = getDatabase();
  const [latest] = await database
    .select({ sequence: jobEvents.sequence })
    .from(jobEvents)
    .where(eq(jobEvents.jobId, jobId))
    .orderBy(desc(jobEvents.sequence))
    .limit(1);
  const sequence = (latest?.sequence ?? -1) + 1;
  await database
    .insert(jobEvents)
    .values({ jobId, sequence, stage, status, detail });
  return sequence;
}

export async function listJobEvents(jobId: string) {
  return getDatabase()
    .select()
    .from(jobEvents)
    .where(eq(jobEvents.jobId, jobId))
    .orderBy(jobEvents.sequence);
}

export async function listExpiredSessionsForCleanup(limit = 25) {
  const database = getDatabase();
  const now = new Date();
  const expired = await database
    .select({
      id: experimentSessions.id,
      publicId: experimentSessions.publicId,
      expiresAt: experimentSessions.expiresAt,
    })
    .from(experimentSessions)
    .where(lt(experimentSessions.expiresAt, now))
    .orderBy(experimentSessions.expiresAt)
    .limit(limit);
  const expiredSessionIds = expired.map(({ id }) => id);
  if (expiredSessionIds.length === 0)
    return { sessionIds: [] as string[], pathnames: [] as string[] };

  const [captureRows, grantRows, jobRows] = await Promise.all([
    database
      .select({ pathname: captures.pathname })
      .from(captures)
      .where(inArray(captures.sessionId, expiredSessionIds)),
    database
      .select({ pathname: captureUploadGrants.pathname })
      .from(captureUploadGrants)
      .where(inArray(captureUploadGrants.sessionId, expiredSessionIds)),
    database
      .select({
        resultPathname: upgradeJobs.resultPathname,
        differencePathname: upgradeJobs.differencePathname,
        reportPathname: upgradeJobs.reportPathname,
      })
      .from(upgradeJobs)
      .where(inArray(upgradeJobs.sessionId, expiredSessionIds)),
  ]);
  const pathnames = new Set(
    expired.flatMap(({ publicId }) =>
      (["A", "B"] as const).flatMap((slot) => [
        capturePathname(publicId, slot, 1),
        capturePathname(publicId, slot, 2),
      ]),
    ),
  );
  for (const { pathname } of captureRows) pathnames.add(pathname);
  for (const { pathname } of grantRows) pathnames.add(pathname);
  for (const job of jobRows) {
    if (job.resultPathname) pathnames.add(job.resultPathname);
    if (job.differencePathname) pathnames.add(job.differencePathname);
    if (job.reportPathname) pathnames.add(job.reportPathname);
  }
  const safeDeleteBefore = now.getTime() - ARTIFACT_WRITE_DRAIN_MS;
  const sessionIds = expired
    .filter(({ expiresAt }) => expiresAt.getTime() <= safeDeleteBefore)
    .map(({ id }) => id);
  return { sessionIds, pathnames: [...pathnames] };
}

export async function deleteExpiredSessionRecords(sessionIds: string[]) {
  if (sessionIds.length === 0) return 0;
  const deleted = await getDatabase()
    .delete(experimentSessions)
    .where(inArray(experimentSessions.id, sessionIds))
    .returning({ id: experimentSessions.id });
  return deleted.length;
}

export async function pruneUsageLedger(retainDays = 35) {
  const before = new Date(Date.now() - retainDays * DAY_MS);
  const deleted = await getDatabase()
    .delete(usageLedger)
    .where(lt(usageLedger.updatedAt, before))
    .returning({ id: usageLedger.id });
  return deleted.length;
}
