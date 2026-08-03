from __future__ import annotations

import hashlib
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from signal_enhancer_worker.app import create_app
from signal_enhancer_worker.config import Settings
from signal_enhancer_worker.wav import encode_pcm16_wav

JOB_ID = "018f0c2d-7b54-7cc1-8c55-3f5ca7f35a11"
ATTEMPT_ID = "018f0c2d-7b54-7cc1-8c55-3f5ca7f35a12"
SECRET = "test-secret-with-enough-entropy"  # noqa: S105 - inert test fixture


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def tone_wav(frequency: float, *, seconds: float = 0.3, sample_rate: int = 16_000) -> bytes:
    time = np.arange(round(seconds * sample_rate), dtype=np.float32) / sample_rate
    samples = (0.18 * np.sin(2.0 * np.pi * frequency * time)).astype(np.float32)
    return encode_pcm16_wav(samples, sample_rate)


@pytest.fixture
def wav_a() -> bytes:
    return tone_wav(440.0)


@pytest.fixture
def wav_b() -> bytes:
    return tone_wav(880.0)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        endpoint_secret=SECRET,
        allowed_storage_hosts=("storage.example",),
        environment="test",
        build_revision="test-build-0123456789",
        temp_root=tmp_path / "worker-tmp",
    )


@pytest.fixture
def uploaded() -> dict[str, bytes]:
    return {}


@pytest.fixture
def request_body(wav_a: bytes, wav_b: bytes) -> dict[str, Any]:
    expiry = (datetime.now(UTC) + timedelta(minutes=5)).isoformat()

    def source(name: str, payload: bytes) -> dict[str, Any]:
        return {
            "object_path": f"captures/{name}.wav",
            "url": (
                f"https://storage.example/captures/{name}.wav"
                f"?vercel-blob-delegation=do-not-reflect-{name}"
                f"&vercel-blob-signature=signed-{name}"
            ),
            "expires_at": expiry,
            "byte_size": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "content_type": "audio/wav",
        }

    result_root = f"results/{JOB_ID}/{ATTEMPT_ID}"

    def output_url(
        pathname: str,
        signature: str,
        content_type: str,
        max_bytes: int,
    ) -> str:
        query = urlencode(
            {
                "pathname": pathname,
                "vercel-blob-allow-overwrite": "false",
                "vercel-blob-add-random-suffix": "false",
                "vercel-blob-allowed-content-types": content_type,
                "vercel-blob-maximum-size-in-bytes": str(max_bytes),
                "vercel-blob-delegation": f"delegation-{signature}",
                "vercel-blob-signature": signature,
            }
        )
        return f"https://storage.example/?{query}"

    return {
        "schema_version": "1",
        "job_id": JOB_ID,
        "attempt_id": ATTEMPT_ID,
        "reference": {"id": "guided-reading-v1", "revision": "1.0.0"},
        "inputs": {"a": source("input-a", wav_a), "b": source("input-b", wav_b)},
        "source": "A",
        "outputs": {
            "enhanced_wav": {
                "object_path": f"{result_root}/enhanced.wav",
                "url": output_url(
                    f"{result_root}/enhanced.wav",
                    "output-one",
                    "audio/wav",
                    4 * 1024 * 1024,
                ),
                "expires_at": expiry,
                "max_bytes": 4 * 1024 * 1024,
                "content_type": "audio/wav",
            },
            "difference_json": {
                "object_path": f"{result_root}/difference.json",
                "url": output_url(
                    f"{result_root}/difference.json",
                    "output-two",
                    "application/json",
                    512 * 1024,
                ),
                "expires_at": expiry,
                "max_bytes": 512 * 1024,
                "content_type": "application/json",
            },
            "report_json": {
                "object_path": f"{result_root}/report.json",
                "url": output_url(
                    f"{result_root}/report.json",
                    "output-three",
                    "application/json",
                    64 * 1024,
                ),
                "expires_at": expiry,
                "max_bytes": 64 * 1024,
                "content_type": "application/json",
            },
        },
    }


@pytest.fixture
def transport(
    wav_a: bytes,
    wav_b: bytes,
    uploaded: dict[str, bytes],
) -> httpx.MockTransport:
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            if request.url.path == "/captures/input-a.wav":
                payload = wav_a
            elif request.url.path == "/captures/input-b.wav":
                payload = wav_b
            else:
                return httpx.Response(404)
            return httpx.Response(
                200,
                content=payload,
                headers={"Content-Length": str(len(payload)), "Content-Type": "audio/wav"},
            )
        if request.method == "PUT":
            uploaded[f"/{request.url.params['pathname']}"] = await request.aread()
            return httpx.Response(201)
        return httpx.Response(405)

    return httpx.MockTransport(handler)


@pytest.fixture
def client_factory(
    settings: Settings,
    transport: httpx.MockTransport,
) -> Callable[[], TestClient]:
    def factory() -> TestClient:
        return TestClient(create_app(settings, storage_transport=transport))

    return factory


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"X-Signal-Endpoint-Secret": SECRET, "Content-Type": "application/json"}
