import { afterEach, describe, expect, it, vi } from "vitest";

import type { LiveSignalEnvironment } from "../env";
import {
  assertProductionWorkerVersion,
  EXPECTED_WORKER_DSP_REVISION,
  EXPECTED_WORKER_MODEL_REVISION,
  EXPECTED_WORKER_PIPELINE_REVISION,
  isRetryableWorkerStatus,
  probeProductionWorker,
  WorkerProbeError,
} from "../worker";

const BUILD_REVISION = "a".repeat(40);
const environment = {
  HF_ENDPOINT_URL: "https://signal.eu-west-1.aws.endpoints.huggingface.cloud",
  HF_ENDPOINT_TOKEN: "gateway-secret",
  HF_ENDPOINT_SHARED_SECRET: "application-secret".repeat(2),
  HF_ENDPOINT_BUILD_REVISION: BUILD_REVISION,
} as LiveSignalEnvironment;

function approvedVersion() {
  return {
    api_schema: "1" as const,
    build_revision: BUILD_REVISION,
    pipeline_revision: EXPECTED_WORKER_PIPELINE_REVISION,
    dsp_revision: EXPECTED_WORKER_DSP_REVISION,
    model_name: "resemble-enhance" as const,
    model_repository: "ResembleAI/resemble-enhance" as const,
    model_revision: EXPECTED_WORKER_MODEL_REVISION,
    model_checkpoint_sha256:
      "f9d035f318de3e6d919bc70cf7ad7d32b4fe92ec5cbe0b30029a27f5db07d9d6" as const,
    source_repository:
      "https://github.com/resemble-ai/resemble-enhance" as const,
    source_revision: "8e978149bfe8abab3eb77d965d579a111afdb0ff" as const,
    inference_profile:
      "enhancer-stage2:nfe=32:solver=midpoint:lambd=0.35:tau=0.45" as const,
  };
}

describe("production worker probe", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requires the exact approved build and model contract", () => {
    expect(
      assertProductionWorkerVersion(approvedVersion(), BUILD_REVISION),
    ).toEqual(approvedVersion());

    expect(() =>
      assertProductionWorkerVersion(
        { ...approvedVersion(), model_revision: "b".repeat(40) },
        BUILD_REVISION,
      ),
    ).toThrow(WorkerProbeError);
  });

  it("retries every transient gateway and cold-start status", () => {
    expect([429, 502, 503, 504].every(isRetryableWorkerStatus)).toBe(true);
    expect([400, 401, 403, 404, 500].some(isRetryableWorkerStatus)).toBe(false);
  });

  it("sends both independent credentials and refuses redirects", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(approvedVersion()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(probeProductionWorker(environment)).resolves.toEqual(
      approvedVersion(),
    );

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${environment.HF_ENDPOINT_URL}/version`);
    expect(init).toMatchObject({
      redirect: "error",
      headers: {
        Authorization: `Bearer ${environment.HF_ENDPOINT_TOKEN}`,
        "X-Signal-Endpoint-Secret": environment.HF_ENDPOINT_SHARED_SECRET,
      },
    });
  });

  it("does not accept a redirect or malformed version response", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 302 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ready" })));

    await expect(probeProductionWorker(environment)).rejects.toMatchObject({
      kind: "unavailable",
    });
    await expect(probeProductionWorker(environment)).rejects.toMatchObject({
      kind: "contract",
    });
  });
});
