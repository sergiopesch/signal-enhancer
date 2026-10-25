# syntax=docker/dockerfile:1.7
ARG INSTALL_RESEMBLE=1

# Keep the readable security-release tag while pinning the exact multi-platform image index.
FROM --platform=linux/amd64 python:3.12.15-slim-trixie@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704 AS builder

ARG INSTALL_RESEMBLE

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --no-deps \
    "https://files.pythonhosted.org/packages/75/2e/62273ee6c9fbebccd8248c153b44870f81ebf5267c31edf4c095d78537fb/uv-0.11.28-py3-none-manylinux_2_17_x86_64.manylinux2014_x86_64.whl#sha256=49fe42df9f42056037473f3876adec1615709b57d3470ed39178ff420f3afb9f"

COPY pyproject.toml uv.lock README.md THIRD_PARTY_NOTICES.md ./
COPY src ./src
COPY vendor ./vendor
COPY scripts/verify_resemble_core.py /usr/local/libexec/verify_resemble_core.py

RUN python /usr/local/libexec/verify_resemble_core.py --source vendor/signal-resemble-core

RUN if [ "$INSTALL_RESEMBLE" = "1" ]; then \
      uv sync --frozen --no-dev --no-editable --extra resemble \
        && .venv/bin/python /usr/local/libexec/verify_resemble_core.py --installed; \
    else \
      uv sync --frozen --no-dev --no-editable; \
    fi

FROM --platform=linux/amd64 python:3.12.15-slim-trixie@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704 AS runtime

ARG INSTALL_RESEMBLE
ARG SIGNAL_BUILD_REVISION=dev

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    HOME=/var/lib/signal-enhancer \
    XDG_CACHE_HOME=/var/lib/signal-enhancer/cache \
    TRITON_CACHE_DIR=/var/lib/signal-enhancer/cache/triton \
    SIGNAL_BUILD_REVISION=${SIGNAL_BUILD_REVISION} \
    SIGNAL_TMP_ROOT=/tmp/signal-enhancer \
    PATH="/app/.venv/bin:${PATH}"

WORKDIR /app

LABEL org.opencontainers.image.title="Signal Enhancer audio worker" \
      org.opencontainers.image.description="Private service-to-service audio restoration worker" \
      org.opencontainers.image.source="https://github.com/sergiopesch/signal-enhancer" \
      org.opencontainers.image.revision="${SIGNAL_BUILD_REVISION}" \
      org.opencontainers.image.licenses="Proprietary" \
      io.signal-enhancer.resemble-installed="${INSTALL_RESEMBLE}" \
      io.signal-enhancer.resemble-source-revision="8e978149bfe8abab3eb77d965d579a111afdb0ff" \
      io.signal-enhancer.resemble-model-revision="4e3510ce4a8391159f665903544c5150bee7b2cb" \
      io.signal-enhancer.resemble-checkpoint-sha256="f9d035f318de3e6d919bc70cf7ad7d32b4fe92ec5cbe0b30029a27f5db07d9d6"

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      ca-certificates \
      libsndfile1 \
      libssl3t64 \
      openssl \
      openssl-provider-legacy \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system --gid 10001 signal \
    && adduser --system --uid 10001 --ingroup signal \
      --home /var/lib/signal-enhancer --no-create-home signal \
    && install -d --owner=10001 --group=10001 --mode=0700 \
      /var/lib/signal-enhancer \
      /var/lib/signal-enhancer/cache \
      /var/lib/signal-enhancer/cache/triton \
      /tmp/signal-enhancer

COPY --from=builder /app/.venv /app/.venv
COPY --from=builder --chmod=0644 /usr/local/libexec/verify_resemble_core.py /usr/local/libexec/verify_resemble_core.py
COPY --chmod=0644 scripts/run_worker.py /usr/local/libexec/run_worker.py

# The service needs no set-ID helpers or executable file capabilities.
RUN python - <<'PY_RUNTIME'
import hashlib
import os
import stat
from pathlib import Path

for current, directories, names in os.walk("/", topdown=True, followlinks=False):
    directories[:] = [name for name in directories if str(Path(current, name)) not in {"/dev", "/proc", "/run", "/sys"}]
    for name in names:
        path = Path(current, name)
        metadata = path.lstat()
        if not stat.S_ISREG(metadata.st_mode):
            continue
        if metadata.st_mode & (stat.S_ISUID | stat.S_ISGID):
            path.chmod(stat.S_IMODE(metadata.st_mode) & ~(stat.S_ISUID | stat.S_ISGID))
        if "security.capability" in os.listxattr(path, follow_symlinks=False):
            os.removexattr(path, "security.capability", follow_symlinks=False)

# The immutable audio service performs no package installation at runtime.
# Keep package records for the SBOM while denying access to the two gzip writers.
for filename, expected_sha256 in {
    "/usr/bin/dpkg-deb": "5346e5fdfdc81d58bbc9d2a3de20ff3738dc479cdb04cc52b91503cbb13440eb",
    "/usr/lib/x86_64-linux-gnu/libapt-pkg.so.7.0.0": "d3dca8bc35a1addcc03808792768ce82ca59bb3623f8053e58b3402ac5898974",
}.items():
    path = Path(filename)
    assert path.stat().st_uid == 0 and path.stat().st_gid == 0
    assert hashlib.file_digest(path.open("rb"), "sha256").hexdigest() == expected_sha256
    path.chmod(0)
PY_RUNTIME

USER 10001:10001
EXPOSE 7860

HEALTHCHECK --interval=20s --timeout=4s --start-period=90s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7860/health', timeout=3)"

CMD ["python", "/usr/local/libexec/run_worker.py"]
