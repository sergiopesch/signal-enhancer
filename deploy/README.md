# Worker release and Hugging Face promotion

This directory holds non-secret release policy, validation, and the guarded endpoint-creation
helper. Running static validation does not change infrastructure; running the deployment helper
does.

- `huggingface-endpoint.production.json` is the production invariant set, not a deployable request.
  Its image reference is deliberately `null`, so it cannot accidentally promote a floating tag.
- `validate_worker_release.py` validates that policy, an immutable image reference, Docker inspect
  evidence, and an optional Hugging Face endpoint snapshot. Validation errors name fields only;
  they never echo rejected values.

Run the static policy check from the repository root:

```bash
python3 deploy/validate_worker_release.py
```

## What CI proves

The worker quality gate builds `worker/Dockerfile` with `INSTALL_RESEMBLE=1` and the full Git SHA.
It then verifies the pinned model labels, non-root user, Linux AMD64 platform, runtime imports,
TorchAudio compatibility, and the development-mode HTTP health contract. The same local image is
catalogued as SPDX JSON and scanned; any unreviewed high or critical vulnerability fails CI.
`worker.openvex.json` holds narrow package-version/CVE assessments for code paths proven absent
from this worker. CI refuses a missing/changed component or reviewed source-boundary hash, records
the exact OCI digest from that build's SBOM in a distinct rendered document, and retains the VEX
and Grype JSON report. Because Grype reconstructs package identity but not root-image identity from
SPDX JSON, suppression is enforced on each exact CVE/package-version PURL; the image digest is
immutable issuance evidence rather than the scanner's matching key. CI proves both positive
matching and a deliberately changed package version that must remain active. A new CVE, package
version, architecture, or unproven source/native boundary is not suppressed.

SoundFile 0.13.1's Linux wheel also bundles libsndfile 1.2.2 and prefers that copy over the Debian
library. The CVE-2026-37555 assessment therefore pins both package PURLs and relies on the tested
PCM/float-only parser boundary; removing the Debian package alone is not remediation.

CI cannot prove that Hugging Face mounted the checkpoint, that the selected L4 exposes CUDA, or
that a published registry digest contains the bytes CI scanned. Those remain promotion gates.

## Production invariant set

Configure the endpoint with these non-secret values:

| Setting                         | Required value                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------- |
| Access                          | HF `authenticated` (the current name for token-gated/protected), never `public` |
| Response caching                | disabled                                                                        |
| Provider and region             | AWS `eu-west-1`                                                                 |
| Hardware                        | GPU, `nvidia-l4`, `x1`                                                          |
| Scaling                         | minimum 0, maximum 1, scale-to-zero timeout 15 minutes                          |
| Model repository                | `ResembleAI/resemble-enhance`                                                   |
| Model framework                 | `custom` (required when a custom image is configured)                           |
| Model revision                  | `4e3510ce4a8391159f665903544c5150bee7b2cb`                                      |
| Custom image                    | approved registry reference with `@sha256:<64 lowercase hex>`, never a tag      |
| Platform                        | `linux/amd64`                                                                   |
| Container port and health route | `7860` and `/health`                                                            |

Every release uses a blue/green endpoint named `signal-enhancer-<digest-prefix>`, where the suffix
is the first 12 hexadecimal characters of the approved image digest. The deployment command omits
an HF task and the provider snapshot must show no task or entrypoint override. The policy-locked
request explicitly sends `cache_http_responses=false` and is validated before provisioning. The
current documented `EndpointWithStatus` response does not expose that request setting, so snapshot
validation deliberately does not claim to prove it a second time. If Hugging Face returns the
field as an extension, the validator still rejects a true value.

The endpoint must also receive every `plainEnvironment` entry in the JSON policy plus
`SIGNAL_ALLOWED_STORAGE_HOSTS`, populated with the exact private Blob data host and PUT
control-plane host. Wildcards fail production readiness. Set only `SIGNAL_ENDPOINT_SECRET` in the
endpoint's secret environment. The Hugging Face gateway token stays in Vercel and must not be
injected into the worker. The two credentials must be independently generated and rotated.

This service is private to the browser at the application boundary, but the current Vercel caller
requires an internet-reachable, authenticated HF endpoint. HF `private` is a different product
mode using PrivateLink. Selecting it without first adding a compatible private network path from
Vercel will make the product unavailable.

## Safe promotion sequence

