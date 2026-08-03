import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const blobMocks = vi.hoisted(() => ({
  captureGrantValidUntil: vi.fn(),
  capturePathname: vi.fn(
    (publicId: string, slot: "A" | "B", attempt: 1 | 2) =>
      `sessions/${publicId}/captures/${slot}-${attempt}.wav`,
  ),
  createCapturePutUrl: vi.fn(),
  verifyCommittedBlob: vi.fn(),
}));
const repositoryMocks = vi.hoisted(() => ({
  claimCaptureVerification: vi.fn(),
  commitCapture: vi.fn(),
  releaseCaptureUploadGrant: vi.fn(),
  requireOwnedSession: vi.fn(),
  reserveCaptureUploadGrant: vi.fn(),
}));
const sessionMocks = vi.hoisted(() => ({
  readSessionToken: vi.fn(),
}));

vi.mock("@/lib/server/blob", () => blobMocks);
vi.mock("@/lib/server/repository", () => repositoryMocks);
vi.mock("@/lib/server/session", () => sessionMocks);
vi.mock("@/lib/server/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/errors")>();
  return { ...actual, assertSameOrigin: vi.fn() };
});

import { POST as authorizeUpload } from "../authorize/route";
import { POST as commitUpload } from "../commit/route";
import { SignalError } from "@/lib/server/errors";

const PUBLIC_ID = "123e4567-e89b-42d3-a456-426614174000";
const INTERNAL_ID = "123e4567-e89b-42d3-a456-426614174001";
const CAPTURE_ID = "123e4567-e89b-42d3-a456-426614174002";
const SHA = "a".repeat(64);
const PATHNAME = `sessions/${PUBLIC_ID}/captures/A-1.wav`;

function request(pathname: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("capture upload routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMocks.readSessionToken.mockReturnValue({
      publicId: PUBLIC_ID,
      sessionHash: "session-hash",
    });
    repositoryMocks.requireOwnedSession.mockResolvedValue({
      id: INTERNAL_ID,
      publicId: PUBLIC_ID,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    blobMocks.captureGrantValidUntil.mockReturnValue(
      Date.now() + 10 * 60 * 1000,
    );
  });

  it("releases a reservation when signing fails before a response", async () => {
    repositoryMocks.reserveCaptureUploadGrant.mockResolvedValue({
      status: "grant",
      attempt: 1,
      pathname: PATHNAME,
      authorizationCount: 1,
    });
    blobMocks.createCapturePutUrl.mockRejectedValue(
      new Error("signing unavailable"),
    );

    const response = await authorizeUpload(
      request("/api/sessions/uploads/authorize", {
        sessionId: PUBLIC_ID,
        slot: "A",
        bytes: 1_920_044,
        sha256: SHA,
      }),
    );

    expect(response.status).toBe(500);
    expect(repositoryMocks.releaseCaptureUploadGrant).toHaveBeenCalledWith(
      INTERNAL_ID,
      "A",
      1,
      1,
    );
  });

  it("returns a matching committed slot without issuing another Blob URL", async () => {
    repositoryMocks.reserveCaptureUploadGrant.mockResolvedValue({
      status: "committed",
      captureId: CAPTURE_ID,
      pathname: PATHNAME,
    });

    const response = await authorizeUpload(
      request("/api/sessions/uploads/authorize", {
        sessionId: PUBLIC_ID,
        slot: "A",
        bytes: 1_920_044,
        sha256: SHA,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      committed: true,
      captureId: CAPTURE_ID,
    });
    expect(blobMocks.createCapturePutUrl).not.toHaveBeenCalled();
  });

  it("rejects an unissued commit before any billable Blob verification", async () => {
    repositoryMocks.claimCaptureVerification.mockRejectedValue(
      new SignalError("capture_verification_limit", "No issued grant.", 409),
    );

    const response = await commitUpload(
      request("/api/sessions/uploads/commit", {
        sessionId: PUBLIC_ID,
        slot: "A",
        pathname: PATHNAME,
        bytes: 1_920_044,
        sha256: SHA,
        durationMs: 20_000,
        sampleRate: 48_000,
        channels: 1,
        codec: "pcm_s16le",
        metrics: {},
      }),
    );

    expect(response.status).toBe(409);
    expect(blobMocks.verifyCommittedBlob).not.toHaveBeenCalled();
    expect(repositoryMocks.commitCapture).not.toHaveBeenCalled();
  });

  it("skips Blob HEAD for an idempotent committed receipt", async () => {
    repositoryMocks.claimCaptureVerification.mockResolvedValue({
      status: "committed",
      captureId: CAPTURE_ID,
    });

    const response = await commitUpload(
      request("/api/sessions/uploads/commit", {
        sessionId: PUBLIC_ID,
        slot: "A",
        pathname: PATHNAME,
        bytes: 1_920_044,
        sha256: SHA,
        durationMs: 20_000,
        sampleRate: 48_000,
        channels: 1,
        codec: "pcm_s16le",
        metrics: {},
      }),
    );

    expect(response.status).toBe(200);
    expect(blobMocks.verifyCommittedBlob).not.toHaveBeenCalled();
    expect(repositoryMocks.commitCapture).not.toHaveBeenCalled();
  });

  it("checks the issued grant before HEAD and commits only after HEAD succeeds", async () => {
    repositoryMocks.claimCaptureVerification.mockResolvedValue({
      status: "verify",
      captureId: null,
    });
    blobMocks.verifyCommittedBlob.mockResolvedValue({
      bytes: 1_920_044,
      contentType: "audio/wav",
    });
    repositoryMocks.commitCapture.mockResolvedValue({
      id: CAPTURE_ID,
      slot: "A",
    });

    const response = await commitUpload(
      request("/api/sessions/uploads/commit", {
        sessionId: PUBLIC_ID,
        slot: "A",
        pathname: PATHNAME,
        bytes: 1_920_044,
        sha256: SHA,
        durationMs: 20_000,
        sampleRate: 48_000,
        channels: 1,
        codec: "pcm_s16le",
        metrics: {},
      }),
    );

    expect(response.status).toBe(200);
    expect(
      repositoryMocks.claimCaptureVerification.mock.invocationCallOrder[0],
    ).toBeLessThan(
      blobMocks.verifyCommittedBlob.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(
      blobMocks.verifyCommittedBlob.mock.invocationCallOrder[0],
    ).toBeLessThan(
      repositoryMocks.commitCapture.mock.invocationCallOrder[0] ?? Infinity,
    );
  });
});
