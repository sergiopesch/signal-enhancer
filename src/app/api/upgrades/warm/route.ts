import { after } from "next/server";
import type { NextRequest } from "next/server";

import { startUpgradeSchema } from "@/lib/server/contracts";
import { getEnvironment } from "@/lib/server/env";
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
    const environment = getEnvironment();
    if (environment.SIGNAL_MODE !== "live")
      return Response.json({ accepted: false, mode: "demo" });
    const identity = readSessionToken(request);
    if (!identity)
      throw new SignalError(
        "session_required",
        "Start an experiment before warming the upgrade engine.",
        401,
      );
    const input = startUpgradeSchema.parse(await request.json());
    if (identity.publicId !== input.sessionId)
      throw new SignalError(
        "session_mismatch",
        "This warm request does not belong to the session.",
        403,
      );
    await requireOwnedSession(identity.publicId, identity.sessionHash);

    after(async () => {
      try {
        await fetch(
          `${environment.HF_ENDPOINT_URL?.replace(/\/$/, "")}/health`,
          {
            headers: {
              Authorization: `Bearer ${environment.HF_ENDPOINT_TOKEN}`,
              "X-Signal-Endpoint-Secret":
                environment.HF_ENDPOINT_SHARED_SECRET ?? "",
              "X-Scale-Up-Timeout": "1",
            },
            cache: "no-store",
            signal: AbortSignal.timeout(3_000),
          },
        );
      } catch {
        // Prewarming is best effort; the durable workflow owns correctness and retries.
      }
    });
    return Response.json(
      { accepted: true },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
