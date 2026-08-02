import "server-only";

import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import type { CommitCaptureInput } from "./contracts";
import { getDatabase } from "./db";
import { getEnvironment } from "./env";
import { SignalError } from "./errors";
import {
  captures,
  experimentSessions,
  jobEvents,
  upgradeJobs,
  usageLedger,
} from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function createExperimentSession(input: {
  sessionHash: string;
  networkHash: string;
  publicId: string;
  deviceMetadata?: Record<string, unknown>;
}) {
  const database = getDatabase();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [{ value: recentStarts = 0 } = { value: 0 }] = await database
    .select({ value: count() })
    .from(experimentSessions)
    .where(
      and(
        eq(experimentSessions.networkHash, input.networkHash),
        gte(experimentSessions.createdAt, hourAgo),
      ),
    );
  if (recentStarts >= 3) {
    throw new SignalError(
      "session_rate_limited",
      "This network has started three recent experiments. Please try again later.",
      429,
    );
  }

  const expiresAt = new Date(Date.now() + DAY_MS);
  const [session] = await database
    .insert(experimentSessions)
    .values({
      publicId: input.publicId,
      sessionHash: input.sessionHash,
      networkHash: input.networkHash,
      deviceMetadata: input.deviceMetadata ?? {},
      expiresAt,
    })
    .returning();
  if (!session)
    throw new SignalError(
      "session_create_failed",
      "The experiment could not be reserved.",
      503,
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

export async function commitCapture(
  sessionId: string,
  input: CommitCaptureInput,
) {
  const database = getDatabase();
  const expiresAt = new Date(Date.now() + DAY_MS);
  const [capture] = await database
    .insert(captures)
    .values({
      sessionId,
      slot: input.slot,
      pathname: input.pathname,
      bytes: input.bytes,
      sha256: input.sha256,
      codec: input.codec,
      durationMs: input.durationMs,
      sampleRate: input.sampleRate,
      channels: input.channels,
      metrics: input.metrics,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [captures.sessionId, captures.slot],
      set: {
        pathname: input.pathname,
        bytes: input.bytes,
        sha256: input.sha256,
        codec: input.codec,
        durationMs: input.durationMs,
        sampleRate: input.sampleRate,
        channels: input.channels,
        metrics: input.metrics,
        expiresAt,
      },
    })
    .returning();
  if (!capture)
    throw new SignalError(
      "capture_commit_failed",
      "The capture could not be committed.",
      503,
    );
  return capture;
}

export async function getSessionCaptures(sessionId: string) {
  return getDatabase()
    .select()
    .from(captures)
    .where(eq(captures.sessionId, sessionId));
}

export async function reserveUpgradeJob(
  sessionId: string,
  sessionHash: string,
  networkHash: string,
) {
  const database = getDatabase();
  const environment = getEnvironment();
  const dayBucket = new Date().toISOString().slice(0, 10);

  return database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`signal-enhancer:${dayBucket}`}))`,
    );
    const [{ value: globalJobs = 0 } = { value: 0 }] = await transaction
      .select({ value: count() })
      .from(upgradeJobs)
      .where(
        gte(upgradeJobs.createdAt, new Date(`${dayBucket}T00:00:00.000Z`)),
      );
    if (globalJobs >= environment.MAX_GLOBAL_JOBS_PER_DAY) {
      throw new SignalError(
        "daily_capacity_reached",
        "Today’s upgrade capacity has been reached. Your browser preview remains available.",
        429,
      );
    }

    const [{ value: activeJobs = 0 } = { value: 0 }] = await transaction
      .select({ value: count() })
      .from(upgradeJobs)
      .where(
        inArray(upgradeJobs.state, [
          "queued",
          "warming",
          "processing",
          "storing",
        ]),
      );
    if (activeJobs >= environment.MAX_ACTIVE_GPU_JOBS) {
      throw new SignalError(
        "upgrade_capacity_busy",
        "The upgrade engine is occupied. Your browser preview remains available.",
        429,
      );
    }

    const [job] = await transaction
      .insert(upgradeJobs)
      .values({ sessionId, expiresAt: new Date(Date.now() + DAY_MS) })
      .onConflictDoNothing({ target: upgradeJobs.sessionId })
      .returning();
    if (!job) {
      throw new SignalError(
        "upgrade_already_used",
        "This session has already used its signal upgrade.",
        409,
      );
    }

    await transaction
      .insert(usageLedger)
      .values({ sessionHash, networkHash, dayBucket, reservedJobs: 1 })
      .onConflictDoUpdate({
        target: [usageLedger.sessionHash, usageLedger.dayBucket],
        set: {
          reservedJobs: sql`${usageLedger.reservedJobs} + 1`,
          updatedAt: new Date(),
        },
      });
    return job;
  });
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
  const expired = await database
    .select({ id: experimentSessions.id })
    .from(experimentSessions)
    .where(lt(experimentSessions.expiresAt, new Date()))
    .limit(limit);
  const sessionIds = expired.map(({ id }) => id);
  if (sessionIds.length === 0) return { sessionIds, pathnames: [] as string[] };

  const [captureRows, jobRows] = await Promise.all([
    database
      .select({ pathname: captures.pathname })
      .from(captures)
      .where(inArray(captures.sessionId, sessionIds)),
    database
      .select({
        resultPathname: upgradeJobs.resultPathname,
        differencePathname: upgradeJobs.differencePathname,
        reportPathname: upgradeJobs.reportPathname,
      })
      .from(upgradeJobs)
      .where(inArray(upgradeJobs.sessionId, sessionIds)),
  ]);
  const pathnames = new Set(captureRows.map(({ pathname }) => pathname));
  for (const job of jobRows) {
    if (job.resultPathname) pathnames.add(job.resultPathname);
    if (job.differencePathname) pathnames.add(job.differencePathname);
    if (job.reportPathname) pathnames.add(job.reportPathname);
  }
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
