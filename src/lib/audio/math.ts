import { AudioUtilityError, assertFiniteSampleRate } from "./errors";
import type { MonoAudio } from "./types";

export const DB_FLOOR = -120;
export const EPSILON = 1e-12;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function sanitizeSample(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function linearToDb(value: number, floor = DB_FLOOR): number {
  if (!Number.isFinite(value) || value <= 0) {
    return floor;
  }
  return Math.max(floor, 20 * Math.log10(value));
}

export function dbToLinear(db: number): number {
  return Number.isFinite(db) ? 10 ** (db / 20) : 0;
}

export function calculateRms(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }

  let sumSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = sanitizeSample(samples[index] ?? 0);
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / samples.length);
}

export function calculatePeak(samples: Float32Array): number {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(sanitizeSample(samples[index] ?? 0)));
  }
  return peak;
}

export function applyGain(samples: Float32Array, gain: number): Float32Array {
  const safeGain = Number.isFinite(gain) ? gain : 1;
  const output = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    output[index] = sanitizeSample(samples[index] ?? 0) * safeGain;
  }
  return output;
}

export function validateMonoAudio(audio: MonoAudio, label = "Audio"): void {
  assertFiniteSampleRate(audio.sampleRate);
  if (!(audio.samples instanceof Float32Array)) {
    throw new AudioUtilityError(
      "invalid-audio",
      `${label} samples must be a Float32Array.`,
    );
  }
  if (audio.samples.length > audio.sampleRate * 60 * 10) {
    throw new AudioUtilityError(
      "invalid-audio",
      `${label} is longer than the local ten-minute safety limit.`,
    );
  }
}

export function percentile(
  sortedValues: readonly number[],
  fraction: number,
): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  const position = clamp(fraction, 0, 1) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex] ?? 0;
  const upper = sortedValues[upperIndex] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

export function concatenateFloat32(
  chunks: readonly Float32Array[],
  length: number,
): Float32Array {
  const output = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= length) {
      break;
    }
    const count = Math.min(chunk.length, length - offset);
    output.set(chunk.subarray(0, count), offset);
    offset += count;
  }
  return output;
}
