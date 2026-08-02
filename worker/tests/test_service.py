from __future__ import annotations

import threading
import time

import anyio
import pytest

from signal_enhancer_worker.service import _non_cancellable_thread


@pytest.mark.anyio
async def test_native_work_finishes_before_cancelled_scope_exits() -> None:
    started = threading.Event()
    finished = threading.Event()

    def native_work() -> None:
        started.set()
        time.sleep(0.12)
        finished.set()

    async def invoke() -> None:
        await _non_cancellable_thread(native_work)

    began = time.monotonic()
    async with anyio.create_task_group() as tasks:
        tasks.start_soon(invoke)
        await anyio.to_thread.run_sync(started.wait)
        tasks.cancel_scope.cancel()

    assert finished.is_set()
    assert time.monotonic() - began >= 0.1
