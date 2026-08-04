# Production release runbook

This runbook is the release gate for Signal Enhancer. It separates repository readiness from the
external infrastructure, credentials, and physical-device evidence that cannot be committed or
simulated safely. Never paste a credential, signed media URL, endpoint snapshot, captured voice,
or database URL into a terminal transcript, issue, pull request, or release record.

## 1. Approve the external production boundary

Before any live deployment, record an owner and budget for each service and choose one deployment
profile:

- **Personal low-volume live demo:** Vercel Hobby may host the full interactive service only for
  personal, non-commercial use. It has no SLA. The checked-in cron runs authenticated cleanup
  daily for 03:17 UTC (`17 3 * * *`; Hobby may invoke it within that hour), with the strict volume
  and manual-drain controls in section 7.
- **Professional, commercial, or higher-volume:** use Vercel Pro or Enterprise in `dub1` and the
  five-minute cleanup schedule (`*/5 * * * *`).
- Neon Postgres and a dedicated private Vercel Blob store in the intended environment. An existing
  pooled Neon Free `DATABASE_URL` is acceptable for the tiny-traffic Hobby profile; provisioning a
  new database through Vercel Marketplace is optional.
- an immutable-digest container registry whose approved worker package is anonymously readable by
  Hugging Face (the publisher verifies this after logging out of the registry);
- a paid Hugging Face custom Inference Endpoint on AWS `eu-west-1` with one NVIDIA L4, scale from
  zero to at most one replica, and the 15-minute scale-to-zero policy;
- operational alerting for web 5xx, workflow failures, worker 5xx/readiness, cleanup failure,
  database/Blob failure, and GPU cost or saturation.

The current Vercel-to-Hugging-Face architecture requires HF's internet-reachable,
token-gated `authenticated` endpoint type (formerly described as protected). `public` is
forbidden. HF `private` uses PrivateLink and is not reachable from this Vercel architecture
without a separate private-network design.

Creating the endpoint and, for the professional profile, changing the Vercel plan can incur
charges. They are explicit release decisions, not automated repository steps.

## 2. Freeze and prove one release candidate

1. Start from a reviewed full Git commit, not an uncommitted worktree.
2. Require a green GitHub Actions run for that exact commit. It must include the web audit,
   formatting, lint, typecheck, unit tests, production build, desktop/mobile browser journeys,
   worker audit/tests, the real Resemble-enabled image build, image identity checks, SPDX SBOM,
   reviewed version-scoped component policy, image-associated exact-package VEX,
   native-boundary proof, a package-version mismatch test, and a blocking high/critical image
   scan. Retain the rendered VEX and Grype JSON report alongside the SBOM. A new CVE, changed
   package version, or changed reviewed source/native boundary must remain blocking. A different
   image digest receives a distinct document ID and recorded image PURL; Grype's SPDX scan itself
   enforces exact package/CVE PURLs rather than root-image identity.
3. Publish the worker image from that commit, resolve its registry manifest digest, pull the
   digest back, and repeat the SBOM/scan and label validation. Follow
   [`../deploy/README.md`](../deploy/README.md); never promote a tag.
4. Retain the exact web commit, worker digest, SBOM, VEX, scan result, model commit, and migration
   list in the release record. Retain the previous known-good web commit and worker digest for
   rollback.

## 3. Provision the worker without exposing secrets

Use [`../deploy/huggingface-endpoint.production.json`](../deploy/huggingface-endpoint.production.json)
as the non-secret invariant set and validate the provider snapshot with
`deploy/validate_worker_release.py`. The model mount must resolve
`ResembleAI/resemble-enhance@4e3510ce4a8391159f665903544c5150bee7b2cb`; startup verifies the
approved checkpoint checksum before model loading.

Provision each release as a blue/green endpoint named `signal-enhancer-<digest-prefix>` from the
approved image digest. The release script deliberately omits an HF task and does not permit a
human-selected endpoint name. It explicitly sends and pre-validates
`cache_http_responses=false`; the documented provider response does not expose that request-only
setting, so the exported snapshot cannot independently prove it. If the provider returns the
field as an extension, validation still rejects a true value.

Set `SIGNAL_ALLOWED_STORAGE_HOSTS` to the exact private Blob data host and PUT control-plane host.
Set `SIGNAL_ENDPOINT_SECRET` only through the HF secret control. It must be an independently
generated value of at least 32 bytes and must not be the HF gateway token. Production must set
`SIGNAL_ENGINE=resemble` and `SIGNAL_ALLOW_DSP_FALLBACK=false`; any fallback configuration fails
readiness.

Require `/health` to become ready on the target L4. Then authenticate `/version` with the
application secret and record its build, pipeline, DSP, model name, and model revision. The build
must equal the release commit configured in Vercel.

## 4. Configure the live web environment

Set the following values in the intended Vercel environment using its secret controls. Prefer
Vercel OIDC plus `BLOB_STORE_ID` over a long-lived Blob read/write token.
Enable **Automatically expose System Environment Variables** so the platform supplies the
build-and-runtime `VERCEL_GIT_COMMIT_SHA`; live configuration rejects a missing or mismatched SHA.

