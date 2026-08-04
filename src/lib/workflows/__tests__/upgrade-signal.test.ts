import { describe, expect, it } from "vitest";

import {
  UPGRADE_INFERENCE_REQUEST_TIMEOUT_MS,
  UPGRADE_INFERENCE_SCALE_TIMEOUT_SECONDS,
  UPGRADE_WARM_MAX_RETRIES,
  UPGRADE_WARM_REQUEST_TIMEOUT_MS,
  UPGRADE_WARM_SCALE_TIMEOUT_SECONDS,
  UPGRADE_WORKER_MAX_RETRIES,
  upgradeResultCoordinates,
} from "@/lib/workflows/upgrade-signal";

describe("upgrade workflow replay coordinates", () => {
  it("derives stable non-overwriting artifacts from the public job id", () => {
    const job = {
      sessionId: "session-internal",
      internalJobId: "job-internal",
      publicJobId: "b824b5b4-60e9-438b-bc28-6d598312c692",
    };

    const first = upgradeResultCoordinates(job);
    const replay = upgradeResultCoordinates(job);

    expect(replay).toEqual(first);
    expect(first).toEqual({
      attemptId: job.publicJobId,
      resultPaths: {
        enhanced: `sessions/${job.sessionId}/results/${job.internalJobId}/${job.publicJobId}/enhanced.wav`,
        difference: `sessions/${job.sessionId}/results/${job.internalJobId}/${job.publicJobId}/difference.json`,
        report: `sessions/${job.sessionId}/results/${job.internalJobId}/${job.publicJobId}/report.json`,
      },
    });
  });

  it("forbids automatic retries of a partially uploaded worker attempt", () => {
    expect(UPGRADE_WORKER_MAX_RETRIES).toBe(0);
  });

  it("keeps every provider request inside the Hobby Fluid step ceiling", () => {
    expect(UPGRADE_WARM_MAX_RETRIES).toBe(3);
    expect(UPGRADE_WARM_SCALE_TIMEOUT_SECONDS).toBeLessThan(300);
    expect(UPGRADE_WARM_REQUEST_TIMEOUT_MS).toBeLessThan(300_000);
    expect(UPGRADE_INFERENCE_SCALE_TIMEOUT_SECONDS).toBeLessThan(300);
    expect(UPGRADE_INFERENCE_REQUEST_TIMEOUT_MS).toBeLessThan(300_000);
    expect(
      300_000 - UPGRADE_INFERENCE_REQUEST_TIMEOUT_MS,
    ).toBeGreaterThanOrEqual(60_000);
  });
});
