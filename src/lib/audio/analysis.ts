import { AudioUtilityError, assertFiniteSampleRate } from "./errors";
import {
  DB_FLOOR,
  clamp,
  linearToDb,
  percentile,
  sanitizeSample,
} from "./math";
import type {
  AudioAnalysis,
  AudioLevelMetrics,
  DynamicsBin,
  SpectrumBin,
  WaveformBin,
} from "./types";

export interface AnalyzeAudioOptions {
  readonly waveformBins?: number;
  readonly spectrumBins?: number;
  readonly dynamicsBins?: number;
  readonly fftSize?: number;
  readonly maxSpectrumFrames?: number;
  readonly clippingThreshold?: number;
}

const DEFAULT_WAVEFORM_BINS = 160;
const DEFAULT_SPECTRUM_BINS = 96;
const DEFAULT_DYNAMICS_BINS = 100;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value)) {
    throw new AudioUtilityError(
      "invalid-audio",
      "Analysis bin counts must be finite numbers.",
    );
  }
  return Math.round(clamp(value, minimum, maximum));
}

function calculateRangeStats(
  samples: Float32Array,
  start: number,
  end: number,
): {
  min: number;
  max: number;
  rms: number;
  peak: number;
} {
  if (end <= start) {
    return { min: 0, max: 0, rms: 0, peak: 0 };
  }
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let sumSquares = 0;
  let peak = 0;
  for (let index = start; index < end; index += 1) {
    const sample = sanitizeSample(samples[index] ?? 0);
    minimum = Math.min(minimum, sample);
    maximum = Math.max(maximum, sample);
    peak = Math.max(peak, Math.abs(sample));
    sumSquares += sample * sample;
  }
  return {
    min: Number.isFinite(minimum) ? minimum : 0,
    max: Number.isFinite(maximum) ? maximum : 0,
    rms: Math.sqrt(sumSquares / (end - start)),
    peak,
  };
}

export function computeWaveformBins(
  samples: Float32Array,
  requestedBins = DEFAULT_WAVEFORM_BINS,
): WaveformBin[] {
  if (samples.length === 0) {
    return [];
  }
  const binCount = Math.min(
    samples.length,
    boundedInteger(requestedBins, DEFAULT_WAVEFORM_BINS, 1, 4_096),
  );
  const bins: WaveformBin[] = [];
  for (let bin = 0; bin < binCount; bin += 1) {
    const startSample = Math.floor((bin * samples.length) / binCount);
    const endSample = Math.max(
      startSample + 1,
      Math.floor(((bin + 1) * samples.length) / binCount),
    );
    const stats = calculateRangeStats(
      samples,
      startSample,
      Math.min(endSample, samples.length),
    );
    bins.push({
      startSample,
      endSample: Math.min(endSample, samples.length),
      min: stats.min,
      max: stats.max,
      rms: stats.rms,
    });
  }
  return bins;
}

export function computeDynamicsBins(
  samples: Float32Array,
  sampleRate: number,
  requestedBins = DEFAULT_DYNAMICS_BINS,
): DynamicsBin[] {
  if (samples.length === 0) {
    return [];
  }
  const binCount = Math.min(
    samples.length,
    boundedInteger(requestedBins, DEFAULT_DYNAMICS_BINS, 1, 4_096),
  );
  const bins: DynamicsBin[] = [];
  for (let bin = 0; bin < binCount; bin += 1) {
    const start = Math.floor((bin * samples.length) / binCount);
    const end = Math.max(
      start + 1,
      Math.floor(((bin + 1) * samples.length) / binCount),
    );
    const safeEnd = Math.min(end, samples.length);
    const stats = calculateRangeStats(samples, start, safeEnd);
    bins.push({
      startSeconds: start / sampleRate,
      endSeconds: safeEnd / sampleRate,
      rms: stats.rms,
      rmsDbFs: linearToDb(stats.rms),
      peak: stats.peak,
    });
  }
  return bins;
}

function reverseBits(value: number, bitCount: number): number {
  let result = 0;
  for (let bit = 0; bit < bitCount; bit += 1) {
    result = (result << 1) | ((value >> bit) & 1);
  }
  return result;
}

