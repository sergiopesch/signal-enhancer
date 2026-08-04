import type { NextRequest } from "next/server";
import { getRun } from "workflow/api";

import { createPrivateReadUrl } from "@/lib/server/blob";
import {
  assertSameOrigin,
  safeErrorResponse,
  SignalError,
} from "@/lib/server/errors";
import {
  cancelUnattachedUpgradeJobReservation,
  getJobById,
  getOwnedJobBySessionHash,
  listJobEvents,
  updateJobStateIfCurrent,
} from "@/lib/server/repository";
import { readSessionToken } from "@/lib/server/session";

export const dynamic = "force-dynamic";

async function authorize(request: NextRequest, runId: string) {
  const identity = readSessionToken(request);
  if (!identity)
    throw new SignalError(
      "session_required",
      "This upgrade requires its experiment session.",
      401,
    );
  return {
    job: await getOwnedJobBySessionHash(runId, identity.sessionHash),
    identity,
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await context.params;
    const { job } = await authorize(request, runId);
    const events = await listJobEvents(job.id);
    const result =
      job.state === "completed" && job.resultPathname
        ? await createPrivateReadUrl(job.resultPathname, "get", job.expiresAt)
        : null;
    return Response.json(
      {
        upgradeId: job.publicId,
        state: job.state,
        events,
        resultUrl: result?.url ?? null,
        resultSha256: job.state === "completed" ? job.resultSha256 : null,
        routing: job.state === "completed" ? job.routing : null,
        resultMetadata: job.state === "completed" ? job.resultMetadata : null,
        error: job.errorCode
          ? { code: job.errorCode, message: job.errorMessage }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    assertSameOrigin(request);
    const { runId } = await context.params;
    const { job, identity } = await authorize(request, runId);
    let currentJob = job;
    if (job.state === "queued" && !job.workflowRunId) {
      const cancelled = await cancelUnattachedUpgradeJobReservation(
        {
          sessionId: job.sessionId,
          publicId: job.publicId,
          expiresAt: job.expiresAt,
        },
        identity.sessionHash,
      );
      if (cancelled)
        return Response.json(
          { state: "cancelled" },
          { headers: { "Cache-Control": "no-store" } },
        );
      // An attachment or replay can win while cancellation waits for the
      // global reservation lock. Re-read by the stable public coordinate and
      // cancel that exact durable run rather than trusting the stale snapshot.
      currentJob = await getOwnedJobBySessionHash(runId, identity.sessionHash);
    }
    const cancellableStates = [
      "queued",
      "warming",
      "processing",
      "storing",
    ] as const;
    if (
      cancellableStates.includes(
        currentJob.state as (typeof cancellableStates)[number],
      )
    ) {
      if (!currentJob.workflowRunId)
        throw new SignalError(
          "upgrade_cancellation_pending",
          "The upgrade attachment is still settling. Cancellation will be retried.",
          503,
        );
      // Keep the job in its active, capacity-counted state until the workflow
      // control plane acknowledges cancellation. A failed/ambiguous request
      // therefore cannot admit a second GPU job.
      await getRun(currentJob.workflowRunId).cancel();
    }
    const cancelled = await updateJobStateIfCurrent(
      currentJob.id,
      cancellableStates,
      "cancelled",
      { completedAt: new Date() },
    );
    const state = cancelled
      ? "cancelled"
      : (await getJobById(currentJob.id)).state;
    return Response.json(
      { state },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
