"""The model package metadata must not silently change the upstream source."""

from __future__ import annotations

import importlib.util
import shutil
from pathlib import Path

import pytest

WORKER = Path(__file__).resolve().parent.parent
CORE = WORKER / "vendor" / "signal-resemble-core"
SPEC = importlib.util.spec_from_file_location(
    "verify_resemble_core", WORKER / "scripts" / "verify_resemble_core.py"
)
assert SPEC is not None and SPEC.loader is not None
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)


def test_complete_checked_in_core_matches_immutable_source() -> None:
    VERIFIER.verify_source(CORE)


@pytest.mark.parametrize(
    "change", ["code", "module", "native_module", "manifest", "gradio", "dependency"]
)
def test_changed_source_or_metadata_is_rejected(tmp_path: Path, change: str) -> None:
    core = tmp_path / "core"
    shutil.copytree(CORE, core)
    if change == "code":
        path = core / "resemble_enhance" / "inference.py"
        path.write_text(path.read_text() + "\n# altered\n")
    elif change == "module":
        (core / "resemble_enhance" / "unexpected.py").write_text("pass\n")
    elif change == "native_module":
        (core / "resemble_enhance" / "inference.so").write_bytes(b"not an approved module")
    elif change == "manifest":
        path = core / "UPSTREAM_PROVENANCE.json"
        path.write_text(path.read_text() + "\n")
    else:
        path = core / "pyproject.toml"
        text = path.read_text()
        text = text.replace(
            '"torch>=2.1.1",',
            '"torch>=2.1.1", "gradio>=4.8.0",' if change == "gradio" else "",
        )
        path.write_text(text)
    with pytest.raises(VERIFIER.ProvenanceError):
        VERIFIER.verify_source(core)


def test_symlinked_source_is_rejected(tmp_path: Path) -> None:
    core = tmp_path / "core"
    shutil.copytree(CORE, core)
    path = core / "resemble_enhance" / "inference.py"
    path.unlink()
    path.symlink_to(CORE / "resemble_enhance" / "inference.py")
    with pytest.raises(VERIFIER.ProvenanceError, match="symlink"):
        VERIFIER.verify_source(core)
