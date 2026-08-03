ALTER TABLE "experiment_sessions"
  ADD COLUMN IF NOT EXISTS "reference_revision" text;
--> statement-breakpoint
UPDATE "experiment_sessions"
SET "reference_revision" = CASE
  WHEN "reference_id" = 'guided-reading-v1' THEN '1.0.0'
  ELSE 'v1'
END
WHERE "reference_revision" IS NULL;
--> statement-breakpoint
ALTER TABLE "experiment_sessions"
  ALTER COLUMN "reference_id" SET DEFAULT 'guided-reading-v1';
--> statement-breakpoint
ALTER TABLE "experiment_sessions"
  ALTER COLUMN "reference_revision" SET DEFAULT '1.0.0';
--> statement-breakpoint
ALTER TABLE "experiment_sessions"
  ALTER COLUMN "reference_revision" SET NOT NULL;
