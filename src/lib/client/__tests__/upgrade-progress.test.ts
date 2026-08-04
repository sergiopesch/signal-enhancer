import { describe, expect, it, vi } from "vitest";

import {
  followUpgradeProgress,
  nextUpgradeStreamIndex,
  upgradeReconnectDelay,
  withUpgradeStreamCursor,
} from "@/lib/client/upgrade-progress";

function eventStream(sequence: number, stage: string) {
  return new Response(
    `${JSON.stringify({
      sequence,
      stage,
      detail: `${stage} detail`,
      status: "active",
      timestamp: "2026-08-04T12:00:00.000Z",
    })}\n`,
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
}

describe("durable upgrade progress reconnect", () => {
  it("builds a zero-based Workflow frame cursor independently of event sequences", () => {
    expect(nextUpgradeStreamIndex(0)).toBe(1);
    expect(nextUpgradeStreamIndex(4)).toBe(5);
    expect(withUpgradeStreamCursor("/api/events", 0)).toBe("/api/events");
    expect(withUpgradeStreamCursor("/api/events?source=lab", 3)).toBe(
      "/api/events?source=lab&startIndex=3",
    );
    expect(upgradeReconnectDelay(750, 1)).toBe(750);
    expect(upgradeReconnectDelay(750, 2)).toBe(1_500);
    expect(upgradeReconnectDelay(750, 5)).toBe(12_000);
    expect(upgradeReconnectDelay(750, 20)).toBe(12_000);
  });

  it("reconnects a closed stream from the next event until the job completes", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(eventStream(42, "Receiving capture"))
      .mockResolvedValueOnce(Response.json({ state: "warming" }))
      .mockResolvedValueOnce(eventStream(99, "Inspecting signal"))
      .mockResolvedValueOnce(
        Response.json({
          state: "completed",
          resultUrl: "https://blob.example/enhanced.wav",
          resultSha256: "a".repeat(64),
        }),
      );
    const onEvent = vi.fn();

    const status = await followUpgradeProgress({
      eventsUrl: "/api/upgrades/job/events",
      statusUrl: "/api/upgrades/job",
      signal: new AbortController().signal,
      onEvent,
      fetcher,
      reconnectDelayMs: 0,
    });

    expect(status.state).toBe("completed");
    expect(onEvent.mock.calls.map(([event]) => event.sequence)).toEqual([
      42, 99,
    ]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/upgrades/job/events",
      "/api/upgrades/job",
      "/api/upgrades/job/events?startIndex=1",
      "/api/upgrades/job",
    ]);
  });

  it("replays an unterminated frame from the last acknowledged cursor", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"sequence":0'))
      .mockResolvedValueOnce(Response.json({ state: "warming" }))
      .mockResolvedValueOnce(eventStream(0, "Receiving capture"))
      .mockResolvedValueOnce(
        Response.json({
          state: "completed",
          resultUrl: "https://blob.example/enhanced.wav",
        }),
      );
    const onEvent = vi.fn();

    await followUpgradeProgress({
      eventsUrl: "/api/upgrades/job/events",
      statusUrl: "/api/upgrades/job",
      signal: new AbortController().signal,
      onEvent,
      fetcher,
      reconnectDelayMs: 0,
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/upgrades/job/events",
      "/api/upgrades/job",
      "/api/upgrades/job/events",
      "/api/upgrades/job",
    ]);
  });

  it("tolerates an eventually visible Workflow stream", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ state: "queued" }))
      .mockResolvedValueOnce(eventStream(0, "Receiving capture"))
      .mockResolvedValueOnce(
        Response.json({
          state: "completed",
          resultUrl: "https://blob.example/enhanced.wav",
        }),
      );

    const status = await followUpgradeProgress({
      eventsUrl: "/api/upgrades/job/events",
      statusUrl: "/api/upgrades/job",
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      fetcher,
      reconnectDelayMs: 0,
    });

    expect(status.state).toBe("completed");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("keeps ownership through more than ten transient status failures", async () => {
    let statusAttempts = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes("/events"))
        return new Response(null, { status: 503 });
      statusAttempts += 1;
      if (statusAttempts <= 12) return new Response(null, { status: 503 });
      return Response.json({
        state: "failed",
        error: { message: "The worker eventually failed." },
      });
    });

    await expect(
      followUpgradeProgress({
        eventsUrl: "/api/upgrades/job/events",
        statusUrl: "/api/upgrades/job",
        signal: new AbortController().signal,
        onEvent: vi.fn(),
        fetcher,
        reconnectDelayMs: 0,
      }),
    ).rejects.toThrow("The worker eventually failed.");
    expect(statusAttempts).toBe(13);
  });

  it("surfaces a durable terminal failure instead of reconnecting forever", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(eventStream(0, "Receiving capture"))
      .mockResolvedValueOnce(
        Response.json({
          state: "failed",
          error: { message: "The worker rejected the capture." },
        }),
      );

    await expect(
      followUpgradeProgress({
        eventsUrl: "/api/upgrades/job/events",
        statusUrl: "/api/upgrades/job",
        signal: new AbortController().signal,
        onEvent: vi.fn(),
        fetcher,
        reconnectDelayMs: 0,
      }),
    ).rejects.toThrow("The worker rejected the capture.");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects an incompatible status record", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(""))
      .mockResolvedValueOnce(Response.json({ state: "mystery" }));

    await expect(
      followUpgradeProgress({
        eventsUrl: "/api/upgrades/job/events",
        statusUrl: "/api/upgrades/job",
        signal: new AbortController().signal,
        onEvent: vi.fn(),
        fetcher,
        reconnectDelayMs: 0,
      }),
    ).rejects.toThrow("invalid status record");
  });

  it("stops reconnecting when the user aborts", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async () => {
      controller.abort();
      return new Response(null, { status: 503 });
    });

    await expect(
      followUpgradeProgress({
        eventsUrl: "/api/upgrades/job/events",
        statusUrl: "/api/upgrades/job",
        signal: controller.signal,
        onEvent: vi.fn(),
        fetcher,
        reconnectDelayMs: 0,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
