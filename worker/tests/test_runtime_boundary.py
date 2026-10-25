from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "scripts" / "run_worker.py"
SPEC = importlib.util.spec_from_file_location("signal_runtime_boundary", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
RUNTIME = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNTIME)
STATUS = "CapInh:\t0000000000000000\nCapPrm:\t0\nCapEff:\t0\nCapAmb:\t0\nNoNewPrivs:\t1\n"
IDENTITY = (10_001, 10_001, 10_001)


def test_accepts_only_unprivileged_kernel_evidence() -> None:
    RUNTIME.validate_privileges(IDENTITY, IDENTITY, STATUS)


@pytest.mark.parametrize("field", ["CapInh", "CapPrm", "CapEff", "CapAmb"])
def test_rejects_each_retained_capability_set(field: str) -> None:
    lines = [
        line if not line.startswith(field + ":") else field + ":\t200000"
        for line in STATUS.splitlines()
    ]
    with pytest.raises(RuntimeError):
        RUNTIME.validate_privileges(IDENTITY, IDENTITY, "\n".join(lines))


@pytest.mark.parametrize(
    "status",
    [
        STATUS.replace("NoNewPrivs:\t1", "NoNewPrivs:\t0"),
        STATUS.replace("CapEff:\t0\n", ""),
        STATUS + "CapEff:\t0\n",
        STATUS.replace("CapEff:\t0", "CapEff:\tbogus"),
    ],
)
def test_rejects_incomplete_or_invalid_kernel_evidence(status: str) -> None:
    with pytest.raises(RuntimeError):
        RUNTIME.validate_privileges(IDENTITY, IDENTITY, status)


@pytest.mark.parametrize(
    "identity", [(0, 10_001, 10_001), (10_001, 0, 10_001), (10_001, 10_001, 0)]
)
def test_rejects_any_retained_root_identity(identity: tuple[int, int, int]) -> None:
    with pytest.raises(RuntimeError):
        RUNTIME.validate_privileges(identity, IDENTITY, STATUS)
    with pytest.raises(RuntimeError):
        RUNTIME.validate_privileges(IDENTITY, identity, STATUS)
