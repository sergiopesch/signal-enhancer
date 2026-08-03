import { describe, expect, it } from "vitest";

import {
  commitCaptureSchema,
  createSessionSchema,
  workerResultSchema,
} from "../contracts";

const JOB_ID = "123e4567-e89b-42d3-a456-426614174000";
const ATTEMPT_ID = "123e4567-e89b-42d3-a456-426614174001";
const SHA = "a".repeat(64);

function analysis() {
  return {
    audio: {
      sha256: SHA,
      byte_size: 1_920_044,
      codec: "pcm_s16le",
      sample_rate_hz: 48_000,
      channels: 1,
      bits_per_sample: 16,
      frame_count: 960_000,
      duration_seconds: 20,
    },
    metrics: {
      peak_dbfs: -1,
      rms_dbfs: -18,
      steady_noise_floor_dbfs: -58,
      crest_factor_db: 17,
      dynamics_range_db: 42,
      clipping_ratio: 0,
      dc_offset: 0,
      high_frequency_energy_ratio: 0.12,
      spectral_rolloff_hz: 8_200,
      compression_proxy: 0.2,
      reverb_proxy: 0.1,
    },
  };
}

function workerResult() {
  return {
    schema_version: "1",
    job_id: JOB_ID,
    attempt_id: ATTEMPT_ID,
    source: "A",
    routing: {
      requested_engine: "resemble",
      used_engine: "resemble",
      outcome: "enhanced",
      fallback_code: null,
    },
    before: analysis(),
    after: analysis(),
    comparison_b: analysis(),
    artifacts: {
      enhanced_wav: {
        object_path: `sessions/example/results/${JOB_ID}/${ATTEMPT_ID}/enhanced.wav`,
        content_type: "audio/wav",
        byte_size: 1_920_044,
        sha256: SHA,
      },
      difference_json: {
        object_path: `sessions/example/results/${JOB_ID}/${ATTEMPT_ID}/difference.json`,
        content_type: "application/json",
        byte_size: 1_024,
        sha256: SHA,
      },
      report_json: {
        object_path: `sessions/example/results/${JOB_ID}/${ATTEMPT_ID}/report.json`,
        content_type: "application/json",
        byte_size: 2_048,
        sha256: SHA,
      },
    },
    versions: {
      api_schema: "1",
      build_revision: "abc123",
      pipeline_revision: "signal-enhancer-v1",
      dsp_revision: "restrained-v1",
      model_name: "resemble-enhance",
      model_revision: "4e3510ce",
    },
  };
}

describe("web boundary contracts", () => {
  it("rejects undeclared session fields", () => {
    expect(() =>
      createSessionSchema.parse({
        referenceId: "diagnostic-speech-v1",
        admin: true,
      }),
    ).toThrow();
  });

  it("accepts only bounded, session-scoped mono captures", () => {
    expect(
      commitCaptureSchema.parse({
        sessionId: JOB_ID,
        slot: "A",
        pathname: `sessions/${JOB_ID}/captures/A-1.wav`,
        bytes: 1_920_044,
        sha256: SHA,
        durationMs: 20_000,
        sampleRate: 48_000,
        channels: 1,
        codec: "pcm_s16le",
        metrics: {},
      }),
    ).toBeTruthy();

    expect(() =>
      commitCaptureSchema.parse({
        sessionId: JOB_ID,
        slot: "A",
        pathname: `sessions/${JOB_ID}/captures/A-2.wav`,
        bytes: 1_920_044,
        sha256: SHA,
        durationMs: 21_000,
        sampleRate: 48_000,
        channels: 2,
        metrics: {},
      }),
    ).toThrow();

    expect(() =>
      commitCaptureSchema.parse({
        sessionId: JOB_ID,
        slot: "A",
        pathname: `sessions/${JOB_ID}/captures/A-${ATTEMPT_ID}.wav`,
        bytes: 1_920_044,
        sha256: SHA,
        durationMs: 20_000,
        sampleRate: 48_000,
        channels: 1,
        metrics: {},
      }),
    ).toThrow();
  });

  it("pins worker schema and artifact content types", () => {
    expect(workerResultSchema.parse(workerResult())).toBeTruthy();

    const invalid = workerResult();
    invalid.artifacts.enhanced_wav.content_type = "application/json";
    expect(() => workerResultSchema.parse(invalid)).toThrow();
  });
});
