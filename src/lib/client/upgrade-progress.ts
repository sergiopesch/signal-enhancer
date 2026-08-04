export type UpgradeProgressEvent = {
  sequence: number;
  stage: string;
  detail: string;
  status: "active" | "complete" | "failed";
  timestamp: string;
};

export type UpgradeProgressState =
  | "queued"
  | "warming"
  | "processing"
  | "storing"
  | "completed"
  | "cancelled"
  | "expired"
  | "failed";

export type UpgradeProgressStatus = {
  state: UpgradeProgressState;
  resultUrl?: string | null;
  resultSha256?: string | null;
  routing?: unknown;
  resultMetadata?: unknown;
  error?: { message: string } | null;
};

type FollowUpgradeProgressOptions = {
  eventsUrl: string;
  statusUrl: string;
  signal: AbortSignal;
  onEvent: (event: UpgradeProgressEvent) => void;
  fetcher?: typeof fetch;
  reconnectDelayMs?: number;
};

const KNOWN_STATES = new Set<UpgradeProgressState>([
  "queued",
  "warming",
  "processing",
  "storing",
  "completed",
  "cancelled",
  "expired",
  "failed",
]);
const TERMINAL_FAILURE_STATES = new Set<UpgradeProgressState>([
  "cancelled",
  "expired",
  "failed",
]);
const MAX_RECONNECT_DELAY_MS = 12_000;

class TransientProgressError extends Error {}

