# Signal Enhancer audio worker

This directory is the private, service-to-service audio plane for Signal Enhancer. It is a
FastAPI container intended for a Hugging Face Inference Endpoint. The browser must never call
it directly.

The worker deliberately does four things:

1. downloads Input A and Input B from short-lived, object-scoped private URLs;
2. validates and measures both WAV files with a single bounded parser;
3. restores Input A once, then applies a restrained deterministic DSP polish;
4. uploads an aligned PCM16 WAV, a bounded difference map, and a transparent report.

It never accepts a caller-selected model, preset, processing chain, source input, arbitrary
artifact list, or output filename. It never returns signed URLs.

## API

- `GET /health` is unauthenticated for the endpoint health probe. It returns `200` only after
  configuration, DSP, and the selected model are ready; otherwise it returns `503`.
- `GET /version` requires application-secret authentication and returns immutable build/pipeline/model
  revisions.
- `POST /v1/analyze` requires application-secret authentication and validates/analyzes both captures.
- `POST /v1/enhance` requires application-secret authentication and generates the three result artifacts.
  With `Accept: application/x-ndjson`, it emits the seven real product stages and one final
  result record. With any other Accept header it returns one JSON result.

All POST models use Pydantic strict mode and reject unknown keys recursively. Requests must use
`Content-Type: application/json` and are capped at 64 KiB. Error responses contain only stable,
safe codes; validation output never reflects URL or token values.

The exact request/response schemas are defined in
`src/signal_enhancer_worker/contracts.py`. Important invariants include:

- lowercase UUID job and attempt IDs;
- literal API schema `"1"` and literal source `"A"`;
- literal guided-reading protocol `{ "id": "guided-reading-v1", "revision": "1.0.0" }`;
- explicit Input A/Input B descriptors with byte count and SHA-256;
- output paths scoped by job and attempt and ending in `enhanced.wav`, `difference.json`, and
  `report.json`;
- URL path exactly matching the declared object path;
- URL expiry between three seconds and fifteen minutes from validation time;
- exact output content types and no input/output path reuse.

The enhanced WAV always has Input A's sample rate and frame count, so its difference map is
aligned. Resemble bandwidth restoration is described as inferred—not recovered fact.

## WAV limits

The parser accepts mono RIFF/WAVE only, up to 4 MiB and 20 seconds. Supported encodings are
PCM16, PCM24, PCM32, and finite IEEE float32, including valid WAVE_FORMAT_EXTENSIBLE variants.
Sample rates from 8–96 kHz are accepted. It rejects RF64, compressed codecs, duplicate required
chunks, truncated or inconsistent chunk sizes, inconsistent byte rates/block alignment, empty
data, non-finite float samples, and mismatched committed byte counts or hashes.

## Configuration

Production fails closed when required settings are absent.

| Variable                             | Required   | Meaning                                                                                |
| ------------------------------------ | ---------- | -------------------------------------------------------------------------------------- |
| `SIGNAL_ENDPOINT_SECRET`             | yes        | Dedicated high-entropy application secret shared only with Vercel                      |
| `SIGNAL_ALLOWED_STORAGE_HOSTS`       | yes        | Comma-separated exact hosts; a leading `*.` is supported but exact hosts are preferred |
| `SIGNAL_BUILD_REVISION`              | production | Exact 40-character Git commit baked into the image                                     |
| `SIGNAL_ENGINE`                      | production | Must be `resemble`; `dsp` is for explicit development preview only                     |
| `SIGNAL_ALLOW_DSP_FALLBACK`          | production | Must be `false`; defaults to false and is rejected in production                       |
| `SIGNAL_RESEMBLE_RUN_DIR`            | with model | Pinned `enhancer_stage2` directory; default `/repository/enhancer_stage2`              |
| `SIGNAL_RESEMBLE_DEVICE`             | no         | Torch device, default `cuda`                                                           |
| `SIGNAL_RESEMBLE_SOURCE_REVISION`    | no         | Approved source commit; changing it fails readiness                                    |
| `SIGNAL_RESEMBLE_MODEL_REVISION`     | no         | Approved Hugging Face artifact commit; changing it fails readiness                     |
| `SIGNAL_TMP_ROOT`                    | no         | Isolated temporary-job parent, default `/tmp/signal-enhancer`                          |
| `SIGNAL_ALLOW_INSECURE_STORAGE_HTTP` | test only  | Enables HTTP only outside production                                                   |

