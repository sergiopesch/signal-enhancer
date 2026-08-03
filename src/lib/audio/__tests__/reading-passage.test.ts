import { describe, expect, it } from "vitest";

import {
  getGuidedReadingCue,
  getGuidedReadingCueIndex,
  getGuidedReadingProgress,
  GUIDED_READING_COMPLETION_TOLERANCE_SECONDS,
  GUIDED_READING_CUES,
  GUIDED_READING_DURATION_SECONDS,
  GUIDED_READING_PASSAGE,
  isCompleteGuidedReadingDuration,
  makeGuidedReadingDisplayTrace,
} from "../reading-passage";

describe("guided reading passage", () => {
  it("covers the complete capture without gaps or overlaps", () => {
    expect(GUIDED_READING_CUES[0]?.startSeconds).toBe(0);
    expect(GUIDED_READING_CUES.at(-1)?.endSeconds).toBe(
      GUIDED_READING_DURATION_SECONDS,
    );

    for (let index = 1; index < GUIDED_READING_CUES.length; index += 1) {
      expect(GUIDED_READING_CUES[index]?.startSeconds).toBe(
        GUIDED_READING_CUES[index - 1]?.endSeconds,
      );
    }
  });

  it("selects deterministic cues at every boundary", () => {
    expect(getGuidedReadingCue(-1).id).toBe("room-tone");
    expect(getGuidedReadingCue(1.999).id).toBe("room-tone");
    expect(getGuidedReadingCue(2).id).toBe("natural");
    expect(getGuidedReadingCue(8).id).toBe("soft");
    expect(getGuidedReadingCue(14).id).toBe("finish");
    expect(getGuidedReadingCue(20).id).toBe("finish");
    expect(getGuidedReadingCue(Number.POSITIVE_INFINITY).id).toBe("room-tone");
    expect(getGuidedReadingCueIndex(14)).toBe(3);
  });

  it("keeps the full readable passage versioned outside the UI", () => {
    const visibleCueText = GUIDED_READING_CUES.flatMap((cue) =>
      cue.text === null ? [] : [cue.text],
    ).join(" ");

    expect(GUIDED_READING_PASSAGE).toBe(visibleCueText);
    expect(GUIDED_READING_PASSAGE.split(/\s+/)).toHaveLength(36);
  });

  it("bounds capture progress to the protocol duration", () => {
    expect(getGuidedReadingProgress(-5)).toBe(0);
    expect(getGuidedReadingProgress(5)).toBe(0.25);
    expect(getGuidedReadingProgress(20)).toBe(1);
    expect(getGuidedReadingProgress(200)).toBe(1);
    expect(getGuidedReadingProgress(Number.NaN)).toBe(0);
  });

  it("accepts only a complete guided-reading duration within the declared tolerance", () => {
    expect(
      isCompleteGuidedReadingDuration(
        GUIDED_READING_DURATION_SECONDS -
          GUIDED_READING_COMPLETION_TOLERANCE_SECONDS,
      ),
    ).toBe(true);
    expect(
      isCompleteGuidedReadingDuration(
        GUIDED_READING_DURATION_SECONDS -
          GUIDED_READING_COMPLETION_TOLERANCE_SECONDS -
          0.001,
      ),
    ).toBe(false);
    expect(isCompleteGuidedReadingDuration(Number.NaN)).toBe(false);
  });

  it("creates a bounded display trace with quieter room-tone and soft cues", () => {
    const trace = makeGuidedReadingDisplayTrace(200);
    const peak = (values: readonly number[]) =>
      Math.max(...values.map((value) => Math.abs(value)));

    expect(trace).toHaveLength(200);
    expect(peak(trace)).toBeLessThanOrEqual(1);
    expect(peak(trace.slice(0, 20))).toBeLessThan(0.01);
    expect(peak(trace.slice(80, 140))).toBeLessThan(peak(trace.slice(20, 80)));
  });
});
