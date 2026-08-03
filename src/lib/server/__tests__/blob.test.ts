import { beforeEach, describe, expect, it, vi } from "vitest";

const blobMocks = vi.hoisted(() => ({
  issueSignedToken: vi.fn(),
  presignUrl: vi.fn(),
}));
const environmentMocks = vi.hoisted(() => ({
  getEnvironment: vi.fn(),
  requireLiveEnvironment: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@vercel/blob", () => blobMocks);
vi.mock("../env", () => environmentMocks);

import {
  captureGrantValidUntil,
  capturePathname,
  createCapturePutUrl,
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
  });

  it("refuses to mint a write grant as the session expires", async () => {
    expect(() =>
      captureGrantValidUntil(new Date(Date.now() + 10_000)),
    ).toThrowError(
      expect.objectContaining({ code: "session_expiring", status: 409 }),
    );
    expect(blobMocks.issueSignedToken).not.toHaveBeenCalled();
  });
});
