import { z } from "zod";

class VerificationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "VerificationError";
  }
}

function readConfiguration() {
  const appUrlValue = process.env.PRODUCTION_APP_URL;
  const cronSecret = process.env.CRON_SECRET;
  const expectedRelease = process.env.EXPECTED_WEB_RELEASE;

  if (!appUrlValue) throw new VerificationError("missing_production_app_url");
  if (!cronSecret || cronSecret.length < 32 || /\s/.test(cronSecret))
    throw new VerificationError("missing_cron_secret");
  if (!expectedRelease || !/^[0-9a-f]{40}$/.test(expectedRelease))
    throw new VerificationError("invalid_expected_web_release");

  let appUrl: URL;
  try {
    appUrl = new URL(appUrlValue);
  } catch {
    throw new VerificationError("invalid_production_app_origin");
  }
  if (
    appUrl.protocol !== "https:" ||
    appUrl.username ||
    appUrl.password ||
    appUrl.port ||
    appUrl.pathname !== "/" ||
    appUrl.search ||
    appUrl.hash ||
    (appUrlValue !== appUrl.origin && appUrlValue !== `${appUrl.origin}/`)
  ) {
    throw new VerificationError("invalid_production_app_origin");
  }

  return { appUrl, cronSecret, expectedRelease };
}

const healthSchema = z
  .object({
    status: z.literal("ok"),
    service: z.literal("signal-enhancer-web"),
    mode: z.literal("live"),
    release: z.string().regex(/^[0-9a-f]{12}$/),
    integrations: z
      .object({
        database: z.literal(true),
        privateBlob: z.literal(true),
        worker: z.literal(true),
      })
      .strict(),
  })
  .strict();

const readinessSchema = z
  .object({
    status: z.literal("ready"),
    service: z.literal("signal-enhancer-web"),
    mode: z.literal("live"),
    release: z.string().regex(/^[0-9a-f]{12}$/),
    checks: z
      .object({
        database: z.literal("ready"),
        privateBlob: z.literal("ready"),
        worker: z.literal("ready"),
      })
      .strict(),
  })
  .strict();

async function readJson(
  appUrl: URL,
  pathname: string,
  schema: z.ZodType,
  options: { authorization?: string; timeoutMs: number },
) {
  let response: Response;
  try {
    response = await fetch(new URL(pathname, appUrl), {
      ...(options.authorization
        ? { headers: { authorization: options.authorization } }
        : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch {
    throw new VerificationError("deployment_unreachable");
  }
  if (!response.ok) throw new VerificationError("deployment_not_ready");
  if (!response.headers.get("cache-control")?.includes("no-store"))
    throw new VerificationError("unsafe_health_caching");
  const result = schema.safeParse(await response.json().catch(() => null));
  if (!result.success) throw new VerificationError("invalid_health_contract");
  return result.data as {
    release: string;
  };
}

async function main() {
  try {
    const { appUrl, cronSecret, expectedRelease } = readConfiguration();
    const health = await readJson(appUrl, "/api/health", healthSchema, {
      timeoutMs: 15_000,
    });
    if (health.release !== expectedRelease.slice(0, 12))
      throw new VerificationError("unexpected_web_release");

    const readiness = await readJson(
      appUrl,
      "/api/internal/readiness",
      readinessSchema,
      {
        authorization: `Bearer ${cronSecret}`,
        timeoutMs: 270_000,
      },
    );
    if (health.release !== readiness.release)
      throw new VerificationError("release_changed_during_verification");

    console.log(
      JSON.stringify({
        status: "ready",
        service: "signal-enhancer-web",
        release: health.release,
        checks: ["configuration", "database", "privateBlob", "worker"],
      }),
    );
  } catch (error) {
    const code =
      error instanceof VerificationError
        ? error.code
        : "unexpected_verification_error";
    console.error(
      JSON.stringify({
        status: "not_ready",
        service: "signal-enhancer-web",
        code,
      }),
    );
    process.exitCode = 1;
  }
}

void main();
