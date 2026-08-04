import { z } from "zod";

import { GUIDED_READING_ID } from "@/lib/audio/reading-passage";

export const deviceMetadataSchema = z
  .object({
    inputA: z
      .object({ deviceId: z.string().max(256), label: z.string().max(256) })
      .strict(),
    inputB: z
      .object({ deviceId: z.string().max(256), label: z.string().max(256) })
      .strict(),
    requested: z.record(z.string(), z.unknown()).default({}),
    reported: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const createSessionSchema = z
  .object({
    referenceId: z.literal(GUIDED_READING_ID).default(GUIDED_READING_ID),
    devices: deviceMetadataSchema.optional(),
  })
  .strict();

export const uploadAuthorizationSchema = z
  .object({
    sessionId: z.string().uuid(),
    slot: z.enum(["A", "B"]),
    bytes: z
      .number()
      .int()
      .min(44)
      .max(4 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const commitCaptureSchema = z
  .object({
    sessionId: z.string().uuid(),
    slot: z.enum(["A", "B"]),
    pathname: z
      .string()
      .regex(/^sessions\/[0-9a-f-]+\/captures\/[AB]-[12]\.wav$/),
    bytes: z
      .number()
      .int()
      .positive()
      .max(4 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    durationMs: z.number().int().min(19_000).max(20_500),
    sampleRate: z.number().int().min(16_000).max(96_000),
    channels: z.literal(1),
    codec: z.enum(["pcm_s16le", "pcm_f32le"]).default("pcm_s16le"),
    metrics: z.record(z.string(), z.number().finite()).default({}),
  })
  .strict();

export const startUpgradeSchema = z
  .object({
    sessionId: z.string().uuid(),
    upgradeId: z.string().uuid(),
  })
  .strict();

export type CommitCaptureInput = z.infer<typeof commitCaptureSchema>;

const audioDescriptorSchema = z
  .object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byte_size: z.number().int().positive(),
    codec: z.string(),
    sample_rate_hz: z.number().int().positive(),
    channels: z.literal(1),
    bits_per_sample: z.number().int().positive(),
    frame_count: z.number().int().positive(),
    duration_seconds: z.number().positive(),
  })
  .strict();

const metricsSchema = z
  .object({
    peak_dbfs: z.number(),
    rms_dbfs: z.number(),
    steady_noise_floor_dbfs: z.number(),
    crest_factor_db: z.number(),
    dynamics_range_db: z.number(),
    clipping_ratio: z.number(),
    dc_offset: z.number(),
    high_frequency_energy_ratio: z.number(),
    spectral_rolloff_hz: z.number(),
    compression_proxy: z.number(),
    reverb_proxy: z.number(),
  })
  .strict();

const captureAnalysisSchema = z
  .object({ audio: audioDescriptorSchema, metrics: metricsSchema })
  .strict();
const artifactReceiptSchema = z
  .object({
    object_path: z.string(),
    content_type: z.enum(["audio/wav", "application/json"]),
    byte_size: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const wavArtifactReceiptSchema = artifactReceiptSchema.extend({
  content_type: z.literal("audio/wav"),
});
const jsonArtifactReceiptSchema = artifactReceiptSchema.extend({
  content_type: z.literal("application/json"),
});

export const workerVersionSchema = z
  .object({
    api_schema: z.literal("1"),
    build_revision: z.string().regex(/^[a-f0-9]{40}$/),
    pipeline_revision: z.literal("signal-enhancer-audio/1.0.0"),
    dsp_revision: z.literal("restrained-dsp/1.0.0"),
    model_name: z.literal("resemble-enhance"),
    model_repository: z.literal("ResembleAI/resemble-enhance"),
    model_revision: z.literal("4e3510ce4a8391159f665903544c5150bee7b2cb"),
    model_checkpoint_sha256: z.literal(
      "f9d035f318de3e6d919bc70cf7ad7d32b4fe92ec5cbe0b30029a27f5db07d9d6",
    ),
    source_repository: z.literal(
      "https://github.com/resemble-ai/resemble-enhance",
    ),
    source_revision: z.literal("8e978149bfe8abab3eb77d965d579a111afdb0ff"),
    inference_profile: z.literal(
      "enhancer-stage2:nfe=32:solver=midpoint:lambd=0.35:tau=0.45",
    ),
  })
  .strict();

export type WorkerVersion = z.infer<typeof workerVersionSchema>;

export const workerResultSchema = z
  .object({
    schema_version: z.literal("1"),
    job_id: z.string().uuid(),
    attempt_id: z.string().uuid(),
    source: z.literal("A"),
    routing: z
      .object({
        requested_engine: z.literal("resemble"),
        used_engine: z.literal("resemble"),
        outcome: z.literal("enhanced"),
        fallback_code: z.null(),
      })
      .strict(),
    before: captureAnalysisSchema,
    after: captureAnalysisSchema,
    comparison_b: captureAnalysisSchema,
    artifacts: z
      .object({
        enhanced_wav: wavArtifactReceiptSchema,
        difference_json: jsonArtifactReceiptSchema,
        report_json: jsonArtifactReceiptSchema,
      })
      .strict(),
    versions: workerVersionSchema,
  })
  .strict();
