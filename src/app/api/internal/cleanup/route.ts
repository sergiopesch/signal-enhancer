import { timingSafeEqual } from "node:crypto";

import { createPrivateDeleteUrl } from "@/lib/server/blob";
import { getEnvironment, requireLiveEnvironment } from "@/lib/server/env";
import { safeErrorResponse, SignalError } from "@/lib/server/errors";
import {
  deleteExpiredSessionRecords,
  listExpiredSessionsForCleanup,
  pruneUsageLedger,
} from "@/lib/server/repository";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function hasValidCronAuthorization(request: Request, secret: string) {
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

async function deletePrivateBlob(pathname: string) {
  const signed = await createPrivateDeleteUrl(pathname);
  const response = await fetch(signed.url, {
    method: "DELETE",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Private artifact deletion failed with status ${response.status}.`,
    );
  }
}

export async function GET(request: Request) {
  try {
    const environment = getEnvironment();
    if (environment.SIGNAL_MODE === "demo") {
      return Response.json(
        { mode: "demo", skipped: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const liveEnvironment = requireLiveEnvironment();
    if (!hasValidCronAuthorization(request, liveEnvironment.CRON_SECRET)) {
      throw new SignalError(
        "cron_unauthorized",
        "This cleanup request is not authorized.",
        401,
      );
    }

    const expired = await listExpiredSessionsForCleanup();
    for (const pathname of expired.pathnames) await deletePrivateBlob(pathname);
    const deletedSessions = await deleteExpiredSessionRecords(
      expired.sessionIds,
    );
    const deletedLedgerRows = await pruneUsageLedger();

    return Response.json(
      {
        deletedArtifacts: expired.pathnames.length,
        deletedSessions,
        deletedLedgerRows,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
