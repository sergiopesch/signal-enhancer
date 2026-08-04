import { beforeEach, describe, expect, it, vi } from "vitest";

const blobMocks = vi.hoisted(() => ({
  issueSignedToken: vi.fn(),
  presignUrl: vi.fn(),
}));
const environmentMocks = vi.hoisted(() => ({
  getEnvironment: vi.fn(),
  requireCleanupEnvironment: vi.fn(),
  requireLiveEnvironment: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@vercel/blob", () => blobMocks);
vi.mock("../env", () => environmentMocks);

import {
  captureGrantValidUntil,
  capturePathname,
  createCapturePutUrl,
  createPrivateDeleteUrl,
  verifyResultArtifact,
} from "../blob";

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("private capture storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    environmentMocks.getEnvironment.mockReturnValue({
      BLOB_READ_WRITE_TOKEN: "test-blob-token",
    });
    blobMocks.issueSignedToken.mockResolvedValue("signed-token");
    blobMocks.presignUrl.mockResolvedValue({
      presignedUrl: "https://blob.example/upload",
    });
  });

  it("bounds every session to two immutable objects per capture slot", () => {
    expect(capturePathname(SESSION_ID, "A", 1)).toBe(
      `sessions/${SESSION_ID}/captures/A-1.wav`,
    );
    expect(capturePathname(SESSION_ID, "A", 2)).toBe(
      `sessions/${SESSION_ID}/captures/A-2.wav`,
    );
    expect(capturePathname(SESSION_ID, "B", 1)).toBe(
      `sessions/${SESSION_ID}/captures/B-1.wav`,
    );
  });

  it("issues an immutable private write capped by the session expiry", async () => {
    const pathname = capturePathname(SESSION_ID, "A", 1);
    const sessionExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const validUntil = captureGrantValidUntil(sessionExpiresAt);

    const grant = await createCapturePutUrl(pathname, validUntil);
    expect(grant).toMatchObject({
      pathname,
      url: "https://blob.example/upload",
    });
    expect(grant.validUntil).toBeLessThanOrEqual(sessionExpiresAt.getTime());
    expect(blobMocks.presignUrl).toHaveBeenCalledWith(
      "signed-token",
      expect.objectContaining({
        access: "private",
        operation: "put",
        pathname,
        allowOverwrite: false,
        addRandomSuffix: false,
      }),
    );
    expect(environmentMocks.requireLiveEnvironment).toHaveBeenCalledOnce();
    expect(environmentMocks.requireCleanupEnvironment).not.toHaveBeenCalled();
  });

  it("uses cleanup-only authority solely for private deletion grants", async () => {
    await createPrivateDeleteUrl(`sessions/${SESSION_ID}/captures/A-1.wav`);

    expect(environmentMocks.requireCleanupEnvironment).toHaveBeenCalledOnce();
    expect(environmentMocks.requireLiveEnvironment).not.toHaveBeenCalled();
    expect(blobMocks.issueSignedToken).toHaveBeenCalledWith(
      expect.objectContaining({ operations: ["delete"] }),
    );
  });

  it("prefers ambient runtime OIDC even if a stale legacy token is present", async () => {
    environmentMocks.getEnvironment.mockReturnValue({
      BLOB_STORE_ID: "store_private",
      BLOB_READ_WRITE_TOKEN: "stale-legacy-token",
    });
    const pathname = capturePathname(SESSION_ID, "B", 1);

    await createCapturePutUrl(pathname, Date.now() + 5 * 60 * 1000);

    expect(blobMocks.issueSignedToken).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: "store_private", pathname }),
    );
    expect(blobMocks.issueSignedToken.mock.calls[0]?.[0]).not.toHaveProperty(
      "oidcToken",
    );
    expect(blobMocks.issueSignedToken.mock.calls[0]?.[0]).not.toHaveProperty(
      "token",
    );
  });

  it("refuses to mint a write grant as the session expires", async () => {
    expect(() =>
      captureGrantValidUntil(new Date(Date.now() + 10_000)),
    ).toThrowError(
      expect.objectContaining({ code: "session_expiring", status: 409 }),
    );
    expect(blobMocks.issueSignedToken).not.toHaveBeenCalled();
  });

  it("refuses redirects while independently verifying result artifacts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          "Content-Length": "128",
          "Content-Type": "audio/wav",
        },
      }),
    );

    await expect(
      verifyResultArtifact("results/job/enhanced.wav", 128, "audio/wav", 256),
    ).rejects.toMatchObject({ code: "artifact_verification_failed" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://blob.example/upload",
      expect.objectContaining({ method: "HEAD", redirect: "error" }),
    );
  });
});
