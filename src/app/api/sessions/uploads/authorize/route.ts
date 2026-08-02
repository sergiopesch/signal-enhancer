import type { NextRequest } from "next/server";

import { capturePathname, createCapturePutUrl } from "@/lib/server/blob";
import { uploadAuthorizationSchema } from "@/lib/server/contracts";
import {
  assertSameOrigin,
  safeErrorResponse,
  SignalError,
} from "@/lib/server/errors";
import { requireOwnedSession } from "@/lib/server/repository";
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
    await requireOwnedSession(identity.publicId, identity.sessionHash);
    const pathname = capturePathname(identity.publicId, input.slot);
    const upload = await createCapturePutUrl(pathname);
    return Response.json(
      {
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
