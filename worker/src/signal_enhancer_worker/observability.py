"""Structured operational logs that cannot contain media URLs or credentials."""

from __future__ import annotations

import json
import logging
from typing import Literal

_LOGGER = logging.getLogger("signal_enhancer.worker")


def configure_safe_logging() -> None:
    # HTTPX's request log includes the complete query string, which is a signed secret.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


def log_job_event(
    event: Literal["analyze_complete", "enhance_complete", "enhance_failed", "enhance_cancelled"],
    *,
    job_id: str,
    attempt_id: str,
    elapsed_ms: float,
    code: str | None = None,
    engine: Literal["dsp", "resemble"] | None = None,
    audio_seconds: float | None = None,
    real_time_factor: float | None = None,
    timings_ms: dict[str, float] | None = None,
) -> None:
    payload: dict[str, object] = {
        "event": event,
        "job_id": job_id,
        "attempt_id": attempt_id,
        "elapsed_ms": round(elapsed_ms, 3),
    }
    if code is not None:
        payload["code"] = code
    if engine is not None:
        payload["engine"] = engine
    if audio_seconds is not None:
        payload["audio_seconds"] = round(audio_seconds, 6)
    if real_time_factor is not None:
        payload["real_time_factor"] = round(real_time_factor, 4)
    if timings_ms is not None:
        payload["timings_ms"] = {
            key: round(value, 3)
            for key, value in sorted(timings_ms.items())
            if key in {"download", "validation", "analysis", "model", "dsp", "artifacts", "upload"}
        }
    _LOGGER.info(json.dumps(payload, sort_keys=True, separators=(",", ":")))
