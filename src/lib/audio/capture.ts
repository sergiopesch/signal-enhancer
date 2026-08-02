import {
  readReportedCaptureSettings,
  requestedCaptureConstraints,
} from "./devices";
import { AudioUtilityError, mapMediaError } from "./errors";
import { concatenateFloat32, sanitizeSample } from "./math";
import {
  MAX_CAPTURE_DURATION_MS,
  PREFERRED_CAPTURE_SAMPLE_RATE,
} from "./types";
import type {
  CaptureMethod,
  CaptureProgress,
  CaptureReady,
  PcmCaptureResult,
} from "./types";
import { encodeMonoWav } from "./wav";

const DEFAULT_WORKLET_URL = "/audio/signal-enhancer-recorder-worklet.js";
const PROGRESS_INTERVAL_MS = 50;

export interface CapturePcmWavOptions {
  readonly stream: MediaStream;
  readonly durationMs?: number;
  readonly deviceId?: string;
  /** Called only after the capture graph is connected; start reference playback here. */
  readonly onReady?: (ready: CaptureReady) => void;
  readonly onProgress?: (progress: CaptureProgress) => void;
  readonly signal?: AbortSignal;
  readonly audioContext?: AudioContext;
  readonly workletUrl?: string;
  readonly preferAudioWorklet?: boolean;
}

interface AudioContextConstructor {
  new (options?: AudioContextOptions): AudioContext;
}

interface WorkletSamplesMessage {
  readonly type: "samples";
  readonly samples: Float32Array;
}

interface WorkletCompleteMessage {
  readonly type: "complete";
}

type WorkletMessage = WorkletSamplesMessage | WorkletCompleteMessage;

function getAudioContextConstructor(): AudioContextConstructor {
  const scope = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };
  const Constructor = scope.AudioContext ?? scope.webkitAudioContext;
  if (Constructor === undefined) {
    throw new AudioUtilityError(
      "unsupported-browser",
      "This browser does not support the Web Audio API required for PCM capture.",
    );
  }
  return Constructor;
}

function createOwnedAudioContext(): AudioContext {
  const Constructor = getAudioContextConstructor();
  try {
    return new Constructor({
      sampleRate: PREFERRED_CAPTURE_SAMPLE_RATE,
      latencyHint: "interactive",
    });
  } catch {
    // Some WebKit versions expose AudioContextOptions but reject sampleRate.
    // The actual context rate remains authoritative and is returned to the caller.
    return new Constructor({ latencyHint: "interactive" });
  }
}

function validateDuration(durationMs: number): void {
  if (
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    durationMs > MAX_CAPTURE_DURATION_MS
  ) {
    throw new AudioUtilityError(
      "invalid-duration",
      `Capture duration must be greater than zero and no longer than ${MAX_CAPTURE_DURATION_MS / 1_000} seconds.`,
    );
  }
}

function copyMonoChunk(
  chunk: Float32Array,
  maximumLength: number,
): Float32Array {
  const length = Math.min(chunk.length, maximumLength);
  const copy = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    copy[index] = sanitizeSample(chunk[index] ?? 0);
  }
  return copy;
}

function averageInputChannels(
  input: AudioBuffer,
  maximumLength: number,
): Float32Array {
  const length = Math.min(input.length, maximumLength);
  const mono = new Float32Array(length);
  if (input.numberOfChannels === 0) {
    return mono;
  }
  for (
    let channelIndex = 0;
    channelIndex < input.numberOfChannels;
    channelIndex += 1
  ) {
    const channel = input.getChannelData(channelIndex);
    for (let frame = 0; frame < length; frame += 1) {
      mono[frame] =
        (mono[frame] ?? 0) +
        sanitizeSample(channel[frame] ?? 0) / input.numberOfChannels;
    }
  }
  return mono;
}

