import type { NextRequest } from "next/server";

import { capturePathname, verifyCommittedBlob } from "@/lib/server/blob";
import { commitCaptureSchema } from "@/lib/server/contracts";
import {
  assertSameOrigin,
  safeErrorResponse,
  SignalError,
} from "@/lib/server/errors";
import {
  claimCaptureVerification,
  commitCapture,
  requireOwnedSession,
} from "@/lib/server/repository";
import { readSessionToken } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const identity = readSessionToken(request);
    if (!identity)
      throw new SignalError(
        "session_required",
        "Start an experiment before committing a capture.",
        401,
      );
    const input = commitCaptureSchema.parse(await request.json());
    if (identity.publicId !== input.sessionId)
      throw new SignalError(
        "session_mismatch",
        "The capture does not belong to this session.",
        403,
      );
    const session = await requireOwnedSession(
      identity.publicId,
      identity.sessionHash,
    );
    const allowedPathnames = [
      capturePathname(identity.publicId, input.slot, 1),
      capturePathname(identity.publicId, input.slot, 2),
    ];
    if (!allowedPathnames.includes(input.pathname)) {
      throw new SignalError(
        "invalid_capture_path",
        "The capture path was outside this session.",
        403,
      );
    }
    const verification = await claimCaptureVerification(
      session.id,
      input.slot,
      input.pathname,
      input.bytes,
      input.sha256,
    );
    if (verification.status === "committed")
      return Response.json(
        {
          captureId: verification.captureId,
          slot: input.slot,
          committed: true,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    await verifyCommittedBlob(input.pathname, input.bytes);
    const capture = await commitCapture(session.id, session.expiresAt, input);
    return Response.json(
      { captureId: capture.id, slot: capture.slot, committed: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
