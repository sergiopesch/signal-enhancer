import type { NextRequest } from "next/server";
import { getRun } from "workflow/api";

import { createPrivateReadUrl } from "@/lib/server/blob";
import {
  assertSameOrigin,
  safeErrorResponse,
  SignalError,
} from "@/lib/server/errors";
import {
  getOwnedJobBySessionHash,
  listJobEvents,
  updateJobState,
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
  return getOwnedJobBySessionHash(runId, identity.sessionHash);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await context.params;
    const job = await authorize(request, runId);
    const events = await listJobEvents(job.id);
    const result =
      job.state === "completed" && job.resultPathname
        ? await createPrivateReadUrl(job.resultPathname)
        : null;
    return Response.json(
      {
        upgradeId: job.publicId,
        state: job.state,
        events,
        resultUrl: result?.url ?? null,
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
    const job = await authorize(request, runId);
    if (job.workflowRunId) await getRun(job.workflowRunId).cancel();
    await updateJobState(job.id, "cancelled", { completedAt: new Date() });
    return Response.json(
      { state: "cancelled" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
