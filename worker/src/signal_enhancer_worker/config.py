"""Environment-backed settings with production-safe defaults."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

DEFAULT_RESEMBLE_SOURCE_REVISION = "8e978149bfe8abab3eb77d965d579a111afdb0ff"
DEFAULT_RESEMBLE_MODEL_REVISION = "4e3510ce4a8391159f665903544c5150bee7b2cb"
DEFAULT_RESEMBLE_CHECKPOINT_SHA256 = (
    "f9d035f318de3e6d919bc70cf7ad7d32b4fe92ec5cbe0b30029a27f5db07d9d6"
)
_REVISION_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{6,127}$")


def _read_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean")


def _read_hosts(value: str) -> tuple[str, ...]:
    hosts = tuple(part.strip().lower().rstrip(".") for part in value.split(",") if part.strip())
    for host in hosts:
        if "://" in host or "/" in host or host == "*":
            raise ValueError("SIGNAL_ALLOWED_STORAGE_HOSTS contains an invalid host pattern")
        if "*" in host and not host.startswith("*."):
            raise ValueError("Only a leading '*.' wildcard is supported for storage hosts")
    return hosts


@dataclass(frozen=True, slots=True)
class Settings:
    endpoint_secret: str
    allowed_storage_hosts: tuple[str, ...]
    environment: Literal["development", "test", "production"] = "production"
    allow_insecure_storage_http: bool = False
    engine: Literal["dsp", "resemble"] = "dsp"
    allow_dsp_fallback: bool = True
    max_wav_bytes: int = 4 * 1024 * 1024
    max_duration_seconds: float = 20.0
    max_request_bytes: int = 64 * 1024
    storage_timeout_seconds: float = 30.0
    temp_root: Path = Path("/tmp/signal-enhancer")  # noqa: S108 - dedicated 0700 runtime dir
    build_revision: str = "dev"
    pipeline_revision: str = "signal-enhancer-audio/1.0.0"
    dsp_revision: str = "restrained-dsp/1.0.0"
    resemble_source_revision: str = DEFAULT_RESEMBLE_SOURCE_REVISION
    resemble_model_revision: str = DEFAULT_RESEMBLE_MODEL_REVISION
    resemble_run_dir: Path = Path("/repository/enhancer_stage2")
    resemble_device: str = "cuda"

    @classmethod
    def from_env(cls) -> Settings:
        environment = os.getenv("SIGNAL_ENVIRONMENT", "production").strip().lower()
        if environment not in {"development", "test", "production"}:
            raise ValueError("SIGNAL_ENVIRONMENT must be development, test, or production")
        engine = os.getenv("SIGNAL_ENGINE", "dsp").strip().lower()
        if engine not in {"dsp", "resemble"}:
            raise ValueError("SIGNAL_ENGINE must be dsp or resemble")
        return cls(
            endpoint_secret=os.getenv("SIGNAL_ENDPOINT_SECRET", ""),
            allowed_storage_hosts=_read_hosts(os.getenv("SIGNAL_ALLOWED_STORAGE_HOSTS", "")),
            environment=environment,  # type: ignore[arg-type]
            allow_insecure_storage_http=_read_bool("SIGNAL_ALLOW_INSECURE_STORAGE_HTTP", False),
            engine=engine,  # type: ignore[arg-type]
            allow_dsp_fallback=_read_bool("SIGNAL_ALLOW_DSP_FALLBACK", True),
            max_wav_bytes=int(os.getenv("SIGNAL_MAX_WAV_BYTES", str(4 * 1024 * 1024))),
            max_duration_seconds=float(os.getenv("SIGNAL_MAX_DURATION_SECONDS", "20")),
            max_request_bytes=int(os.getenv("SIGNAL_MAX_REQUEST_BYTES", str(64 * 1024))),
            storage_timeout_seconds=float(os.getenv("SIGNAL_STORAGE_TIMEOUT_SECONDS", "30")),
            temp_root=Path(
                os.getenv("SIGNAL_TMP_ROOT", "/tmp/signal-enhancer")  # noqa: S108
            ),
            build_revision=os.getenv("SIGNAL_BUILD_REVISION", "dev"),
            pipeline_revision=os.getenv(
                "SIGNAL_PIPELINE_REVISION", "signal-enhancer-audio/1.0.0"
            ),
            dsp_revision=os.getenv("SIGNAL_DSP_REVISION", "restrained-dsp/1.0.0"),
            resemble_source_revision=os.getenv(
                "SIGNAL_RESEMBLE_SOURCE_REVISION",
                DEFAULT_RESEMBLE_SOURCE_REVISION,
            ),
            resemble_model_revision=os.getenv(
                "SIGNAL_RESEMBLE_MODEL_REVISION",
                DEFAULT_RESEMBLE_MODEL_REVISION,
            ),
            resemble_run_dir=Path(
                os.getenv("SIGNAL_RESEMBLE_RUN_DIR", "/repository/enhancer_stage2")
            ),
            resemble_device=os.getenv("SIGNAL_RESEMBLE_DEVICE", "cuda"),
        )

    def readiness_problems(self) -> tuple[str, ...]:
        problems: list[str] = []
        if not self.endpoint_secret:
            problems.append("missing_endpoint_secret")
        elif self.environment == "production" and len(self.endpoint_secret.encode()) < 32:
            problems.append("weak_endpoint_secret")
        if not self.allowed_storage_hosts:
            problems.append("missing_storage_allowlist")
        elif self.environment == "production" and any(
            host.startswith("*.") for host in self.allowed_storage_hosts
        ):
            problems.append("wildcard_storage_allowlist")
        if self.max_wav_bytes <= 0 or self.max_wav_bytes > 8 * 1024 * 1024:
            problems.append("invalid_audio_size_limit")
        if not 0 < self.max_duration_seconds <= 20:
            problems.append("invalid_audio_duration_limit")
        if self.environment == "production" and self.allow_insecure_storage_http:
            problems.append("insecure_storage_transport")
        resolved_temp_root = self.temp_root.resolve()
        broad_temp_roots = {
            Path("/"),
            Path("/tmp"),  # noqa: S108 - this exact broad path is intentionally rejected
            Path.home().resolve(),
        }
        if not self.temp_root.is_absolute() or resolved_temp_root in broad_temp_roots:
            problems.append("unsafe_temp_root")
        if not _REVISION_PATTERN.fullmatch(self.build_revision) or (
            self.environment == "production" and self.build_revision == "dev"
        ):
            problems.append("missing_build_revision")
        if not _REVISION_PATTERN.fullmatch(self.pipeline_revision):
            problems.append("invalid_pipeline_revision")
        if not _REVISION_PATTERN.fullmatch(self.dsp_revision):
            problems.append("invalid_dsp_revision")
        if self.environment == "production" and self.engine != "resemble":
            problems.append("production_requires_resemble")
        if (
            self.resemble_source_revision != DEFAULT_RESEMBLE_SOURCE_REVISION
            or self.resemble_model_revision != DEFAULT_RESEMBLE_MODEL_REVISION
        ):
            problems.append("unexpected_model_revision")
        return tuple(problems)
