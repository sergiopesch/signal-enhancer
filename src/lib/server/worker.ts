import "server-only";

import { workerVersionSchema } from "@/lib/server/contracts";
import type { LiveSignalEnvironment } from "@/lib/server/env";

export const EXPECTED_WORKER_PIPELINE_REVISION = "signal-enhancer-audio/1.0.0";
export const EXPECTED_WORKER_DSP_REVISION = "restrained-dsp/1.0.0";
export const EXPECTED_WORKER_MODEL_REVISION =
  "4e3510ce4a8391159f665903544c5150bee7b2cb";

export class WorkerProbeError extends Error {
  constructor(
    readonly kind: "unavailable" | "contract",
    readonly retryable: boolean,
  ) {
    super(
      kind === "unavailable"
        ? "The upgrade worker is unavailable."
        : "The upgrade worker does not match the approved release contract.",
    );
    this.name = "WorkerProbeError";
  }
}

export function isRetryableWorkerStatus(status: number) {
  return [429, 502, 503, 504].includes(status);
}

export function assertProductionWorkerVersion(
  value: unknown,
  expectedBuildRevision: string,
) {
  const parsed = workerVersionSchema.safeParse(value);
  if (!parsed.success) throw new WorkerProbeError("contract", false);
  const version = parsed.data;
  if (
    version.build_revision !== expectedBuildRevision ||
    version.pipeline_revision !== EXPECTED_WORKER_PIPELINE_REVISION ||
    version.dsp_revision !== EXPECTED_WORKER_DSP_REVISION ||
    version.model_name !== "resemble-enhance" ||
    version.model_revision !== EXPECTED_WORKER_MODEL_REVISION
  ) {
    throw new WorkerProbeError("contract", false);
  }
  return version;
}

export async function probeProductionWorker(
  environment: LiveSignalEnvironment,
  options: { timeoutMs?: number; scaleUpTimeoutSeconds?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  let response: Response;
  try {
    response = await fetch(`${environment.HF_ENDPOINT_URL}/version`, {
      headers: {
        Authorization: `Bearer ${environment.HF_ENDPOINT_TOKEN}`,
        "X-Signal-Endpoint-Secret": environment.HF_ENDPOINT_SHARED_SECRET,
        ...(options.scaleUpTimeoutSeconds
          ? { "X-Scale-Up-Timeout": String(options.scaleUpTimeoutSeconds) }
          : {}),
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new WorkerProbeError("unavailable", true);
  }

  if (!response.ok) {
    throw new WorkerProbeError(
      "unavailable",
      isRetryableWorkerStatus(response.status),
    );
  }

  return assertProductionWorkerVersion(
    await response.json().catch(() => null),
    environment.HF_ENDPOINT_BUILD_REVISION,
  );
}
