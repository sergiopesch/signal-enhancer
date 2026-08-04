from __future__ import annotations

import copy
import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from signal_enhancer_worker.analysis import analyze_signal as analyze_signal_impl
from signal_enhancer_worker.app import create_app
from signal_enhancer_worker.config import Settings
from signal_enhancer_worker.contracts import ReferenceVersion
from signal_enhancer_worker.wav import decode_and_validate_wav


def test_reference_protocol_rollout_accepts_only_exact_version_pairs() -> None:
    assert ReferenceVersion(id="diagnostic-speech", revision="v1").id == "diagnostic-speech"
    assert ReferenceVersion(id="guided-reading-v1", revision="1.0.0").revision == "1.0.0"

    with pytest.raises(ValidationError):
        ReferenceVersion(id="diagnostic-speech", revision="1.0.0")
    with pytest.raises(ValidationError):
        ReferenceVersion(id="guided-reading-v1", revision="v1")


def test_health_and_authenticated_version(
    client_factory: Any,
    auth_headers: dict[str, str],
) -> None:
    with client_factory() as client:
        assert client.get("/health").json() == {"status": "ready"}
        assert client.get("/version").status_code == 401
        response = client.get("/version", headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == {
        "api_schema": "1",
        "build_revision": "test-build-0123456789",
        "pipeline_revision": "signal-enhancer-audio/1.0.0",
        "dsp_revision": "restrained-dsp/1.0.0",
        "model_name": "none",
        "model_repository": None,
        "model_revision": None,
        "model_checkpoint_sha256": None,
        "source_repository": None,
        "source_revision": None,
        "inference_profile": "dsp-only",
    }


def test_unready_health_fails_closed(tmp_path: Path) -> None:
    from signal_enhancer_worker.app import create_app
    from signal_enhancer_worker.config import Settings

    app = create_app(
        Settings(
            endpoint_secret="",
            allowed_storage_hosts=(),
            environment="production",
            temp_root=tmp_path,
        )
    )
    with TestClient(app) as client:
        assert client.get("/health").status_code == 503
        assert client.get("/health").json() == {"status": "starting"}


def test_analyze_is_deterministic_and_never_returns_urls(
    client_factory: Any,
    auth_headers: dict[str, str],
    request_body: dict[str, Any],
) -> None:
    body = copy.deepcopy(request_body)
    body.pop("source")
    body.pop("outputs")
    with client_factory() as client:
        first = client.post("/v1/analyze", headers=auth_headers, json=body)
        second = client.post("/v1/analyze", headers=auth_headers, json=body)

    assert first.status_code == 200, first.text
    assert first.json() == second.json()
    result = first.json()
    assert result["inputs"]["a"]["audio"]["channels"] == 1
    assert result["inputs"]["a"]["metrics"]["spectral_rolloff_hz"] > 0
    assert "delta_b_minus_a" in result
    assert "signature=" not in first.text
    assert "url" not in first.text.lower()


def test_analyze_calls_input_b_with_only_its_samples_and_sample_rate(
    monkeypatch: pytest.MonkeyPatch,
    client_factory: Any,
    auth_headers: dict[str, str],
    request_body: dict[str, Any],
) -> None:
    calls: list[tuple[int, int]] = []

    def record_analysis(samples: Any, sample_rate: int):
        calls.append((len(samples), sample_rate))
        return analyze_signal_impl(samples, sample_rate)

    monkeypatch.setattr("signal_enhancer_worker.service.analyze_signal", record_analysis)
    body = copy.deepcopy(request_body)
    body.pop("source")
    body.pop("outputs")

    with client_factory() as client:
        response = client.post("/v1/analyze", headers=auth_headers, json=body)

    assert response.status_code == 200, response.text
    assert len(calls) == 2
    assert all(sample_count > 0 and sample_rate == 16_000 for sample_count, sample_rate in calls)


def test_enhance_uploads_aligned_hashed_artifacts_and_cleans_temp_files(
    client_factory: Any,
    auth_headers: dict[str, str],
    request_body: dict[str, Any],
    uploaded: dict[str, bytes],
    settings: Any,
) -> None:
    with client_factory() as client:
        response = client.post("/v1/enhance", headers=auth_headers, json=request_body)

    assert response.status_code == 200, response.text
    result = response.json()
    assert result["routing"] == {
        "requested_engine": "dsp",
        "used_engine": "dsp",
        "outcome": "dsp_fallback",
        "fallback_code": None,
    }
    assert result["before"]["audio"]["sample_rate_hz"] == result["after"]["audio"]["sample_rate_hz"]
    assert result["before"]["audio"]["frame_count"] == result["after"]["audio"]["frame_count"]
    assert set(uploaded) == {
        f"/results/{request_body['job_id']}/{request_body['attempt_id']}/enhanced.wav",
        f"/results/{request_body['job_id']}/{request_body['attempt_id']}/difference.json",
        f"/results/{request_body['job_id']}/{request_body['attempt_id']}/report.json",
    }

    for kind, receipt in result["artifacts"].items():
        path = "/" + receipt["object_path"]
        assert receipt["byte_size"] == len(uploaded[path]), kind
        assert receipt["sha256"] == hashlib.sha256(uploaded[path]).hexdigest(), kind
    report_path = f"/results/{request_body['job_id']}/{request_body['attempt_id']}/report.json"
    report = json.loads(uploaded[report_path])
    assert "inferred" in " ".join(report["limitations"]).lower()
    assert "better" not in json.dumps(report).lower()
    assert "worse" not in json.dumps(report).lower()

    enhanced_path = f"/results/{request_body['job_id']}/{request_body['attempt_id']}/enhanced.wav"
    enhanced = uploaded[enhanced_path]
    decoded = decode_and_validate_wav(
        enhanced,
        expected_sha256=hashlib.sha256(enhanced).hexdigest(),
        expected_bytes=len(enhanced),
        max_bytes=4 * 1024 * 1024,
        max_duration_seconds=20,
    )
    assert decoded.metadata.codec == "pcm_s16le"
    assert list(settings.temp_root.iterdir()) == []
    assert "signature=" not in response.text


def test_enhance_ndjson_reports_real_stages_then_result(
    client_factory: Any,
    auth_headers: dict[str, str],
    request_body: dict[str, Any],
) -> None:
    headers = {**auth_headers, "Accept": "application/x-ndjson"}
    with client_factory() as client:
        response = client.post("/v1/enhance", headers=headers, json=request_body)

    assert response.status_code == 200
    events = [json.loads(line) for line in response.text.splitlines()]
    assert [event["sequence"] for event in events] == list(range(1, 9))
    assert [event["stage"] for event in events[:-1]] == [
        "receiving_capture",
        "inspecting_signal",
        "detecting_noise_and_compression",
        "restoring_detail",
        "polishing_dynamics",
        "generating_difference_map",
        "preparing_report",
    ]
    assert events[-1]["type"] == "result"


def test_auth_schema_and_content_guards_do_not_reflect_secrets(
    client_factory: Any,
    auth_headers: dict[str, str],
    request_body: dict[str, Any],
) -> None:
    body = copy.deepcopy(request_body)
    body["inputs"]["a"]["unexpected"] = "very-secret-value"
    with client_factory() as client:
        assert client.post("/v1/analyze", json=body).status_code == 401
        wrong = client.post(
            "/v1/analyze",
            headers={
                "X-Signal-Endpoint-Secret": "wrong",
                "Content-Type": "application/json",
            },
            json=body,
        )
        invalid = client.post("/v1/enhance", headers=auth_headers, json=body)
        wrong_type = client.post(
            "/v1/enhance",
            headers={**auth_headers, "Content-Type": "text/plain"},
            content="{}",
        )
        oversized = client.post(
            "/v1/enhance",
            headers=auth_headers,
            content=b"{" + b" " * (65 * 1024) + b"}",
        )

    assert wrong.status_code == 401
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "invalid_request"
    assert "very-secret-value" not in invalid.text
    assert "do-not-reflect" not in invalid.text
    assert wrong_type.status_code == 415
    assert oversized.status_code == 413


def test_invalid_storage_host_is_rejected_before_download(
    client_factory: Any,
    auth_headers: dict[str, str],
    request_body: dict[str, Any],
) -> None:
    body = copy.deepcopy(request_body)
    body["inputs"]["a"]["url"] = "https://storage.example.attacker.test/captures/input-a.wav"
    with client_factory() as client:
        response = client.post("/v1/enhance", headers=auth_headers, json=body)

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_storage_url"
    assert "attacker" not in response.text


def test_invalid_audio_cleans_temp_directory_and_never_uploads(
    settings: Settings,
    auth_headers: dict[str, str],
    request_body: dict[str, Any],
    wav_b: bytes,
) -> None:
    invalid = b"this is not a wave file" * 2
    body = copy.deepcopy(request_body)
    body["inputs"]["a"]["byte_size"] = len(invalid)
    body["inputs"]["a"]["sha256"] = hashlib.sha256(invalid).hexdigest()
    upload_attempts = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal upload_attempts
        if request.method == "PUT":
            upload_attempts += 1
            return httpx.Response(201)
        payload = invalid if request.url.path.endswith("input-a.wav") else wav_b
        return httpx.Response(
            200,
            content=payload,
            headers={"Content-Length": str(len(payload))},
        )

    app = create_app(settings, storage_transport=httpx.MockTransport(handler))
    with TestClient(app) as client:
        response = client.post("/v1/enhance", headers=auth_headers, json=body)

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_audio"
    assert upload_attempts == 0
    assert list(settings.temp_root.iterdir()) == []


def test_redirected_storage_download_is_not_followed(
    settings: Settings,
    auth_headers: dict[str, str],
    request_body: dict[str, Any],
) -> None:
    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"Location": "http://127.0.0.1/latest/meta-data"})

    app = create_app(settings, storage_transport=httpx.MockTransport(handler))
    with TestClient(app) as client:
        response = client.post("/v1/enhance", headers=auth_headers, json=request_body)

    assert response.status_code == 502
    assert response.json()["code"] == "storage_unavailable"
    assert "127.0.0.1" not in response.text


def test_numeric_url_expiry_is_rejected_by_strict_schema(
    client_factory: Any,
    auth_headers: dict[str, str],
    request_body: dict[str, Any],
) -> None:
    body = copy.deepcopy(request_body)
    body["inputs"]["a"]["expires_at"] = int((datetime.now(UTC) + timedelta(minutes=5)).timestamp())
    with client_factory() as client:
        response = client.post("/v1/enhance", headers=auth_headers, json=body)
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_request"
