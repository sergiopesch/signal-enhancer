import { AudioUtilityError } from "./errors";
import {
  EPSILON,
  applyGain,
  calculatePeak,
  calculateRms,
  clamp,
  linearToDb,
  sanitizeSample,
  validateMonoAudio,
} from "./math";
import type { AudioComparison, ComparisonSignal, MonoAudio } from "./types";

export interface MakeComparisonOptions {
  readonly loudnessMatched?: boolean;
}

export interface RmsMatchResult {
  readonly samples: Float32Array;
  readonly gain: number;
  readonly gainDb: number;
  readonly referenceRms: number;
  readonly sourceRms: number;
}

export function resampleLinear(
  samples: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array {
  if (
    !Number.isFinite(sourceRate) ||
    !Number.isFinite(targetRate) ||
    sourceRate <= 0 ||
    targetRate <= 0
  ) {
    throw new AudioUtilityError(
      "invalid-audio",
      "Resampling requires positive sample rates.",
    );
  }
  if (sourceRate === targetRate || samples.length === 0) {
    return samples.slice();
  }
  const outputLength = Math.max(
    1,
    Math.round((samples.length * targetRate) / sourceRate),
  );
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const lowerIndex = Math.min(samples.length - 1, Math.floor(position));
    const upperIndex = Math.min(samples.length - 1, lowerIndex + 1);
    const mix = position - lowerIndex;
    const lower = sanitizeSample(samples[lowerIndex] ?? 0);
    const upper = sanitizeSample(samples[upperIndex] ?? lower);
    output[index] = lower + (upper - lower) * mix;
  }
  return output;
}

export function matchBroadbandRms(
  reference: Float32Array,
  source: Float32Array,
  maximumBoostDb = 12,
): RmsMatchResult {
  const referenceRms = calculateRms(reference);
  const sourceRms = calculateRms(source);
  let gain = 1;
  if (referenceRms > EPSILON && sourceRms > EPSILON) {
    gain = clamp(
      referenceRms / sourceRms,
      10 ** (-60 / 20),
      10 ** (maximumBoostDb / 20),
    );
    const peak = calculatePeak(source);
    if (peak > EPSILON) {
      gain = Math.min(gain, 0.999 / peak);
    }
  }
  return {
    samples: applyGain(source, gain),
    gain,
    gainDb: linearToDb(gain, -60),
    referenceRms,
    sourceRms,
  };
}

export function createDifferenceSignal(
  a: Float32Array,
  b: Float32Array,
): Float32Array {
  const length = Math.max(a.length, b.length);
  const difference = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    difference[index] =
      sanitizeSample(a[index] ?? 0) - sanitizeSample(b[index] ?? 0);
  }
  return difference;
}

function padToLength(samples: Float32Array, length: number): Float32Array {
  if (samples.length === length) {
    return samples;
  }
  const output = new Float32Array(length);
  output.set(samples.subarray(0, length));
  return output;
}

function comparisonSignal(
  samples: Float32Array,
  gain: number,
  originalRms: number,
  sampleRate: number,
): ComparisonSignal {
  return {
    samples,
    sampleRate,
    gain,
    gainDb: linearToDb(gain, -60),
    originalRmsDbFs: linearToDb(originalRms),
  };
}

export function makeComparison(
  a: MonoAudio,
  b: MonoAudio,
  options: MakeComparisonOptions = {},
): AudioComparison {
  validateMonoAudio(a, "Input A");
  validateMonoAudio(b, "Input B");

  const bAtTargetRate = resampleLinear(b.samples, b.sampleRate, a.sampleRate);
  const originalRmsA = calculateRms(a.samples);
  const originalRmsB = calculateRms(bAtTargetRate);
  let gainA = 1;
  let gainB = 1;

  if (
    options.loudnessMatched === true &&
    originalRmsA > EPSILON &&
    originalRmsB > EPSILON
  ) {
    // Match down to the quieter capture. Attenuation avoids introducing clipping or
    // presenting an arbitrary normalization target as an absolute measurement.
    const targetRms = Math.min(originalRmsA, originalRmsB);
    gainA = targetRms / originalRmsA;
    gainB = targetRms / originalRmsB;
  }

  const processedA = applyGain(a.samples, gainA);
  const processedB = applyGain(bAtTargetRate, gainB);
  const length = Math.max(processedA.length, processedB.length);
  const paddedA = padToLength(processedA, length);
  const paddedB = padToLength(processedB, length);
  const difference = createDifferenceSignal(paddedA, paddedB);
  const differencePeak = calculatePeak(difference);
  const playbackGain = differencePeak > 0.95 ? 0.95 / differencePeak : 1;

  return {
    sampleRate: a.sampleRate,
    length,
    durationSeconds: length / a.sampleRate,
    loudnessMatched: options.loudnessMatched === true,
    matchingMethod: options.loudnessMatched === true ? "broadband-rms" : "none",
    a: comparisonSignal(paddedA, gainA, originalRmsA, a.sampleRate),
    b: comparisonSignal(paddedB, gainB, originalRmsB, a.sampleRate),
    difference,
    differenceForPlayback: applyGain(difference, playbackGain),
    differencePeak,
  };
}
