import { AudioUtilityError } from "./errors";
import {
  EPSILON,
  applyGain,
  calculatePeak,
  calculateRms,
  clamp,
  dbToLinear,
  linearToDb,
  sanitizeSample,
  validateMonoAudio,
} from "./math";
import type { DspPreviewResult, DspPreviewStep, MonoAudio } from "./types";

export interface DspPreviewOptions {
  readonly highPassHz?: number | false;
  readonly presenceFrequencyHz?: number;
  readonly presenceGainDb?: number;
  readonly compressorThresholdDb?: number;
  readonly compressorRatio?: number;
  readonly compressorAttackMs?: number;
  readonly compressorReleaseMs?: number;
  readonly loudnessMatch?: boolean;
}

interface BiquadCoefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

function applyBiquad(
  samples: Float32Array,
  coefficients: BiquadCoefficients,
): Float32Array {
  const output = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const x0 = sanitizeSample(samples[index] ?? 0);
    const y0 =
      coefficients.b0 * x0 +
      coefficients.b1 * x1 +
      coefficients.b2 * x2 -
      coefficients.a1 * y1 -
      coefficients.a2 * y2;
    output[index] = Number.isFinite(y0) ? y0 : 0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return output;
}

function highPassCoefficients(
  sampleRate: number,
  frequencyHz: number,
): BiquadCoefficients {
  const omega = (2 * Math.PI * frequencyHz) / sampleRate;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const alpha = sine / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cosine) / 2 / a0,
    b1: -(1 + cosine) / a0,
    b2: (1 + cosine) / 2 / a0,
    a1: (-2 * cosine) / a0,
    a2: (1 - alpha) / a0,
  };
}

function peakingCoefficients(
  sampleRate: number,
  frequencyHz: number,
  gainDb: number,
  quality = 0.8,
): BiquadCoefficients {
  const amplitude = 10 ** (gainDb / 40);
  const omega = (2 * Math.PI * frequencyHz) / sampleRate;
  const alpha = Math.sin(omega) / (2 * quality);
  const cosine = Math.cos(omega);
  const a0 = 1 + alpha / amplitude;
  return {
    b0: (1 + alpha * amplitude) / a0,
    b1: (-2 * cosine) / a0,
    b2: (1 - alpha * amplitude) / a0,
    a1: (-2 * cosine) / a0,
    a2: (1 - alpha / amplitude) / a0,
  };
}

function compress(
  samples: Float32Array,
  sampleRate: number,
  thresholdDb: number,
  ratio: number,
  attackMs: number,
  releaseMs: number,
): Float32Array {
  const output = new Float32Array(samples.length);
  const attackCoefficient = Math.exp(
    -1 / Math.max(1, (attackMs / 1_000) * sampleRate),
  );
  const releaseCoefficient = Math.exp(
    -1 / Math.max(1, (releaseMs / 1_000) * sampleRate),
  );
  let envelope = 0;
  let smoothedGain = 1;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = sanitizeSample(samples[index] ?? 0);
    const absolute = Math.abs(sample);
    const envelopeCoefficient =
      absolute > envelope ? attackCoefficient : releaseCoefficient;
    envelope =
      envelopeCoefficient * envelope + (1 - envelopeCoefficient) * absolute;
    const envelopeDb = linearToDb(envelope);
    const reductionDb =
      envelopeDb > thresholdDb
        ? thresholdDb + (envelopeDb - thresholdDb) / ratio - envelopeDb
        : 0;
    const desiredGain = dbToLinear(reductionDb);
    const gainCoefficient =
      desiredGain < smoothedGain ? attackCoefficient : releaseCoefficient;
    smoothedGain =
      gainCoefficient * smoothedGain + (1 - gainCoefficient) * desiredGain;
    output[index] = sample * smoothedGain;
  }
  return output;
}

function parseArguments(
  audioOrSamples: MonoAudio | Float32Array,
  sampleRateOrOptions?: number | DspPreviewOptions,
  maybeOptions?: DspPreviewOptions,
): { audio: MonoAudio; options: DspPreviewOptions } {
  if (audioOrSamples instanceof Float32Array) {
    if (typeof sampleRateOrOptions !== "number") {
      throw new AudioUtilityError(
        "invalid-audio",
        "A sample rate is required with a sample array.",
      );
    }
    return {
      audio: { samples: audioOrSamples, sampleRate: sampleRateOrOptions },
      options: maybeOptions ?? {},
    };
  }
  return {
    audio: audioOrSamples,
    options: typeof sampleRateOrOptions === "object" ? sampleRateOrOptions : {},
  };
}

