import { unstable_checkRateLimit } from "@vercel/firewall";
import type { NextRequest } from "next/server";
import { getRun, start } from "workflow/api";
import { getWorld } from "workflow/runtime";

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
  releaseUpgradeJobReservation,
  requireOwnedSession,
  reserveUpgradeJob,
} from "@/lib/server/repository";
import { hashNetwork, readSessionToken } from "@/lib/server/session";
import { upgradeSignalWorkflow } from "@/lib/workflows/upgrade-signal";

export const dynamic = "force-dynamic";

function acceptedUpgradeResponse(job: {
  publicId: string;
  workflowRunId: string;
  state: string;
}) {
  return Response.json(
    {
      upgradeId: job.publicId,
      runId: job.workflowRunId,
      state: job.state,
      eventsUrl: `/api/upgrades/${job.publicId}/events`,
    },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}

async function attachStartedWorkflow(jobId: string, workflowRunId: string) {
  try {
    return await attachWorkflowRun(jobId, workflowRunId);
  } catch (firstError) {
    // The first write may have committed even if its acknowledgement was lost.
    // attachWorkflowRun accepts only an empty slot or this exact run, so one
    // immediate reconciliation attempt cannot replace a concurrent workflow.
    try {
      return await attachWorkflowRun(jobId, workflowRunId);
    } catch {
      throw firstError;
    }
  }
}

type WorkflowStartObservation = {
  runId?: string;
  queueState: "not-invoked" | "invoked" | "accepted";
  attachedJob?: Awaited<ReturnType<typeof attachWorkflowRun>>;
};

function createAttachmentFirstWorld(
  jobId: string,
  observation: WorkflowStartObservation,
) {
  const world = getWorld();
  return new Proxy(world, {
    get(target, property) {
      if (property === "queue") {
        return async (...args: Parameters<typeof target.queue>) => {
          const message = args[1] as { runId?: unknown } | undefined;
          if (typeof message?.runId !== "string" || message.runId.length === 0)
            throw new SignalError(
              "workflow_run_id_missing",
              "The durable upgrade run could not be identified before enqueueing.",
              503,
            );
          observation.runId = message.runId;
          // Workflow SDK 4.6 generates the run ID before enqueueing. Persist
          // that coordinate first so an accepted queue message is always
          // cancellable/reconcilable even if start() later loses its reply.
          observation.attachedJob = await attachStartedWorkflow(
            jobId,
            message.runId,
          );
          observation.queueState = "invoked";
          const queued = await target.queue(...args);
          observation.queueState = "accepted";
          return queued;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

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
      input.upgradeId,
      identity.sessionHash,
      hashNetwork(request),
      session.expiresAt,
    );
    if (!job.created) {
      if (job.state === "cancelled")
        throw new SignalError(
          "upgrade_cancelled",
          "This signal upgrade was cancelled and cannot be restarted.",
          409,
        );
      if (!job.workflowRunId)
        throw new SignalError(
          "upgrade_start_in_progress",
          "This upgrade is still being attached. Retry the same upgrade request.",
          503,
        );
      return acceptedUpgradeResponse({
        publicId: job.publicId,
        workflowRunId: job.workflowRunId,
        state: job.state,
      });
    }

    let run: { runId: string; cancel(): Promise<void> } | undefined;
    const startObservation: WorkflowStartObservation = {
      queueState: "not-invoked",
    };
    try {
      run = await start(upgradeSignalWorkflow, [job.id], {
        world: createAttachmentFirstWorld(job.id, startObservation),
      });
      const attached =
        startObservation.attachedJob ??
        (await attachStartedWorkflow(job.id, run.runId));
      return acceptedUpgradeResponse({
        publicId: job.publicId,
        workflowRunId: run.runId,
        state: attached.state,
      });
    } catch (error) {
      // The attachment-first queue wrapper preserves the generated coordinate
      // even if start() throws after queue acceptance. Cancel that exact run
      // before release; if cancellation is uncertain, retain the attached row
      // so the same client ID can reconcile and the DB state guard remains.
      const observedRunId = run?.runId ?? startObservation.runId;
      const potentiallyEnqueued =
        run !== undefined || startObservation.queueState !== "not-invoked";
      let mayRelease = !potentiallyEnqueued;
      if (observedRunId) {
        try {
          await (run ?? getRun(observedRunId)).cancel();
          mayRelease = true;
        } catch {
          // A failed cancellation only blocks release after the real queue was
          // invoked. Before that point the run may have an event record, but it
          // cannot execute; releasing the reservation remains safe.
          mayRelease = !potentiallyEnqueued;
        }
      }
      if (mayRelease) {
        try {
          await releaseUpgradeJobReservation(
            job.id,
            identity.sessionHash,
            observedRunId ?? null,
          );
        } catch {
          // Preserve the start/attachment failure. The client-known upgrade ID
          // remains available for reconciliation or cancellation if cleanup is
          // temporarily unavailable.
        }
      }
      throw error;
    }
  } catch (error) {
    return safeErrorResponse(error);
  }
}
