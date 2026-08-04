from __future__ import annotations

import hashlib
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from signal_enhancer_worker.adapters import ResembleEnhanceAdapter
from signal_enhancer_worker.adapters.resemble import _sha256_file
from signal_enhancer_worker.config import (
    DEFAULT_RESEMBLE_ARTIFACT_MANIFEST,
    DEFAULT_RESEMBLE_CHECKPOINT_SHA256,
    DEFAULT_RESEMBLE_INFERENCE_LAMBD,
    DEFAULT_RESEMBLE_INFERENCE_NFE,
    DEFAULT_RESEMBLE_INFERENCE_SOLVER,
    DEFAULT_RESEMBLE_INFERENCE_TAU,
    DEFAULT_RESEMBLE_SOURCE_REVISION,
)
from signal_enhancer_worker.errors import EngineError


def write_manifest_fixture(run_dir: Path) -> None:
    for relative_path, _ in DEFAULT_RESEMBLE_ARTIFACT_MANIFEST:
        path = run_dir / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(f"fixture:{relative_path}".encode())


def manifest_digest(path: Path, run_dir: Path) -> str:
    expected = dict(DEFAULT_RESEMBLE_ARTIFACT_MANIFEST)
    return expected[path.relative_to(run_dir).as_posix()]


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


@pytest.mark.parametrize(
    "tampered_relative_path",
    [relative_path for relative_path, _ in DEFAULT_RESEMBLE_ARTIFACT_MANIFEST],
)
def test_resemble_adapter_refuses_any_tampered_artifact_before_import(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    tampered_relative_path: str,
) -> None:
    write_manifest_fixture(tmp_path)
    imported: list[str] = []

    def unexpected_import(name: str):
        imported.append(name)
        raise AssertionError("model packages must not import before manifest verification")

    def digest(path: Path) -> str:
        if path.relative_to(tmp_path).as_posix() == tampered_relative_path:
            return "0" * 64
        return manifest_digest(path, tmp_path)

    monkeypatch.setattr("signal_enhancer_worker.adapters.resemble._sha256_file", digest)
    monkeypatch.setattr("importlib.import_module", unexpected_import)
    adapter = ResembleEnhanceAdapter(
        run_dir=tmp_path,
        device="cuda",
        revision=DEFAULT_RESEMBLE_SOURCE_REVISION,
    )

    with pytest.raises(EngineError, match="artifact manifest"):
        adapter.prepare()
    assert imported == []
    assert adapter.ready is False


def test_resemble_adapter_accepts_verified_checkpoint_before_model_load(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    write_manifest_fixture(tmp_path)
    loaded: list[tuple[Path, str]] = []
    torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True))
    inference = SimpleNamespace(
        load_enhancer=lambda run_dir, device: loaded.append((run_dir, device)),
        enhance=object(),
    )

    monkeypatch.setattr(
        "signal_enhancer_worker.adapters.resemble._sha256_file",
        lambda path: manifest_digest(path, tmp_path),
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


def test_resemble_adapter_uses_the_versioned_inference_profile(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    write_manifest_fixture(tmp_path)
    invocation: dict[str, object] = {}

    class FakeResult:
        def detach(self) -> FakeResult:
            return self

        def cpu(self) -> FakeResult:
            return self

        def numpy(self) -> np.ndarray:
            return np.asarray([0.1, -0.1], dtype=np.float32)

    def enhance(
        waveform: object,
        sample_rate: int,
        device: str,
        **parameters: object,
    ) -> tuple[FakeResult, int]:
        invocation.update(
            waveform=waveform,
            sample_rate=sample_rate,
            device=device,
            **parameters,
        )
        return FakeResult(), 44_100

    torch = SimpleNamespace(
        cuda=SimpleNamespace(is_available=lambda: True),
        from_numpy=lambda values: values,
    )
    inference = SimpleNamespace(load_enhancer=lambda *_: None, enhance=enhance)
    monkeypatch.setattr(
        "signal_enhancer_worker.adapters.resemble._sha256_file",
        lambda path: manifest_digest(path, tmp_path),
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

    output, output_rate = adapter.enhance(np.zeros(16, dtype=np.float32), 48_000)

    assert output.tolist() == pytest.approx([0.1, -0.1])
    assert output_rate == 44_100
    waveform = invocation.pop("waveform")
    assert isinstance(waveform, np.ndarray)
    assert waveform.tolist() == pytest.approx(np.zeros(16, dtype=np.float32))
    assert invocation == {
        "sample_rate": 48_000,
        "device": "cuda",
        "nfe": DEFAULT_RESEMBLE_INFERENCE_NFE,
        "solver": DEFAULT_RESEMBLE_INFERENCE_SOLVER,
        "lambd": DEFAULT_RESEMBLE_INFERENCE_LAMBD,
        "tau": DEFAULT_RESEMBLE_INFERENCE_TAU,
        "run_dir": tmp_path,
    }


def test_manifest_contains_the_reviewed_hugging_face_artifact_hashes() -> None:
    assert dict(DEFAULT_RESEMBLE_ARTIFACT_MANIFEST) == {
        "ds/G/default/mp_rank_00_model_states.pt": DEFAULT_RESEMBLE_CHECKPOINT_SHA256,
        "ds/G/latest": "37a8eec1ce19687d132fe29051dca629d164e2c4958ba141d5f4133a33f0688f",
        "hparams.yaml": "80c3f15bc5a5b2cacf2c698699a0f6599d62911c0d53e1d6dee895c0d7cbaeac",
    }


def test_checkpoint_digest_is_sha256(tmp_path: Path) -> None:
    checkpoint = tmp_path / "checkpoint.pt"
    payload = b"known checkpoint payload"
    checkpoint.write_bytes(payload)

    assert _sha256_file(checkpoint) == hashlib.sha256(payload).hexdigest()