async function safelyCloseContext(
  context: AudioContext,
  owned: boolean,
): Promise<void> {
  if (!owned || context.state === "closed") {
    return;
  }
  try {
    await context.close();
  } catch {
    // Cleanup failure must not replace a completed capture result.
  }
}

export async function capturePcmWav(
  options: CapturePcmWavOptions,
): Promise<PcmCaptureResult> {
  const durationMs = options.durationMs ?? MAX_CAPTURE_DURATION_MS;
  validateDuration(durationMs);
  if (options.signal?.aborted === true) {
    throw new AudioUtilityError(
      "capture-aborted",
      "Audio capture was cancelled.",
    );
  }

  const audioTrack = options.stream.getAudioTracks()[0];
  if (audioTrack === undefined || audioTrack.readyState === "ended") {
    throw new AudioUtilityError(
      "no-audio-track",
      "The selected stream has no live audio track.",
    );
  }

  const ownsContext = options.audioContext === undefined;
  const context = options.audioContext ?? createOwnedAudioContext();
  const sampleRate = context.sampleRate;
  const maximumFrames = Math.max(
    1,
    Math.floor((durationMs * sampleRate) / 1_000),
  );
  const chunks: Float32Array[] = [];
  const warnings: string[] = [];
  let capturedFrames = 0;
  let lastProgressAt = Number.NEGATIVE_INFINITY;
  let method: CaptureMethod = "script-processor";
  let source: MediaStreamAudioSourceNode | null = null;
  let captureNode: AudioNode | null = null;
  let scriptNode: ScriptProcessorNode | null = null;
  let silentGain: GainNode | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let settled = false;
  let progressCallbackFailed = false;

  const reportProgress = (force = false): void => {
    const now = Date.now();
    if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) {
      return;
    }
    lastProgressAt = now;
    const elapsedMs = Math.min(
      durationMs,
      (capturedFrames / sampleRate) * 1_000,
    );
    try {
      options.onProgress?.({
        elapsedMs,
        durationMs,
        ratio: Math.min(1, capturedFrames / maximumFrames),
        capturedFrames,
        method,
      });
    } catch {
      if (!progressCallbackFailed) {
        warnings.push("The capture progress callback failed and was ignored.");
        progressCallbackFailed = true;
      }
    }
  };

  return await new Promise<PcmCaptureResult>((resolve, reject) => {
    const disconnect = (): void => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      options.signal?.removeEventListener("abort", handleAbort);
      audioTrack.removeEventListener("ended", handleTrackEnded);
      if (scriptNode !== null) {
        scriptNode.onaudioprocess = null;
      }
      try {
        captureNode?.disconnect();
        source?.disconnect();
        silentGain?.disconnect();
      } catch {
        // A browser may already have disconnected a node after device removal.
      }
    };

    const settle = (error?: AudioUtilityError): void => {
      if (settled) {
        return;
      }
      settled = true;
      disconnect();
      void safelyCloseContext(context, ownsContext).then(() => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        reportProgress(true);
        const samples = concatenateFloat32(chunks, capturedFrames);
        const wavBytes = encodeMonoWav(
          { samples, sampleRate },
          { encoding: "pcm16" },
        );
        resolve({
          samples,
          sampleRate,
          wav: new Blob([wavBytes], { type: "audio/wav" }),
          wavBytes,
          durationMs: (samples.length / sampleRate) * 1_000,
          method,
          requestedConstraints: requestedCaptureConstraints(options.deviceId),
          reportedSettings: readReportedCaptureSettings(options.stream),
          warnings,
        });
      });
    };

    const appendChunk = (chunk: Float32Array): void => {
      if (settled || capturedFrames >= maximumFrames) {
        return;
      }
      const copy = copyMonoChunk(chunk, maximumFrames - capturedFrames);
      if (copy.length === 0) {
        return;
      }
      chunks.push(copy);
      capturedFrames += copy.length;
      reportProgress(capturedFrames >= maximumFrames);
      if (capturedFrames >= maximumFrames) {
        queueMicrotask(() => settle());
      }
    };

    function handleAbort(): void {
      settle(
        new AudioUtilityError(
          "capture-aborted",
          "Audio capture was cancelled.",
        ),
      );
    }

    function handleTrackEnded(): void {
      settle(
        new AudioUtilityError(
          "device-unavailable",
          "The selected audio input stopped before capture completed.",
        ),
      );
    }

    const connectScriptProcessor = (): void => {
      method = "script-processor";
      const reportedChannels =
        readReportedCaptureSettings(options.stream).channelCount ?? 2;
      const inputChannels = Math.max(
        1,
        Math.min(8, Math.round(reportedChannels)),
      );
      scriptNode = context.createScriptProcessor(2_048, inputChannels, 1);
      scriptNode.onaudioprocess = (event) => {
        appendChunk(
          averageInputChannels(
            event.inputBuffer,
            maximumFrames - capturedFrames,
          ),
        );
      };
      captureNode = scriptNode;
      source?.connect(scriptNode);
      scriptNode.connect(silentGain as GainNode);
    };

    const initialize = async (): Promise<void> => {
      try {
        if (context.state === "suspended") {
          await context.resume();
        }
        if (context.state === "closed") {
          throw new AudioUtilityError(
            "capture-failed",
            "The audio context is already closed.",
          );
        }

        source = context.createMediaStreamSource(options.stream);
        silentGain = context.createGain();
        silentGain.gain.value = 0;
        silentGain.connect(context.destination);

        const canUseWorklet =
          options.preferAudioWorklet !== false &&
          context.audioWorklet !== undefined &&
          typeof AudioWorkletNode !== "undefined";

        if (canUseWorklet) {
          let workletNode: AudioWorkletNode | null = null;
          try {
            await context.audioWorklet.addModule(
              options.workletUrl ?? DEFAULT_WORKLET_URL,
            );
            workletNode = new AudioWorkletNode(
              context,
              "signal-enhancer-mono-recorder",
              {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [1],
                processorOptions: { maximumFrames },
              },
            );
            method = "audio-worklet";
            workletNode.port.onmessage = (
              event: MessageEvent<WorkletMessage>,
            ) => {
              if (
                event.data.type === "samples" &&
                event.data.samples instanceof Float32Array
              ) {
                appendChunk(event.data.samples);
              } else if (event.data.type === "complete") {
                queueMicrotask(() => settle());
              }
            };
            workletNode.onprocessorerror = () => {
              settle(
                new AudioUtilityError(
                  "capture-failed",
                  "The browser audio recorder stopped unexpectedly.",
                ),
              );
            };
            captureNode = workletNode;
            source.connect(workletNode);
            workletNode.connect(silentGain);
          } catch (error) {
            if (workletNode !== null) {
              workletNode.port.onmessage = null;
              workletNode.disconnect();
              source.disconnect();
              captureNode = null;
            }
            warnings.push(
              "AudioWorklet capture was unavailable, so the browser used its compatibility recorder.",
            );
            connectScriptProcessor();
            if (error instanceof AudioUtilityError) {
              throw error;
            }
          }
        } else {
          warnings.push(
            "This browser does not support AudioWorklet capture, so it used its compatibility recorder.",
          );
          connectScriptProcessor();
        }

        options.signal?.addEventListener("abort", handleAbort, { once: true });
        audioTrack.addEventListener("ended", handleTrackEnded, { once: true });
        options.onReady?.({
          audioContext: context,
          method,
          sampleRate,
          startedAtContextTime: context.currentTime,
        });
        reportProgress(true);
        timeoutId = setTimeout(
          () => settle(),
          Math.ceil(durationMs + Math.max(250, (2_048 / sampleRate) * 2_000)),
        );
      } catch (error) {
        settle(mapMediaError(error));
      }
    };

    void initialize();
  });
}