| Variable                                         | Release requirement                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `SIGNAL_MODE`, `NEXT_PUBLIC_SIGNAL_MODE`         | Both exactly `live`; the public value is build-time and requires a rebuild  |
| `NEXT_PUBLIC_APP_URL`                            | Exact canonical HTTPS application origin                                    |
| `SESSION_SIGNING_SECRET`, `NETWORK_HASH_SECRET`  | Independent high-entropy values, each at least 32 bytes                     |
| `DATABASE_URL`                                   | Pooled Neon connection; an existing Neon Free URL fits the Hobby profile    |
| `BLOB_STORE_ID` with Vercel OIDC                 | Preferred authority for the dedicated private store                         |
| `BLOB_READ_WRITE_TOKEN`                          | Legacy alternative only; never configure both without a rotation plan       |
| `CRON_SECRET`                                    | High-entropy value used by Vercel for cleanup and operator readiness        |
| `HF_ENDPOINT_URL`                                | Exact HTTPS HF endpoint origin; no path, query, credentials, or custom port |
| `HF_ENDPOINT_TOKEN`                              | Least-privilege HF gateway token                                            |
| `HF_ENDPOINT_SHARED_SECRET`                      | Exact independent value configured as worker `SIGNAL_ENDPOINT_SECRET`       |
| `HF_ENDPOINT_BUILD_REVISION`                     | Exact 40-character lowercase Git commit returned by worker `/version`       |
| `MAX_GLOBAL_JOBS_PER_DAY`, `MAX_ACTIVE_GPU_JOBS` | Exactly `5` and `1` for the low-volume Hobby profile                        |

Use separate values for preview and production. Never expose a server credential with a
`NEXT_PUBLIC_` prefix. Rotate both HF credentials if either boundary is suspected to be exposed.

## 5. Prepare data and deploy to a live preview

1. Apply every checked-in migration to the target database with `npm run db:migrate`. The runner
   verifies the migration ledger checksums and refuses drift.
2. Deploy the exact web commit to a restricted live preview using the exact production-shaped
   integrations. Do not move the public production alias yet.
3. Confirm `GET /api/health` returns `status: ok`, `mode: live`, the expected release, and all three
   integrations configured.
4. Run the authenticated, read-only deep probe. This checks the migration ledger/product tables,
   private Blob signing plus a non-existent-object HEAD, and the authenticated worker `/version`
   contract. It may wake the paid GPU endpoint:

   ```bash
   PRODUCTION_APP_URL=https://RESTRICTED_PREVIEW_ORIGIN \
   CRON_SECRET=SET_IN_A_PRIVATE_SHELL \
   EXPECTED_WEB_RELEASE=FULL_GIT_SHA \
   npm run production:verify
   ```

The verifier never prints credentials, response bodies, or signed URLs. A failed component is a
stop condition; inspect provider logs through access-controlled consoles.

## 6. Exercise the real product and recent UI

Use disposable test speech with informed testers; never use sensitive voice content. Complete at
least one cold and one warm live journey through session creation, both private uploads, durable
workflow, pinned model inference, result retrieval, and page reload/reconnect.

Verify the recent UI release explicitly:

- animated foyer and reduced-motion behavior;
- the complete 36-word guided reading and capture timing;
- independent Input A and Input B review, transport/seek, and rapid playback switching;
- worker progress, enhanced reveal, dual-signal mark, failure copy, and browser-only fallback;
- microphone grant, denial, device switching, and unavailable-device recovery on physical Chrome
  and Safari, including at least one iPhone-class viewport and the 320 px minimum;
- keyboard-only navigation, visible focus, dialog focus return, readable zoom, screen-reader names,
  no horizontal overflow, and no browser console errors.

Automated desktop Chromium, iPhone/WebKit, 320 px, tablet, race, and reduced-motion coverage must
already be green, but it does not replace physical microphone and audio-output testing.

## 7. Prove retention, operations, and rollback

In the isolated preview data set, create an operator-approved disposable session and Blob objects,
wait through the 15-minute post-expiry write-drain window, invoke the authenticated cleanup route,
and confirm every tracked object is gone before database discovery rows cascade. Invoke it again
to prove idempotency. User access must stop at the 24-hour session expiry even if physical cleanup
has not run yet.

Confirm the cron registered for the selected profile, returns success, and drains its reported
backlog; do not infer this from `vercel.json` alone:

- The low-volume Hobby profile is scheduled daily for 03:17 UTC (`17 3 * * *`; Hobby may invoke it
  within that hour). A pass processes at most 25 expired sessions, so this profile assumes fewer than 25 newly expired sessions per day. If a
  response reports `backlogRemaining`, invoke the authenticated route again manually until it is
  false. With the normal daily drain, 24-hour access expiry, and 15-minute write-drain window,
  physical Blob and database deletion can occur up to roughly 49 hours after creation. Hobby has
  no SLA, so a missed run or uncleared backlog extends that physical-deletion time.
- The professional or higher-volume profile registers `*/5 * * * *` on Vercel Pro or Enterprise
  and alerts on any failed run or remaining backlog.

Exercise these failure paths before promotion: worker cold-start timeout, worker rejection, Blob
failure, database failure, browser reconnect, quota exhaustion, and cleanup retry. Confirm safe
user copy and logs contain no request body, audio, credential, database URL, or signed URL.

Rollback means redeploying the previous web commit with its aligned build-time mode and restoring
the previous worker digest. If the live path is unsafe, redeploy both modes as `demo`; changing
only `SIGNAL_MODE` is insufficient because `NEXT_PUBLIC_SIGNAL_MODE` is embedded at build time.
Keep cleanup enabled until all previously accepted live sessions have expired and their objects
have been deleted.

## 8. Promote only on a complete evidence set

Move the production alias only when every gate above is recorded for the same release. Immediately
rerun `npm run production:verify` against the canonical origin, execute one low-risk production
journey, confirm the selected cleanup schedule and its manual-backlog procedure, and watch
error/cost signals through the first cold start. Stop or roll back on any release mismatch, model
fallback, public endpoint, missing scan/SBOM, migration drift, retention failure, secret exposure,
physical-device failure, or unexplained error-rate increase.
