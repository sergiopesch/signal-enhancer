import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workflowMocks = vi.hoisted(() => ({ getRun: vi.fn() }));
const repositoryMocks = vi.hoisted(() => ({
  cancelUnattachedUpgradeJobReservation: vi.fn(),
  getJobById: vi.fn(),
  getOwnedJobBySessionHash: vi.fn(),
  listJobEvents: vi.fn(),
  updateJobStateIfCurrent: vi.fn(),
}));
const sessionMocks = vi.hoisted(() => ({ readSessionToken: vi.fn() }));

vi.mock("workflow/api", () => workflowMocks);
vi.mock("@/lib/server/blob", () => ({ createPrivateReadUrl: vi.fn() }));
vi.mock("@/lib/server/env", () => ({ requireLiveEnvironment: vi.fn() }));
vi.mock("@/lib/server/repository", () => repositoryMocks);
vi.mock("@/lib/server/session", () => sessionMocks);
vi.mock("@/lib/server/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/errors")>();
  return { ...actual, assertSameOrigin: vi.fn() };
});

import { DELETE } from "../route";

const RUN_ID = "123e4567-e89b-42d3-a456-426614174000";
const JOB_ID = "123e4567-e89b-42d3-a456-426614174001";

function request() {
  return new NextRequest(`http://localhost/api/upgrades/${RUN_ID}`, {
    method: "DELETE",
  });
}

describe("upgrade cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMocks.readSessionToken.mockReturnValue({
      publicId: "session-public-id",
      sessionHash: "session-hash",
    });
    repositoryMocks.getOwnedJobBySessionHash.mockResolvedValue({
      id: JOB_ID,
      state: "processing",
      workflowRunId: "workflow-run-id",
    });
  });

  it("re-reads terminal state when cancellation loses to completion", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    workflowMocks.getRun.mockReturnValue({ cancel });
    repositoryMocks.updateJobStateIfCurrent.mockResolvedValue(null);
    repositoryMocks.getJobById.mockResolvedValue({
      id: JOB_ID,
      state: "completed",
    });

    const response = await DELETE(request(), {
      params: Promise.resolve({ runId: RUN_ID }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "completed" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("releases an unattached queued reservation so cancellation does not consume the session", async () => {
    repositoryMocks.getOwnedJobBySessionHash.mockResolvedValue({
      id: JOB_ID,
      sessionId: "123e4567-e89b-42d3-a456-426614174002",
      publicId: RUN_ID,
      state: "queued",
      workflowRunId: null,
      expiresAt: new Date("2026-08-05T12:00:00.000Z"),
    });
    repositoryMocks.cancelUnattachedUpgradeJobReservation.mockResolvedValue(
      true,
    );

    const response = await DELETE(request(), {
      params: Promise.resolve({ runId: RUN_ID }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "cancelled" });
    expect(
      repositoryMocks.cancelUnattachedUpgradeJobReservation,
    ).toHaveBeenCalledWith(
      {
        sessionId: "123e4567-e89b-42d3-a456-426614174002",
        publicId: RUN_ID,
        expiresAt: new Date("2026-08-05T12:00:00.000Z"),
      },
      "session-hash",
    );
    expect(repositoryMocks.updateJobStateIfCurrent).not.toHaveBeenCalled();
    expect(workflowMocks.getRun).not.toHaveBeenCalled();
  });

  it("cancels the exact attached run before making the job terminal", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    workflowMocks.getRun.mockReturnValue({ cancel });
    repositoryMocks.updateJobStateIfCurrent.mockResolvedValueOnce({
      id: JOB_ID,
      state: "cancelled",
      workflowRunId: "workflow-run-id",
    });

    const response = await DELETE(request(), {
      params: Promise.resolve({ runId: RUN_ID }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "cancelled" });
    expect(workflowMocks.getRun).toHaveBeenCalledWith("workflow-run-id");
    expect(cancel).toHaveBeenCalledOnce();
    expect(repositoryMocks.updateJobStateIfCurrent).toHaveBeenCalledWith(
      JOB_ID,
      ["queued", "warming", "processing", "storing"],
      "cancelled",
      { completedAt: expect.any(Date) },
    );
  });

  it("keeps an uncertain cancellation active and returns a retryable error", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("cancel unavailable"));
    workflowMocks.getRun.mockReturnValue({ cancel });

    const response = await DELETE(request(), {
      params: Promise.resolve({ runId: RUN_ID }),
    });

    expect(response.status).toBe(500);
    expect(cancel).toHaveBeenCalledOnce();
    expect(repositoryMocks.updateJobStateIfCurrent).not.toHaveBeenCalled();
    expect(repositoryMocks.getJobById).not.toHaveBeenCalled();
  });

  it("retries the exact active run after cancellation uncertainty", async () => {
    const cancel = vi
      .fn()
      .mockRejectedValueOnce(new Error("cancel unavailable"))
      .mockResolvedValueOnce(undefined);
    workflowMocks.getRun.mockReturnValue({ cancel });
    repositoryMocks.updateJobStateIfCurrent.mockResolvedValueOnce({
      id: JOB_ID,
      state: "cancelled",
      workflowRunId: "workflow-run-id",
    });

    const firstResponse = await DELETE(request(), {
      params: Promise.resolve({ runId: RUN_ID }),
    });
    const secondResponse = await DELETE(request(), {
      params: Promise.resolve({ runId: RUN_ID }),
    });

    expect(firstResponse.status).toBe(500);
    expect(secondResponse.status).toBe(200);
    await expect(secondResponse.json()).resolves.toEqual({
      state: "cancelled",
    });
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(repositoryMocks.updateJobStateIfCurrent).toHaveBeenCalledOnce();
  });

  it("cancels an attachment that wins the unattached tombstone race", async () => {
    repositoryMocks.getOwnedJobBySessionHash
      .mockResolvedValueOnce({
        id: JOB_ID,
        sessionId: "123e4567-e89b-42d3-a456-426614174002",
        publicId: RUN_ID,
        state: "queued",
        workflowRunId: null,
        expiresAt: new Date("2026-08-05T12:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: JOB_ID,
        sessionId: "123e4567-e89b-42d3-a456-426614174002",
        publicId: RUN_ID,
        state: "queued",
        workflowRunId: "workflow-run-id",
        expiresAt: new Date("2026-08-05T12:00:00.000Z"),
      });
    repositoryMocks.cancelUnattachedUpgradeJobReservation.mockResolvedValue(
      false,
    );
    const cancel = vi.fn().mockResolvedValue(undefined);
    workflowMocks.getRun.mockReturnValue({ cancel });
    repositoryMocks.updateJobStateIfCurrent.mockResolvedValueOnce({
      id: JOB_ID,
      state: "cancelled",
      workflowRunId: "workflow-run-id",
    });

    const response = await DELETE(request(), {
      params: Promise.resolve({ runId: RUN_ID }),
    });

    expect(response.status).toBe(200);
    expect(cancel).toHaveBeenCalledOnce();
    expect(repositoryMocks.getOwnedJobBySessionHash).toHaveBeenCalledTimes(2);
    expect(repositoryMocks.updateJobStateIfCurrent).toHaveBeenCalledOnce();
  });
});