1. Require a green CI run for the exact full Git SHA. Review and retain its worker SBOM, exact
   package-scoped VEX document with its associated image digest, and Grype report. Do not add or
   broaden a high/critical VEX statement
   without primary-source evidence, a tested execution boundary, and an exact versioned package
   PURL. Reassess all Python statements when Python 3.12.14 (or another official 3.12 security
   release) is available, and every statement whenever its package, native boundary, or base image
   changes.
2. Build from that SHA with `INSTALL_RESEMBLE=1`, push to the approved registry, and resolve the
   registry's manifest digest. The exact package must be anonymously readable so Hugging Face can
   pull it; the publisher logs out and proves this before continuing. A first GHCR publication may
   require an administrator to change the new container package from its default private visibility
   to public, then rerun the publisher. A local image ID or a tag digest is not promotion evidence.
3. Validate the resolved reference before using it:

   ```bash
   python3 deploy/validate_worker_release.py \
     --image-reference 'REGISTRY/OWNER/signal-enhancer-worker@sha256:REPLACE_WITH_64_HEX'
   ```

4. Pull that exact digest back from the registry, regenerate its SBOM, rerun the high/critical
   vulnerability gate, and verify its OCI revision/model/checkpoint labels match the approved
   commit and policy. This detects registry or manifest drift after the CI-local build.
5. Install `uv` and the Hugging Face CLI, authenticate with `hf auth login`, then create the
   digest-derived blue/green HF endpoint with `worker/scripts/deploy_huggingface_endpoint.sh` using
   the invariant set above. The script runs the helper in an isolated runtime pinned to
   `huggingface-hub==1.21.0`; it does not depend on the system Python or print the cached token. Add
   secret values only through the provider's secret controls; never place them in a command line,
   checked-in JSON, workflow input, issue, or build argument. If observable post-create validation
   fails, the helper deletes that newly created digest-named endpoint. A rollback failure is a hard
   stop requiring immediate manual deletion to avoid charges.
6. Export the resulting endpoint configuration through the authenticated admin API into a
   permission-restricted temporary file. Do not print or commit it. Validate the observable
   snapshot fields and approved image together:

   ```bash
   python3 deploy/validate_worker_release.py \
     --endpoint-json /private/tmp/hf-endpoint-snapshot.json \
     --image-reference 'REGISTRY/OWNER/signal-enhancer-worker@sha256:REPLACE_WITH_64_HEX'
   ```

7. On the target L4, require `/health` to return 200 only after the pinned checkpoint checksum is
   verified and CUDA model loading finishes. With application-secret authentication, require
   `/version` to report the expected build, pipeline, DSP, model name, and model revision. Verify
   the source revision separately from the immutable image label. Inspect provider logs for safe
   error codes only—never request bodies, signed URLs, audio, or credentials.
8. In a live preview environment, run one disposable two-capture journey through private Blob,
   durable workflow, the digest-pinned endpoint, result retrieval, and authenticated cleanup.
   Verify expiry/deletion, failure recovery, cold-start behavior, and no browser-visible secrets.
9. Promote web and worker configuration together only after those gates pass. Retain the previous
   known-good digest for rollback, and roll back by digest rather than rebuilding an old tag.

The low-volume Vercel Hobby profile remains a full interactive live service, but it is valid only
for personal, non-commercial use and has no SLA. It uses an existing pooled Neon Free connection
or equivalent, caps work at `MAX_GLOBAL_JOBS_PER_DAY=5` and `MAX_ACTIVE_GPU_JOBS=1`, and schedules
cleanup daily for 03:17 UTC (`17 3 * * *`; Hobby may invoke it within that hour). Each pass processes at most 25 expired sessions and
assumes fewer than 25 newly expired sessions per day; manually invoke cleanup again whenever
`backlogRemaining` is true. User access expires after 24 hours, while physical deletion can occur
up to roughly 49 hours after creation with the 15-minute write-drain window and normal daily drain.
Professional, commercial, or higher-volume deployments instead use Vercel Pro or Enterprise and
the five-minute cleanup schedule (`*/5 * * * *`).

Stop promotion if the endpoint is public, any revision differs, the image uses a tag, the SBOM or
scan is missing, a VEX statement is broader than an exact reviewed package version, fallback is
enabled, `/health` cannot load the real model, cleanup does not match the selected profile, the
Hobby backlog procedure is unowned, or the disposable live journey fails.
