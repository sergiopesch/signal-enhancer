from __future__ import annotations

import numpy as np

from signal_enhancer_worker.analysis import analyze_signal
from signal_enhancer_worker.dsp import resample_bandlimited, restrained_dsp


def test_analysis_and_dsp_are_deterministic_and_restrained() -> None:
    generator = np.random.default_rng(7)
    source = generator.normal(0.0, 0.08, 8_000).astype(np.float32)

    first_metrics = analyze_signal(source, 16_000)
    second_metrics = analyze_signal(source, 16_000)
    first = restrained_dsp(source, 16_000)
    second = restrained_dsp(source, 16_000)

    assert first_metrics == second_metrics
    np.testing.assert_array_equal(first.samples, second.samples)
    assert first.applied_processing == second.applied_processing
    assert np.max(np.abs(first.samples)) <= 0.98
    source_rms = np.sqrt(np.mean(np.square(source, dtype=np.float64)))
    output_rms = np.sqrt(np.mean(np.square(first.samples, dtype=np.float64)))
    change_db = 20 * np.log10(output_rms / source_rms)
    assert abs(change_db) <= 1.6


def test_dsp_can_loudness_match_against_the_original_capture() -> None:
    time = np.arange(16_000, dtype=np.float32) / 16_000
    restored = (0.24 * np.sin(2 * np.pi * 220 * time)).astype(np.float32)
    original = (0.08 * np.sin(2 * np.pi * 220 * time)).astype(np.float32)

    result = restrained_dsp(restored, 16_000, original)
    original_rms = np.sqrt(np.mean(np.square(original, dtype=np.float64)))
    result_rms = np.sqrt(np.mean(np.square(result.samples, dtype=np.float64)))

    assert abs(20 * np.log10(result_rms / original_rms)) <= 1.6


def test_bandlimited_resampler_preserves_voice_band_and_rejects_aliases() -> None:
    source_rate = 48_000
    target_rate = 16_000
    time = np.arange(source_rate, dtype=np.float32) / source_rate
    voice_band = np.sin(2 * np.pi * 1_000 * time).astype(np.float32)
    out_of_band = np.sin(2 * np.pi * 12_000 * time).astype(np.float32)

    voice_result = resample_bandlimited(voice_band, source_rate, target_rate)
    alias_result = resample_bandlimited(out_of_band, source_rate, target_rate)

    assert voice_result.size == target_rate
    assert np.sqrt(np.mean(np.square(voice_result, dtype=np.float64))) > 0.65
    assert np.sqrt(np.mean(np.square(alias_result, dtype=np.float64))) < 0.04


def test_bandlimited_resampler_returns_an_independent_copy_at_the_same_rate() -> None:
    source = np.linspace(-0.5, 0.5, 128, dtype=np.float32)
    result = resample_bandlimited(source, 48_000, 48_000)

    np.testing.assert_array_equal(result, source)
    assert result is not source
