"""Start the fixed worker process without a privilege-acquisition path."""

from __future__ import annotations

import ctypes
import errno
import os
from pathlib import Path

WORKER_COMMAND = (
    "/app/.venv/bin/uvicorn",
    "signal_enhancer_worker.app:app",
    "--host",
    "0.0.0.0",  # noqa: S104 - existing authenticated container service port
    "--port",
    "7860",
    "--no-access-log",
)
CAPABILITY_FIELDS = {"CapInh", "CapPrm", "CapEff", "CapAmb"}


def validate_privileges(
    uids: tuple[int, int, int], gids: tuple[int, int, int], status: str
) -> None:
    """Reject retained root identities, capabilities, and missing kernel evidence."""
    if uids != (10_001, 10_001, 10_001) or gids != (10_001, 10_001, 10_001):
        raise RuntimeError("the worker must use only UID/GID 10001")
    evidence: dict[str, str] = {}
    for line in status.splitlines():
        name, separator, value = line.partition(":")
        if separator and name in CAPABILITY_FIELDS | {"NoNewPrivs"}:
            if name in evidence:
                raise RuntimeError("duplicate process privilege evidence")
            evidence[name] = value.strip()
    if set(evidence) != CAPABILITY_FIELDS | {"NoNewPrivs"}:
        raise RuntimeError("missing process privilege evidence")
    if evidence["NoNewPrivs"] != "1":
        raise RuntimeError("the kernel must prevent acquiring new privileges")
    for name in CAPABILITY_FIELDS:
        value = evidence[name]
        if not value or any(character not in "0123456789abcdefABCDEF" for character in value):
            raise RuntimeError("invalid process capability evidence")
        if int(value, 16):
            raise RuntimeError("the worker must not retain process capabilities")


def prevent_new_privileges() -> None:
    """Linux PR_SET_NO_NEW_PRIVS persists across the fixed exec and its descendants."""
    library = ctypes.CDLL(None, use_errno=True)
    prctl = library.prctl
    prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    prctl.restype = ctypes.c_int
    if prctl(38, 1, 0, 0, 0) != 0:
        raise RuntimeError("the kernel could not prevent acquiring new privileges")


def close_inherited_descriptors() -> None:
    """Do not carry a parent's open file authority into the worker service."""
    with os.scandir("/proc/self/fd") as entries:
        descriptors = [
            int(entry.name) for entry in entries if entry.name.isdigit() and int(entry.name) > 2
        ]
    for descriptor in descriptors:
        try:
            os.close(descriptor)
        except OSError as error:
            # The directory iterator's descriptor has already closed. Any other
            # failure is fatal rather than accepting uncertain inherited state.
            if error.errno != errno.EBADF:
                raise


def main() -> None:
    prevent_new_privileges()
    validate_privileges(os.getresuid(), os.getresgid(), Path("/proc/self/status").read_text())
    close_inherited_descriptors()
    os.execv(WORKER_COMMAND[0], WORKER_COMMAND)  # noqa: S606 - fixed absolute process/arguments


if __name__ == "__main__":
    main()
