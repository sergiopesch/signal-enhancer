import { AudioUtilityError, assertFiniteSampleRate } from "./errors";
import { DB_FLOOR, linearToDb, sanitizeSample } from "./math";
import {
  GUIDED_READING_COMPLETION_TOLERANCE_SECONDS,
  GUIDED_READING_CUES,
  GUIDED_READING_DURATION_SECONDS,
  isCompleteGuidedReadingDuration,
  type GuidedReadingCueId,
} from "./reading-passage";

export type AssessmentTrack = "A" | "B";
export type TrackInsightTone = "strength" | "attention" | "context";
export type TrackInsightMetric =
  | "capture-length"
  | "room-tone"
  | "spoken-level"
  | "digital-headroom"
  | "soft-contrast"
  | "clipping";

export interface TrackCueMetrics {
  readonly cueId: GuidedReadingCueId;
  readonly label: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly complete: boolean;
  readonly sampleCount: number;
  readonly rmsDbFs: number;
  readonly peakDbFs: number;
  readonly clippingFraction: number;
}

export interface TrackInsight {
  readonly id: string;
  readonly track: AssessmentTrack;
  readonly tone: TrackInsightTone;
  readonly metric: TrackInsightMetric;
  readonly title: string;
  readonly detail: string;
  readonly measuredValue: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly basis: "absolute-threshold" | "guided-cue-contrast";
}

export interface IndividualTrackAssessment {
  readonly track: AssessmentTrack;
  readonly sampleRate: number;
  readonly durationSeconds: number;
  readonly cues: readonly TrackCueMetrics[];
  readonly insights: readonly TrackInsight[];
}

/**
 * Published thresholds make the assessment deterministic and reviewable. They
 * are conservative digital-signal checks, not calibrated acoustic targets.
 */
export const TRACK_ASSESSMENT_THRESHOLDS = {
  clippingSampleAmplitude: 0.999,
  clippingAttentionFraction: 0.0001,
  roomToneStrengthMaxDbFs: -55,
  roomToneAttentionMinDbFs: -42,
  spokenLowRmsDbFs: -36,
  headroomStrengthMaxPeakDbFs: -3,
  headroomAttentionMinPeakDbFs: -1,
  cueSignalAboveRoomToneDb: 6,
  softContrastStrengthMinDb: 3,
  softContrastAttentionMaxDb: 1,
  completeDurationToleranceSeconds: GUIDED_READING_COMPLETION_TOLERANCE_SECONDS,
} as const;

type RangeMetrics = {
  readonly sampleCount: number;
  readonly rmsDbFs: number;
  readonly peakDbFs: number;
  readonly clippingFraction: number;
};

// Float32 quantization can move an exact generated boundary by a few millionths
// of a decibel. This tolerance preserves the declared inclusive thresholds.
const DB_THRESHOLD_EPSILON = 0.0001;

function measureRange(
  samples: Float32Array,
  sampleRate: number,
  startSeconds: number,
  endSeconds: number,
): RangeMetrics {
  const startFrame = Math.min(
    samples.length,
    Math.max(0, Math.floor(startSeconds * sampleRate)),
  );
  const endFrame = Math.min(
    samples.length,
    Math.max(startFrame, Math.ceil(endSeconds * sampleRate)),
  );
  const sampleCount = endFrame - startFrame;
  if (sampleCount === 0) {
    return {
      sampleCount: 0,
      rmsDbFs: DB_FLOOR,
      peakDbFs: DB_FLOOR,
      clippingFraction: 0,
    };
  }

  let sumSquares = 0;
  let peak = 0;
  let clippingSamples = 0;
  for (let index = startFrame; index < endFrame; index += 1) {
    const sample = sanitizeSample(samples[index] ?? 0);
    const absolute = Math.abs(sample);
    sumSquares += sample * sample;
    peak = Math.max(peak, absolute);
    if (absolute >= TRACK_ASSESSMENT_THRESHOLDS.clippingSampleAmplitude) {
      clippingSamples += 1;
    }
  }

  return {
    sampleCount,
    rmsDbFs: linearToDb(Math.sqrt(sumSquares / sampleCount)),
    peakDbFs: linearToDb(peak),
    clippingFraction: clippingSamples / sampleCount,
  };
}

function formatDb(label: "RMS" | "Peak", value: number): string {
  return `${label} ${value.toFixed(1)} dBFS`;
}

function formatClipping(fraction: number): string {
  return `${(fraction * 100).toFixed(3)}% clipped samples`;
}

function insight(
  track: AssessmentTrack,
  metric: TrackInsightMetric,
  tone: TrackInsightTone,
  title: string,
  detail: string,
  measuredValue: string,
  startSeconds: number,
  endSeconds: number,
  basis: TrackInsight["basis"] = "absolute-threshold",
): TrackInsight {
  return {
    id: `${track.toLowerCase()}-${metric}`,
    track,
    tone,
    metric,
    title,
    detail,
    measuredValue,
    startSeconds,
    endSeconds,
    basis,
  };
}

