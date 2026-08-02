"""Restrained, deterministic DSP used for preview and safe fallback."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from signal_enhancer_worker.analysis import analyze_signal
from signal_enhancer_worker.wav import FloatSamples


@dataclass(frozen=True, slots=True)
class DspResult:
    samples: FloatSamples
    applied_processing: tuple[str, ...]


def _one_pole_high_pass(samples: FloatSamples, sample_rate: int, cutoff_hz: float) -> FloatSamples:
    coefficient = math.exp(-2.0 * math.pi * cutoff_hz / sample_rate)
    output = np.empty_like(samples)
    previous_input = 0.0
    previous_output = 0.0
    for index, current in enumerate(samples):
        value = coefficient * (previous_output + float(current) - previous_input)
        output[index] = value
        previous_input = float(current)
        previous_output = value
    return output


def _gentle_expander(samples: FloatSamples, noise_dbfs: float) -> FloatSamples:
    threshold = 10.0 ** (min(-40.0, noise_dbfs + 5.0) / 20.0)
    magnitude = np.abs(samples)
    normalized = np.clip(magnitude / max(threshold, 1e-5), 0.0, 1.0)
    gain = 0.82 + 0.18 * np.square(normalized)
    return np.asarray(samples * gain, dtype=np.float32)


def _compress(samples: FloatSamples, sample_rate: int) -> FloatSamples:
    threshold = 10.0 ** (-16.0 / 20.0)
    ratio = 1.45
    attack = math.exp(-1.0 / (sample_rate * 0.012))
    release = math.exp(-1.0 / (sample_rate * 0.14))
    envelope = 0.0
    smoothed_gain = 1.0
    output = np.empty_like(samples)
    for index, sample in enumerate(samples):
        magnitude = abs(float(sample))
        coefficient = attack if magnitude > envelope else release
        envelope = coefficient * envelope + (1.0 - coefficient) * magnitude
        if envelope > threshold:
            target = ((threshold + (envelope - threshold) / ratio) / envelope) ** 0.75
        else:
            target = 1.0
        gain_coefficient = attack if target < smoothed_gain else release
        smoothed_gain = gain_coefficient * smoothed_gain + (1.0 - gain_coefficient) * target
        output[index] = float(sample) * smoothed_gain
    return output


def _de_ess(samples: FloatSamples, sample_rate: int) -> FloatSamples:
    low_coefficient = math.exp(-2.0 * math.pi * min(5_500.0, sample_rate * 0.35) / sample_rate)
    release = math.exp(-1.0 / (sample_rate * 0.05))
    low = 0.0
    detector = 0.0
    output = np.empty_like(samples)
    for index, sample in enumerate(samples):
        current = float(sample)
        low = (1.0 - low_coefficient) * current + low_coefficient * low
        high = abs(current - low)
        detector = max(high, detector * release)
        excess = max(0.0, detector - 0.09)
        reduction = 1.0 / (1.0 + 2.0 * excess)
        output[index] = current * max(0.82, reduction)
    return output


def _match_loudness(processed: FloatSamples, reference: FloatSamples) -> FloatSamples:
    processed_rms = float(np.sqrt(np.mean(np.square(processed, dtype=np.float64))))
    reference_rms = float(np.sqrt(np.mean(np.square(reference, dtype=np.float64))))
    if processed_rms <= 1e-8 or reference_rms <= 1e-8:
        matched = processed.copy()
    else:
        raw_gain = reference_rms / processed_rms
        limited_gain = float(np.clip(raw_gain, 10 ** (-1.5 / 20.0), 10 ** (1.5 / 20.0)))
        matched = processed * limited_gain
    peak = float(np.max(np.abs(matched), initial=0.0))
    if peak > 0.98:
        matched = matched * (0.98 / peak)
    return matched.astype(np.float32, copy=False)


def restrained_dsp(samples: FloatSamples, sample_rate: int) -> DspResult:
    metrics = analyze_signal(samples, sample_rate)
    processed = _one_pole_high_pass(samples, sample_rate, 68.0)
    stages: list[str] = ["68 Hz high-pass filtering"]
    if metrics.steady_noise_floor_dbfs > -58.0:
        processed = _gentle_expander(processed, metrics.steady_noise_floor_dbfs)
        stages.append("low-level 1.2:1 downward expansion")
    processed = _compress(processed, sample_rate)
    stages.append("gentle 1.45:1 peak compression")
    if metrics.high_frequency_energy_ratio > 0.035:
        processed = _de_ess(processed, sample_rate)
        stages.append("up to 1.7 dB adaptive sibilance restraint")
    processed = _match_loudness(processed, samples)
    stages.append("loudness matching within 1.5 dB and 0.98 peak safety")
    return DspResult(samples=processed, applied_processing=tuple(stages))


def resample_linear(samples: FloatSamples, source_rate: int, target_rate: int) -> FloatSamples:
    if source_rate == target_rate:
        return samples.astype(np.float32, copy=True)
    output_length = max(1, round(samples.size * target_rate / source_rate))
    source_positions = np.arange(samples.size, dtype=np.float64)
    target_positions = np.linspace(0.0, max(0.0, samples.size - 1.0), output_length)
    return np.interp(target_positions, source_positions, samples).astype(np.float32)


def align_length(samples: FloatSamples, frame_count: int) -> FloatSamples:
    if samples.size == frame_count:
        return samples
    if samples.size > frame_count:
        return samples[:frame_count].copy()
    return np.pad(samples, (0, frame_count - samples.size)).astype(np.float32)
