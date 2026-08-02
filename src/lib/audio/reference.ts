import { AudioUtilityError, assertFiniteSampleRate } from "./errors";
import { clamp, dbToLinear } from "./math";
import type { MonoAudio } from "./types";
import { encodeMonoWav } from "./wav";

export const REFERENCE_DIAGNOSTIC_ID = "signal-enhancer-reference";
export const REFERENCE_DIAGNOSTIC_VERSION = "1.0.0";
export const REFERENCE_DIAGNOSTIC_DURATION_SECONDS = 20;
export const REFERENCE_DIAGNOSTIC_URL =
  "/audio/signal-enhancer-reference-v1.wav";
export const REFERENCE_DIAGNOSTIC_SHA256 =
  "127b9e1199cfa4a2b634bca86ef614cc2e862ef51a5a360bd3016a004854019d";

export type ReferenceSegmentId =
  "silence" | "sweep" | "transients" | "quiet-voice" | "loud-voice";

export interface ReferenceSegment {
  readonly id: ReferenceSegmentId;
  readonly label: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly purpose: string;
}

export const REFERENCE_SEGMENTS: readonly ReferenceSegment[] = [
  {
    id: "silence",
    label: "Silence",
    startSeconds: 0,
    endSeconds: 2,
    purpose: "Estimate the steady noise-floor proxy.",
  },
  {
    id: "sweep",
    label: "Sweep",
    startSeconds: 2,
    endSeconds: 6,
    purpose: "Expose frequency response and high-frequency roll-off patterns.",
  },
  {
    id: "transients",
    label: "Clicks",
    startSeconds: 6,
    endSeconds: 10,
    purpose: "Expose transient control, limiting, and suppression patterns.",
  },
  {
    id: "quiet-voice",
    label: "Quiet probe",
    startSeconds: 10,
    endSeconds: 15,
    purpose:
      "Expose gain-riding and suppression patterns with a speech-shaped probe.",
  },
  {
    id: "loud-voice",
    label: "Loud probe",
    startSeconds: 15,
    endSeconds: 20,
    purpose: "Expose compression, clipping, and peak-control patterns.",
  },
] as const;

export interface ReferenceDiagnostic extends MonoAudio {
  readonly id: typeof REFERENCE_DIAGNOSTIC_ID;
  readonly version: typeof REFERENCE_DIAGNOSTIC_VERSION;
  readonly durationSeconds: typeof REFERENCE_DIAGNOSTIC_DURATION_SECONDS;
  readonly segments: typeof REFERENCE_SEGMENTS;
  /** Synthetic and deterministic; no recorded voice or third-party asset is embedded. */
  readonly source: "procedural-speech-shaped-diagnostic";
}

export interface ReferencePlaybackOptions {
  readonly buffer?: AudioBuffer;
  readonly destination?: AudioNode;
  readonly offsetSeconds?: number;
  readonly volume?: number;
}

export interface ReferencePlaybackController {
  readonly buffer: AudioBuffer;
  readonly source: AudioBufferSourceNode;
  readonly ended: Promise<void>;
  stop(): void;
}

const referenceCache = new Map<number, ReferenceDiagnostic>();
const audioBufferCache = new WeakMap<BaseAudioContext, AudioBuffer>();
const decodedBufferPromiseCache = new WeakMap<
  BaseAudioContext,
  Promise<AudioBuffer>
>();

