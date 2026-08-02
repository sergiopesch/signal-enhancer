CREATE TABLE IF NOT EXISTS "experiment_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "status" text DEFAULT 'created' NOT NULL,
  "session_hash" text NOT NULL,
  "network_hash" text NOT NULL,
  "reference_id" text DEFAULT 'diagnostic-speech-v1' NOT NULL,
  "device_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "capture_constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "experiment_sessions_status_check" CHECK ("status" IN ('created', 'capturing', 'ready', 'upgrading', 'completed', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "experiment_sessions_public_id_idx" ON "experiment_sessions" ("public_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "experiment_sessions_expiry_idx" ON "experiment_sessions" ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "experiment_sessions_abuse_idx" ON "experiment_sessions" ("network_hash", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "captures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "experiment_sessions"("id") ON DELETE CASCADE,
  "slot" text NOT NULL,
  "pathname" text NOT NULL,
  "bytes" integer NOT NULL,
  "sha256" text NOT NULL,
  "codec" text DEFAULT 'pcm_s16le' NOT NULL,
  "duration_ms" integer NOT NULL,
  "sample_rate" integer NOT NULL,
  "channels" integer NOT NULL,
  "metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "captures_slot_check" CHECK ("slot" IN ('A', 'B')),
  CONSTRAINT "captures_bytes_check" CHECK ("bytes" BETWEEN 44 AND 4194304),
  CONSTRAINT "captures_duration_check" CHECK ("duration_ms" BETWEEN 19000 AND 20500),
  CONSTRAINT "captures_channels_check" CHECK ("channels" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "captures_session_slot_idx" ON "captures" ("session_id", "slot");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "captures_pathname_idx" ON "captures" ("pathname");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "captures_expiry_idx" ON "captures" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "upgrade_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "experiment_sessions"("id") ON DELETE CASCADE,
  "workflow_run_id" text,
  "state" text DEFAULT 'queued' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "source_slot" text DEFAULT 'A' NOT NULL,
  "routing" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result_pathname" text,
  "report_pathname" text,
  "difference_pathname" text,
  "result_sha256" text,
  "result_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_code" text,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "upgrade_jobs_state_check" CHECK ("state" IN ('queued', 'warming', 'processing', 'storing', 'completed', 'failed', 'expired', 'cancelled')),
  CONSTRAINT "upgrade_jobs_source_check" CHECK ("source_slot" = 'A')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "upgrade_jobs_public_id_idx" ON "upgrade_jobs" ("public_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "upgrade_jobs_session_idx" ON "upgrade_jobs" ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upgrade_jobs_state_idx" ON "upgrade_jobs" ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upgrade_jobs_expiry_idx" ON "upgrade_jobs" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_events" (
  "job_id" uuid NOT NULL REFERENCES "upgrade_jobs"("id") ON DELETE CASCADE,
  "sequence" integer NOT NULL,
  "stage" text NOT NULL,
  "status" text NOT NULL,
  "detail" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "job_events_pk" PRIMARY KEY ("job_id", "sequence")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_events_job_created_idx" ON "job_events" ("job_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_hash" text NOT NULL,
  "network_hash" text NOT NULL,
  "day_bucket" text NOT NULL,
  "reserved_jobs" integer DEFAULT 0 NOT NULL,
  "completed_jobs" integer DEFAULT 0 NOT NULL,
  "failed_jobs" integer DEFAULT 0 NOT NULL,
  "decoded_seconds" bigint DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "usage_ledger_bucket_idx" ON "usage_ledger" ("session_hash", "day_bucket");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_ledger_global_day_idx" ON "usage_ledger" ("day_bucket");
