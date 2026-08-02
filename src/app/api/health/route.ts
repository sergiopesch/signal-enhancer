import { getEnvironment } from "@/lib/server/env";

export const dynamic = "force-dynamic";

export function GET() {
  const environment = getEnvironment();
  return Response.json(
    {
      status: "ok",
      service: "signal-enhancer-web",
      mode: environment.SIGNAL_MODE,
      release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "development",
      integrations: {
        database: Boolean(environment.DATABASE_URL),
        privateBlob: Boolean(
          environment.BLOB_READ_WRITE_TOKEN ||
          (process.env.VERCEL_OIDC_TOKEN && environment.BLOB_STORE_ID),
        ),
        worker: Boolean(environment.HF_ENDPOINT_URL),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
