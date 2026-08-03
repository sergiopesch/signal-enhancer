import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const firewallMocks = vi.hoisted(() => ({
  unstable_checkRateLimit: vi.fn(),
}));
const workflowMocks = vi.hoisted(() => ({ start: vi.fn() }));
const repositoryMocks = vi.hoisted(() => ({
  attachWorkflowRun: vi.fn(),
  getSessionCaptures: vi.fn(),
  requireOwnedSession: vi.fn(),
  reserveUpgradeJob: vi.fn(),
}));
const sessionMocks = vi.hoisted(() => ({
  hashNetwork: vi.fn(),
  readSessionToken: vi.fn(),
}));

vi.mock("@vercel/firewall", () => firewallMocks);
vi.mock("workflow/api", () => workflowMocks);
vi.mock("@/lib/server/env", () => ({ requireLiveEnvironment: vi.fn() }));
vi.mock("@/lib/server/repository", () => repositoryMocks);
vi.mock("@/lib/server/session", () => sessionMocks);
vi.mock("@/lib/server/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/errors")>();
  return { ...actual, assertSameOrigin: vi.fn() };
});

import { POST } from "../route";

const PUBLIC_ID = "123e4567-e89b-42d3-a456-426614174000";
const INTERNAL_ID = "123e4567-e89b-42d3-a456-426614174001";
const JOB_ID = "123e4567-e89b-42d3-a456-426614174002";

function request() {
  return new NextRequest("http://localhost/api/upgrades", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: PUBLIC_ID }),
  });
}

describe("upgrade route protocol boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firewallMocks.unstable_checkRateLimit.mockResolvedValue({
      rateLimited: false,
    });
    sessionMocks.readSessionToken.mockReturnValue({
      publicId: PUBLIC_ID,
      sessionHash: "session-hash",
    });
    sessionMocks.hashNetwork.mockReturnValue("network-hash");
  });

  it("rejects a legacy session before capture lookup, quota reservation, or worker start", async () => {
    repositoryMocks.requireOwnedSession.mockResolvedValue({
      id: INTERNAL_ID,
      publicId: PUBLIC_ID,
      referenceId: "diagnostic-speech-v1",
      referenceRevision: "v1",
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unsupported_capture_protocol" },
    });
    expect(repositoryMocks.getSessionCaptures).not.toHaveBeenCalled();
    expect(repositoryMocks.reserveUpgradeJob).not.toHaveBeenCalled();
    expect(workflowMocks.start).not.toHaveBeenCalled();
  });

  it("starts a supported guided-reading session after both captures exist", async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1_000);
    repositoryMocks.requireOwnedSession.mockResolvedValue({
      id: INTERNAL_ID,
      publicId: PUBLIC_ID,
      referenceId: "guided-reading-v1",
      referenceRevision: "1.0.0",
      expiresAt,
    });
    repositoryMocks.getSessionCaptures.mockResolvedValue([
      { slot: "A" },
      { slot: "B" },
    ]);
    repositoryMocks.reserveUpgradeJob.mockResolvedValue({
      id: JOB_ID,
      publicId: JOB_ID,
    });
    workflowMocks.start.mockResolvedValue({ runId: "run-1" });

    const response = await POST(request());

    expect(response.status).toBe(202);
    expect(repositoryMocks.reserveUpgradeJob).toHaveBeenCalledWith(
      INTERNAL_ID,
      "session-hash",
      "network-hash",
      expiresAt,
    );
    expect(workflowMocks.start).toHaveBeenCalledOnce();
    expect(repositoryMocks.attachWorkflowRun).toHaveBeenCalledWith(
      JOB_ID,
      "run-1",
    );
  });
});
