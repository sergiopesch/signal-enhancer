import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const experimentSessions = pgTable(
  "experiment_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicId: uuid("public_id").notNull().defaultRandom(),
    status: text("status").notNull().default("created"),
    sessionHash: text("session_hash").notNull(),
    networkHash: text("network_hash").notNull(),
    referenceId: text("reference_id").notNull().default("diagnostic-speech-v1"),
    deviceMetadata: jsonb("device_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    captureConstraints: jsonb("capture_constraints")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("experiment_sessions_public_id_idx").on(table.publicId),
    index("experiment_sessions_expiry_idx").on(table.expiresAt),
    index("experiment_sessions_abuse_idx").on(
      table.networkHash,
      table.createdAt,
    ),
  ],
);

export const captures = pgTable(
  "captures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => experimentSessions.id, { onDelete: "cascade" }),
    slot: text("slot").notNull(),
    pathname: text("pathname").notNull(),
    bytes: integer("bytes").notNull(),
    sha256: text("sha256").notNull(),
    codec: text("codec").notNull().default("pcm_s16le"),
    durationMs: integer("duration_ms").notNull(),
    sampleRate: integer("sample_rate").notNull(),
    channels: integer("channels").notNull(),
    metrics: jsonb("metrics")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("captures_session_slot_idx").on(table.sessionId, table.slot),
    uniqueIndex("captures_pathname_idx").on(table.pathname),
    index("captures_expiry_idx").on(table.expiresAt),
  ],
);

export const upgradeJobs = pgTable(
  "upgrade_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicId: uuid("public_id").notNull().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => experimentSessions.id, { onDelete: "cascade" }),
    workflowRunId: text("workflow_run_id"),
    state: text("state").notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    sourceSlot: text("source_slot").notNull().default("A"),
    routing: jsonb("routing")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    resultPathname: text("result_pathname"),
    reportPathname: text("report_pathname"),
    differencePathname: text("difference_pathname"),
    resultSha256: text("result_sha256"),
    resultMetadata: jsonb("result_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("upgrade_jobs_public_id_idx").on(table.publicId),
    uniqueIndex("upgrade_jobs_session_idx").on(table.sessionId),
    index("upgrade_jobs_state_idx").on(table.state),
    index("upgrade_jobs_expiry_idx").on(table.expiresAt),
  ],
);

export const jobEvents = pgTable(
  "job_events",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => upgradeJobs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    stage: text("stage").notNull(),
    status: text("status").notNull(),
    detail: text("detail").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.sequence] }),
    index("job_events_job_created_idx").on(table.jobId, table.createdAt),
  ],
);

export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionHash: text("session_hash").notNull(),
    networkHash: text("network_hash").notNull(),
    dayBucket: text("day_bucket").notNull(),
    reservedJobs: integer("reserved_jobs").notNull().default(0),
    completedJobs: integer("completed_jobs").notNull().default(0),
    failedJobs: integer("failed_jobs").notNull().default(0),
    decodedSeconds: bigint("decoded_seconds", { mode: "number" })
      .notNull()
      .default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("usage_ledger_bucket_idx").on(
      table.sessionHash,
      table.dayBucket,
    ),
    index("usage_ledger_global_day_idx").on(table.dayBucket),
  ],
);

export type ExperimentSession = typeof experimentSessions.$inferSelect;
export type Capture = typeof captures.$inferSelect;
export type UpgradeJob = typeof upgradeJobs.$inferSelect;
