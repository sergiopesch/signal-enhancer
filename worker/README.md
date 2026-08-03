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
- literal diagnostic reference `{ "id": "diagnostic-speech", "revision": "v1" }`;
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
| `SIGNAL_BUILD_REVISION`              | production | Immutable Git SHA or image revision; `dev` is rejected in production                   |
| `SIGNAL_ENGINE`                      | no         | `dsp` (default) or `resemble`                                                          |
| `SIGNAL_ALLOW_DSP_FALLBACK`          | no         | Preserve restrained DSP output if an initialized model fails; default `true`           |
| `SIGNAL_RESEMBLE_RUN_DIR`            | with model | Pinned `enhancer_stage2` directory; default `/repository/enhancer_stage2`              |
| `SIGNAL_RESEMBLE_DEVICE`             | no         | Torch device, default `cuda`                                                           |
| `SIGNAL_RESEMBLE_SOURCE_REVISION`    | no         | Approved source commit; changing it fails readiness                                    |
| `SIGNAL_RESEMBLE_MODEL_REVISION`     | no         | Approved Hugging Face artifact commit; changing it fails readiness                     |
| `SIGNAL_TMP_ROOT`                    | no         | Isolated temporary-job parent, default `/tmp/signal-enhancer`                          |
| `SIGNAL_ALLOW_INSECURE_STORAGE_HTTP` | test only  | Enables HTTP only outside production                                                   |

The default `dsp` engine is an explicitly labelled fallback/preview path and is not AI
restoration. Production should set `SIGNAL_ENGINE=resemble`.

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
run the same import and compatibility checks as CI:

```bash
uv sync --extra dev --extra resemble --frozen
uv pip check --python .venv/bin/python
```

## Container and Hugging Face

The image is fixed to `linux/amd64`, installs from the committed `uv.lock`, runs as UID/GID
10001, disables Uvicorn access logs, and uses `/health` for readiness. Build the small
deterministic image with:

```bash
docker build --platform linux/amd64 \
  --build-arg SIGNAL_BUILD_REVISION="$(git rev-parse HEAD)" \
  -t signal-enhancer-worker:local .
```

For the GPU endpoint, install the pinned Resemble source dependency in the image:

```bash
docker build --platform linux/amd64 \
  --build-arg INSTALL_RESEMBLE=1 \
  --build-arg SIGNAL_BUILD_REVISION="$(git rev-parse HEAD)" \
  -t signal-enhancer-worker:resemble .
```

The model source revision is pinned in `pyproject.toml`; model files must also be pinned from
`ResembleAI/resemble-enhance@4e3510ce4a8391159f665903544c5150bee7b2cb` and mounted at
`SIGNAL_RESEMBLE_RUN_DIR`. Before importing Torch or calling upstream `torch.load`, startup
verifies that `mp_rank_00_model_states.pt` has SHA-256
`f9d035f318de3e6d919bc70cf7ad7d32b4fe92ec5cbe0b30029a27f5db07d9d6`. A missing or altered
checkpoint fails readiness, and the upstream package can never fall back to its floating network
download. Promote the published image by immutable digest rather than a floating tag. Keep
endpoint minimum replicas at zero and maximum replicas at one during the beta, and let the durable
Vercel workflow handle bounded cold-start retries.

The Linux lock resolves Torch's CUDA 13 runtime. Treat a successful `/health` probe on the target
GPU instance as a promotion gate; the worker fails closed when its configured CUDA device is not
available.

The optional dependency is
[Resemble Enhance](https://github.com/resemble-ai/resemble-enhance), pinned to
`8e978149bfe8abab3eb77d965d579a111afdb0ff`. Its MIT notice is recorded in
`THIRD_PARTY_NOTICES.md` and remains present in the installed distribution.

The production dependency set is resolved in `uv.lock`, including the newest compatible
TorchAudio maintenance release. CI installs the complete `resemble` extra, smoke-tests the
Resemble import path and the exact TorchAudio operations it uses, checks installed-package
compatibility, and audits every registry package from a hash-locked export. The Resemble source
distribution is not represented in PyPI's advisory database; CI therefore asserts its exact Git
revision before excluding that single line from the registry audit. Changing either the source
revision or model revision requires a fresh source review, checkpoint-load test, and dependency
audit.
