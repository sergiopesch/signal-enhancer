import type { NextRequest } from "next/server";

import {
  captureGrantValidUntil,
  capturePathname,
  createCapturePutUrl,
} from "@/lib/server/blob";
import { uploadAuthorizationSchema } from "@/lib/server/contracts";
import {
  assertSameOrigin,
  safeErrorResponse,
  SignalError,
} from "@/lib/server/errors";
import {
  requireOwnedSession,
  releaseCaptureUploadGrant,
  reserveCaptureUploadGrant,
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
        "Start an experiment before uploading a capture.",
        401,
      );
    const input = uploadAuthorizationSchema.parse(await request.json());
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
    const validUntil = captureGrantValidUntil(session.expiresAt);
    const grant = await reserveCaptureUploadGrant(
      session.id,
      identity.publicId,
      input.slot,
      input.bytes,
      input.sha256,
      new Date(validUntil),
    );
    if (grant.status === "committed")
      return Response.json(
        {
          committed: true,
          captureId: grant.captureId,
          pathname: grant.pathname,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    const pathname = capturePathname(
      identity.publicId,
      input.slot,
      grant.attempt,
    );
    if (pathname !== grant.pathname)
      throw new SignalError(
        "capture_grant_mismatch",
        "The private capture grant could not be verified.",
        503,
      );
    let upload: Awaited<ReturnType<typeof createCapturePutUrl>>;
    try {
      upload = await createCapturePutUrl(pathname, validUntil);
    } catch (error) {
      await releaseCaptureUploadGrant(
        session.id,
        input.slot,
        grant.attempt,
        grant.authorizationCount,
      );
      throw error;
    }
    return Response.json(
      {
        committed: false,
        pathname,
        uploadUrl: upload.url,
        method: "PUT",
        headers: { "Content-Type": "audio/wav" },
        expiresAt: new Date(upload.validUntil).toISOString(),
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
