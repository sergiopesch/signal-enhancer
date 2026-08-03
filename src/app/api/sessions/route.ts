import { unstable_checkRateLimit } from "@vercel/firewall";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { GUIDED_READING_VERSION } from "@/lib/audio/reading-passage";
import { createSessionSchema } from "@/lib/server/contracts";
import { getEnvironment } from "@/lib/server/env";
import {
  assertSameOrigin,
  safeErrorResponse,
  SignalError,
} from "@/lib/server/errors";
import { createExperimentSession } from "@/lib/server/repository";
import {
  attachSessionCookie,
  hashNetwork,
  hashSession,
  issueSessionToken,
} from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const environment = getEnvironment();
    if (environment.SIGNAL_MODE === "live") {
      const firewall = await unstable_checkRateLimit("signal-session-start");
      if (firewall.rateLimited)
        throw new SignalError(
          "session_rate_limited",
          "Please wait before starting another experiment.",
          429,
        );
      if (firewall.error)
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "firewall_check_unavailable",
          }),
        );
    }

    const input = createSessionSchema.parse(
      await request.json().catch(() => ({})),
    );
    const publicId = randomUUID();
    const token = issueSessionToken(publicId);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    if (environment.SIGNAL_MODE === "live") {
      await createExperimentSession({
        publicId,
        sessionHash: hashSession(token),
        networkHash: hashNetwork(request),
        referenceId: input.referenceId,
        referenceRevision: GUIDED_READING_VERSION,
        ...(input.devices ? { deviceMetadata: input.devices } : {}),
      });
    }

    const response = NextResponse.json(
      {
        sessionId: publicId,
        referenceId: input.referenceId,
        referenceRevision: GUIDED_READING_VERSION,
        mode: environment.SIGNAL_MODE,
        expiresAt: expiresAt.toISOString(),
        uploadEnabled: environment.SIGNAL_MODE === "live",
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
    attachSessionCookie(response, token);
    return response;
  } catch (error) {
    return safeErrorResponse(error);
  }
}
