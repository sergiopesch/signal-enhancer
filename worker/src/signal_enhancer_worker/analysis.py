"""Deterministic, cautious signal measurements for short speech captures."""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray

from signal_enhancer_worker.contracts import AnalysisMetrics, MetricDelta
from signal_enhancer_worker.wav import FloatSamples

_EPSILON = 1e-12


def _db(value: float) -> float:
    return 20.0 * math.log10(max(value, _EPSILON))


def _finite_round(value: float, digits: int = 4) -> float:
    if not math.isfinite(value):
        return -120.0
    return round(float(value), digits)


def _frame_rms(samples: FloatSamples, sample_rate: int) -> NDArray[np.float64]:
    frame_size = max(1, round(sample_rate * 0.02))
    hop_size = max(1, round(sample_rate * 0.01))
    if samples.size <= frame_size:
        return np.asarray([np.sqrt(np.mean(np.square(samples, dtype=np.float64)))])
    starts = range(0, samples.size - frame_size + 1, hop_size)
    return np.asarray(
        [
            np.sqrt(
                np.mean(np.square(samples[start : start + frame_size], dtype=np.float64))
            )
            for start in starts
        ],
        dtype=np.float64,
    )


def analyze_signal(samples: FloatSamples, sample_rate: int) -> AnalysisMetrics:
    values = samples.astype(np.float64, copy=False)
    absolute = np.abs(values)
    peak = float(np.max(absolute, initial=0.0))
    rms = float(np.sqrt(np.mean(np.square(values))))
    frame_rms = _frame_rms(samples, sample_rate)
    frame_db = 20.0 * np.log10(np.maximum(frame_rms, _EPSILON))

    silence_frames = max(1, min(frame_db.size, round(2.0 / 0.01)))
    noise_floor = float(np.median(frame_db[:silence_frames]))
    active = frame_db[frame_db > max(noise_floor + 6.0, -70.0)]
    if active.size >= 4:
        dynamics = float(np.percentile(active, 90) - np.percentile(active, 10))
    else:
        dynamics = float(np.percentile(frame_db, 90) - np.percentile(frame_db, 10))

    window_length = min(values.size, max(sample_rate, 4096))
    if values.size > window_length:
        loudest_frame = int(np.argmax(frame_rms))
        center = loudest_frame * max(1, round(sample_rate * 0.01))
        start = min(max(0, center - window_length // 2), values.size - window_length)
        spectral_source = values[start : start + window_length]
    else:
        spectral_source = values
    if spectral_source.size > 1:
        window = np.hanning(spectral_source.size)
        spectrum = np.abs(np.fft.rfft(spectral_source * window)) ** 2
        frequencies = np.fft.rfftfreq(spectral_source.size, d=1.0 / sample_rate)
        total_energy = float(np.sum(spectrum)) + _EPSILON
        hf_floor = min(8_000.0, sample_rate * 0.35)
        high_ratio = float(np.sum(spectrum[frequencies >= hf_floor]) / total_energy)
        cumulative = np.cumsum(spectrum)
        rolloff_index = int(np.searchsorted(cumulative, cumulative[-1] * 0.95))
        rolloff = float(frequencies[min(rolloff_index, frequencies.size - 1)])
    else:
        high_ratio = 0.0
        rolloff = 0.0

    log_envelope = np.log(np.maximum(frame_rms, _EPSILON))
    if log_envelope.size >= 30 and float(np.std(log_envelope)) > 1e-9:
        correlations: list[float] = []
        for lag in range(5, min(26, log_envelope.size // 2)):
            left = log_envelope[:-lag]
            right = log_envelope[lag:]
            correlation = np.corrcoef(left, right)[0, 1]
            if math.isfinite(float(correlation)):
                correlations.append(max(0.0, float(correlation)))
        reverb_proxy = float(np.mean(correlations)) if correlations else 0.0
    else:
        reverb_proxy = 0.0

    compression_proxy = float(np.clip(1.0 - (dynamics / 24.0), 0.0, 1.0))
    return AnalysisMetrics(
        peak_dbfs=_finite_round(_db(peak), 3),
        rms_dbfs=_finite_round(_db(rms), 3),
        steady_noise_floor_dbfs=_finite_round(max(-120.0, noise_floor), 3),
        crest_factor_db=_finite_round(max(0.0, _db(peak) - _db(rms)), 3),
        dynamics_range_db=_finite_round(max(0.0, dynamics), 3),
        clipping_ratio=_finite_round(float(np.mean(absolute >= 0.999)), 7),
        dc_offset=_finite_round(float(np.mean(values)), 7),
        high_frequency_energy_ratio=_finite_round(float(np.clip(high_ratio, 0.0, 1.0)), 7),
        spectral_rolloff_hz=_finite_round(rolloff, 1),
        compression_proxy=_finite_round(compression_proxy, 4),
        reverb_proxy=_finite_round(float(np.clip(reverb_proxy, 0.0, 1.0)), 4),
    )


def compare_metrics(a: AnalysisMetrics, b: AnalysisMetrics) -> tuple[MetricDelta, list[str]]:
    delta = MetricDelta(
        noise_floor_db=round(b.steady_noise_floor_dbfs - a.steady_noise_floor_dbfs, 3),
        dynamics_range_db=round(b.dynamics_range_db - a.dynamics_range_db, 3),
        high_frequency_energy_ratio=round(
            b.high_frequency_energy_ratio - a.high_frequency_energy_ratio, 7
        ),
        clipping_ratio=round(b.clipping_ratio - a.clipping_ratio, 7),
    )
    observations: list[str] = []
    if abs(delta.noise_floor_db) >= 2.0:
        subject = "Input B" if delta.noise_floor_db > 0 else "Input A"
        observations.append(f"{subject} shows a higher steady noise-floor estimate.")
    if abs(delta.dynamics_range_db) >= 2.0:
        subject = "Input B" if delta.dynamics_range_db < 0 else "Input A"
        observations.append(f"{subject} shows more tightly controlled short-term dynamics.")
    if abs(delta.high_frequency_energy_ratio) >= 0.01:
        subject = "Input B" if delta.high_frequency_energy_ratio > 0 else "Input A"
        observations.append(f"{subject} carries more energy in the upper measured frequencies.")
    if max(a.clipping_ratio, b.clipping_ratio) >= 0.0005:
        subject = "Input A" if a.clipping_ratio >= b.clipping_ratio else "Input B"
        observations.append(f"{subject} contains more samples close to full scale.")
    if not observations:
        observations.append(
            "The selected measurements are closely matched across the two captures."
        )
    observations.append(
        "These patterns may reflect device processing, placement, playback level, or the room."
    )
    return delta, observations


def issue_observations(metrics: AnalysisMetrics) -> list[str]:
    issues: list[str] = []
    if metrics.steady_noise_floor_dbfs > -45.0:
        issues.append("The opening segment has an elevated steady noise-floor estimate.")
    if metrics.clipping_ratio >= 0.0005:
        issues.append(
            "Some samples sit close to full scale, which can accompany peak limiting or clipping."
        )
    if metrics.dynamics_range_db < 6.0:
        issues.append(
            "Short-term levels are tightly grouped, which can accompany gain control or "
            "compression."
        )
    if metrics.high_frequency_energy_ratio < 0.01:
        issues.append(
            "The capture carries relatively little energy in the upper measured frequencies."
        )
    if not issues:
        issues.append("No strong issue crossed the conservative routing thresholds.")
    return issues[:5]
