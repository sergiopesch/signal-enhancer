# syntax=docker/dockerfile:1.7
FROM --platform=linux/amd64 python:3.12.11-slim-bookworm AS builder

ARG INSTALL_RESEMBLE=0

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

RUN python -m pip install "uv==0.11.28"

COPY pyproject.toml uv.lock README.md THIRD_PARTY_NOTICES.md ./
COPY src ./src

RUN if [ "$INSTALL_RESEMBLE" = "1" ]; then \
      uv sync --frozen --no-dev --no-editable --extra resemble; \
    else \
      uv sync --frozen --no-dev --no-editable; \
    fi

FROM --platform=linux/amd64 python:3.12.11-slim-bookworm AS runtime

ARG SIGNAL_BUILD_REVISION=dev

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SIGNAL_BUILD_REVISION=${SIGNAL_BUILD_REVISION} \
    SIGNAL_TMP_ROOT=/tmp/signal-enhancer \
    PATH="/app/.venv/bin:${PATH}"

WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates libsndfile1 \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system --gid 10001 signal \
    && adduser --system --uid 10001 --ingroup signal --home /nonexistent --no-create-home signal \
    && mkdir -p /tmp/signal-enhancer \
    && chown 10001:10001 /tmp/signal-enhancer

COPY --from=builder /app/.venv /app/.venv

USER 10001:10001
EXPOSE 7860

HEALTHCHECK --interval=20s --timeout=4s --start-period=90s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7860/health', timeout=3)"

CMD ["uvicorn", "signal_enhancer_worker.app:app", "--host", "0.0.0.0", "--port", "7860", "--no-access-log"]
