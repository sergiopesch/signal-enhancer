import { describe, expect, it } from "vitest";

import {
  assessIndividualTrack,
  TRACK_ASSESSMENT_THRESHOLDS,
  type IndividualTrackAssessment,
  type TrackInsightMetric,
} from "../track-assessment";
import {
  GUIDED_READING_CUES,
  GUIDED_READING_DURATION_SECONDS,
  type GuidedReadingCueId,
} from "../reading-passage";

const SAMPLE_RATE = 8_000;

function amplitudeAtDb(db: number): number {
  return 10 ** (db / 20);
}

function emptyReading(): Float32Array {
  return new Float32Array(SAMPLE_RATE * GUIDED_READING_DURATION_SECONDS);
}

function cue(id: GuidedReadingCueId) {
  const match = GUIDED_READING_CUES.find((candidate) => candidate.id === id);
  if (match === undefined) throw new Error(`Missing test cue ${id}`);
  return match;
}

function fillRange(
  samples: Float32Array,
  startSeconds: number,
  endSeconds: number,
  amplitude: number,
) {
  const start = Math.floor(startSeconds * SAMPLE_RATE);
  const end = Math.min(samples.length, Math.ceil(endSeconds * SAMPLE_RATE));
  samples.fill(amplitude, start, end);
}

function fillCue(
  samples: Float32Array,
  cueId: GuidedReadingCueId,
  amplitude: number,
) {
  const range = cue(cueId);
  fillRange(samples, range.startSeconds, range.endSeconds, amplitude);
}

function insight(
  assessment: IndividualTrackAssessment,
  metric: TrackInsightMetric,
) {
  const match = assessment.insights.find(
    (candidate) => candidate.metric === metric,
  );
  if (match === undefined) throw new Error(`Missing ${metric} insight`);
  return match;
}

function spokenReading(levelDb = -20): Float32Array {
  const samples = emptyReading();
  const amplitude = amplitudeAtDb(levelDb);
  fillCue(samples, "natural", amplitude);
  fillCue(samples, "soft", amplitudeAtDb(levelDb - 4));
  fillCue(samples, "finish", amplitude);
  return samples;
}

