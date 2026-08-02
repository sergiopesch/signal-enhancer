export const MAX_CAPTURE_DURATION_MS = 20_000;
export const PREFERRED_CAPTURE_SAMPLE_RATE = 48_000;

export interface MonoAudio {
  readonly samples: Float32Array;
  readonly sampleRate: number;
}

export interface AudioInputDevice {
  readonly deviceId: string;
  readonly groupId: string;
  /** The label exactly as reported by the browser. It is often empty before permission. */
  readonly reportedLabel: string;
  /** A neutral fallback for display; it is not asserted to be the physical device name. */
  readonly displayLabel: string;
  readonly labelAvailable: boolean;
}

export interface RequestedCaptureConstraints {
  readonly deviceId: string | null;
  readonly channelCount: 1;
  readonly sampleRate: number;
  readonly echoCancellation: false;
  readonly noiseSuppression: false;
  readonly autoGainControl: false;
}

export interface ReportedCaptureSettings {
  readonly deviceId: string | null;
  readonly groupId: string | null;
  readonly sampleRate: number | null;
  readonly channelCount: number | null;
  readonly echoCancellation: boolean | null;
  readonly noiseSuppression: boolean | null;
  readonly autoGainControl: boolean | null;
  readonly latency: number | null;
}

export type CaptureMethod = "audio-worklet" | "script-processor";

export interface CaptureProgress {
  readonly elapsedMs: number;
  readonly durationMs: number;
  readonly ratio: number;
  readonly capturedFrames: number;
  readonly method: CaptureMethod;
}

export interface CaptureReady {
  /** Reuse this context and its cached reference AudioBuffer for synchronized playback. */
  readonly audioContext: AudioContext;
  readonly method: CaptureMethod;
  readonly sampleRate: number;
  readonly startedAtContextTime: number;
}

export interface PcmCaptureResult extends MonoAudio {
  readonly wav: Blob;
  readonly wavBytes: ArrayBuffer;
  readonly durationMs: number;
  readonly method: CaptureMethod;
  readonly requestedConstraints: RequestedCaptureConstraints;
  readonly reportedSettings: ReportedCaptureSettings;
  /** Non-fatal compatibility notes, such as an AudioWorklet fallback. */
  readonly warnings: readonly string[];
}

export type WavSampleFormat = "pcm" | "ieee-float";

export interface DecodedWav extends MonoAudio {
  readonly channelData: readonly Float32Array[];
  readonly numberOfChannels: number;
  readonly numberOfFrames: number;
  readonly durationSeconds: number;
  readonly bitsPerSample: number;
  readonly sampleFormat: WavSampleFormat;
}

export interface WaveformBin {
  readonly startSample: number;
  readonly endSample: number;
  readonly min: number;
  readonly max: number;
  readonly rms: number;
}

export interface SpectrumBin {
  readonly frequencyHz: number;
  readonly magnitude: number;
  readonly magnitudeDbFs: number;
}

export interface DynamicsBin {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly rms: number;
  readonly rmsDbFs: number;
  readonly peak: number;
}

export interface AudioLevelMetrics {
  readonly rms: number;
  readonly rmsDbFs: number;
  readonly peak: number;
  readonly peakDbFs: number;
  readonly dcOffset: number;
  readonly crestFactorDb: number;
  /** Low-percentile short-window energy. This is a proxy, not a calibrated SPL reading. */
  readonly noiseFloorProxyDbFs: number;
  /** High-percentile minus low-percentile short-window energy. */
  readonly dynamicRangeProxyDb: number;
  readonly clippingSampleCount: number;
  readonly clippingFraction: number;
}

export interface AudioAnalysis {
  readonly sampleRate: number;
  readonly sampleCount: number;
  readonly durationSeconds: number;
  readonly waveform: readonly WaveformBin[];
  readonly spectrum: readonly SpectrumBin[];
  readonly dynamics: readonly DynamicsBin[];
  readonly metrics: AudioLevelMetrics;
}

export interface ComparisonSignal extends MonoAudio {
  readonly gain: number;
  readonly gainDb: number;
  readonly originalRmsDbFs: number;
}

export interface AudioComparison {
  readonly sampleRate: number;
  readonly length: number;
  readonly durationSeconds: number;
  readonly loudnessMatched: boolean;
  /** The matching method is intentionally named: it is broadband RMS, not LUFS. */
  readonly matchingMethod: "none" | "broadband-rms";
  readonly a: ComparisonSignal;
  readonly b: ComparisonSignal;
  readonly difference: Float32Array;
  readonly differenceForPlayback: Float32Array;
  readonly differencePeak: number;
}

export interface DspPreviewStep {
  readonly id:
    | "high-pass"
    | "presence-eq"
    | "gentle-compression"
    | "rms-match"
    | "peak-protection";
  readonly label: string;
  readonly detail: string;
}

export interface DspPreviewResult extends MonoAudio {
  readonly steps: readonly DspPreviewStep[];
  readonly inputRmsDbFs: number;
  readonly outputRmsDbFs: number;
  readonly appliedOutputGainDb: number;
  readonly peakProtectionGainDb: number;
  readonly loudnessMethod: "broadband-rms";
  readonly disclaimer: string;
}
