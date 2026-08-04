#!/usr/bin/env bash

set -euo pipefail

: "${HF_ENDPOINT_IMAGE:?Set HF_ENDPOINT_IMAGE to an immutable image digest (for example ghcr.io/acme/signal-enhancer@sha256:...).}"
: "${HF_ENDPOINT_SECRETS_FILE:?Set HF_ENDPOINT_SECRETS_FILE to a chmod 600 file containing only SIGNAL_ENDPOINT_SECRET=...}"
: "${SIGNAL_ALLOWED_STORAGE_HOSTS:?Set SIGNAL_ALLOWED_STORAGE_HOSTS to the exact private Blob hosts.}"

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIRECTORY}/../.." && pwd)"

if ! command -v hf >/dev/null 2>&1; then
  echo "Hugging Face CLI is required. Install it and run 'hf auth login'." >&2
  exit 1
fi
if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required to run the pinned Hugging Face deployment client." >&2
  exit 1
fi

hf auth whoami >/dev/null
uv run \
  --directory "${REPOSITORY_ROOT}" \
  --isolated \
  --with "huggingface-hub==1.21.0" \
  python "${REPOSITORY_ROOT}/deploy/create_huggingface_endpoint.py"
