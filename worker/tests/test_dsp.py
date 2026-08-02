from __future__ import annotations

import numpy as np

from signal_enhancer_worker.analysis import analyze_signal
from signal_enhancer_worker.dsp import restrained_dsp


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