The default `dsp` engine is an explicitly labelled preview path and is not AI restoration.
Production must set `SIGNAL_ENGINE=resemble`; it also fails readiness if DSP fallback is enabled,
so a model failure cannot silently masquerade as a completed AI enhancement.

The Vercel workflow sends two independent credentials: `Authorization: Bearer ...` is consumed
by the protected Hugging Face gateway, while `X-Signal-Endpoint-Secret` must contain
`SIGNAL_ENDPOINT_SECRET` and is verified by this application. Do not reuse the Hugging Face
endpoint token as the application secret.

For Vercel Blob, allowlist both the exact private object host and exact PUT control-plane host,
for example `abc123.private.blob.vercel-storage.com,blob.vercel-storage.com`. GET URL paths must
equal the declared object pathname. PUT URLs must use the control-plane root and their single
signed `pathname` query value must equal the declared output pathname.
The worker also requires the signed PUT constraints to disable overwrites and random suffixes,
match the artifact content type, and cap size at or below the declared `max_bytes`.

## Local development

Python 3.11 or 3.12 is supported. Production uses Python 3.12.

```bash
uv sync --extra dev --frozen
SIGNAL_ENVIRONMENT=development \
SIGNAL_ENDPOINT_SECRET=local-only-secret \
SIGNAL_ALLOWED_STORAGE_HOSTS=storage.example \
SIGNAL_BUILD_REVISION=local-dev \
uv run uvicorn signal_enhancer_worker.app:app --reload --port 7860
uv run pytest
uv run ruff check .
uv run mypy
```

Tests use an in-memory HTTP transport; they never need Blob credentials, model packages, or a
GPU.

To exercise the production dependency boundary locally, install the committed model extra and
check the resolved environment. CI performs the authoritative import and compatibility smoke
inside the production image:

```bash
uv sync --extra dev --extra resemble --frozen
uv pip check --python .venv/bin/python
```

## Container and Hugging Face

The image is fixed to `linux/amd64`, uses a digest-pinned Python 3.12.13 security-release base,
installs from the committed `uv.lock`, runs as UID/GID 10001, disables Uvicorn access logs, and
uses port 7860 plus `/health` for readiness. The unprivileged account has a private `0700` home
and cache tree at `/var/lib/signal-enhancer`; DeepSpeed's Triton cache is confined there instead of
attempting to write beneath the root filesystem. A production build includes the pinned Resemble
dependency by default; keep the build argument explicit in release automation:

```bash
docker build --platform linux/amd64 \
  --build-arg INSTALL_RESEMBLE=1 \
  --build-arg SIGNAL_BUILD_REVISION="$(git rev-parse HEAD)" \
  -t signal-enhancer-worker:resemble .
```

The protected manual `Publish Hugging Face worker` GitHub workflow builds that production target
for `linux/amd64` and publishes it to GHCR. It then logs out, anonymously pulls the exact digest,
validates the pulled image labels, regenerates a retained SPDX SBOM, and blocks high or critical
findings before reporting the immutable deployment coordinate. Hugging Face must be able to pull
the custom image. After authenticating the Hugging Face CLI, deploy that digest with the checked-in
guardrail script:

```bash
chmod 600 ./hf-endpoint.secrets
# hf-endpoint.secrets contains only: SIGNAL_ENDPOINT_SECRET=<at least 32 characters>
HF_ENDPOINT_IMAGE="ghcr.io/owner/repository/worker@sha256:..." \
HF_ENDPOINT_SECRETS_FILE="$PWD/hf-endpoint.secrets" \
SIGNAL_ALLOWED_STORAGE_HOSTS="abc123.private.blob.vercel-storage.com,blob.vercel-storage.com" \
./scripts/deploy_huggingface_endpoint.sh
```

The script fails before provisioning unless `uv` and the Hugging Face CLI are installed, the image
is digest-pinned, the secrets file contains exactly one strong application secret at mode `600`,
and the CLI is authenticated. It runs the provider helper in an isolated environment pinned to
`huggingface-hub==1.21.0`, creates an authenticated custom GPU endpoint from the exact Hub revision,
explicitly disables response caching, mounts the model at `/repository`, configures `/health` on
port `7860`, forbids DSP fallback, and fixes the beta to `eu-west-1 / nvidia-l4 / x1`, zero-to-one
replicas, and a 15-minute scale-to-zero timeout.
`SIGNAL_BUILD_REVISION` is baked into the production image by the publish workflow and is not
overridden with a second caller-supplied value during deployment.

