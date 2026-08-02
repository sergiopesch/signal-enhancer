"""Worker runtime and end-to-end analysis/enhancement orchestration."""

from __future__ import annotations

import asyncio
import hashlib
import os
import tempfile
import time
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any, Literal

import anyio
import httpx

from signal_enhancer_worker.adapters import ResembleEnhanceAdapter
from signal_enhancer_worker.analysis import analyze_signal, compare_metrics
from signal_enhancer_worker.artifacts import (
    build_difference,
    build_report,
    canonical_json_bytes,
)
from signal_enhancer_worker.config import Settings
from signal_enhancer_worker.contracts import (
    AnalyzeRequest,
    AnalyzeResponse,
    ArtifactReceipt,
    CaptureAnalysis,
    EnhanceRequest,
    EnhanceResponse,
    ProductStage,
    ResultEvent,
    RoutingDecision,
    SignedGetObject,
    SignedPutObject,
    StageEvent,
    VersionInfo,
)
from signal_enhancer_worker.dsp import align_length, resample_linear, restrained_dsp
from signal_enhancer_worker.errors import (
    BusyError,
    ConfigurationError,
    EngineError,
    StorageError,
    WorkerError,
)
from signal_enhancer_worker.observability import log_job_event
from signal_enhancer_worker.security import validate_signed_url
from signal_enhancer_worker.storage import StorageClient
from signal_enhancer_worker.wav import DecodedWav, decode_and_validate_wav, encode_pcm16_wav

PipelineEvent = StageEvent | ResultEvent


