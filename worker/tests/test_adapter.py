from __future__ import annotations

from pathlib import Path

import pytest

from signal_enhancer_worker.adapters import ResembleEnhanceAdapter
from signal_enhancer_worker.config import DEFAULT_RESEMBLE_SOURCE_REVISION
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