function fftInPlace(real: Float64Array, imaginary: Float64Array): void {
  const length = real.length;
  const bitCount = Math.log2(length);
  for (let index = 0; index < length; index += 1) {
    const reversed = reverseBits(index, bitCount);
    if (reversed > index) {
      const realValue = real[index] ?? 0;
      const imaginaryValue = imaginary[index] ?? 0;
      real[index] = real[reversed] ?? 0;
      imaginary[index] = imaginary[reversed] ?? 0;
      real[reversed] = realValue;
      imaginary[reversed] = imaginaryValue;
    }
  }

  for (let width = 2; width <= length; width *= 2) {
    const halfWidth = width / 2;
    const phaseStep = (-2 * Math.PI) / width;
    for (let block = 0; block < length; block += width) {
      for (let offset = 0; offset < halfWidth; offset += 1) {
        const phase = phaseStep * offset;
        const cosine = Math.cos(phase);
        const sine = Math.sin(phase);
        const evenIndex = block + offset;
        const oddIndex = evenIndex + halfWidth;
        const oddReal = real[oddIndex] ?? 0;
        const oddImaginary = imaginary[oddIndex] ?? 0;
        const transformedReal = oddReal * cosine - oddImaginary * sine;
        const transformedImaginary = oddReal * sine + oddImaginary * cosine;
        const evenReal = real[evenIndex] ?? 0;
        const evenImaginary = imaginary[evenIndex] ?? 0;
        real[evenIndex] = evenReal + transformedReal;
        imaginary[evenIndex] = evenImaginary + transformedImaginary;
        real[oddIndex] = evenReal - transformedReal;
        imaginary[oddIndex] = evenImaginary - transformedImaginary;
      }
    }
  }
}

function nearestPowerOfTwo(value: number): number {
  return 2 ** Math.round(Math.log2(value));
}

function frameStarts(
  sampleCount: number,
  fftSize: number,
  maximumFrames: number,
): number[] {
  if (sampleCount <= fftSize || maximumFrames === 1) {
    return [0];
  }
  const availableHalfOverlapFrames =
    1 + Math.floor((sampleCount - fftSize) / (fftSize / 2));
  const count = Math.min(maximumFrames, availableHalfOverlapFrames);
  return Array.from({ length: count }, (_, index) =>
    count === 1
      ? 0
      : Math.round((index * (sampleCount - fftSize)) / (count - 1)),
  );
}

export function computeSpectrumBins(
  samples: Float32Array,
  sampleRate: number,
  options: Pick<
    AnalyzeAudioOptions,
    "fftSize" | "maxSpectrumFrames" | "spectrumBins"
  > = {},
): SpectrumBin[] {
  assertFiniteSampleRate(sampleRate);
  if (samples.length === 0) {
    return [];
  }

  const requestedFftSize = boundedInteger(options.fftSize, 2_048, 256, 8_192);
  const fftSize = clamp(nearestPowerOfTwo(requestedFftSize), 256, 8_192);
  const maximumFrames = boundedInteger(options.maxSpectrumFrames, 8, 1, 32);
  const outputBinCount = boundedInteger(
    options.spectrumBins,
    DEFAULT_SPECTRUM_BINS,
    8,
    512,
  );
  const starts = frameStarts(samples.length, fftSize, maximumFrames);
  const power = new Float64Array(fftSize / 2 + 1);
  const window = new Float64Array(fftSize);
  let windowSum = 0;
  for (let index = 0; index < fftSize; index += 1) {
    const value = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (fftSize - 1));
    window[index] = value;
    windowSum += value;
  }

  for (const start of starts) {
    const real = new Float64Array(fftSize);
    const imaginary = new Float64Array(fftSize);
    for (let index = 0; index < fftSize; index += 1) {
      real[index] =
        sanitizeSample(samples[start + index] ?? 0) * (window[index] ?? 0);
    }
    fftInPlace(real, imaginary);
    for (let bin = 0; bin < power.length; bin += 1) {
      const scale =
        bin === 0 || bin === fftSize / 2 ? 1 / windowSum : 2 / windowSum;
      const magnitude = Math.hypot(real[bin] ?? 0, imaginary[bin] ?? 0) * scale;
      power[bin] = (power[bin] ?? 0) + magnitude * magnitude;
    }
  }
  for (let bin = 0; bin < power.length; bin += 1) {
    power[bin] = (power[bin] ?? 0) / starts.length;
  }

  const nyquist = sampleRate / 2;
  const minimumFrequency = Math.min(20, nyquist);
  const bins: SpectrumBin[] = [];
  for (let index = 0; index < outputBinCount; index += 1) {
    const fraction = outputBinCount === 1 ? 0 : index / (outputBinCount - 1);
    const frequencyHz =
      minimumFrequency === nyquist
        ? nyquist
        : minimumFrequency * (nyquist / minimumFrequency) ** fraction;
    const rawPosition = (frequencyHz * fftSize) / sampleRate;
    const lowerIndex = Math.min(power.length - 1, Math.floor(rawPosition));
    const upperIndex = Math.min(power.length - 1, lowerIndex + 1);
    const mix = rawPosition - lowerIndex;
    const interpolatedPower =
      (power[lowerIndex] ?? 0) * (1 - mix) + (power[upperIndex] ?? 0) * mix;
    const magnitude = Math.sqrt(Math.max(0, interpolatedPower));
    bins.push({ frequencyHz, magnitude, magnitudeDbFs: linearToDb(magnitude) });
  }
  return bins;
}

