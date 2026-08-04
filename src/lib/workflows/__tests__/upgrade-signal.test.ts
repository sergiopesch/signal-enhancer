import { describe, expect, it } from "vitest";

import {
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
});
