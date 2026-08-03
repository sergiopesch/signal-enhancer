import { unstable_checkRateLimit } from "@vercel/firewall";
import type { NextRequest } from "next/server";
import { start } from "workflow/api";

import {
  GUIDED_READING_ID,
  GUIDED_READING_VERSION,
} from "@/lib/audio/reading-passage";
import { startUpgradeSchema } from "@/lib/server/contracts";
import { requireLiveEnvironment } from "@/lib/server/env";
import {
  assertSameOrigin,
  safeErrorResponse,
  SignalError,
} from "@/lib/server/errors";
import {
  attachWorkflowRun,
  getSessionCaptures,
  requireOwnedSession,
  reserveUpgradeJob,
} from "@/lib/server/repository";
import { hashNetwork, readSessionToken } from "@/lib/server/session";
import { upgradeSignalWorkflow } from "@/lib/workflows/upgrade-signal";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    requireLiveEnvironment();
    const identity = readSessionToken(request);
    if (!identity)
      throw new SignalError(
        "session_required",
        "Start an experiment before upgrading a signal.",
        401,
      );
    const input = startUpgradeSchema.parse(await request.json());
    if (identity.publicId !== input.sessionId)
      throw new SignalError(
        "session_mismatch",
        "The upgrade does not belong to this session.",
        403,
      );
    const firewall = await unstable_checkRateLimit("signal-upgrade-start", {
      rateLimitKey: identity.sessionHash,
    });
    if (firewall.rateLimited)
      throw new SignalError(
        "upgrade_rate_limited",
        "Please wait before trying the upgrade again.",
        429,
      );
    const session = await requireOwnedSession(
      identity.publicId,
      identity.sessionHash,
    );
    if (
      session.referenceId !== GUIDED_READING_ID ||
      session.referenceRevision !== GUIDED_READING_VERSION
    ) {
      throw new SignalError(
        "unsupported_capture_protocol",
        "This experiment uses an earlier capture protocol and cannot be upgraded by the current engine.",
        409,
      );
    }
    const captureRows = await getSessionCaptures(session.id);
    if (
      !captureRows.some((capture) => capture.slot === "A") ||
      !captureRows.some((capture) => capture.slot === "B")
    ) {
      throw new SignalError(
        "captures_incomplete",
        "Both Input A and Input B must be committed first.",
        409,
      );
    }
    const job = await reserveUpgradeJob(
      session.id,
      identity.sessionHash,
      hashNetwork(request),
      session.expiresAt,
    );
    const run = await start(upgradeSignalWorkflow, [job.id]);
    await attachWorkflowRun(job.id, run.runId);
    return Response.json(
      {
        upgradeId: job.publicId,
        runId: run.runId,
        state: "queued",
        eventsUrl: `/api/upgrades/${job.publicId}/events`,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
