import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const firewallMocks = vi.hoisted(() => ({
  unstable_checkRateLimit: vi.fn(),
}));
const workflowMocks = vi.hoisted(() => ({ getRun: vi.fn(), start: vi.fn() }));
const workflowRuntimeMocks = vi.hoisted(() => ({ getWorld: vi.fn() }));
const repositoryMocks = vi.hoisted(() => ({
  attachWorkflowRun: vi.fn(),
  getSessionCaptures: vi.fn(),
  releaseUpgradeJobReservation: vi.fn(),
  requireOwnedSession: vi.fn(),
  reserveUpgradeJob: vi.fn(),
}));
const sessionMocks = vi.hoisted(() => ({
  hashNetwork: vi.fn(),
  readSessionToken: vi.fn(),
}));

vi.mock("@vercel/firewall", () => firewallMocks);
vi.mock("workflow/api", () => workflowMocks);
vi.mock("workflow/runtime", () => workflowRuntimeMocks);
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
    body: JSON.stringify({ sessionId: PUBLIC_ID, upgradeId: JOB_ID }),
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
    repositoryMocks.releaseUpgradeJobReservation.mockResolvedValue(true);
    workflowRuntimeMocks.getWorld.mockReturnValue({
      queue: vi.fn().mockResolvedValue({ messageId: "message-1" }),
    });
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
      workflowRunId: null,
      state: "queued",
      created: true,
    });
    const cancel = vi.fn();
    workflowMocks.start.mockResolvedValue({ runId: "run-1", cancel });
    repositoryMocks.attachWorkflowRun.mockResolvedValue({ state: "queued" });

    const response = await POST(request());

    expect(response.status).toBe(202);
    expect(repositoryMocks.reserveUpgradeJob).toHaveBeenCalledWith(
      INTERNAL_ID,
      JOB_ID,
      "session-hash",
      "network-hash",
      expiresAt,
    );
    expect(workflowMocks.start).toHaveBeenCalledOnce();
    expect(repositoryMocks.attachWorkflowRun).toHaveBeenCalledWith(
      JOB_ID,
      "run-1",
    );
    expect(cancel).not.toHaveBeenCalled();
    expect(repositoryMocks.releaseUpgradeJobReservation).not.toHaveBeenCalled();
  });

  it("reconciles the same client upgrade ID without starting a second workflow", async () => {
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
      workflowRunId: "run-existing",
      state: "warming",
      created: false,
    });

    const response = await POST(request());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      upgradeId: JOB_ID,
      runId: "run-existing",
      state: "warming",
    });
    expect(workflowMocks.start).not.toHaveBeenCalled();
    expect(repositoryMocks.attachWorkflowRun).not.toHaveBeenCalled();
  });

  it("does not resurrect a cancelled client upgrade ID", async () => {
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
      workflowRunId: null,
      state: "cancelled",
      created: false,
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "upgrade_cancelled" },
    });
    expect(workflowMocks.start).not.toHaveBeenCalled();
    expect(repositoryMocks.attachWorkflowRun).not.toHaveBeenCalled();
  });

  it("releases the job and quota ledger when workflow start fails", async () => {
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
      workflowRunId: null,
      state: "queued",
      created: true,
    });
    workflowMocks.start.mockRejectedValue(new Error("workflow unavailable"));

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(repositoryMocks.releaseUpgradeJobReservation).toHaveBeenCalledWith(
      JOB_ID,
      "session-hash",
      null,
    );
    expect(repositoryMocks.attachWorkflowRun).not.toHaveBeenCalled();
  });

  it("cancels an unattached run before releasing its reservation", async () => {
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
      workflowRunId: null,
      state: "queued",
      created: true,
    });
    const cancel = vi.fn().mockResolvedValue(undefined);
    workflowMocks.start.mockResolvedValue({ runId: "run-unattached", cancel });
    repositoryMocks.attachWorkflowRun.mockRejectedValue(
      new Error("database unavailable"),
    );

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(repositoryMocks.attachWorkflowRun).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(repositoryMocks.releaseUpgradeJobReservation).toHaveBeenCalledWith(
      JOB_ID,
      "session-hash",
      "run-unattached",
    );
  });

  it("captures and cancels a server-enqueued run when start throws before returning it", async () => {
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
      workflowRunId: null,
      state: "queued",
      created: true,
    });
    repositoryMocks.attachWorkflowRun.mockResolvedValue({ state: "queued" });
    const queue = vi.fn().mockResolvedValue({ messageId: "accepted" });
    workflowRuntimeMocks.getWorld.mockReturnValue({ queue });
    workflowMocks.start.mockImplementation(
      async (_workflow, _args, options) => {
        await options.world.queue(
          "workflow-queue",
          { runId: "wrun_server_accepted" },
          {},
        );
        throw new Error("run creation acknowledgement failed");
      },
    );
    const cancel = vi.fn().mockResolvedValue(undefined);
    workflowMocks.getRun.mockReturnValue({ cancel });

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(repositoryMocks.attachWorkflowRun).toHaveBeenCalledWith(
      JOB_ID,
      "wrun_server_accepted",
    );
    expect(queue).toHaveBeenCalledOnce();
    expect(workflowMocks.getRun).toHaveBeenCalledWith("wrun_server_accepted");
    expect(cancel).toHaveBeenCalledOnce();
    expect(repositoryMocks.releaseUpgradeJobReservation).toHaveBeenCalledWith(
      JOB_ID,
      "session-hash",
      "wrun_server_accepted",
    );
  });

  it("retains an attached reservation when an accepted run cannot be cancelled", async () => {
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
      workflowRunId: null,
      state: "queued",
      created: true,
    });
    repositoryMocks.attachWorkflowRun.mockResolvedValue({ state: "queued" });
    const queue = vi.fn().mockResolvedValue({ messageId: "accepted" });
    workflowRuntimeMocks.getWorld.mockReturnValue({ queue });
    workflowMocks.start.mockImplementation(
      async (_workflow, _args, options) => {
        await options.world.queue(
          "workflow-queue",
          { runId: "wrun_cancel_uncertain" },
          {},
        );
        throw new Error("run creation acknowledgement failed");
      },
    );
    const cancel = vi.fn().mockRejectedValue(new Error("cancel unavailable"));
    workflowMocks.getRun.mockReturnValue({ cancel });

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(repositoryMocks.attachWorkflowRun).toHaveBeenCalledWith(
      JOB_ID,
      "wrun_cancel_uncertain",
    );
    expect(queue).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(repositoryMocks.releaseUpgradeJobReservation).not.toHaveBeenCalled();
  });

  it("retains an attached reservation when queue acceptance is uncertain", async () => {
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
      workflowRunId: null,
      state: "queued",
      created: true,
    });
    repositoryMocks.attachWorkflowRun.mockResolvedValue({ state: "queued" });
    const queue = vi
      .fn()
      .mockRejectedValue(new Error("queue acknowledgement unavailable"));
    workflowRuntimeMocks.getWorld.mockReturnValue({ queue });
    workflowMocks.start.mockImplementation(
      async (_workflow, _args, options) => {
        await options.world.queue(
          "workflow-queue",
          { runId: "wrun_queue_uncertain" },
          {},
        );
        throw new Error("unreachable");
      },
    );
    const cancel = vi.fn().mockRejectedValue(new Error("cancel unavailable"));
    workflowMocks.getRun.mockReturnValue({ cancel });

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(repositoryMocks.attachWorkflowRun).toHaveBeenCalledWith(
      JOB_ID,
      "wrun_queue_uncertain",
    );
    expect(queue).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(repositoryMocks.releaseUpgradeJobReservation).not.toHaveBeenCalled();
  });

  it.each([
    { label: "missing", payload: {} },
    { label: "non-string", payload: { runId: 123 } },
  ])(
    "fails closed when the SDK queue run ID is $label",
    async ({ payload }) => {
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
        workflowRunId: null,
        state: "queued",
        created: true,
      });
      const queue = vi
        .fn()
        .mockResolvedValue({ messageId: "must-not-enqueue" });
      workflowRuntimeMocks.getWorld.mockReturnValue({ queue });
      workflowMocks.start.mockImplementation(
        async (_workflow, _args, options) => {
          await options.world.queue("workflow-queue", payload, {});
          throw new Error("unreachable");
        },
      );

      const response = await POST(request());

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "workflow_run_id_missing" },
      });
      expect(queue).not.toHaveBeenCalled();
      expect(repositoryMocks.attachWorkflowRun).not.toHaveBeenCalled();
      expect(workflowMocks.getRun).not.toHaveBeenCalled();
      expect(repositoryMocks.releaseUpgradeJobReservation).toHaveBeenCalledWith(
        JOB_ID,
        "session-hash",
        null,
      );
    },
  );

  it("does not enqueue when attachment remains uncertain", async () => {
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
      workflowRunId: null,
      state: "queued",
      created: true,
    });
    repositoryMocks.attachWorkflowRun.mockRejectedValue(
      new Error("attachment acknowledgement unavailable"),
    );
    const queue = vi.fn().mockResolvedValue({ messageId: "must-not-enqueue" });
    workflowRuntimeMocks.getWorld.mockReturnValue({ queue });
    workflowMocks.start.mockImplementation(
      async (_workflow, _args, options) => {
        await options.world.queue(
          "workflow-queue",
          { runId: "wrun_not_enqueued" },
          {},
        );
        throw new Error("unreachable");
      },
    );
    const cancel = vi
      .fn()
      .mockRejectedValue(new Error("run record not materialized"));
    workflowMocks.getRun.mockReturnValue({ cancel });

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(repositoryMocks.attachWorkflowRun).toHaveBeenCalledTimes(2);
    expect(queue).not.toHaveBeenCalled();
    expect(workflowMocks.getRun).toHaveBeenCalledWith("wrun_not_enqueued");
    expect(cancel).toHaveBeenCalledOnce();
    expect(repositoryMocks.releaseUpgradeJobReservation).toHaveBeenCalledWith(
      JOB_ID,
      "session-hash",
      "wrun_not_enqueued",
    );
  });
});
