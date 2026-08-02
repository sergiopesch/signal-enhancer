# Security policy

## Reporting

Please report a suspected vulnerability through a private GitHub security advisory for this repository. Do not include credentials, signed media URLs, or captured audio in a public issue.

## Supported version

The current `main` branch is the only supported line during the private beta.

## Trust boundaries

- The browser owns microphone permission, capture, local analysis, and the non-AI DSP preview.
- Next.js owns anonymous session authorization, quota reservation, exact Blob grants, and result authorization.
- Vercel Workflow owns durable retries and progress events, but never stores audio bytes in workflow state.
- The Hugging Face gateway bearer and application-level endpoint secret are independently verified.
- The worker accepts only strict schemas, exact allowlisted HTTPS hosts, short expiries, and attempt-scoped object paths.

## Secret handling

Production secrets belong in Vercel and Hugging Face environment settings. Never commit `.env.local`, endpoint tokens, Blob credentials, database URLs, signed URLs, or captured audio. Rotate both worker credentials if either boundary is exposed.

## Data lifetime

Live captures and derived artifacts are private and expire after 24 hours. The cleanup route requires `CRON_SECRET`, deletes known Blob objects first, then cascades expired database records. Live launch requires that route to be called at least hourly; the committed Hobby-compatible demo schedule is daily because demo mode stores no server-side audio. Hashed abuse-control ledger rows are retained for 35 days.

## Deployment controls

- Keep the worker image and model revision immutable.
- Keep the beta endpoint at maximum one replica and enforce application job caps.
- Exercise WAF/rate-limit changes in preview and log-only mode before enforcement.
- Do not enable `SIGNAL_MODE=live` until Neon, private Blob, cleanup authentication, the protected worker, and all required secrets are healthy.