class WorkerRuntime:
    def __init__(
        self,
        settings: Settings,
        *,
        storage_transport: httpx.AsyncBaseTransport | None = None,
        resemble_adapter: ResembleEnhanceAdapter | None = None,
    ) -> None:
        self.settings = settings
        self._storage_transport = storage_transport
        self._resemble = resemble_adapter or ResembleEnhanceAdapter(
            run_dir=settings.resemble_run_dir,
            device=settings.resemble_device,
            revision=settings.resemble_source_revision,
        )
        self._ready = False
        self._startup_problem = "starting"
        self._enhance_lock = asyncio.Lock()

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def startup_problem(self) -> str:
        return self._startup_problem

    def versions(self) -> VersionInfo:
        model_enabled = self.settings.engine == "resemble"
        return VersionInfo(
            api_schema="1",
            build_revision=self.settings.build_revision,
            pipeline_revision=self.settings.pipeline_revision,
            dsp_revision=self.settings.dsp_revision,
            model_name="resemble-enhance" if model_enabled else "none",
            model_revision=self.settings.resemble_model_revision if model_enabled else None,
        )

    async def initialize(self) -> None:
        problems = self.settings.readiness_problems()
        if problems:
            self._startup_problem = problems[0]
            self._ready = False
            return
        try:
            self.settings.temp_root.mkdir(mode=0o700, parents=True, exist_ok=True)
            if self.settings.temp_root.is_symlink():
                raise OSError("temporary root cannot be a symlink")
            os.chmod(self.settings.temp_root, 0o700)
            # Run a tiny DSP probe so readiness represents initialized components.
            await asyncio.to_thread(_dsp_readiness_probe)
            if self.settings.engine == "resemble":
                await asyncio.to_thread(self._resemble.prepare)
        except (OSError, EngineError):
            self._startup_problem = "component_initialization_failed"
            self._ready = False
            return
        self._startup_problem = ""
        self._ready = True

    def require_ready(self) -> None:
        if not self._ready:
            raise ConfigurationError()

    async def analyze(self, request: AnalyzeRequest) -> AnalyzeResponse:
        started = time.perf_counter()
        self.require_ready()
        self._validate_descriptors(request)
        with tempfile.TemporaryDirectory(prefix="job-", dir=self.settings.temp_root) as directory:
            root = Path(directory)
            a_path = root / "input-a.wav"
            b_path = root / "input-b.wav"
            async with self._storage() as storage:
                await storage.download(request.inputs.a, a_path)
                await storage.download(request.inputs.b, b_path)
            a = await self._decode(
                a_path,
                request.inputs.a.sha256,
                request.inputs.a.byte_size,
            )
            b = await self._decode(
                b_path,
                request.inputs.b.sha256,
                request.inputs.b.byte_size,
            )
            a_metrics = await asyncio.to_thread(
                analyze_signal,
                a.samples,
                a.metadata.sample_rate_hz,
            )
            b_metrics = await asyncio.to_thread(
                analyze_signal,
                b.samples,
                b.metadata.sample_rate_hz,
            )
            delta, observations = compare_metrics(a_metrics, b_metrics)
            response = AnalyzeResponse(
                schema_version="1",
                job_id=request.job_id,
                attempt_id=request.attempt_id,
                inputs={
                    "a": CaptureAnalysis(audio=a.metadata, metrics=a_metrics),
                    "b": CaptureAnalysis(audio=b.metadata, metrics=b_metrics),
                },
                delta_b_minus_a=delta,
                observations=observations,
                versions=self.versions(),
            )
            log_job_event(
                "analyze_complete",
                job_id=request.job_id,
                attempt_id=request.attempt_id,
                elapsed_ms=(time.perf_counter() - started) * 1000,
                audio_seconds=a.metadata.duration_seconds + b.metadata.duration_seconds,
            )
            return response

    async def enhance_events(self, request: EnhanceRequest) -> AsyncIterator[PipelineEvent]:
        started = time.perf_counter()
        self.require_ready()
        if self._enhance_lock.locked():
            raise BusyError()
        await self._enhance_lock.acquire()
        try:
            async for event in self._run_enhancement(request):
                yield event
        except asyncio.CancelledError:
            log_job_event(
                "enhance_cancelled",
                job_id=request.job_id,
                attempt_id=request.attempt_id,
                elapsed_ms=(time.perf_counter() - started) * 1000,
            )
            raise
        except WorkerError as error:
            log_job_event(
                "enhance_failed",
                job_id=request.job_id,
                attempt_id=request.attempt_id,
                elapsed_ms=(time.perf_counter() - started) * 1000,
                code=error.code,
            )
            raise
        except Exception:
            log_job_event(
                "enhance_failed",
                job_id=request.job_id,
                attempt_id=request.attempt_id,
                elapsed_ms=(time.perf_counter() - started) * 1000,
                code="internal_error",
            )
            raise
        finally:
            self._enhance_lock.release()

    async def enhance(self, request: EnhanceRequest) -> EnhanceResponse:
        result: EnhanceResponse | None = None
        async for event in self.enhance_events(request):
            if isinstance(event, ResultEvent):
                result = event.result
        if result is None:
            raise StorageError("result generation")
        return result

    async def _run_enhancement(self, request: EnhanceRequest) -> AsyncIterator[PipelineEvent]:
        request_started = time.perf_counter()
        timings: dict[str, float] = {}
        self._validate_descriptors(request)
        versions = self.versions()
        with tempfile.TemporaryDirectory(prefix="job-", dir=self.settings.temp_root) as directory:
            root = Path(directory)
            a_path = root / "input-a.wav"
            b_path = root / "input-b.wav"
            yield _stage(request, 1, ProductStage.receiving_capture)
            step_started = time.perf_counter()
            async with self._storage() as storage:
                await storage.download(request.inputs.a, a_path)
                await storage.download(request.inputs.b, b_path)
                timings["download"] = (time.perf_counter() - step_started) * 1000

                yield _stage(request, 2, ProductStage.inspecting_signal)
                step_started = time.perf_counter()
                a = await self._decode(
                    a_path,
                    request.inputs.a.sha256,
                    request.inputs.a.byte_size,
                )
                b = await self._decode(
                    b_path,
                    request.inputs.b.sha256,
                    request.inputs.b.byte_size,
                )
                timings["validation"] = (time.perf_counter() - step_started) * 1000

                yield _stage(request, 3, ProductStage.detecting_noise_and_compression)
                step_started = time.perf_counter()
                before_metrics = await asyncio.to_thread(
                    analyze_signal,
                    a.samples,
                    a.metadata.sample_rate_hz,
                )
                b_metrics = await asyncio.to_thread(
                    analyze_signal,
                    b.samples,
                    b.metadata.sample_rate_hz,
                )
                timings["analysis"] = (time.perf_counter() - step_started) * 1000

                yield _stage(request, 4, ProductStage.restoring_detail)
                step_started = time.perf_counter()
                restored = a.samples
                restored_rate = a.metadata.sample_rate_hz
                used_engine: Literal["dsp", "resemble"] = "dsp"
                fallback_code: Literal["model_unavailable"] | None = None
                if self.settings.engine == "resemble":
                    try:
                        restored, restored_rate = await _non_cancellable_thread(
                            self._resemble.enhance,
                            a.samples,
                            a.metadata.sample_rate_hz,
                        )
                        used_engine = "resemble"
                    except EngineError:
                        if not self.settings.allow_dsp_fallback:
                            raise
                        fallback_code = "model_unavailable"
                timings["model"] = (time.perf_counter() - step_started) * 1000

                restored = await asyncio.to_thread(
                    resample_linear,
                    restored,
                    restored_rate,
                    a.metadata.sample_rate_hz,
                )
                restored = align_length(restored, a.metadata.frame_count)
                routing = RoutingDecision(
                    requested_engine=self.settings.engine,
                    used_engine=used_engine,
                    outcome="enhanced" if used_engine == "resemble" else "dsp_fallback",
                    fallback_code=fallback_code,
                )

                yield _stage(request, 5, ProductStage.polishing_dynamics)
                step_started = time.perf_counter()
                dsp_result = await asyncio.to_thread(
                    restrained_dsp, restored, a.metadata.sample_rate_hz
                )
                enhanced_bytes = await asyncio.to_thread(
                    encode_pcm16_wav, dsp_result.samples, a.metadata.sample_rate_hz
                )
                enhanced_path = root / "enhanced.wav"
                enhanced_path.write_bytes(enhanced_bytes)
                enhanced_hash = hashlib.sha256(enhanced_bytes).hexdigest()
                enhanced_decoded = await asyncio.to_thread(
                    decode_and_validate_wav,
                    enhanced_bytes,
                    expected_sha256=enhanced_hash,
                    expected_bytes=len(enhanced_bytes),
                    max_bytes=self.settings.max_wav_bytes,
                    max_duration_seconds=self.settings.max_duration_seconds,
                )
                after_metrics = await asyncio.to_thread(
                    analyze_signal,
                    enhanced_decoded.samples,
                    enhanced_decoded.metadata.sample_rate_hz,
                )
                timings["dsp"] = (time.perf_counter() - step_started) * 1000

                yield _stage(request, 6, ProductStage.generating_difference_map)
                step_started = time.perf_counter()
                difference = build_difference(
                    job_id=request.job_id,
                    attempt_id=request.attempt_id,
                    original=a.samples,
                    enhanced=enhanced_decoded.samples,
                    sample_rate=a.metadata.sample_rate_hz,
                )
                difference_bytes = canonical_json_bytes(difference)
                difference_path = root / "difference.json"
                difference_path.write_bytes(difference_bytes)

                yield _stage(request, 7, ProductStage.preparing_report)
                report = build_report(
                    job_id=request.job_id,
                    attempt_id=request.attempt_id,
                    before=before_metrics,
                    after=after_metrics,
                    routing=routing,
                    applied_processing=dsp_result.applied_processing,
                    versions=versions,
                )
                report_bytes = canonical_json_bytes(report)
                report_path = root / "report.json"
                report_path.write_bytes(report_bytes)
                _ensure_artifact_sizes(
                    request,
                    enhanced_size=len(enhanced_bytes),
                    difference_size=len(difference_bytes),
                    report_size=len(report_bytes),
                )
                timings["artifacts"] = (time.perf_counter() - step_started) * 1000

                # The report is uploaded last and can act as an attempt-level completion marker.
                step_started = time.perf_counter()
                await storage.upload(request.outputs.enhanced_wav, enhanced_path)
                await storage.upload(request.outputs.difference_json, difference_path)
                await storage.upload(request.outputs.report_json, report_path)
                timings["upload"] = (time.perf_counter() - step_started) * 1000

            response = EnhanceResponse(
                schema_version="1",
                job_id=request.job_id,
                attempt_id=request.attempt_id,
                source="A",
                routing=routing,
                before=CaptureAnalysis(audio=a.metadata, metrics=before_metrics),
                after=CaptureAnalysis(audio=enhanced_decoded.metadata, metrics=after_metrics),
                comparison_b=CaptureAnalysis(audio=b.metadata, metrics=b_metrics),
                artifacts={
                    "enhanced_wav": _receipt(
                        request.outputs.enhanced_wav.object_path,
                        "audio/wav",
                        enhanced_bytes,
                    ),
                    "difference_json": _receipt(
                        request.outputs.difference_json.object_path,
                        "application/json",
                        difference_bytes,
                    ),
                    "report_json": _receipt(
                        request.outputs.report_json.object_path,
                        "application/json",
                        report_bytes,
                    ),
                },
                versions=versions,
            )
            elapsed_ms = (time.perf_counter() - request_started) * 1000
            model_ms = timings.get("model", 0.0)
            audio_seconds = a.metadata.duration_seconds
            log_job_event(
                "enhance_complete",
                job_id=request.job_id,
                attempt_id=request.attempt_id,
                elapsed_ms=elapsed_ms,
                engine=used_engine,
                audio_seconds=audio_seconds,
                real_time_factor=(model_ms / 1000) / max(audio_seconds, 1e-6),
                timings_ms=timings,
            )
            yield ResultEvent(schema_version="1", type="result", sequence=8, result=response)

    def _validate_descriptors(self, request: AnalyzeRequest | EnhanceRequest) -> None:
        descriptors: list[SignedGetObject | SignedPutObject] = [
            request.inputs.a,
            request.inputs.b,
        ]
        if isinstance(request, EnhanceRequest):
            descriptors.extend(
                [
                    request.outputs.enhanced_wav,
                    request.outputs.difference_json,
                    request.outputs.report_json,
                ]
            )
        urls: set[str] = set()
        for descriptor in descriptors:
            url = validate_signed_url(descriptor, self.settings)
            if url in urls:
                raise StorageError("URL validation")
            urls.add(url)

    async def _decode(self, path: Path, expected_sha: str, expected_bytes: int) -> DecodedWav:
        data = path.read_bytes()
        return await asyncio.to_thread(
            decode_and_validate_wav,
            data,
            expected_sha256=expected_sha,
            expected_bytes=expected_bytes,
            max_bytes=self.settings.max_wav_bytes,
            max_duration_seconds=self.settings.max_duration_seconds,
        )

    def _storage(self) -> StorageClient:
        return StorageClient(self.settings, transport=self._storage_transport)


