import "server-only";

import { z } from "zod";

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const secret = z.string().min(1).regex(/^\S+$/);
const productionSecret = z.string().min(32).regex(/^\S+$/);
const optionalSecret = z.preprocess(blankToUndefined, secret.optional());
const gitRevision = z.string().regex(/^[0-9a-f]{40}$/);
const optionalGitRevision = z.preprocess(
  blankToUndefined,
  gitRevision.optional(),
);

// Custom Inference Endpoints use an HTTPS origin below this Hugging Face-owned
// suffix. Keeping this as an origin (rather than an arbitrary URL) ensures the
// gateway token and worker secret cannot be sent to another host or path.
const huggingFaceEndpointOrigin = z
  .string()
  .regex(
    /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+endpoints\.huggingface\.cloud\/?$/,
    "Must be an HTTPS Hugging Face Inference Endpoint base origin.",
  )
  .url()
  .transform((value) => value.replace(/\/$/, ""));

const optionalHuggingFaceEndpointOrigin = z.preprocess(
  blankToUndefined,
  huggingFaceEndpointOrigin.optional(),
);

const httpsApplicationOrigin = z
  .string()
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.port &&
          !url.search &&
          !url.hash &&
          (value === url.origin || value === `${url.origin}/`)
        );
      } catch {
        return false;
      }
    },
    { message: "Must be an exact HTTPS application origin." },
  )
  .transform((value) => new URL(value).origin);

const baseEnvironmentSchema = z.object({
  SIGNAL_MODE: z.enum(["demo", "live"]).default("demo"),
  NEXT_PUBLIC_SIGNAL_MODE: z.enum(["demo", "live"]).default("demo"),
  SESSION_SIGNING_SECRET: optionalSecret,
  NETWORK_HASH_SECRET: optionalSecret,
  DATABASE_URL: optionalSecret,
  BLOB_READ_WRITE_TOKEN: optionalSecret,
  BLOB_STORE_ID: optionalSecret,
  VERCEL_OIDC_TOKEN: optionalSecret,
  CRON_SECRET: optionalSecret,
  HF_ENDPOINT_URL: optionalHuggingFaceEndpointOrigin,
  HF_ENDPOINT_TOKEN: optionalSecret,
  HF_ENDPOINT_SHARED_SECRET: optionalSecret,
  HF_ENDPOINT_BUILD_REVISION: optionalGitRevision,
  VERCEL_GIT_COMMIT_SHA: optionalGitRevision,
  MAX_GLOBAL_JOBS_PER_DAY: z.coerce.number().int().positive().default(100),
  MAX_ACTIVE_GPU_JOBS: z.coerce.number().int().positive().default(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

const modeEnvironmentSchema = baseEnvironmentSchema.pick({
  SIGNAL_MODE: true,
  NEXT_PUBLIC_SIGNAL_MODE: true,
});

function requireExactlyOneBlobCredential(
  environment: {
    BLOB_READ_WRITE_TOKEN?: string | undefined;
    BLOB_STORE_ID?: string | undefined;
  },
  context: z.RefinementCtx,
) {
  if (environment.BLOB_READ_WRITE_TOKEN && environment.BLOB_STORE_ID) {
    for (const path of ["BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID"]) {
      context.addIssue({
        code: "custom",
        path: [path],
        message: "Choose exactly one Blob credential mode.",
      });
    }
    return;
  }
  if (environment.BLOB_READ_WRITE_TOKEN || environment.BLOB_STORE_ID) return;

  // Report only variable names. Never include credential values in an error.
  context.addIssue({
    code: "custom",
    path: ["BLOB_READ_WRITE_TOKEN"],
    message: "Blob credentials are incomplete.",
  });
  context.addIssue({
    code: "custom",
    path: ["BLOB_STORE_ID"],
    message: "Blob credentials are incomplete.",
  });
}

const cleanupEnvironmentSchema = baseEnvironmentSchema
  .pick({
    DATABASE_URL: true,
    BLOB_READ_WRITE_TOKEN: true,
    BLOB_STORE_ID: true,
    VERCEL_OIDC_TOKEN: true,
    CRON_SECRET: true,
  })
  .extend({
    DATABASE_URL: secret,
    CRON_SECRET: productionSecret,
  })
  .superRefine(requireExactlyOneBlobCredential);

const liveEnvironmentSchema = baseEnvironmentSchema
  .extend({
    SIGNAL_MODE: z.literal("live"),
    NEXT_PUBLIC_SIGNAL_MODE: z.literal("live"),
    SESSION_SIGNING_SECRET: productionSecret,
    NETWORK_HASH_SECRET: productionSecret,
    DATABASE_URL: secret,
    HF_ENDPOINT_URL: huggingFaceEndpointOrigin,
    HF_ENDPOINT_TOKEN: secret,
    HF_ENDPOINT_SHARED_SECRET: productionSecret,
    HF_ENDPOINT_BUILD_REVISION: gitRevision,
    VERCEL_GIT_COMMIT_SHA: gitRevision,
    CRON_SECRET: productionSecret,
    NEXT_PUBLIC_APP_URL: httpsApplicationOrigin,
  })
  .superRefine(requireExactlyOneBlobCredential)
  .superRefine((environment, context) => {
    const namedSecrets = [
      ["SESSION_SIGNING_SECRET", environment.SESSION_SIGNING_SECRET],
      ["NETWORK_HASH_SECRET", environment.NETWORK_HASH_SECRET],
      ["CRON_SECRET", environment.CRON_SECRET],
      ["HF_ENDPOINT_TOKEN", environment.HF_ENDPOINT_TOKEN],
      ["HF_ENDPOINT_SHARED_SECRET", environment.HF_ENDPOINT_SHARED_SECRET],
    ] as const;
    for (const [name, value] of namedSecrets) {
      if (
        namedSecrets.some(
          ([otherName, other]) => otherName !== name && other === value,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: "Production credentials must be independently generated.",
        });
      }
    }
    if (
      environment.HF_ENDPOINT_BUILD_REVISION !==
      environment.VERCEL_GIT_COMMIT_SHA
    ) {
      for (const path of [
        "HF_ENDPOINT_BUILD_REVISION",
        "VERCEL_GIT_COMMIT_SHA",
      ]) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: "The web and worker release revisions must match.",
        });
      }
    }
  });

