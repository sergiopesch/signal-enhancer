import { getEnvironment, requireLiveEnvironment } from "@/lib/server/env";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    const environment = getEnvironment();
    if (environment.SIGNAL_MODE === "live") requireLiveEnvironment();

    return Response.json(
      {
        status: "ok",
        service: "signal-enhancer-web",
        mode: environment.SIGNAL_MODE,
        release:
          environment.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "development",
        integrations: {
          database: Boolean(environment.DATABASE_URL),
          privateBlob: Boolean(
            environment.BLOB_READ_WRITE_TOKEN || environment.BLOB_STORE_ID,
          ),
          worker: Boolean(environment.HF_ENDPOINT_URL),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "health_configuration_invalid",
        errorType: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return Response.json(
      {
        status: "not_ready",
        service: "signal-enhancer-web",
        mode: "unknown",
        release:
          process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "development",
        integrations: {
          database: false,
          privateBlob: false,
          worker: false,
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
