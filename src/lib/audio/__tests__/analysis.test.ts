import { describe, expect, it } from "vitest";

import {
  analyzeAudio,
  computeSpectrumBins,
  computeWaveformBins,
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

describe("local audio analysis", () => {
  it("measures a known sine and locates its dominant spectrum region", () => {
    const samples = sine(48_000, 1_000, 1, 0.5);
    const analysis = analyzeAudio(samples, 48_000, {
      waveformBins: 64,
      spectrumBins: 128,
      dynamicsBins: 20,
    });
    const dominant = analysis.spectrum.reduce((best, bin) =>
      bin.magnitude > best.magnitude ? bin : best,
    );

    expect(analysis.metrics.rms).toBeCloseTo(Math.SQRT1_2 * 0.5, 3);
    expect(analysis.metrics.peak).toBeCloseTo(0.5, 4);
    expect(analysis.waveform).toHaveLength(64);
    expect(analysis.dynamics).toHaveLength(20);
    expect(dominant.frequencyHz).toBeGreaterThan(850);
    expect(dominant.frequencyHz).toBeLessThan(1_150);
    expect(dominant.magnitudeDbFs).toBeGreaterThan(-12);
  });

  it("reports clipping, a low-percentile noise proxy, and dynamic-range proxy", () => {
    const samples = new Float32Array(48_000);
    for (let index = 12_000; index < samples.length; index += 1) {
      samples[index] = index % 2 === 0 ? 1 : -1;
    }
    const analysis = analyzeAudio(samples, 48_000);

    expect(analysis.metrics.clippingSampleCount).toBe(36_000);
    expect(analysis.metrics.clippingFraction).toBeCloseTo(0.75, 5);
    expect(analysis.metrics.noiseFloorProxyDbFs).toBe(-120);
    expect(analysis.metrics.dynamicRangeProxyDb).toBeGreaterThan(100);
  });

  it("handles empty and non-finite samples without contaminating results", () => {
    const empty = analyzeAudio(new Float32Array(), 48_000);
    expect(empty.waveform).toEqual([]);
    expect(empty.spectrum).toEqual([]);
    expect(empty.metrics.rmsDbFs).toBe(-120);

    const irregular = Float32Array.from([
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -0.5,
      0.5,
    ]);
    const analysis = analyzeAudio(irregular, 48_000, {
      waveformBins: 4,
      spectrumBins: 8,
    });
    expect(analysis.metrics.rms).toBeCloseTo(Math.sqrt(0.5 / 4), 5);
    expect(analysis.waveform.every((bin) => Number.isFinite(bin.rms))).toBe(
      true,
    );
  });

  it("returns exact min/max waveform evidence and bounded spectrum bins", () => {
    const waveform = computeWaveformBins(
      Float32Array.from([-1, 0.2, 0.4, 1]),
      2,
    );
    expect(waveform[0]).toMatchObject({
      min: -1,
      startSample: 0,
      endSample: 2,
    });
    expect(waveform[0]?.max).toBeCloseTo(0.2, 6);
    expect(waveform[1]).toMatchObject({ max: 1, startSample: 2, endSample: 4 });
    expect(waveform[1]?.min).toBeCloseTo(0.4, 6);
    expect(
      computeSpectrumBins(Float32Array.from([1]), 8_000, { spectrumBins: 10 }),
    ).toHaveLength(10);
  });
});