export type SignalEnvironment = z.infer<typeof baseEnvironmentSchema>;
export type LiveSignalEnvironment = z.infer<typeof liveEnvironmentSchema>;
export type CleanupEnvironment = z.infer<typeof cleanupEnvironmentSchema>;

export class EnvironmentConfigurationError extends Error {
  readonly invalidVariables: readonly string[];

  constructor(invalidVariables: Iterable<string>) {
    const variables = [...new Set(invalidVariables)];
    const suffix =
      variables.length > 0 ? ` Check ${variables.join(", ")}.` : "";
    super(`Invalid server environment configuration.${suffix}`);
    this.name = "EnvironmentConfigurationError";
    this.invalidVariables = Object.freeze(variables);
  }
}

function parseWithSafeErrors<T>(schema: z.ZodType<T>, values: unknown): T {
  const result = schema.safeParse(values);
  if (result.success) return result.data;

  throw new EnvironmentConfigurationError(
    result.error.issues.map((issue) => {
      const [variable] = issue.path;
      return typeof variable === "string" ? variable : "environment";
    }),
  );
}

let memoizedEnvironment: SignalEnvironment | undefined;

export function getEnvironment(): SignalEnvironment {
  memoizedEnvironment ??= parseEnvironment(process.env);
  return memoizedEnvironment;
}

export function parseEnvironment(
  values: Record<string, string | undefined>,
): SignalEnvironment {
  const modes = parseWithSafeErrors(modeEnvironmentSchema, values);

  if (modes.SIGNAL_MODE !== modes.NEXT_PUBLIC_SIGNAL_MODE) {
    throw new EnvironmentConfigurationError([
      "SIGNAL_MODE",
      "NEXT_PUBLIC_SIGNAL_MODE",
    ]);
  }

  return modes.SIGNAL_MODE === "live"
    ? parseWithSafeErrors(liveEnvironmentSchema, values)
    : parseWithSafeErrors(baseEnvironmentSchema, values);
}

export function requireLiveEnvironment(): LiveSignalEnvironment {
  const environment = getEnvironment();
  if (environment.SIGNAL_MODE !== "live") {
    throw new Error("Live infrastructure is disabled while SIGNAL_MODE=demo.");
  }

  // parseEnvironment has already validated this branch. Parsing again keeps
  // this function's return type aligned with the live-only contract.
  return parseWithSafeErrors(liveEnvironmentSchema, environment);
}

export function requireCleanupEnvironment(): CleanupEnvironment {
  return parseCleanupEnvironment(getEnvironment());
}

export function parseCleanupEnvironment(
  values: Record<string, unknown>,
): CleanupEnvironment {
  return parseWithSafeErrors(cleanupEnvironmentSchema, values);
}
