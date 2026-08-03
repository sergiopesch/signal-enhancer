"""Lazy adapter for the pinned Resemble Enhance source revision."""

from __future__ import annotations

import hashlib
import hmac
import importlib
from pathlib import Path
from typing import Any

import numpy as np

from signal_enhancer_worker.config import (
    DEFAULT_RESEMBLE_CHECKPOINT_SHA256,
    DEFAULT_RESEMBLE_SOURCE_REVISION,
)
from signal_enhancer_worker.errors import EngineError
from signal_enhancer_worker.wav import FloatSamples


class ResembleEnhanceAdapter:
    """Load Resemble and its model only when the configured runtime needs it."""

    name = "resemble-enhance"
    source_revision = DEFAULT_RESEMBLE_SOURCE_REVISION

    def __init__(self, *, run_dir: Path, device: str, revision: str) -> None:
        self._run_dir = run_dir
        self._device = device
        self.source_revision = revision
        self._torch: Any | None = None
        self._enhance: Any | None = None
        self._ready = False

    @property
    def ready(self) -> bool:
        return self._ready

    def prepare(self) -> None:
        if self._ready:
            return
        if self.source_revision != DEFAULT_RESEMBLE_SOURCE_REVISION:
            raise EngineError("The configured restoration model revision is not approved.")
        checkpoint_path = (
            self._run_dir / "ds" / "G" / "default" / "mp_rank_00_model_states.pt"
        )
        required_files = (
            self._run_dir / "hparams.yaml",
            self._run_dir / "ds" / "G" / "latest",
            checkpoint_path,
        )
        if not all(path.is_file() for path in required_files):
            # Never let the upstream helper fall back to downloading a floating model revision.
            raise EngineError("The pinned restoration artifacts are not mounted.")
        if not hmac.compare_digest(
            _sha256_file(checkpoint_path),
            DEFAULT_RESEMBLE_CHECKPOINT_SHA256,
        ):
            raise EngineError("The pinned restoration checkpoint checksum is invalid.")
        try:
            torch = importlib.import_module("torch")
            inference = importlib.import_module("resemble_enhance.enhancer.inference")
            if self._device.startswith("cuda") and not torch.cuda.is_available():
                raise EngineError("The configured restoration accelerator is unavailable.")
            # Loading once here makes /health reflect actual model readiness.
            inference.load_enhancer(self._run_dir, self._device)
        except EngineError:
            raise
        except Exception as exc:
            raise EngineError() from exc
        self._torch = torch
        self._enhance = inference.enhance
        self._ready = True

    def enhance(self, samples: FloatSamples, sample_rate: int) -> tuple[FloatSamples, int]:
        if not self._ready or self._torch is None or self._enhance is None:
            raise EngineError()
        try:
            waveform = self._torch.from_numpy(samples.astype(np.float32, copy=True))
            result, output_rate = self._enhance(
                waveform,
                sample_rate,
                self._device,
                nfe=32,
                solver="midpoint",
                lambd=0.35,
                tau=0.45,
                run_dir=self._run_dir,
            )
            output = result.detach().cpu().numpy().astype(np.float32, copy=False)
        except Exception as exc:
            raise EngineError() from exc
        if output.ndim != 1 or output.size == 0 or not np.all(np.isfinite(output)):
            raise EngineError("The deeper restoration pass produced invalid audio.")
        return output, int(output_rate)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as checkpoint:
        while chunk := checkpoint.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()