export function createDspPreview(
  audio: MonoAudio,
  options?: DspPreviewOptions,
): DspPreviewResult;
export function createDspPreview(
  samples: Float32Array,
  sampleRate: number,
  options?: DspPreviewOptions,
): DspPreviewResult;
export function createDspPreview(
  audioOrSamples: MonoAudio | Float32Array,
  sampleRateOrOptions?: number | DspPreviewOptions,
  maybeOptions?: DspPreviewOptions,
): DspPreviewResult {
  const { audio, options } = parseArguments(
    audioOrSamples,
    sampleRateOrOptions,
    maybeOptions,
  );
  validateMonoAudio(audio);
  const steps: DspPreviewStep[] = [];
  let output: Float32Array = audio.samples.slice();
  const inputRms = calculateRms(output);

  const highPassHz =
    options.highPassHz === false
      ? false
      : clamp(options.highPassHz ?? 70, 20, audio.sampleRate * 0.4);
  if (highPassHz !== false && output.length > 0) {
    output = applyBiquad(
      output,
      highPassCoefficients(audio.sampleRate, highPassHz),
    );
    steps.push({
      id: "high-pass",
      label: "Restrained high-pass",
      detail: `Second-order high-pass at ${Math.round(highPassHz)} Hz to reduce sub-bass rumble.`,
    });
  }

  const presenceFrequencyHz = clamp(
    options.presenceFrequencyHz ?? 3_000,
    200,
    audio.sampleRate * 0.4,
  );
  const presenceGainDb = clamp(options.presenceGainDb ?? 1.5, -3, 3);
  if (Math.abs(presenceGainDb) > 0.01 && output.length > 0) {
    output = applyBiquad(
      output,
      peakingCoefficients(
        audio.sampleRate,
        presenceFrequencyHz,
        presenceGainDb,
      ),
    );
    steps.push({
      id: "presence-eq",
      label: "Gentle presence EQ",
      detail: `${presenceGainDb.toFixed(1)} dB broad adjustment near ${Math.round(presenceFrequencyHz)} Hz.`,
    });
  }

  const thresholdDb = clamp(options.compressorThresholdDb ?? -18, -36, -6);
  const ratio = clamp(options.compressorRatio ?? 2.5, 1, 6);
  const attackMs = clamp(options.compressorAttackMs ?? 12, 1, 100);
  const releaseMs = clamp(options.compressorReleaseMs ?? 140, 20, 1_000);
  if (ratio > 1.01 && output.length > 0) {
    output = compress(
      output,
      audio.sampleRate,
      thresholdDb,
      ratio,
      attackMs,
      releaseMs,
    );
    steps.push({
      id: "gentle-compression",
      label: "Gentle compression",
      detail: `${ratio.toFixed(1)}:1 above ${thresholdDb.toFixed(0)} dBFS with ${attackMs.toFixed(0)} ms attack.`,
    });
  }

  let appliedOutputGainDb = 0;
  if (options.loudnessMatch !== false && inputRms > EPSILON) {
    const outputRms = calculateRms(output);
    if (outputRms > EPSILON) {
      const matchingGain = clamp(
        inputRms / outputRms,
        dbToLinear(-12),
        dbToLinear(6),
      );
      output = applyGain(output, matchingGain);
      appliedOutputGainDb = linearToDb(matchingGain, -60);
      steps.push({
        id: "rms-match",
        label: "Broadband RMS match",
        detail: `${appliedOutputGainDb >= 0 ? "+" : ""}${appliedOutputGainDb.toFixed(1)} dB for a fair local preview comparison; this is not LUFS.`,
      });
    }
  }

  let peakProtectionGainDb = 0;
  const peak = calculatePeak(output);
  if (peak > 0.98) {
    const peakGain = 0.98 / peak;
    output = applyGain(output, peakGain);
    peakProtectionGainDb = linearToDb(peakGain, -60);
    steps.push({
      id: "peak-protection",
      label: "Peak protection",
      detail: `${peakProtectionGainDb.toFixed(1)} dB trim prevents the preview from exceeding -0.2 dBFS.`,
    });
  }

  return {
    samples: output,
    sampleRate: audio.sampleRate,
    steps,
    inputRmsDbFs: linearToDb(inputRms),
    outputRmsDbFs: linearToDb(calculateRms(output)),
    appliedOutputGainDb,
    peakProtectionGainDb,
    loudnessMethod: "broadband-rms",
    disclaimer:
      "Local DSP preview only. It uses fixed filters and dynamics—not the AI restoration pipeline—and does not recover missing detail.",
  };
}