function cueById(
  cues: readonly TrackCueMetrics[],
  cueId: GuidedReadingCueId,
): TrackCueMetrics {
  const cue = cues.find((candidate) => candidate.cueId === cueId);
  if (cue === undefined) {
    throw new AudioUtilityError(
      "invalid-audio",
      `Guided reading cue ${cueId} is not configured.`,
    );
  }
  return cue;
}

/**
 * Assesses one capture independently. No peer track is accepted, so equal
 * captures cannot be forced into a leader/loser claim. All conclusions remain
 * tied to a measured digital value and a guided-reading time range.
 */
export function assessIndividualTrack(
  samples: Float32Array,
  sampleRate: number,
  track: AssessmentTrack,
): IndividualTrackAssessment {
  assertFiniteSampleRate(sampleRate);
  if (!(samples instanceof Float32Array)) {
    throw new AudioUtilityError(
      "invalid-audio",
      "Track assessment samples must be a Float32Array.",
    );
  }

  const durationSeconds = samples.length / sampleRate;
  const cues = GUIDED_READING_CUES.map((cue) => ({
    cueId: cue.id,
    label: cue.label,
    startSeconds: cue.startSeconds,
    endSeconds: cue.endSeconds,
    complete:
      durationSeconds >=
      cue.endSeconds - GUIDED_READING_COMPLETION_TOLERANCE_SECONDS,
    ...measureRange(samples, sampleRate, cue.startSeconds, cue.endSeconds),
  }));
  const roomTone = cueById(cues, "room-tone");
  const natural = cueById(cues, "natural");
  const soft = cueById(cues, "soft");
  const finish = cueById(cues, "finish");
  const readingStart = natural.startSeconds;
  const readingEnd = finish.endSeconds;
  const spoken = measureRange(samples, sampleRate, readingStart, readingEnd);
  const entire = measureRange(
    samples,
    sampleRate,
    0,
    GUIDED_READING_DURATION_SECONDS,
  );
  const insights: TrackInsight[] = [];

  if (!isCompleteGuidedReadingDuration(durationSeconds)) {
    insights.push(
      insight(
        track,
        "capture-length",
        "attention",
        "The capture ends before the guided reading",
        "Later cues do not contain a complete measurement, so their evidence should be interpreted cautiously.",
        `${durationSeconds.toFixed(1)} s captured`,
        Math.min(durationSeconds, GUIDED_READING_DURATION_SECONDS),
        GUIDED_READING_DURATION_SECONDS,
      ),
    );
    return {
      track,
      sampleRate,
      durationSeconds,
      cues,
      insights,
    };
  }

  if (
    roomTone.rmsDbFs <=
    TRACK_ASSESSMENT_THRESHOLDS.roomToneStrengthMaxDbFs + DB_THRESHOLD_EPSILON
  ) {
    insights.push(
      insight(
        track,
        "room-tone",
        "strength",
        "Room-tone energy stays low",
        "The opening pause contains low digital energy. This is not a calibrated room-noise reading.",
        formatDb("RMS", roomTone.rmsDbFs),
        roomTone.startSeconds,
        roomTone.endSeconds,
      ),
    );
  } else if (
    roomTone.rmsDbFs >=
    TRACK_ASSESSMENT_THRESHOLDS.roomToneAttentionMinDbFs - DB_THRESHOLD_EPSILON
  ) {
    insights.push(
      insight(
        track,
        "room-tone",
        "attention",
        "Room-tone energy is prominent",
        "The opening pause contains persistent energy worth checking before interpreting quieter reading detail.",
        formatDb("RMS", roomTone.rmsDbFs),
        roomTone.startSeconds,
        roomTone.endSeconds,
      ),
    );
  } else {
    insights.push(
      insight(
        track,
        "room-tone",
        "context",
        "Room-tone energy is measurable",
        "The opening pause sits between the low-energy and review thresholds. It is descriptive, not a quality score.",
        formatDb("RMS", roomTone.rmsDbFs),
        roomTone.startSeconds,
        roomTone.endSeconds,
      ),
    );
  }

  const spokenIsLow =
    spoken.rmsDbFs < TRACK_ASSESSMENT_THRESHOLDS.spokenLowRmsDbFs;
  insights.push(
    insight(
      track,
      "spoken-level",
      spokenIsLow ? "attention" : "context",
      spokenIsLow
        ? "Reading passages are captured at a low digital level"
        : "Reading level is measured without normalization",
      spokenIsLow
        ? "A stronger, still-unclipped repeat may make low-level detail easier to inspect."
        : "This level describes the capture as recorded; it does not rank the voice or input chain.",
      formatDb("RMS", spoken.rmsDbFs),
      readingStart,
      readingEnd,
    ),
  );

  const cuesRiseAboveRoomTone =
    natural.rmsDbFs - roomTone.rmsDbFs >=
      TRACK_ASSESSMENT_THRESHOLDS.cueSignalAboveRoomToneDb &&
    soft.rmsDbFs - roomTone.rmsDbFs >=
      TRACK_ASSESSMENT_THRESHOLDS.cueSignalAboveRoomToneDb;
  if (!cuesRiseAboveRoomTone) {
    insights.push(
      insight(
        track,
        "soft-contrast",
        "context",
        "Soft-cue contrast is not interpreted",
        "One or both reading cues sit too close to the measured room-tone energy for a dependable contrast statement.",
        "Below cue review floor",
        natural.startSeconds,
        soft.endSeconds,
        "guided-cue-contrast",
      ),
    );
  } else {
    const contrastDb = natural.rmsDbFs - soft.rmsDbFs;
    const measuredValue = `${contrastDb.toFixed(1)} dB natural-to-soft contrast`;
    if (contrastDb >= TRACK_ASSESSMENT_THRESHOLDS.softContrastStrengthMinDb) {
      insights.push(
        insight(
          track,
          "soft-contrast",
          "strength",
          "The softer direction remains visible",
          "The Soft cue measures distinctly below the Natural cue in this recording.",
          measuredValue,
          natural.startSeconds,
          soft.endSeconds,
          "guided-cue-contrast",
        ),
      );
    } else if (
      contrastDb < TRACK_ASSESSMENT_THRESHOLDS.softContrastAttentionMaxDb
    ) {
      insights.push(
        insight(
          track,
          "soft-contrast",
          "attention",
          "The softer direction changes little in level",
          "The Natural and Soft cues measure similarly. Delivery and capture-chain level control can both contribute.",
          measuredValue,
          natural.startSeconds,
          soft.endSeconds,
          "guided-cue-contrast",
        ),
      );
    } else {
      insights.push(
        insight(
          track,
          "soft-contrast",
          "context",
          "The softer direction changes modestly",
          "The cue contrast is measurable but remains below the stronger-contrast threshold.",
          measuredValue,
          natural.startSeconds,
          soft.endSeconds,
          "guided-cue-contrast",
        ),
      );
    }
  }

  if (entire.clippingFraction === 0) {
    insights.push(
      insight(
        track,
        "clipping",
        "strength",
        "No digital clipping is detected",
        "No sample reaches the published clipping threshold during the guided reading.",
        formatClipping(0),
        0,
        GUIDED_READING_DURATION_SECONDS,
      ),
    );
  } else {
    const mostClippedCue = cues.reduce((current, candidate) =>
      candidate.clippingFraction > current.clippingFraction
        ? candidate
        : current,
    );
    const exceedsThreshold =
      entire.clippingFraction >=
      TRACK_ASSESSMENT_THRESHOLDS.clippingAttentionFraction;
    insights.push(
      insight(
        track,
        "clipping",
        exceedsThreshold ? "attention" : "context",
        exceedsThreshold
          ? "Clipping crosses the review threshold"
          : "Isolated clipping stays below the review threshold",
        exceedsThreshold
          ? "Samples reach the digital ceiling; inspect the indicated cue before drawing conclusions from its peaks."
          : "A small number of samples reach the digital ceiling, below the published attention threshold.",
        formatClipping(entire.clippingFraction),
        mostClippedCue.startSeconds,
        mostClippedCue.endSeconds,
      ),
    );
  }

  if (!spokenIsLow && entire.clippingFraction === 0) {
    if (
      spoken.peakDbFs <= TRACK_ASSESSMENT_THRESHOLDS.headroomStrengthMaxPeakDbFs
    ) {
      insights.push(
        insight(
          track,
          "digital-headroom",
          "strength",
          "Reading peaks retain digital headroom",
          "The highest reading sample remains at least 3 dB below the digital ceiling.",
          formatDb("Peak", spoken.peakDbFs),
          readingStart,
          readingEnd,
        ),
      );
    } else if (
      spoken.peakDbFs > TRACK_ASSESSMENT_THRESHOLDS.headroomAttentionMinPeakDbFs
    ) {
      insights.push(
        insight(
          track,
          "digital-headroom",
          "attention",
          "Reading peaks leave little digital headroom",
          "No clipping is detected, but the highest reading sample is close to the digital ceiling.",
          formatDb("Peak", spoken.peakDbFs),
          readingStart,
          readingEnd,
        ),
      );
    } else {
      insights.push(
        insight(
          track,
          "digital-headroom",
          "context",
          "Reading peak headroom is measured",
          "The highest reading sample sits between the published headroom thresholds.",
          formatDb("Peak", spoken.peakDbFs),
          readingStart,
          readingEnd,
        ),
      );
    }
  }

  return {
    track,
    sampleRate,
    durationSeconds,
    cues,
    insights,
  };
}
