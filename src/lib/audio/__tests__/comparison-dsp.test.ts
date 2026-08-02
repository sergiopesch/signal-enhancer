import { describe, expect, it } from "vitest";

import {
  createDifferenceSignal,
  createDspPreview,
  makeComparison,
  matchBroadbandRms,
  resampleLinear,
} from "../index";

function sine(
  sampleRate: number,
  frequency: number,
  seconds: number,
  amplitude: number,
): Float32Array {
  return Float32Array.from(
    { length: sampleRate * seconds },
    (_, index) =>
      amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate),
  );
}

describe("A/B comparison helpers", () => {
  it("matches down to the quieter signal and exposes the matching gains", () => {
    const sampleRate = 8_000;
    const a = sine(sampleRate, 250, 1, 0.5);
    const b = sine(sampleRate, 250, 1, 0.25);
    const absolute = makeComparison(
      { samples: a, sampleRate },
      { samples: b, sampleRate },
    );
    const matched = makeComparison(
      { samples: a, sampleRate },
      { samples: b, sampleRate },
      { loudnessMatched: true },
    );

    expect(absolute.matchingMethod).toBe("none");
    expect(absolute.differencePeak).toBeCloseTo(0.25, 3);
    expect(matched.matchingMethod).toBe("broadband-rms");
    expect(matched.a.gain).toBeCloseTo(0.5, 4);
    expect(matched.b.gain).toBeCloseTo(1, 4);
    expect(matched.differencePeak).toBeLessThan(0.0001);
  });

  it("resamples different input rates and peak-protects difference playback", () => {
    const a = Float32Array.from([1, 1, 1, 1]);
    const b = Float32Array.from([-1, -1]);
    const comparison = makeComparison(
      { samples: a, sampleRate: 16_000 },
      { samples: b, sampleRate: 8_000 },
    );

    expect(comparison.b.samples).toHaveLength(4);
    expect(comparison.differencePeak).toBe(2);
    expect(
      Math.max(...comparison.differenceForPlayback.map(Math.abs)),
    ).toBeCloseTo(0.95, 5);
    expect(
      resampleLinear(Float32Array.from([0, 1]), 8_000, 16_000),
    ).toHaveLength(4);
  });

  it("provides standalone difference and safe RMS matching helpers", () => {
    expect(
      Array.from(
        createDifferenceSignal(
          Float32Array.from([0.5]),
          Float32Array.from([0.1, 0.2]),
        ),
      ),
    ).toEqual([expect.closeTo(0.4, 5), expect.closeTo(-0.2, 5)]);
    const matched = matchBroadbandRms(
      Float32Array.from([0.9, -0.9]),
      Float32Array.from([0.1, -0.1]),
      24,
    );
    expect(Math.max(...matched.samples.map(Math.abs))).toBeLessThanOrEqual(
      0.999001,
    );
  });
});

describe("local DSP preview", () => {
  it("does not mutate input and returns a finite, peak-safe, honestly labelled preview", () => {
    const input = sine(48_000, 220, 1, 0.8);
    const snapshot = input.slice();
    const preview = createDspPreview(input, 48_000);

    expect(input).toEqual(snapshot);
    expect(preview.samples).not.toBe(input);
    expect(preview.samples.every(Number.isFinite)).toBe(true);
    expect(Math.max(...preview.samples.map(Math.abs))).toBeLessThanOrEqual(
      0.98001,
    );
    expect(preview.steps.map((step) => step.id)).toEqual(
      expect.arrayContaining([
        "high-pass",
        "presence-eq",
        "gentle-compression",
        "rms-match",
      ]),
    );
    expect(preview.loudnessMethod).toBe("broadband-rms");
    expect(preview.disclaimer).toContain("not the AI restoration pipeline");
  });

  it("high-pass mode substantially removes steady DC", () => {
    const input = new Float32Array(48_000).fill(0.25);
    const preview = createDspPreview(input, 48_000, {
      presenceGainDb: 0,
      compressorRatio: 1,
      loudnessMatch: false,
    });
    const tail = preview.samples.subarray(preview.samples.length - 4_800);
    const tailPeak = Math.max(...tail.map(Math.abs));
    expect(tailPeak).toBeLessThan(0.001);
  });
});
