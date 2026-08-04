import { afterEach, describe, expect, it, vi } from "vitest";

import { requestRemoteUpgradeCancellation } from "../upgrade-cancellation";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("remote upgrade cancellation", () => {
  it("retries when DELETE arrives before the client-known job is reserved", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ state: "cancelled" }));
    vi.stubGlobal("fetch", fetchMock);

    const cancellation = requestRemoteUpgradeCancellation(
      "123e4567-e89b-42d3-a456-426614174000",
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    await cancellation;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/upgrades/123e4567-e89b-42d3-a456-426614174000",
      { method: "DELETE", keepalive: true },
    );
  });

  it("deduplicates concurrent cancellation requests for one job", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ state: "cancelled" }));
    vi.stubGlobal("fetch", fetchMock);

    const first = requestRemoteUpgradeCancellation(
      "123e4567-e89b-42d3-a456-426614174001",
    );
    const second = requestRemoteUpgradeCancellation(
      "123e4567-e89b-42d3-a456-426614174001",
    );

    expect(second).toBe(first);
    await first;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rechecks after a late start response meets the last pre-reservation DELETE", async () => {
    vi.useFakeTimers();
    let resolveLast404!: (response: Response) => void;
    const last404 = new Promise<Response>((resolve) => {
      resolveLast404 = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockReturnValueOnce(last404)
      .mockResolvedValueOnce(Response.json({ state: "cancelled" }));
    vi.stubGlobal("fetch", fetchMock);
    const upgradeId = "123e4567-e89b-42d3-a456-426614174002";

    const first = requestRemoteUpgradeCancellation(upgradeId);
    await vi.advanceTimersByTimeAsync(10_500);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const late = requestRemoteUpgradeCancellation(upgradeId);
    expect(late).toBe(first);
    resolveLast404(new Response(null, { status: 404 }));
    await first;

    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
