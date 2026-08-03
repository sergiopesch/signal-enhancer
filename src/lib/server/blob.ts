import "server-only";

import { issueSignedToken, presignUrl } from "@vercel/blob";

import { getEnvironment, requireLiveEnvironment } from "./env";
import { SignalError } from "./errors";

export const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
export const ARTIFACT_WRITE_DRAIN_MS = 15 * 60 * 1000;
const CAPTURE_GRANT_MS = 10 * 60 * 1000;
const RESULT_GRANT_MS = 5 * 60 * 1000;
const MIN_GRANT_MS = 30 * 1000;
const WAV_TYPES = ["audio/wav", "audio/wave", "audio/x-wav"];

function credentialOptions() {
  const environment = getEnvironment();
  if (environment.BLOB_READ_WRITE_TOKEN)
    return { token: environment.BLOB_READ_WRITE_TOKEN };
  if (process.env.VERCEL_OIDC_TOKEN && environment.BLOB_STORE_ID) {
    return {
      oidcToken: process.env.VERCEL_OIDC_TOKEN,
      storeId: environment.BLOB_STORE_ID,
    };
  }
  throw new SignalError(
    "blob_not_configured",
    "Private audio storage has not been configured.",
    503,
  );
}

async function issue(
  pathname: string,
  operations: Array<"get" | "head" | "put" | "delete">,
  validUntil: number,
  constraints?: { contentTypes: string[]; maximumSizeInBytes: number },
) {
  requireLiveEnvironment();
  const uploadConstraints = constraints
    ? {
        allowedContentTypes: constraints.contentTypes,
        maximumSizeInBytes: constraints.maximumSizeInBytes,
      }
    : {};
  return issueSignedToken({
    ...credentialOptions(),
    pathname,
    operations,
    validUntil,
    ...uploadConstraints,
  });
}

export function capturePathname(
  sessionPublicId: string,
  slot: "A" | "B",
  attempt: 1 | 2,
) {
  return `sessions/${sessionPublicId}/captures/${slot}-${attempt}.wav`;
}

function boundedValidUntil(expiresAt: Date, maximumLifetimeMs: number) {
  const validUntil = Math.min(
    Date.now() + maximumLifetimeMs,
    expiresAt.getTime(),
  );
  if (validUntil - Date.now() < MIN_GRANT_MS)
    throw new SignalError(
      "session_expiring",
      "This experiment is too close to expiry to issue another storage grant.",
      409,
    );
  return validUntil;
}

export function captureGrantValidUntil(sessionExpiresAt: Date) {
  return boundedValidUntil(sessionExpiresAt, CAPTURE_GRANT_MS);
}

export async function createCapturePutUrl(
  pathname: string,
  validUntil: number,
) {
  if (
    validUntil - Date.now() < MIN_GRANT_MS ||
    validUntil > Date.now() + CAPTURE_GRANT_MS
  )
    throw new SignalError(
      "invalid_grant_expiry",
      "The private upload grant had an invalid expiry.",
      500,
    );
  const token = await issue(pathname, ["put"], validUntil, {
    contentTypes: WAV_TYPES,
    maximumSizeInBytes: MAX_CAPTURE_BYTES,
  });
  const { presignedUrl } = await presignUrl(token, {
    access: "private",
    operation: "put",
    pathname,
    validUntil,
    allowedContentTypes: WAV_TYPES,
    maximumSizeInBytes: MAX_CAPTURE_BYTES,
    allowOverwrite: false,
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
  });
  return { pathname, url: presignedUrl, validUntil };
}

export async function createPrivateReadUrl(
  pathname: string,
  operation: "get" | "head" = "get",
  expiresAt?: Date,
) {
  const validUntil = expiresAt
    ? boundedValidUntil(expiresAt, RESULT_GRANT_MS)
    : Date.now() + RESULT_GRANT_MS;
  const token = await issue(pathname, [operation], validUntil);
  const { presignedUrl } = await presignUrl(token, {
    access: "private",
    operation,
    pathname,
    validUntil,
    ...(operation === "get" ? { useCache: false } : {}),
  });
  return { pathname, url: presignedUrl, validUntil };
}

export async function createResultPutUrl(
  pathname: string,
  contentType: "audio/wav" | "application/json",
  jobExpiresAt: Date,
) {
  const validUntil = boundedValidUntil(jobExpiresAt, RESULT_GRANT_MS);
  const token = await issue(pathname, ["put"], validUntil, {
    contentTypes: [contentType],
    maximumSizeInBytes: MAX_CAPTURE_BYTES,
  });
  const { presignedUrl } = await presignUrl(token, {
    access: "private",
    operation: "put",
    pathname,
    validUntil,
    allowedContentTypes: [contentType],
    maximumSizeInBytes: MAX_CAPTURE_BYTES,
    allowOverwrite: false,
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
  });
  return { pathname, url: presignedUrl, validUntil };
}

export async function createPrivateDeleteUrl(pathname: string) {
  const validUntil = Date.now() + 5 * 60 * 1000;
  const token = await issue(pathname, ["delete"], validUntil);
  const { presignedUrl } = await presignUrl(token, {
    access: "private",
    operation: "delete",
    pathname,
    validUntil,
  });
  return { pathname, url: presignedUrl, validUntil };
}

export async function verifyCommittedBlob(
  pathname: string,
  expectedBytes: number,
) {
  const signed = await createPrivateReadUrl(pathname, "head");
  const response = await fetch(signed.url, {
    method: "HEAD",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new SignalError(
      "capture_missing",
      "The uploaded capture could not be verified.",
      422,
    );
  const actualBytes = Number(response.headers.get("content-length"));
  const contentType = response.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (
    !Number.isFinite(actualBytes) ||
    actualBytes !== expectedBytes ||
    actualBytes > MAX_CAPTURE_BYTES
  ) {
    throw new SignalError(
      "capture_size_mismatch",
      "The uploaded capture size did not match the recorded file.",
      422,
    );
  }
  if (contentType && !WAV_TYPES.includes(contentType)) {
    throw new SignalError(
      "capture_type_mismatch",
      "Only WAV captures are accepted.",
      415,
    );
  }
  return { bytes: actualBytes, contentType: contentType ?? "audio/wav" };
}
