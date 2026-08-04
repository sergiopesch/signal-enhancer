from __future__ import annotations

import threading
import time

import anyio
import pytest

from signal_enhancer_worker.config import (
    DEFAULT_RESEMBLE_CHECKPOINT_SHA256,
    DEFAULT_RESEMBLE_INFERENCE_PROFILE,
    DEFAULT_RESEMBLE_MODEL_REPOSITORY,
    DEFAULT_RESEMBLE_MODEL_REVISION,
    DEFAULT_RESEMBLE_SOURCE_REPOSITORY,
    DEFAULT_RESEMBLE_SOURCE_REVISION,
    Settings,
)
from signal_enhancer_worker.service import WorkerRuntime, _non_cancellable_thread


def test_resemble_versions_are_complete_and_immutable() -> None:
    runtime = WorkerRuntime(
        Settings(
            endpoint_secret="test-secret",  # noqa: S106
            allowed_storage_hosts=("storage.example",),
            environment="test",
            engine="resemble",
            build_revision="test-build-0123456789",
        )
    )

    assert runtime.versions().model_dump(mode="json") == {
        "api_schema": "1",
        "build_revision": "test-build-0123456789",
        "pipeline_revision": "signal-enhancer-audio/1.0.0",
        "dsp_revision": "restrained-dsp/1.0.0",
        "model_name": "resemble-enhance",
        "model_repository": DEFAULT_RESEMBLE_MODEL_REPOSITORY,
        "model_revision": DEFAULT_RESEMBLE_MODEL_REVISION,
        "model_checkpoint_sha256": DEFAULT_RESEMBLE_CHECKPOINT_SHA256,
        "source_repository": DEFAULT_RESEMBLE_SOURCE_REPOSITORY,
        "source_revision": DEFAULT_RESEMBLE_SOURCE_REVISION,
        "inference_profile": DEFAULT_RESEMBLE_INFERENCE_PROFILE,
    }


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
