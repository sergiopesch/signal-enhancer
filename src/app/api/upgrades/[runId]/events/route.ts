import type { NextRequest } from "next/server";
import { getRun } from "workflow/api";

import { safeErrorResponse, SignalError } from "@/lib/server/errors";
import { getOwnedJobBySessionHash } from "@/lib/server/repository";
import { readSessionToken } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    const identity = readSessionToken(request);
    if (!identity)
      throw new SignalError(
        "session_required",
        "This progress stream requires its experiment session.",
        401,
      );
    const { runId } = await context.params;
    const job = await getOwnedJobBySessionHash(runId, identity.sessionHash);
    if (!job.workflowRunId)
      throw new SignalError(
        "workflow_not_ready",
        "The durable run is still being attached.",
        409,
      );
    const startIndexRaw = new URL(request.url).searchParams.get("startIndex");
    const startIndex =
      startIndexRaw === null
        ? undefined
        : Math.max(0, Number.parseInt(startIndexRaw, 10) || 0);
    const run = getRun(job.workflowRunId);
    if (!(await run.exists))
      throw new SignalError(
        "workflow_not_found",
        "The durable run could not be found.",
        404,
      );
    const stream = run.getReadable<Uint8Array>({
      ...(startIndex === undefined ? {} : { startIndex }),
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
