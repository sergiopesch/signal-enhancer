export const GUIDED_READING_ID = "guided-reading-v1";
export const GUIDED_READING_VERSION = "1.0.0";
export const GUIDED_READING_DURATION_SECONDS = 20;
export const GUIDED_READING_COUNT_IN_SECONDS = 3;
export const GUIDED_READING_COMPLETION_TOLERANCE_SECONDS = 0.05;

export type GuidedReadingCueId = "room-tone" | "natural" | "soft" | "finish";

export type GuidedReadingCue = {
  readonly id: GuidedReadingCueId;
  readonly label: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly instruction: string;
  readonly text: string | null;
};

const ROOM_TONE_CUE: GuidedReadingCue = {
  id: "room-tone",
  label: "Room tone",
  startSeconds: 0,
  endSeconds: 2,
  instruction: "Stay silent and keep still.",
  text: null,
};

export const GUIDED_READING_CUES: readonly GuidedReadingCue[] = [
  ROOM_TONE_CUE,
  {
    id: "natural",
    label: "Natural voice",
    startSeconds: 2,
    endSeconds: 8,
    instruction: "Read in your everyday voice.",
    text: "Beyond the quiet room, clear voices travel through glass and open air.",
  },
  {
    id: "soft",
    label: "Soft but clear",
    startSeconds: 8,
    endSeconds: 14,
    instruction: "Soften your voice without whispering.",
    text: "Soft rain settles; small clocks click, and each calm breath leaves a trace.",
  },
  {
    id: "finish",
    label: "Natural finish",
    startSeconds: 14,
    endSeconds: 20,
    instruction: "Return to your everyday voice and finish steadily.",
    text: "Finish this final line at your natural pace, with steady energy.",
  },
] as const;

export const GUIDED_READING_PASSAGE = GUIDED_READING_CUES.flatMap((cue) =>
  cue.text === null ? [] : [cue.text],
).join(" ");

function clampElapsedSeconds(elapsedSeconds: number): number {
  if (!Number.isFinite(elapsedSeconds)) return 0;
  return Math.max(0, Math.min(GUIDED_READING_DURATION_SECONDS, elapsedSeconds));
}

export function getGuidedReadingCueIndex(elapsedSeconds: number): number {
  const elapsed = clampElapsedSeconds(elapsedSeconds);
  if (elapsed >= GUIDED_READING_DURATION_SECONDS)
    return GUIDED_READING_CUES.length - 1;

  const index = GUIDED_READING_CUES.findIndex(
    (cue) => elapsed >= cue.startSeconds && elapsed < cue.endSeconds,
  );
  return index < 0 ? 0 : index;
}

export function getGuidedReadingCue(elapsedSeconds: number): GuidedReadingCue {
  return (
    GUIDED_READING_CUES[getGuidedReadingCueIndex(elapsedSeconds)] ??
    ROOM_TONE_CUE
  );
}

export function getGuidedReadingProgress(elapsedSeconds: number): number {
  return clampElapsedSeconds(elapsedSeconds) / GUIDED_READING_DURATION_SECONDS;
}

export function isCompleteGuidedReadingDuration(
  durationSeconds: number,
): boolean {
  return (
    Number.isFinite(durationSeconds) &&
    durationSeconds >=
      GUIDED_READING_DURATION_SECONDS -
        GUIDED_READING_COMPLETION_TOLERANCE_SECONDS
  );
}

/** A deterministic, decorative speech-shaped trace for non-audio surfaces. */
export function makeGuidedReadingDisplayTrace(pointCount = 260): number[] {
  const length = Number.isFinite(pointCount)
    ? Math.max(32, Math.min(2_000, Math.round(pointCount)))
    : 260;
  return Array.from({ length }, (_, index) => {
    const seconds =
      (index / Math.max(1, length - 1)) * GUIDED_READING_DURATION_SECONDS;
    if (seconds < 2) {
      return Math.sin(seconds * Math.PI * 11) * 0.008;
    }
    const cueGain = seconds >= 8 && seconds < 14 ? 0.34 : 0.68;
    const phraseEnvelope =
      0.2 + 0.8 * Math.pow(Math.abs(Math.sin(seconds * Math.PI * 2.75)), 0.7);
    const speechShape =
      Math.sin(seconds * Math.PI * 8.6) * 0.58 +
      Math.sin(seconds * Math.PI * 17.9) * 0.26 +
      Math.sin(seconds * Math.PI * 31.4) * 0.12;
    return Math.max(-1, Math.min(1, cueGain * phraseEnvelope * speechShape));
  });
}