function calculateMetrics(
  samples: Float32Array,
  sampleRate: number,
  clippingThreshold: number,
): AudioLevelMetrics {
  if (samples.length === 0) {
    return {
      rms: 0,
      rmsDbFs: DB_FLOOR,
      peak: 0,
      peakDbFs: DB_FLOOR,
      dcOffset: 0,
      crestFactorDb: 0,
      noiseFloorProxyDbFs: DB_FLOOR,
      dynamicRangeProxyDb: 0,
      clippingSampleCount: 0,
      clippingFraction: 0,
    };
  }

  let sum = 0;
  let sumSquares = 0;
  let peak = 0;
  let clippingSampleCount = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = sanitizeSample(samples[index] ?? 0);
    const absolute = Math.abs(sample);
    sum += sample;
    sumSquares += sample * sample;
    peak = Math.max(peak, absolute);
    if (absolute >= clippingThreshold) {
      clippingSampleCount += 1;
    }
  }
  const rms = Math.sqrt(sumSquares / samples.length);

  const windowSize = Math.max(1, Math.round(sampleRate * 0.02));
  const windowLevels: number[] = [];
  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(samples.length, start + windowSize);
    windowLevels.push(linearToDb(calculateRangeStats(samples, start, end).rms));
  }
  windowLevels.sort((left, right) => left - right);
  const noiseFloorProxyDbFs = percentile(windowLevels, 0.2);
  const activeLevelDbFs = percentile(windowLevels, 0.95);

  return {
    rms,
    rmsDbFs: linearToDb(rms),
    peak,
    peakDbFs: linearToDb(peak),
    dcOffset: sum / samples.length,
    crestFactorDb: rms > 0 ? Math.max(0, linearToDb(peak / rms, 0)) : 0,
    noiseFloorProxyDbFs,
    dynamicRangeProxyDb: clamp(
      activeLevelDbFs - noiseFloorProxyDbFs,
      0,
      -DB_FLOOR,
    ),
    clippingSampleCount,
    clippingFraction: clippingSampleCount / samples.length,
  };
}

export function analyzeAudio(
  samples: Float32Array,
  sampleRate: number,
  options: AnalyzeAudioOptions = {},
): AudioAnalysis {
  assertFiniteSampleRate(sampleRate);
  if (!(samples instanceof Float32Array)) {
    throw new AudioUtilityError(
      "invalid-audio",
      "Analysis samples must be a Float32Array.",
    );
  }
  const clippingThreshold = clamp(options.clippingThreshold ?? 0.999, 0.8, 1);
  return {
    sampleRate,
    sampleCount: samples.length,
    durationSeconds: samples.length / sampleRate,
    waveform: computeWaveformBins(samples, options.waveformBins),
    spectrum: computeSpectrumBins(samples, sampleRate, options),
    dynamics: computeDynamicsBins(samples, sampleRate, options.dynamicsBins),
    metrics: calculateMetrics(samples, sampleRate, clippingThreshold),
  };
}