describe("individual guided-reading track assessment", () => {
  it("keeps silence finite and reports only measurable, ranged evidence", () => {
    const assessment = assessIndividualTrack(emptyReading(), SAMPLE_RATE, "A");

    expect(assessment.cues.map((candidate) => candidate.cueId)).toEqual([
      "room-tone",
      "natural",
      "soft",
      "finish",
    ]);
    expect(
      assessment.cues.every((candidate) =>
        [
          candidate.rmsDbFs,
          candidate.peakDbFs,
          candidate.clippingFraction,
        ].every(Number.isFinite),
      ),
    ).toBe(true);
    expect(insight(assessment, "room-tone")).toMatchObject({
      tone: "strength",
      startSeconds: 0,
      endSeconds: 2,
      measuredValue: "RMS -120.0 dBFS",
    });
    expect(insight(assessment, "spoken-level").tone).toBe("attention");
    expect(insight(assessment, "soft-contrast").tone).toBe("context");
    expect(insight(assessment, "clipping")).toMatchObject({
      tone: "strength",
      measuredValue: "0.000% clipped samples",
      startSeconds: 0,
      endSeconds: 20,
    });
    expect(JSON.stringify(assessment)).not.toMatch(/NaN|Infinity/);
  });

  it("flags clipping at the published boundary and points to its cue", () => {
    const samples = spokenReading();
    const finish = cue("finish");
    const clippingCount = Math.ceil(
      samples.length * TRACK_ASSESSMENT_THRESHOLDS.clippingAttentionFraction,
    );
    const start = Math.floor(finish.startSeconds * SAMPLE_RATE);
    samples.fill(1, start, start + clippingCount);

    const finding = insight(
      assessIndividualTrack(samples, SAMPLE_RATE, "B"),
      "clipping",
    );

    expect(finding).toMatchObject({
      track: "B",
      tone: "attention",
      startSeconds: finish.startSeconds,
      endSeconds: finish.endSeconds,
    });
    expect(finding.measuredValue).toBe("0.010% clipped samples");
  });

  it("marks truncated cues unavailable and suppresses positive evidence", () => {
    const partial = spokenReading().slice(0, SAMPLE_RATE * 10);
    const assessment = assessIndividualTrack(partial, SAMPLE_RATE, "A");

    expect(assessment.insights).toHaveLength(1);
    expect(insight(assessment, "capture-length")).toMatchObject({
      tone: "attention",
      measuredValue: "10.0 s captured",
      startSeconds: 10,
      endSeconds: 20,
    });
    expect(
      assessment.insights.some((candidate) => candidate.tone === "strength"),
    ).toBe(false);
    expect(
      assessment.cues.map((candidate) => [candidate.cueId, candidate.complete]),
    ).toEqual([
      ["room-tone", true],
      ["natural", true],
      ["soft", false],
      ["finish", false],
    ]);
  });

  it("keeps isolated clipping below the boundary as context", () => {
    const samples = spokenReading();
    const clippingCount = Math.ceil(
      samples.length * TRACK_ASSESSMENT_THRESHOLDS.clippingAttentionFraction,
    );
    const natural = cue("natural");
    const start = Math.floor(natural.startSeconds * SAMPLE_RATE);
    samples.fill(1, start, start + clippingCount - 1);

    expect(
      insight(assessIndividualTrack(samples, SAMPLE_RATE, "A"), "clipping"),
    ).toMatchObject({
      tone: "context",
      startSeconds: natural.startSeconds,
      endSeconds: natural.endSeconds,
    });
  });

  it("treats low spoken level as attention and the exact boundary as context", () => {
    const below = emptyReading();
    fillRange(
      below,
      cue("natural").startSeconds,
      cue("finish").endSeconds,
      amplitudeAtDb(TRACK_ASSESSMENT_THRESHOLDS.spokenLowRmsDbFs - 0.1),
    );
    const boundary = emptyReading();
    fillRange(
      boundary,
      cue("natural").startSeconds,
      cue("finish").endSeconds,
      amplitudeAtDb(TRACK_ASSESSMENT_THRESHOLDS.spokenLowRmsDbFs),
    );

    expect(
      insight(assessIndividualTrack(below, SAMPLE_RATE, "A"), "spoken-level")
        .tone,
    ).toBe("attention");
    expect(
      insight(assessIndividualTrack(boundary, SAMPLE_RATE, "A"), "spoken-level")
        .tone,
    ).toBe("context");
  });

  it("uses inclusive room-tone strength and attention boundaries", () => {
    const strength = spokenReading();
    fillCue(
      strength,
      "room-tone",
      amplitudeAtDb(TRACK_ASSESSMENT_THRESHOLDS.roomToneStrengthMaxDbFs),
    );
    const attention = spokenReading();
    fillCue(
      attention,
      "room-tone",
      amplitudeAtDb(TRACK_ASSESSMENT_THRESHOLDS.roomToneAttentionMinDbFs),
    );

    expect(
      insight(assessIndividualTrack(strength, SAMPLE_RATE, "A"), "room-tone")
        .tone,
    ).toBe("strength");
    expect(
      insight(assessIndividualTrack(attention, SAMPLE_RATE, "A"), "room-tone")
        .tone,
    ).toBe("attention");
  });

  it("recognizes the guided soft cue only when it rises above room tone", () => {
    const samples = emptyReading();
    fillCue(samples, "room-tone", amplitudeAtDb(-70));
    fillCue(samples, "natural", amplitudeAtDb(-20));
    fillCue(
      samples,
      "soft",
      amplitudeAtDb(
        -20 - TRACK_ASSESSMENT_THRESHOLDS.softContrastStrengthMinDb,
      ),
    );
    fillCue(samples, "finish", amplitudeAtDb(-20));

    expect(
      insight(
        assessIndividualTrack(samples, SAMPLE_RATE, "A"),
        "soft-contrast",
      ),
    ).toMatchObject({
      tone: "strength",
      measuredValue: "3.0 dB natural-to-soft contrast",
      startSeconds: 2,
      endSeconds: 14,
      basis: "guided-cue-contrast",
    });
  });

  it("is tie-safe for identical tracks and sanitizes non-finite samples", () => {
    const samples = spokenReading();
    samples[1] = Number.NaN;
    samples[2] = Number.POSITIVE_INFINITY;
    const a = assessIndividualTrack(samples, SAMPLE_RATE, "A");
    const b = assessIndividualTrack(samples, SAMPLE_RATE, "B");
    const withoutIdentity = (assessment: IndividualTrackAssessment) => ({
      ...assessment,
      track: "same",
      insights: assessment.insights.map((candidate) => ({
        ...candidate,
        id: candidate.id.replace(/^[ab]-/, "same-"),
        track: "same",
      })),
    });

    expect(withoutIdentity(a)).toEqual(withoutIdentity(b));
    const evidence = JSON.stringify([a, b]);
    expect(evidence).not.toMatch(/NaN|Infinity/);
    expect(evidence).not.toMatch(
      /\b(?:better|worse|winner|hardware|clarity)\b/i,
    );
  });
});
