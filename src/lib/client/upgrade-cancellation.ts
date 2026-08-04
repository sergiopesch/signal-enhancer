const RETRY_DELAYS_MS = [0, 500, 2_000, 8_000] as const;

const pendingCancellations = new Map<string, Promise<void>>();
const requestedRechecks = new Set<string>();

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}

async function cancelWithBoundedRetry(upgradeId: string) {
  for (const delay of RETRY_DELAYS_MS) {
    if (delay > 0) await wait(delay);
    try {
      const response = await fetch(`/api/upgrades/${upgradeId}`, {
        method: "DELETE",
        keepalive: true,
      });
      if (response.ok) return true;
      // A client-known ID can be cancelled before the concurrent start route
      // has inserted it. Retry that 404, and transient control-plane failures,
      // without turning cancellation into an unbounded background loop.
      if (response.status !== 404 && response.status < 500) return true;
    } catch {
      // A navigation or brief network transition gets the same bounded retry.
    }
  }
  return false;
}

export function requestRemoteUpgradeCancellation(upgradeId: string) {
  const existing = pendingCancellations.get(upgradeId);
  if (existing) {
    // If a late start response arrives while the last pre-reservation DELETE
    // is still resolving, ensure one fresh bounded pass follows it.
    requestedRechecks.add(upgradeId);
    return existing;
  }
  const request = (async () => {
    while (true) {
      requestedRechecks.delete(upgradeId);
      const settled = await cancelWithBoundedRetry(upgradeId);
      if (settled || !requestedRechecks.has(upgradeId)) return;
    }
  })().finally(() => {
    if (pendingCancellations.get(upgradeId) === request)
      pendingCancellations.delete(upgradeId);
    requestedRechecks.delete(upgradeId);
  });
  pendingCancellations.set(upgradeId, request);
  return request;
}
