import "server-only";

import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { NextRequest, NextResponse } from "next/server";

import { getEnvironment } from "./env";

export const SESSION_COOKIE = "signal_session";
const SESSION_TTL_SECONDS = 24 * 60 * 60;

function signingSecret() {
  const environment = getEnvironment();
  if (environment.SIGNAL_MODE === "live") {
    if (
      !environment.SESSION_SIGNING_SECRET ||
      environment.SESSION_SIGNING_SECRET.length < 32
    ) {
      throw new Error(
        "SESSION_SIGNING_SECRET must contain at least 32 characters in live mode.",
      );
    }
    return environment.SESSION_SIGNING_SECRET;
  }
  return "signal-enhancer-demo-session-secret-not-for-production";
}

function signature(value: string) {
  return createHmac("sha256", signingSecret())
    .update(value)
    .digest("base64url");
}

export function issueSessionToken(publicId = randomUUID()) {
  return `${publicId}.${signature(publicId)}`;
}

export function readSessionToken(request: NextRequest | Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const raw = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!raw) return null;
  const [publicId, supplied] = decodeURIComponent(raw).split(".");
  if (!publicId || !supplied) return null;
  const expected = signature(publicId);
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  )
    return null;
  return { publicId, token: raw, sessionHash: hashSession(raw) };
}

export function attachSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function hashSession(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function hashNetwork(request: Request) {
  const environment = getEnvironment();
  const secret =
    environment.NETWORK_HASH_SECRET ?? "signal-enhancer-demo-network-secret";
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  return createHmac("sha256", secret).update(address).digest("hex");
}
