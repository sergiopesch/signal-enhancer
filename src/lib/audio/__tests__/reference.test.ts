import { describe, expect, it } from "vitest";

import {
  REFERENCE_DIAGNOSTIC_DURATION_SECONDS,
  REFERENCE_SEGMENTS,
  createReferenceDiagnostic,
  createReferenceDiagnosticWav,
  parseWav,
} from "../index";

function rms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
}

describe("versioned diagnostic reference", () => {
  it("is deterministic, cached, exactly 20 seconds, and silent for its first segment", () => {
    const first = createReferenceDiagnostic(8_000);
    const second = createReferenceDiagnostic(8_000);

    expect(second).toBe(first);
    expect(first.durationSeconds).toBe(REFERENCE_DIAGNOSTIC_DURATION_SECONDS);
    expect(first.samples).toHaveLength(160_000);
    expect(
      first.samples.subarray(0, 16_000).every((sample) => sample === 0),
    ).toBe(true);
    expect(
      first.samples.subarray(16_000, 48_000).some((sample) => sample !== 0),
    ).toBe(true);
    expect(
      REFERENCE_SEGMENTS.map((segment) => [
        segment.startSeconds,
        segment.endSeconds,
      ]),
    ).toEqual([
      [0, 2],
      [2, 6],
      [6, 10],
      [10, 15],
      [15, 20],
    ]);
  });

  it("uses the same speech-shaped probe at quiet and louder levels", () => {
    const reference = createReferenceDiagnostic(8_000);
    const quiet = reference.samples.subarray(80_000, 120_000);
    const loud = reference.samples.subarray(120_000, 160_000);
    const ratio = rms(loud) / rms(quiet);
    const nonSilentIndex = quiet.findIndex(
      (sample) => Math.abs(sample) > 0.001,
    );

    expect(ratio).toBeGreaterThan(2);
    expect(ratio).toBeLessThan(4);
    expect(nonSilentIndex).toBeGreaterThanOrEqual(0);
    expect(
      (loud[nonSilentIndex] ?? 0) / (quiet[nonSilentIndex] ?? 1),
    ).toBeCloseTo(ratio, 4);
  });

  it("encodes a playable PCM16 WAV without separate encoder logic", () => {
    const decoded = parseWav(createReferenceDiagnosticWav(8_000));
    expect(decoded.sampleRate).toBe(8_000);
    expect(decoded.durationSeconds).toBe(20);
    expect(decoded.bitsPerSample).toBe(16);
  });
});
