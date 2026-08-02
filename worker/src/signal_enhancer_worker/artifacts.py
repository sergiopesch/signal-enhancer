"""Bounded, canonical JSON artifact generation."""

from __future__ import annotations

import json
from typing import Annotated, Literal

import numpy as np
from pydantic import Field

from signal_enhancer_worker.analysis import issue_observations
from signal_enhancer_worker.contracts import (
    AnalysisMetrics,
    BoundedText,
    RoutingDecision,
    StrictModel,
    UuidString,
    VersionInfo,
)
from signal_enhancer_worker.wav import FloatSamples


class DifferencePoint(StrictModel):
    time_seconds: float
    original_dbfs: float
    enhanced_dbfs: float
    difference_dbfs: float


class DifferenceArtifact(StrictModel):
    schema_version: Literal["1"]
    job_id: UuidString
    attempt_id: UuidString
    sample_rate_hz: int
    frame_count: int
    points: Annotated[list[DifferencePoint], Field(min_length=1, max_length=400)]


class TransparentReport(StrictModel):
    schema_version: Literal["1"]
    job_id: UuidString
    attempt_id: UuidString
    source: Literal["A"]
    detected_issues: Annotated[list[BoundedText], Field(min_length=1, max_length=6)]
    routing: RoutingDecision
    applied_processing: Annotated[list[BoundedText], Field(min_length=1, max_length=8)]
    likely_changes: Annotated[list[BoundedText], Field(min_length=1, max_length=6)]
    limitations: Annotated[list[BoundedText], Field(min_length=1, max_length=6)]
    versions: VersionInfo


def canonical_json_bytes(model: StrictModel) -> bytes:
    return json.dumps(
        model.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def _window_dbfs(values: FloatSamples) -> float:
    rms = float(np.sqrt(np.mean(np.square(values, dtype=np.float64))))
    return round(float(20.0 * np.log10(max(rms, 1e-6))), 3)


def build_difference(
    *,
    job_id: str,
    attempt_id: str,
    original: FloatSamples,
    enhanced: FloatSamples,
    sample_rate: int,
) -> DifferenceArtifact:
    point_count = min(400, max(1, original.size // max(1, sample_rate // 20)))
    edges = np.linspace(0, original.size, point_count + 1, dtype=np.int64)
    points: list[DifferencePoint] = []
    for index in range(point_count):
        start = int(edges[index])
        end = max(start + 1, int(edges[index + 1]))
        original_window = original[start:end]
        enhanced_window = enhanced[start:end]
        points.append(
            DifferencePoint(
                time_seconds=round(start / sample_rate, 4),
                original_dbfs=_window_dbfs(original_window),
                enhanced_dbfs=_window_dbfs(enhanced_window),
                difference_dbfs=_window_dbfs(enhanced_window - original_window),
            )
        )
    return DifferenceArtifact(
        schema_version="1",
        job_id=job_id,
        attempt_id=attempt_id,
        sample_rate_hz=sample_rate,
        frame_count=original.size,
        points=points,
    )


def build_report(
    *,
    job_id: str,
    attempt_id: str,
    before: AnalysisMetrics,
    after: AnalysisMetrics,
    routing: RoutingDecision,
    applied_processing: tuple[str, ...],
    versions: VersionInfo,
) -> TransparentReport:
    likely_changes: list[str] = []
    if after.steady_noise_floor_dbfs < before.steady_noise_floor_dbfs - 0.5:
        likely_changes.append("The steady background estimate is lower in the processed signal.")
    if after.crest_factor_db < before.crest_factor_db - 0.5:
        likely_changes.append("Peak-to-average contrast is slightly more restrained.")
    if after.clipping_ratio < before.clipping_ratio:
        likely_changes.append("Fewer output samples sit close to full scale.")
    if not likely_changes:
        likely_changes.append("The restrained pass preserves the measured level balance closely.")
    return TransparentReport(
        schema_version="1",
        job_id=job_id,
        attempt_id=attempt_id,
        source="A",
        detected_issues=issue_observations(before),
        routing=routing,
        applied_processing=list(applied_processing),
        likely_changes=likely_changes,
        limitations=[
            "Any bandwidth restoration is inferred; missing source information is not recovered "
            "with certainty.",
            "Observed patterns may also reflect placement, playback level, browser processing, "
            "or the room.",
            "This speech-focused pass is not intended for music mastering or microphone emulation.",
        ],
        versions=versions,
    )
