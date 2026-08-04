import { createPrivateDeleteUrl } from "@/lib/server/blob";
import { getEnvironment, requireCleanupEnvironment } from "@/lib/server/env";
import { safeErrorResponse } from "@/lib/server/errors";
import { requireInternalBearerAuthorization } from "@/lib/server/internal-auth";
import {
  deleteExpiredSessionRecords,
  listExpiredSessionsForCleanup,
  pruneUsageLedger,
} from "@/lib/server/repository";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const DELETE_CONCURRENCY = 10;

type ExpiredSession = {
  sessionId: string;
  pathnames: string[];
};

async function deletePrivateBlob(pathname: string) {
  const signed = await createPrivateDeleteUrl(pathname);
  const response = await fetch(signed.url, {
    method: "DELETE",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Private artifact deletion failed with status ${response.status}.`,
    );
  }
}

async function deletePrivateBlobs(sessions: ExpiredSession[]) {
  const artifacts = sessions.flatMap(({ sessionId, pathnames }) =>
    pathnames.map((pathname) => ({ sessionId, pathname })),
  );
  const failedSessionIds = new Set<string>();
  let deletedArtifacts = 0;

  for (
    let offset = 0;
    offset < artifacts.length;
    offset += DELETE_CONCURRENCY
  ) {
    const batch = artifacts.slice(offset, offset + DELETE_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(({ pathname }) => deletePrivateBlob(pathname)),
    );
    results.forEach((result, index) => {
      const sessionId = batch[index]?.sessionId;
      if (!sessionId) return;
      if (result.status === "fulfilled") deletedArtifacts += 1;
      else failedSessionIds.add(sessionId);
    });
  }

  return { deletedArtifacts, failedSessionIds };
}

export async function GET(request: Request) {
  try {
    const environment = getEnvironment();
    const cleanupConfigured = Boolean(
      environment.DATABASE_URL ||
      environment.BLOB_READ_WRITE_TOKEN ||
      environment.BLOB_STORE_ID ||
      environment.CRON_SECRET,
    );
    if (!cleanupConfigured) {
      return Response.json(
        { mode: environment.SIGNAL_MODE, skipped: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const cleanupEnvironment = requireCleanupEnvironment();
    requireInternalBearerAuthorization(request, cleanupEnvironment.CRON_SECRET);

    const expired = await listExpiredSessionsForCleanup();
    const { deletedArtifacts, failedSessionIds } = await deletePrivateBlobs(
      expired.sessions,
    );
    const successfulSessionIds = expired.sessions
      .map(({ sessionId }) => sessionId)
      .filter((sessionId) => !failedSessionIds.has(sessionId));
    const deletedSessions =
      await deleteExpiredSessionRecords(successfulSessionIds);
    const deletedLedgerRows = await pruneUsageLedger();
    const failedSessions = failedSessionIds.size;
    const backlogRemaining = expired.hasMore || failedSessions > 0;

    if (backlogRemaining) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "cleanup_backlog_remaining",
          oldestExpiredAt: expired.oldestExpiredAt,
          failedSessions,
        }),
      );
    }

    return Response.json(
      {
        deletedArtifacts,
        deletedSessions,
        deletedLedgerRows,
        failedSessions,
        backlogRemaining,
        oldestExpiredAt: expired.oldestExpiredAt,
      },
      {
        status: failedSessions > 0 ? 503 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
