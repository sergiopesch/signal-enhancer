"""Strict public API contracts.

Signed URLs are deliberately represented by ``SecretStr``. They must never be
included in response models, logs, or exception messages.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    StringConstraints,
    field_validator,
    model_validator,
)

ApiVersion = Literal["1"]
UuidString = Annotated[
    str,
    StringConstraints(
        strict=True,
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    ),
]
Sha256 = Annotated[str, StringConstraints(strict=True, pattern=r"^[0-9a-f]{64}$")]
ObjectPath = Annotated[
    str,
    StringConstraints(
        strict=True,
        min_length=3,
        max_length=512,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._/-]+$",
    ),
]
BoundedText = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=240)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, validate_default=True)


class ReferenceVersion(StrictModel):
    id: Literal["diagnostic-speech", "guided-reading-v1"]
    revision: Literal["v1", "1.0.0"]

    @model_validator(mode="after")
    def require_matching_protocol_revision(self) -> ReferenceVersion:
        supported_pairs = {
            ("diagnostic-speech", "v1"),
            ("guided-reading-v1", "1.0.0"),
        }
        if (self.id, self.revision) not in supported_pairs:
            raise ValueError("reference protocol and revision do not match")
        return self


class SignedGetObject(StrictModel):
    object_path: ObjectPath
    url: SecretStr
    # JSON has no native datetime type, so this field alone parses an RFC 3339 string.
    expires_at: Annotated[datetime, Field(strict=False)]
    byte_size: Annotated[int, Field(strict=True, ge=44, le=4 * 1024 * 1024)]
    sha256: Sha256
    content_type: Literal["audio/wav"]

    @field_validator("url")
    @classmethod
    def validate_url_length(cls, value: SecretStr) -> SecretStr:
        if not 1 <= len(value.get_secret_value()) <= 4096:
            raise ValueError("signed URL length is outside the permitted range")
        return value

    @field_validator("expires_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("expires_at must include a timezone")
        return value

    @field_validator("expires_at", mode="before")
    @classmethod
    def require_rfc3339_input(cls, value: object) -> object:
        if isinstance(value, datetime):
            return value
        if not isinstance(value, str) or "T" not in value or len(value) > 40:
            raise ValueError("expires_at must be an RFC 3339 string")
        return value

    @field_validator("object_path")
    @classmethod
    def validate_object_path(cls, value: str) -> str:
        _validate_path_segments(value)
        return value


class SignedPutObject(StrictModel):
    object_path: ObjectPath
    url: SecretStr
    expires_at: Annotated[datetime, Field(strict=False)]
    max_bytes: Annotated[int, Field(strict=True, ge=2, le=4 * 1024 * 1024)]
    content_type: Literal["audio/wav", "application/json"]

    @field_validator("url")
    @classmethod
    def validate_url_length(cls, value: SecretStr) -> SecretStr:
        if not 1 <= len(value.get_secret_value()) <= 4096:
            raise ValueError("signed URL length is outside the permitted range")
        return value

    @field_validator("expires_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("expires_at must include a timezone")
        return value

    @field_validator("expires_at", mode="before")
    @classmethod
    def require_rfc3339_input(cls, value: object) -> object:
        if isinstance(value, datetime):
            return value
        if not isinstance(value, str) or "T" not in value or len(value) > 40:
            raise ValueError("expires_at must be an RFC 3339 string")
        return value

    @field_validator("object_path")
    @classmethod
    def validate_object_path(cls, value: str) -> str:
        _validate_path_segments(value)
        return value


def _validate_path_segments(value: str) -> None:
    if "//" in value or "\\" in value:
        raise ValueError("object path is not canonical")
    if any(part in {"", ".", ".."} for part in value.split("/")):
        raise ValueError("object path contains an invalid segment")


class CaptureInputs(StrictModel):
    a: SignedGetObject
    b: SignedGetObject

    @model_validator(mode="after")
    def distinct_inputs(self) -> CaptureInputs:
        if self.a.object_path == self.b.object_path:
            raise ValueError("input object paths must be distinct")
        return self


class OutputDestinations(StrictModel):
    enhanced_wav: SignedPutObject
    difference_json: SignedPutObject
    report_json: SignedPutObject

    @model_validator(mode="after")
    def validate_outputs(self) -> OutputDestinations:
        expected = {
            "enhanced_wav": (self.enhanced_wav, "audio/wav", "enhanced.wav"),
            "difference_json": (self.difference_json, "application/json", "difference.json"),
            "report_json": (self.report_json, "application/json", "report.json"),
        }
        paths: set[str] = set()
        for item, content_type, suffix in expected.values():
            if item.content_type != content_type:
                raise ValueError("output content type does not match its artifact kind")
            if not item.object_path.endswith(f"/{suffix}"):
                raise ValueError("output object path does not match its artifact kind")
            if item.object_path in paths:
                raise ValueError("output object paths must be distinct")
            paths.add(item.object_path)
        return self


class BaseJobRequest(StrictModel):
    schema_version: ApiVersion
    job_id: UuidString
    attempt_id: UuidString
    reference: ReferenceVersion
    inputs: CaptureInputs


class AnalyzeRequest(BaseJobRequest):
    pass


class EnhanceRequest(BaseJobRequest):
    source: Literal["A"]
    outputs: OutputDestinations

    @model_validator(mode="after")
    def validate_attempt_scoping(self) -> EnhanceRequest:
        input_paths = {self.inputs.a.object_path, self.inputs.b.object_path}
        job_segment = self.job_id
        attempt_segment = self.attempt_id
        for output in (
            self.outputs.enhanced_wav,
            self.outputs.difference_json,
            self.outputs.report_json,
        ):
            parts = output.object_path.split("/")
            if job_segment not in parts or attempt_segment not in parts:
                raise ValueError("output paths must be scoped to the job and attempt")
            if output.object_path in input_paths:
                raise ValueError("an output path cannot overwrite an input")
        return self


class AudioMetadata(StrictModel):
    sha256: Sha256
    byte_size: int
    codec: Literal["pcm_s16le", "pcm_s24le", "pcm_s32le", "float32le"]
    sample_rate_hz: int
    channels: Literal[1]
    bits_per_sample: Literal[16, 24, 32]
    frame_count: int
    duration_seconds: float


class AnalysisMetrics(StrictModel):
    peak_dbfs: float
    rms_dbfs: float
    steady_noise_floor_dbfs: float
    crest_factor_db: float
    dynamics_range_db: float
    clipping_ratio: float
    dc_offset: float
    high_frequency_energy_ratio: float
    spectral_rolloff_hz: float
    compression_proxy: float
    reverb_proxy: float


class CaptureAnalysis(StrictModel):
    audio: AudioMetadata
    metrics: AnalysisMetrics


class MetricDelta(StrictModel):
    noise_floor_db: float
    dynamics_range_db: float
    high_frequency_energy_ratio: float
    clipping_ratio: float


class VersionInfo(StrictModel):
    api_schema: ApiVersion
    build_revision: str
    pipeline_revision: str
    dsp_revision: str
    model_name: Literal["none", "resemble-enhance"]
    model_revision: str | None


class AnalyzeResponse(StrictModel):
    schema_version: ApiVersion
    job_id: UuidString
    attempt_id: UuidString
    inputs: dict[Literal["a", "b"], CaptureAnalysis]
    delta_b_minus_a: MetricDelta
    observations: Annotated[list[BoundedText], Field(max_length=8)]
    versions: VersionInfo


class ArtifactReceipt(StrictModel):
    object_path: ObjectPath
    content_type: Literal["audio/wav", "application/json"]
    byte_size: int
    sha256: Sha256


class RoutingDecision(StrictModel):
    requested_engine: Literal["dsp", "resemble"]
    used_engine: Literal["dsp", "resemble"]
    outcome: Literal["enhanced", "dsp_fallback"]
    fallback_code: Literal["model_unavailable"] | None = None


class EnhanceResponse(StrictModel):
    schema_version: ApiVersion
    job_id: UuidString
    attempt_id: UuidString
    source: Literal["A"]
    routing: RoutingDecision
    before: CaptureAnalysis
    after: CaptureAnalysis
    comparison_b: CaptureAnalysis
    artifacts: dict[Literal["enhanced_wav", "difference_json", "report_json"], ArtifactReceipt]
    versions: VersionInfo


class ProductStage(StrEnum):
    receiving_capture = "receiving_capture"
    inspecting_signal = "inspecting_signal"
    detecting_noise_and_compression = "detecting_noise_and_compression"
    restoring_detail = "restoring_detail"
    polishing_dynamics = "polishing_dynamics"
    generating_difference_map = "generating_difference_map"
    preparing_report = "preparing_report"


class StageEvent(StrictModel):
    schema_version: ApiVersion
    type: Literal["stage"]
    job_id: UuidString
    attempt_id: UuidString
    sequence: Annotated[int, Field(ge=1, le=7)]
    stage: ProductStage


class ResultEvent(StrictModel):
    schema_version: ApiVersion
    type: Literal["result"]
    sequence: Literal[8]
    result: EnhanceResponse


class ErrorResponse(StrictModel):
    schema_version: ApiVersion = "1"
    request_id: str
    code: str
    message: str
    retryable: bool


class HealthResponse(StrictModel):
    status: Literal["ready", "starting"]
