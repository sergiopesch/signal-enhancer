from __future__ import annotations

import hashlib
from pathlib import Path
from types import SimpleNamespace

import pytest

from signal_enhancer_worker.adapters import ResembleEnhanceAdapter
from signal_enhancer_worker.adapters.resemble import _sha256_file
from signal_enhancer_worker.config import (
    DEFAULT_RESEMBLE_CHECKPOINT_SHA256,
    DEFAULT_RESEMBLE_SOURCE_REVISION,
)
from signal_enhancer_worker.errors import EngineError


def test_resemble_adapter_is_lazy_and_refuses_missing_pinned_artifacts(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    imported: list[str] = []

    def unexpected_import(name: str):
        imported.append(name)
        raise AssertionError("optional model packages must not import before artifact checks")

    monkeypatch.setattr("importlib.import_module", unexpected_import)
    adapter = ResembleEnhanceAdapter(
        run_dir=tmp_path,
        device="cuda",
        revision=DEFAULT_RESEMBLE_SOURCE_REVISION,
    )

    assert adapter.ready is False
    with pytest.raises(EngineError, match="pinned restoration artifacts"):
        adapter.prepare()
    assert imported == []


def test_resemble_adapter_refuses_tampered_checkpoint_before_import(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    checkpoint = tmp_path / "ds" / "G" / "default" / "mp_rank_00_model_states.pt"
    checkpoint.parent.mkdir(parents=True)
    checkpoint.write_bytes(b"tampered checkpoint")
    (tmp_path / "hparams.yaml").write_text("wav_rate: 44100\n")
    (tmp_path / "ds" / "G" / "latest").write_text("default\n")
    imported: list[str] = []

    def unexpected_import(name: str):
        imported.append(name)
        raise AssertionError("model packages must not import before checkpoint verification")

    monkeypatch.setattr("importlib.import_module", unexpected_import)
    adapter = ResembleEnhanceAdapter(
        run_dir=tmp_path,
        device="cuda",
        revision=DEFAULT_RESEMBLE_SOURCE_REVISION,
    )

    with pytest.raises(EngineError, match="checkpoint checksum"):
        adapter.prepare()
    assert imported == []
    assert adapter.ready is False


def test_resemble_adapter_accepts_verified_checkpoint_before_model_load(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    checkpoint = tmp_path / "ds" / "G" / "default" / "mp_rank_00_model_states.pt"
    checkpoint.parent.mkdir(parents=True)
    checkpoint.write_bytes(b"fixture checkpoint")
    (tmp_path / "hparams.yaml").write_text("wav_rate: 44100\n")
    (tmp_path / "ds" / "G" / "latest").write_text("default\n")
    loaded: list[tuple[Path, str]] = []
    torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True))
    inference = SimpleNamespace(
        load_enhancer=lambda run_dir, device: loaded.append((run_dir, device)),
        enhance=object(),
    )

    monkeypatch.setattr(
        "signal_enhancer_worker.adapters.resemble._sha256_file",
        lambda _: DEFAULT_RESEMBLE_CHECKPOINT_SHA256,
    )
    monkeypatch.setattr(
        "importlib.import_module",
        lambda name: torch if name == "torch" else inference,
    )
    adapter = ResembleEnhanceAdapter(
        run_dir=tmp_path,
        device="cuda",
        revision=DEFAULT_RESEMBLE_SOURCE_REVISION,
    )

    adapter.prepare()

    assert adapter.ready is True
    assert loaded == [(tmp_path, "cuda")]


def test_checkpoint_digest_is_sha256(tmp_path: Path) -> None:
    checkpoint = tmp_path / "checkpoint.pt"
    payload = b"known checkpoint payload"
    checkpoint.write_bytes(payload)

    assert _sha256_file(checkpoint) == hashlib.sha256(payload).hexdigest()
