from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
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


def test_accepts_only_normal_loader_environment_and_process_maps() -> None:
    RUNTIME.validate_startup_context(
        {"PATH": "/app/.venv/bin:/usr/bin"}, "0000 /usr/local/bin/python\n"
    )
    for name in ("LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT", "LD_DEBUG"):
        with pytest.raises(RuntimeError):
            RUNTIME.validate_startup_context({name: ""}, "")
    for mapped in (
        "/usr/lib/x86_64-linux-gnu/libapt-pkg.so.7.0.0",
        "/usr/bin/dpkg-deb",
        "/usr/lib/x86_64-linux-gnu/libapt-pkg.so.7.0.0 (deleted)",
    ):
        with pytest.raises(RuntimeError):
            RUNTIME.validate_startup_context({}, "0000 " + mapped + "\n")


def test_closes_real_inherited_descriptors_and_preserves_standard_streams() -> None:
    code = """
import errno, os, runpy, sys
runtime = runpy.run_path(sys.argv[1])
descriptor = int(sys.argv[2])
assert os.read(descriptor, 1) == b'x'
runtime['close_inherited_descriptors']()
for stream in range(3):
    os.fstat(stream)
try:
    os.fstat(descriptor)
except OSError as error:
    assert error.errno == errno.EBADF
else:
    raise AssertionError('inherited authority remained open')
"""
    with tempfile.TemporaryFile() as inherited:
        inherited.write(b"x")
        inherited.flush()
        inherited.seek(0)
        subprocess.run(  # noqa: S603 - controlled Python fixture and task-owned descriptor
            [sys.executable, "-c", code, str(SCRIPT), str(inherited.fileno())],
            pass_fds=(inherited.fileno(),),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            check=True,
        )


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