def _stage(request: EnhanceRequest, sequence: int, stage: ProductStage) -> StageEvent:
    return StageEvent(
        schema_version="1",
        type="stage",
        job_id=request.job_id,
        attempt_id=request.attempt_id,
        sequence=sequence,
        stage=stage,
    )


def _receipt(
    object_path: str,
    content_type: Literal["audio/wav", "application/json"],
    payload: bytes,
) -> ArtifactReceipt:
    return ArtifactReceipt(
        object_path=object_path,
        content_type=content_type,
        byte_size=len(payload),
        sha256=hashlib.sha256(payload).hexdigest(),
    )


def _ensure_artifact_sizes(
    request: EnhanceRequest,
    *,
    enhanced_size: int,
    difference_size: int,
    report_size: int,
) -> None:
    limits = (
        (enhanced_size, request.outputs.enhanced_wav.max_bytes),
        (difference_size, request.outputs.difference_json.max_bytes),
        (report_size, request.outputs.report_json.max_bytes),
    )
    if any(size > maximum for size, maximum in limits):
        raise StorageError("artifact generation")


def _dsp_readiness_probe() -> None:
    import numpy as np

    probe = np.zeros(64, dtype=np.float32)
    result = restrained_dsp(probe, 16_000)
    if result.samples.size != probe.size:
        raise RuntimeError("DSP readiness probe failed")


async def _non_cancellable_thread(
    function: Callable[..., Any],
    *args: object,
) -> Any:
    """Hold the one-job permit until an in-flight native/GPU call actually stops."""
    task = asyncio.create_task(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        with anyio.CancelScope(shield=True):
            # The request is already cancelled; only resource serialization matters here.
            await asyncio.gather(task, return_exceptions=True)
        raise