The helper uses the authenticated HF client because the CLI has no response-cache switch. It
derives the only permitted endpoint name from the first 12 characters of the image digest for an
immutable blue/green promotion, validates the request before provisioning, and then validates the
observable provider-returned snapshot fields. The documented snapshot does not echo the response
cache request setting, so the validator does not claim to re-prove it. A post-create validation
failure automatically deletes only that newly created digest-named endpoint; a rollback failure is
a hard stop requiring immediate manual deletion. Promote the new endpoint URL to Vercel after its
authenticated `/version` and model-backed `/health` checks pass; retire the prior endpoint only
after in-flight jobs have drained.

The model source revision is pinned in `pyproject.toml`; model files must also be pinned from
`ResembleAI/resemble-enhance@4e3510ce4a8391159f665903544c5150bee7b2cb` and mounted at
`SIGNAL_RESEMBLE_RUN_DIR`. Before importing Torch or calling upstream `torch.load`, startup verifies
all three required artifacts against the checked-in SHA-256 manifest: the 713 MB checkpoint,
`ds/G/latest`, and `hparams.yaml`. A missing or altered artifact fails readiness, and the upstream
package can never fall back to its floating network download. Every result records the exact Hub
repository and revision, source repository and revision, checkpoint digest, and fixed inference
profile (`nfe=32`, midpoint solver, `lambd=0.35`, `tau=0.45`). Promote the published image by
immutable digest rather than a floating tag. Keep endpoint minimum replicas at zero and maximum
replicas at one during the beta, and let the durable Vercel workflow handle bounded cold-start
retries.

For local DSP-only development, opt out explicitly with `--build-arg INSTALL_RESEMBLE=0`. That
smaller image is labelled `io.signal-enhancer.resemble-installed=0`, and the release validator
will reject it for promotion.

The checked-in non-secret endpoint policy is `../deploy/huggingface-endpoint.production.json`;
validate it and any release evidence with `../deploy/validate_worker_release.py`. It fixes the
model and checkpoint revisions, AWS `eu-west-1`, one NVIDIA L4, scale-to-zero from zero to one
replica, port 7860, and `/health`. It intentionally contains no image value or credential value.

The current Vercel-to-Hugging-Face path requires an internet-reachable, token-gated endpoint.
Hugging Face now calls this endpoint type `authenticated`; it is the current name for the
formerly `protected` mode. `public` is forbidden. Hugging Face `private` means PrivateLink and is
not reachable from Vercel without a separately designed private-network topology. Keep minimum
replicas at zero and maximum replicas at one during the beta, and let the durable Vercel workflow
handle bounded cold-start retries.

The Linux lock resolves Torch's CUDA 13 runtime. Treat a successful `/health` probe on the target
GPU instance as a promotion gate; the worker fails closed when its configured CUDA device is not
available.

The optional dependency is
[Resemble Enhance](https://github.com/resemble-ai/resemble-enhance), pinned to
`8e978149bfe8abab3eb77d965d579a111afdb0ff`. Its MIT notice is recorded in
`THIRD_PARTY_NOTICES.md` and remains present in the installed distribution.

The production dependency set is resolved in `uv.lock`, including the newest compatible
TorchAudio maintenance release. CI builds the actual `INSTALL_RESEMBLE=1` image, checks its OCI
revision/model labels and non-root identity, smoke-tests the Resemble import path and exact
TorchAudio operations inside that image, exercises its HTTP health contract, emits an SPDX JSON
SBOM, and blocks high or critical image vulnerabilities. It also audits every registry package
from a hash-locked export. The Resemble source distribution is not represented in PyPI's advisory
database; CI therefore asserts its exact Git revision before excluding that single line from the
registry audit. The image scan starts from the reviewed, version-scoped OpenVEX component policy
in `deploy/worker.openvex.json`, verifies every component against the SBOM, and renders statements
with exact package-version products plus the SBOM's immutable image PURL as issuance evidence. It
also proves the locale and native-symbol boundaries used by the glibc assessments, compares every
high/critical baseline match with the exact reviewed CVE/PURL pairs, and confirms a deliberately
changed Python version remains active. These controls do not suppress new CVEs, changed packages,
or a changed reviewed execution boundary. Changing the base image, source revision, model
revision, checkpoint, native audit, or any VEX package requires a fresh image build, SBOM,
vulnerability scan, source review, and GPU checkpoint-load test.

CI deliberately neither publishes an image nor updates an endpoint. Follow the
[worker release runbook](../deploy/README.md) for the remaining approval, registry, digest,
endpoint-snapshot, GPU health, and disposable end-to-end gates.
