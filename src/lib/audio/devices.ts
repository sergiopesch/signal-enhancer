import { AudioUtilityError, mapMediaError } from "./errors";
import { PREFERRED_CAPTURE_SAMPLE_RATE } from "./types";
import type {
  AudioInputDevice,
  ReportedCaptureSettings,
  RequestedCaptureConstraints,
} from "./types";

export interface AudioBrowserSupport {
  readonly secureContext: boolean;
  readonly getUserMedia: boolean;
  readonly enumerateDevices: boolean;
  readonly audioContext: boolean;
  readonly audioWorklet: boolean;
  readonly outputDeviceSelection: boolean;
}

export function getAudioBrowserSupport(): AudioBrowserSupport {
  const scope = globalThis as typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };
  const mediaDevices =
    typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  const audioContext = scope.AudioContext ?? scope.webkitAudioContext;
  const audioElementPrototype =
    typeof HTMLMediaElement === "undefined"
      ? undefined
      : HTMLMediaElement.prototype;
  return {
    secureContext:
      typeof window === "undefined" || window.isSecureContext !== false,
    getUserMedia: typeof mediaDevices?.getUserMedia === "function",
    enumerateDevices: typeof mediaDevices?.enumerateDevices === "function",
    audioContext: audioContext !== undefined,
    audioWorklet:
      audioContext !== undefined &&
      typeof AudioWorkletNode !== "undefined" &&
      "audioWorklet" in audioContext.prototype,
    outputDeviceSelection:
      audioElementPrototype !== undefined &&
      "setSinkId" in audioElementPrototype,
  };
}

function getMediaDevices(): MediaDevices {
  if (
    typeof navigator === "undefined" ||
    navigator.mediaDevices === undefined
  ) {
    throw new AudioUtilityError(
      "unsupported-browser",
      "This browser does not expose microphone capture APIs.",
    );
  }
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    throw new AudioUtilityError(
      "insecure-context",
      "Microphone access requires HTTPS or a local development origin.",
    );
  }
  return navigator.mediaDevices;
}

export function requestedCaptureConstraints(
  deviceId?: string,
): RequestedCaptureConstraints {
  return {
    deviceId: deviceId !== undefined && deviceId.length > 0 ? deviceId : null,
    channelCount: 1,
    sampleRate: PREFERRED_CAPTURE_SAMPLE_RATE,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
}

function toMediaTrackConstraints(
  requested: RequestedCaptureConstraints,
): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {
    channelCount: { ideal: requested.channelCount },
    sampleRate: { ideal: requested.sampleRate },
    echoCancellation: { ideal: requested.echoCancellation },
    noiseSuppression: { ideal: requested.noiseSuppression },
    autoGainControl: { ideal: requested.autoGainControl },
  };
  if (requested.deviceId !== null) {
    constraints.deviceId = { exact: requested.deviceId };
  }
  return constraints;
}

export async function listAudioInputs(): Promise<AudioInputDevice[]> {
  const mediaDevices = getMediaDevices();
  if (typeof mediaDevices.enumerateDevices !== "function") {
    throw new AudioUtilityError(
      "unsupported-browser",
      "This browser cannot enumerate audio inputs.",
    );
  }
  try {
    const devices = await mediaDevices.enumerateDevices();
    let inputIndex = 0;
    return devices
      .filter((device) => device.kind === "audioinput")
      .map((device) => {
        inputIndex += 1;
        const reportedLabel = device.label.trim();
        return {
          deviceId: device.deviceId,
          groupId: device.groupId,
          reportedLabel,
          displayLabel:
            reportedLabel || `Audio input ${inputIndex} · browser unnamed`,
          labelAvailable: reportedLabel.length > 0,
        };
      });
  } catch (error) {
    throw mapMediaError(error);
  }
}

export async function requestAudioPermission(
  deviceId?: string,
): Promise<MediaStream> {
  const mediaDevices = getMediaDevices();
  if (typeof mediaDevices.getUserMedia !== "function") {
    throw new AudioUtilityError(
      "unsupported-browser",
      "This browser cannot request microphone access.",
    );
  }
  const requested = requestedCaptureConstraints(deviceId);
  try {
    const stream = await mediaDevices.getUserMedia({
      audio: toMediaTrackConstraints(requested),
      video: false,
    });
    if (stream.getAudioTracks().length === 0) {
      stopMediaStream(stream);
      throw new AudioUtilityError(
        "no-audio-track",
        "The browser returned a media stream without an audio track.",
      );
    }
    return stream;
  } catch (error) {
    throw mapMediaError(error);
  }
}

function finiteNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function readReportedCaptureSettings(
  stream: MediaStream,
): ReportedCaptureSettings {
  const track = stream.getAudioTracks()[0];
  const settings = track?.getSettings();
  const extendedSettings = settings as
    (MediaTrackSettings & { latency?: number }) | undefined;
  return {
    deviceId: settings?.deviceId ?? null,
    groupId: settings?.groupId ?? null,
    sampleRate: finiteNumber(settings?.sampleRate),
    channelCount: finiteNumber(settings?.channelCount),
    echoCancellation: booleanOrNull(settings?.echoCancellation),
    noiseSuppression: booleanOrNull(settings?.noiseSuppression),
    autoGainControl: booleanOrNull(settings?.autoGainControl),
    latency: finiteNumber(extendedSettings?.latency),
  };
}

export function stopMediaStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}
