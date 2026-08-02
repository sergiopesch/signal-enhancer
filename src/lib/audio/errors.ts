export type AudioUtilityErrorCode =
  | "unsupported-browser"
  | "insecure-context"
  | "permission-denied"
  | "device-not-found"
  | "device-unavailable"
  | "constraints-unsatisfied"
  | "no-audio-track"
  | "invalid-duration"
  | "capture-aborted"
  | "capture-failed"
  | "invalid-audio"
  | "invalid-wav"
  | "unsupported-wav"
  | "playback-failed";

export class AudioUtilityError extends Error {
  readonly code: AudioUtilityErrorCode;
  override readonly cause: unknown;

  constructor(code: AudioUtilityErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "AudioUtilityError";
    this.code = code;
    this.cause = cause;
  }
}

export function mapMediaError(error: unknown): AudioUtilityError {
  if (error instanceof AudioUtilityError) {
    return error;
  }

  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
      return new AudioUtilityError(
        "permission-denied",
        "Microphone access was not granted. Check the browser permission and try again.",
        error,
      );
    case "NotFoundError":
      return new AudioUtilityError(
        "device-not-found",
        "The selected audio input is no longer available.",
        error,
      );
    case "NotReadableError":
    case "AbortError":
      return new AudioUtilityError(
        "device-unavailable",
        "The audio input could not be opened. Another application may be using it.",
        error,
      );
    case "OverconstrainedError":
      return new AudioUtilityError(
        "constraints-unsatisfied",
        "The selected input could not satisfy the requested capture settings.",
        error,
      );
    case "SecurityError":
      return new AudioUtilityError(
        "insecure-context",
        "Microphone capture requires a secure browser context.",
        error,
      );
    default:
      return new AudioUtilityError(
        "capture-failed",
        "Audio capture failed unexpectedly.",
        error,
      );
  }
}

export function assertFiniteSampleRate(sampleRate: number): void {
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate < 8_000 ||
    sampleRate > 384_000
  ) {
    throw new AudioUtilityError(
      "invalid-audio",
      "Sample rate must be between 8 kHz and 384 kHz.",
    );
  }
}