async function sha256Hex(buffer: ArrayBuffer): Promise<string | null> {
  if (globalThis.crypto?.subtle === undefined) {
    return null;
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function fadeEnvelope(
  time: number,
  duration: number,
  fadeSeconds: number,
): number {
  return Math.min(1, time / fadeSeconds, (duration - time) / fadeSeconds);
}

function addSweep(samples: Float32Array, sampleRate: number): void {
  const startFrame = Math.round(2 * sampleRate);
  const frameCount = Math.round(4 * sampleRate);
  const startFrequency = 45;
  const endFrequency = Math.min(18_000, sampleRate * 0.42);
  const logarithmicRatio = Math.log(endFrequency / startFrequency);
  const amplitude = dbToLinear(-15);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / sampleRate;
    const phase =
      (2 *
        Math.PI *
        startFrequency *
        4 *
        (Math.exp((time / 4) * logarithmicRatio) - 1)) /
      logarithmicRatio;
    const envelope = fadeEnvelope(time, 4, 0.025);
    samples[startFrame + frame] =
      Math.sin(phase) * amplitude * Math.max(0, envelope);
  }
}

function addTransientProbe(samples: Float32Array, sampleRate: number): void {
  const random = seededRandom(0x5349474e);
  const noiseStart = Math.round(7.35 * sampleRate);
  const noiseEnd = Math.round(8.45 * sampleRate);
  for (let frame = noiseStart; frame < noiseEnd; frame += 1) {
    const localTime = (frame - noiseStart) / sampleRate;
    const duration = (noiseEnd - noiseStart) / sampleRate;
    const envelope = fadeEnvelope(localTime, duration, 0.04);
    samples[frame] =
      (random() * 2 - 1) * dbToLinear(-23) * Math.max(0, envelope);
  }

  const clickTimes = [6.25, 6.75, 7.05, 8.8, 9.15, 9.5];
  const clickLength = Math.max(1, Math.round(sampleRate * 0.008));
  for (const clickTime of clickTimes) {
    const clickStart = Math.round(clickTime * sampleRate);
    for (let frame = 0; frame < clickLength; frame += 1) {
      const decay = Math.exp(-frame / Math.max(1, sampleRate * 0.0009));
      const polarity = frame % 2 === 0 ? 1 : -0.65;
      const index = clickStart + frame;
      samples[index] = clamp(
        (samples[index] ?? 0) + polarity * decay * 0.62,
        -0.9,
        0.9,
      );
    }
  }
}

interface Syllable {
  readonly start: number;
  readonly duration: number;
  readonly fundamental: number;
  readonly formants: readonly [number, number, number];
}

const SYLLABLES: readonly Syllable[] = [
  {
    start: 0.18,
    duration: 0.58,
    fundamental: 118,
    formants: [700, 1_220, 2_600],
  },
  {
    start: 0.9,
    duration: 0.5,
    fundamental: 126,
    formants: [430, 1_780, 2_650],
  },
  {
    start: 1.58,
    duration: 0.65,
    fundamental: 114,
    formants: [520, 1_050, 2_450],
  },
  {
    start: 2.42,
    duration: 0.48,
    fundamental: 132,
    formants: [300, 2_100, 2_850],
  },
  {
    start: 3.1,
    duration: 0.62,
    fundamental: 120,
    formants: [640, 1_300, 2_500],
  },
  {
    start: 3.9,
    duration: 0.7,
    fundamental: 110,
    formants: [420, 1_650, 2_700],
  },
] as const;

function formantWeight(
  frequency: number,
  formants: readonly [number, number, number],
): number {
  let weight = 0.025;
  const bandwidths = [100, 150, 240] as const;
  for (let index = 0; index < formants.length; index += 1) {
    const formant = formants[index] ?? 1;
    const bandwidth = bandwidths[index] ?? 150;
    const distance = (frequency - formant) / bandwidth;
    weight += Math.exp(-0.5 * distance * distance);
  }
  return weight;
}

function createSpeechShapedProbe(sampleRate: number): Float32Array {
  const samples = new Float32Array(5 * sampleRate);
  const random = seededRandom(0x564f4943);
  for (const syllable of SYLLABLES) {
    const startFrame = Math.round(syllable.start * sampleRate);
    const frameCount = Math.round(syllable.duration * sampleRate);
    for (let frame = 0; frame < frameCount; frame += 1) {
      const time = frame / sampleRate;
      const progress = time / syllable.duration;
      const fundamental =
        syllable.fundamental * (1 + 0.025 * Math.sin(2 * Math.PI * progress));
      let voiced = 0;
      for (let harmonic = 1; harmonic <= 18; harmonic += 1) {
        const frequency = fundamental * harmonic;
        if (frequency >= sampleRate * 0.45) {
          break;
        }
        const weight = formantWeight(frequency, syllable.formants) / harmonic;
        voiced +=
          Math.sin(2 * Math.PI * frequency * time + harmonic * 0.17) * weight;
      }
      const attack = Math.min(1, time / 0.035);
      const release = Math.min(1, (syllable.duration - time) / 0.075);
      const envelope = Math.max(0, attack * release);
      const breath = (random() * 2 - 1) * 0.025;
      const sampleIndex = startFrame + frame;
      samples[sampleIndex] =
        (samples[sampleIndex] ?? 0) + (voiced * 0.11 + breath) * envelope;
    }
  }

  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index] ?? 0));
  }
  const gain = peak > 0 ? 0.72 / peak : 1;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = (samples[index] ?? 0) * gain;
  }
  return samples;
}

export function createReferenceDiagnostic(
  sampleRate = 48_000,
): ReferenceDiagnostic {
  assertFiniteSampleRate(sampleRate);
  const integerSampleRate = Math.round(sampleRate);
  const cached = referenceCache.get(integerSampleRate);
  if (cached !== undefined) {
    return cached;
  }

  const samples = new Float32Array(
    integerSampleRate * REFERENCE_DIAGNOSTIC_DURATION_SECONDS,
  );
  addSweep(samples, integerSampleRate);
  addTransientProbe(samples, integerSampleRate);
  const speechProbe = createSpeechShapedProbe(integerSampleRate);
  const quietGain = dbToLinear(-13);
  const loudGain = dbToLinear(-3.5);
  const quietStart = 10 * integerSampleRate;
  const loudStart = 15 * integerSampleRate;
  for (let frame = 0; frame < speechProbe.length; frame += 1) {
    const sample = speechProbe[frame] ?? 0;
    samples[quietStart + frame] = sample * quietGain;
    samples[loudStart + frame] = sample * loudGain;
  }

  const diagnostic: ReferenceDiagnostic = {
    id: REFERENCE_DIAGNOSTIC_ID,
    version: REFERENCE_DIAGNOSTIC_VERSION,
    durationSeconds: REFERENCE_DIAGNOSTIC_DURATION_SECONDS,
    sampleRate: integerSampleRate,
    samples,
    segments: REFERENCE_SEGMENTS,
    source: "procedural-speech-shaped-diagnostic",
  };
  referenceCache.set(integerSampleRate, diagnostic);
  return diagnostic;
}

