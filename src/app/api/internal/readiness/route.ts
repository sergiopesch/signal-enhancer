import { assertPrivateBlobReady } from "@/lib/server/blob";
import { assertDatabaseReady } from "@/lib/server/db";
import { requireLiveEnvironment } from "@/lib/server/env";
import { safeErrorResponse } from "@/lib/server/errors";
import { requireInternalBearerAuthorization } from "@/lib/server/internal-auth";
import { probeProductionWorker } from "@/lib/server/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    const environment = requireLiveEnvironment();
    requireInternalBearerAuthorization(request, environment.CRON_SECRET);

    const entries = await Promise.allSettled([
      assertDatabaseReady(),
      assertPrivateBlobReady(),
      probeProductionWorker(environment, {
        timeoutMs: 240_000,
        scaleUpTimeoutSeconds: 230,
      }),
    ]);
    const names = ["database", "privateBlob", "worker"] as const;
    const checks = Object.fromEntries(
      names.map((name, index) => [
        name,
        entries[index]?.status === "fulfilled" ? "ready" : "failed",
      ]),
    ) as Record<(typeof names)[number], "ready" | "failed">;
    const failed = names.filter((name) => checks[name] === "failed");

    if (failed.length > 0) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "production_readiness_failed",
          components: failed,
        }),
      );
    }

    return Response.json(
      {
        status: failed.length === 0 ? "ready" : "not_ready",
        service: "signal-enhancer-web",
        mode: "live",
        release: environment.VERCEL_GIT_COMMIT_SHA.slice(0, 12),
        checks,
      },
      { status: failed.length === 0 ? 200 : 503, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
