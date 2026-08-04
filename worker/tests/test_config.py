from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from signal_enhancer_worker.config import Settings


def production_settings(tmp_path: Path, *, allow_dsp_fallback: bool) -> Settings:
    return Settings(
        endpoint_secret="production-secret-with-at-least-32-bytes",  # noqa: S106
        allowed_storage_hosts=(
            "private-store.private.blob.vercel-storage.com",
            "blob.vercel-storage.com",
        ),
        environment="production",
        engine="resemble",
        allow_dsp_fallback=allow_dsp_fallback,
        temp_root=tmp_path / "signal-worker",
        build_revision="a" * 40,
    )


def test_dsp_fallback_defaults_to_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SIGNAL_ENVIRONMENT", "development")
    monkeypatch.delenv("SIGNAL_ALLOW_DSP_FALLBACK", raising=False)

    assert Settings.from_env().allow_dsp_fallback is False


def test_production_rejects_dsp_fallback(tmp_path: Path) -> None:
    settings = production_settings(tmp_path, allow_dsp_fallback=True)

    assert "production_disallows_dsp_fallback" in settings.readiness_problems()


def test_production_requires_an_immutable_build_commit(tmp_path: Path) -> None:
    settings = replace(
        production_settings(tmp_path, allow_dsp_fallback=False),
        build_revision="latest-build",
    )

    assert "missing_build_revision" in settings.readiness_problems()


def test_production_resemble_route_is_ready_without_fallback(tmp_path: Path) -> None:
    settings = production_settings(tmp_path, allow_dsp_fallback=False)

    assert settings.readiness_problems() == ()
