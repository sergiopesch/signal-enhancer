# Security policy

## Reporting

Please report a suspected vulnerability through a private GitHub security advisory for this repository. Do not include credentials, signed media URLs, or captured audio in a public issue.

## Supported version

The current `main` branch is the only supported line during the public preview.

## Trust boundaries

- The browser owns microphone permission, capture, local analysis, and the non-AI DSP preview.
- Next.js owns anonymous session authorization, quota reservation, exact Blob grants, and result authorization.
- Vercel Workflow owns durable retries and progress events, but never stores audio bytes in workflow state.
- The Hugging Face gateway bearer and application-level endpoint secret are independently verified.
- The worker accepts only strict schemas, exact allowlisted HTTPS hosts, short expiries, and attempt-scoped object paths.

## Secret handling

Production secrets belong in Vercel and Hugging Face environment settings. Never commit `.env.local`, endpoint tokens, Blob credentials, database URLs, signed URLs, or captured audio. Rotate both worker credentials if either boundary is exposed.

## Data lifetime

Live capture and result access expires with the 24-hour session. The cleanup route requires
`CRON_SECRET`, waits through a 15-minute post-expiry write-drain window, then repeatedly deletes
every bounded or persisted Blob path and cascades database discovery rows only after successful
deletion. The personal, non-commercial low-volume Hobby profile schedules cleanup daily for 03:17
UTC (`17 3 * * *`; Hobby may invoke it within that hour), processes at most 25 expired sessions per pass, and assumes fewer than 25 newly
expired sessions per day. If `backlogRemaining` is true, an operator must invoke cleanup again
manually until it is false. With a normal daily drain, physical deletion can occur up to roughly
49 hours after creation; Hobby provides no SLA. Professional, commercial, or higher-volume
operation uses Vercel Pro or Enterprise and the five-minute schedule (`*/5 * * * *`). Hashed
abuse-control ledger rows are retained for 35 days.

## Deployment controls

- Keep the worker image and model revision immutable.
- Use the exact Node/npm toolchain and keep every dependency install script on the pinned `allowScripts` list; unexpected lifecycle scripts fail clean installation.
- Keep the preview endpoint at maximum one replica and enforce application job caps.
- Keep the low-volume Hobby circuit breakers at `MAX_GLOBAL_JOBS_PER_DAY=5` and
  `MAX_ACTIVE_GPU_JOBS=1`.
- Exercise WAF/rate-limit changes in preview and log-only mode before enforcement.
- Do not enable `SIGNAL_MODE=live` until Neon, private Blob, cleanup authentication, the protected worker, and all required secrets are healthy.
- Require the authenticated deep-readiness probe, physical-device journey, retention canary, and rollback evidence in the [production runbook](docs/PRODUCTION_RUNBOOK.md) before moving the production alias.
