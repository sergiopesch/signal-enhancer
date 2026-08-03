import "server-only";

import { z } from "zod";

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalSecret = z.preprocess(
  blankToUndefined,
  z.string().trim().min(1).optional(),
);
const optionalUrl = z.preprocess(blankToUndefined, z.string().url().optional());

const environmentSchema = z.object({
  SIGNAL_MODE: z.enum(["demo", "live"]).default("demo"),
  SESSION_SIGNING_SECRET: optionalSecret,
  NETWORK_HASH_SECRET: optionalSecret,
  DATABASE_URL: optionalSecret,
  BLOB_READ_WRITE_TOKEN: optionalSecret,
  BLOB_STORE_ID: optionalSecret,
  CRON_SECRET: optionalSecret,
  HF_ENDPOINT_URL: optionalUrl,
  HF_ENDPOINT_TOKEN: optionalSecret,
  HF_ENDPOINT_SHARED_SECRET: optionalSecret,
  MAX_GLOBAL_JOBS_PER_DAY: z.coerce.number().int().positive().default(100),
  MAX_ACTIVE_GPU_JOBS: z.coerce.number().int().positive().default(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

export type SignalEnvironment = z.infer<typeof environmentSchema>;

let memoizedEnvironment: SignalEnvironment | undefined;

export function getEnvironment(): SignalEnvironment {
  memoizedEnvironment ??= parseEnvironment(process.env);
  return memoizedEnvironment;
}

export function parseEnvironment(
  values: Record<string, string | undefined>,
): SignalEnvironment {
  return environmentSchema.parse(values);
}

export function requireLiveEnvironment() {
  const environment = getEnvironment();
  if (environment.SIGNAL_MODE !== "live") {
    throw new Error("Live infrastructure is disabled while SIGNAL_MODE=demo.");
  }

  const liveSchema = environmentSchema.extend({
    SIGNAL_MODE: z.literal("live"),
    SESSION_SIGNING_SECRET: z.string().min(32),
    NETWORK_HASH_SECRET: z.string().min(32),
    DATABASE_URL: z.string().min(1),
    HF_ENDPOINT_URL: z.string().url(),
    HF_ENDPOINT_TOKEN: z.string().min(1),
    HF_ENDPOINT_SHARED_SECRET: z.string().min(32),
    CRON_SECRET: z.string().min(32),
  });

  return liveSchema.parse(environment);
}