export function withUpgradeStreamCursor(eventsUrl: string, startIndex: number) {
  if (startIndex <= 0) return eventsUrl;
  const absolute = /^https?:\/\//i.test(eventsUrl);
  const parsed = new URL(eventsUrl, "https://signal-enhancer.invalid");
  parsed.searchParams.set("startIndex", String(startIndex));
  return absolute
    ? parsed.toString()
    : `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function nextUpgradeStreamIndex(current: number) {
  return current + 1;
}

export function upgradeReconnectDelay(
  baseDelayMs: number,
  consecutiveFailures: number,
) {
  if (baseDelayMs <= 0) return 0;
  const exponent = Math.min(Math.max(consecutiveFailures - 1, 0), 4);
  return Math.min(baseDelayMs * 2 ** exponent, MAX_RECONNECT_DELAY_MS);
}

function isTransientNetworkError(error: unknown) {
  return (
    error instanceof TransientProgressError ||
    error instanceof TypeError ||
    (error instanceof DOMException && error.name !== "AbortError")
  );
}

function isRetryableStreamStatus(status: number) {
  return (
    status === 404 ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function isRetryableStatusStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function reconnectDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    function handleAbort() {
      globalThis.clearTimeout(timer);
      reject(new DOMException("Upgrade cancelled.", "AbortError"));
    }
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function readEvent(line: string) {
  const event = JSON.parse(line) as UpgradeProgressEvent;
  if (
    !Number.isSafeInteger(event.sequence) ||
    event.sequence < 0 ||
    typeof event.stage !== "string" ||
    typeof event.detail !== "string" ||
    !["active", "complete", "failed"].includes(event.status) ||
    typeof event.timestamp !== "string"
  ) {
    throw new Error("The durable progress stream returned an invalid event.");
  }
  return event;
}

function readStatus(value: unknown): UpgradeProgressStatus {
  if (!value || typeof value !== "object") {
    throw new Error("The durable upgrade returned an invalid status record.");
  }
  const status = value as Record<string, unknown>;
  if (
    typeof status.state !== "string" ||
    !KNOWN_STATES.has(status.state as UpgradeProgressState) ||
    ![status.resultUrl, status.resultSha256].every(
      (item) => item === undefined || item === null || typeof item === "string",
    ) ||
    !(
      status.error === undefined ||
      status.error === null ||
      (typeof status.error === "object" &&
        status.error !== null &&
        typeof (status.error as Record<string, unknown>).message === "string")
    )
  ) {
    throw new Error("The durable upgrade returned an invalid status record.");
  }
  return {
    state: status.state as UpgradeProgressState,
    ...(status.resultUrl === undefined
      ? {}
      : { resultUrl: status.resultUrl as string | null }),
    ...(status.resultSha256 === undefined
      ? {}
      : { resultSha256: status.resultSha256 as string | null }),
    routing: status.routing,
    resultMetadata: status.resultMetadata,
    error:
      status.error && typeof status.error === "object"
        ? {
            message: (status.error as Record<string, unknown>)
              .message as string,
          }
        : null,
  };
}

export async function followUpgradeProgress({
  eventsUrl,
  statusUrl,
  signal,
  onEvent,
  fetcher = fetch,
  reconnectDelayMs = 750,
}: FollowUpgradeProgressOptions): Promise<UpgradeProgressStatus> {
  let startIndex = 0;
  let consecutiveStatusFailures = 0;

  while (true) {
    signal.throwIfAborted();
    try {
      const response = await fetcher(
        withUpgradeStreamCursor(eventsUrl, startIndex),
        { cache: "no-store", signal },
      );
      signal.throwIfAborted();
      if (isRetryableStreamStatus(response.status)) {
        // The durable run is still authoritative. Check its stored state and
        // reconnect instead of turning a transient function failure into a
        // remote cancellation.
        throw new TransientProgressError(
          "The durable progress stream was interrupted.",
        );
      } else if (!response.ok || !response.body) {
        throw new Error("The durable progress stream could not be opened.");
      } else {
        const reader = response.body
          .pipeThrough(new TextDecoderStream())
          .getReader();
        let buffer = "";
        const consumeLine = (line: string) => {
          if (!line.trim()) return;
          const event = readEvent(line);
          // Workflow's startIndex is a stream-chunk cursor, not the event's
          // separately persisted Neon sequence. writeProgress emits exactly
          // one newline-delimited frame per Workflow stream chunk, so advance
          // by the number of complete frames the client consumed.
          startIndex = nextUpgradeStreamIndex(startIndex);
          onEvent(event);
        };
        while (true) {
          const chunk = await reader.read();
          signal.throwIfAborted();
          if (chunk.done) break;
          buffer += chunk.value;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) consumeLine(line);
        }
        if (buffer.trim()) {
          // Infrastructure can close a response between bytes. A valid final
          // frame is accepted, while an incomplete frame is replayed from the
          // last acknowledged Workflow chunk on the next connection.
          try {
            consumeLine(buffer);
          } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
          }
        }
      }
    } catch (error) {
      signal.throwIfAborted();
      if (!isTransientNetworkError(error)) throw error;
    }

    let status: UpgradeProgressStatus;
    try {
      const response = await fetcher(statusUrl, {
        cache: "no-store",
        signal,
      });
      signal.throwIfAborted();
      if (isRetryableStatusStatus(response.status))
        throw new TransientProgressError(
          "The durable upgrade status was interrupted.",
        );
      if (!response.ok)
        throw new Error("The durable upgrade status is unavailable.");
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        if (error instanceof SyntaxError)
          throw new TransientProgressError(
            "The durable upgrade status was interrupted.",
          );
        throw error;
      }
      status = readStatus(payload);
      consecutiveStatusFailures = 0;
    } catch (error) {
      signal.throwIfAborted();
      if (!isTransientNetworkError(error)) throw error;
      consecutiveStatusFailures += 1;
      // The durable run stays authoritative through a browser/network outage.
      // Keep its ID owned by this UI until the user explicitly cancels, with a
      // capped backoff to avoid hammering the status route while offline.
      await reconnectDelay(
        upgradeReconnectDelay(reconnectDelayMs, consecutiveStatusFailures),
        signal,
      );
      continue;
    }

    if (status.state === "completed") return status;
    if (TERMINAL_FAILURE_STATES.has(status.state)) {
      throw new Error(
        status.error?.message ?? "The deeper restoration did not finish.",
      );
    }

    await reconnectDelay(reconnectDelayMs, signal);
  }
}