export function createReferenceDiagnosticWav(sampleRate = 48_000): ArrayBuffer {
  return encodeMonoWav(createReferenceDiagnostic(sampleRate), {
    encoding: "pcm16",
  });
}

export function getReferenceDiagnosticAudioBuffer(
  context: BaseAudioContext,
): AudioBuffer {
  const cached = audioBufferCache.get(context);
  if (cached !== undefined) {
    return cached;
  }
  const diagnostic = createReferenceDiagnostic(context.sampleRate);
  const buffer = context.createBuffer(
    1,
    diagnostic.samples.length,
    diagnostic.sampleRate,
  );
  buffer.copyToChannel(new Float32Array(diagnostic.samples), 0);
  audioBufferCache.set(context, buffer);
  return buffer;
}

/**
 * Loads the checked-in, versioned WAV and decodes it once per audio context.
 * Reusing the resolved AudioBuffer for Input A and Input B prevents source drift.
 */
export async function loadReferenceDiagnosticAudioBuffer(
  context: BaseAudioContext,
  url = REFERENCE_DIAGNOSTIC_URL,
): Promise<AudioBuffer> {
  const existingBuffer = audioBufferCache.get(context);
  if (existingBuffer !== undefined) {
    return existingBuffer;
  }
  const existingPromise = decodedBufferPromiseCache.get(context);
  if (existingPromise !== undefined) {
    return existingPromise;
  }
  if (typeof fetch !== "function") {
    throw new AudioUtilityError(
      "playback-failed",
      "Reference audio loading is unavailable in this environment.",
    );
  }

  const promise = (async () => {
    try {
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) {
        throw new Error(
          `Reference request failed with status ${response.status}.`,
        );
      }
      const encoded = await response.arrayBuffer();
      if (encoded.byteLength < 44 || encoded.byteLength > 4 * 1_024 * 1_024) {
        throw new Error(
          "Reference WAV size was outside the expected safety bounds.",
        );
      }
      const digest = await sha256Hex(encoded);
      if (digest !== null && digest !== REFERENCE_DIAGNOSTIC_SHA256) {
        throw new Error(
          "Reference WAV checksum did not match the pinned diagnostic version.",
        );
      }
      const buffer = await context.decodeAudioData(encoded.slice(0));
      const frameTolerance = 2 / buffer.sampleRate;
      if (
        buffer.numberOfChannels < 1 ||
        Math.abs(buffer.duration - REFERENCE_DIAGNOSTIC_DURATION_SECONDS) >
          frameTolerance
      ) {
        throw new Error(
          "Reference WAV metadata did not match the pinned diagnostic version.",
        );
      }
      audioBufferCache.set(context, buffer);
      return buffer;
    } catch (error) {
      decodedBufferPromiseCache.delete(context);
      throw new AudioUtilityError(
        "playback-failed",
        "The versioned diagnostic reference could not be loaded.",
        error,
      );
    }
  })();
  decodedBufferPromiseCache.set(context, promise);
  return promise;
}

export async function playReferenceDiagnostic(
  context: AudioContext,
  options: ReferencePlaybackOptions = {},
): Promise<ReferencePlaybackController> {
  if (context.state === "closed") {
    throw new AudioUtilityError(
      "playback-failed",
      "The audio context is closed.",
    );
  }
  try {
    if (context.state === "suspended") {
      await context.resume();
    }
    const buffer =
      options.buffer ?? (await loadReferenceDiagnosticAudioBuffer(context));
    const offsetSeconds = clamp(options.offsetSeconds ?? 0, 0, buffer.duration);
    const gain = context.createGain();
    gain.gain.value = clamp(options.volume ?? 1, 0, 1);
    gain.connect(options.destination ?? context.destination);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    let stopped = false;
    let resolveEnded: (() => void) | null = null;
    const ended = new Promise<void>((resolve) => {
      resolveEnded = resolve;
    });
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      resolveEnded?.();
      resolveEnded = null;
    };
    source.start(0, offsetSeconds);
    return {
      buffer,
      source,
      ended,
      stop(): void {
        if (stopped) {
          return;
        }
        stopped = true;
        try {
          source.stop();
        } catch {
          // stop() is intentionally idempotent for UI cleanup.
        }
      },
    };
  } catch (error) {
    if (error instanceof AudioUtilityError) {
      throw error;
    }
    throw new AudioUtilityError(
      "playback-failed",
      "The diagnostic reference could not be played.",
      error,
    );
  }
}
