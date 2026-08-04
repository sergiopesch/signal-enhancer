from __future__ import annotations

import os
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "deploy_huggingface_endpoint.sh"


def deployment_environment(secret_file: Path) -> dict[str, str]:
    return {
        **os.environ,
        "HF_ENDPOINT_IMAGE": f"ghcr.io/example/signal@sha256:{'a' * 64}",
        "HF_ENDPOINT_SECRETS_FILE": str(secret_file),
        "SIGNAL_ALLOWED_STORAGE_HOSTS": (
            "private-store.private.blob.vercel-storage.com,blob.vercel-storage.com"
        ),
    }


def private_secret_file(tmp_path: Path) -> Path:
    secret_file = tmp_path / "endpoint.secrets"
    secret_file.write_text(f"SIGNAL_ENDPOINT_SECRET={'s' * 40}\n")
    secret_file.chmod(0o600)
    return secret_file


def run_script(environment: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603
        ["/bin/bash", str(SCRIPT)],
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )


def install_fake_commands(tmp_path: Path, *, include_uv: bool = True) -> Path:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    hf = fake_bin / "hf"
    hf.write_text("#!/bin/sh\nexit 0\n")
    hf.chmod(0o755)
    if include_uv:
        uv = fake_bin / "uv"
        uv.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$HF_CAPTURE_ARGS"\n')
        uv.chmod(0o755)
    return fake_bin


def test_deploy_requires_the_pinned_runtime_launcher(tmp_path: Path) -> None:
    environment = deployment_environment(private_secret_file(tmp_path))
    fake_bin = install_fake_commands(tmp_path, include_uv=False)
    environment["PATH"] = f"{fake_bin}:/usr/bin:/bin"

    result = run_script(environment)

    assert result.returncode == 1
    assert "uv is required" in result.stderr


def test_deploy_invokes_the_policy_locked_python_helper(tmp_path: Path) -> None:
    environment = deployment_environment(private_secret_file(tmp_path))
    capture = tmp_path / "hf-arguments.txt"
    environment["HF_CAPTURE_ARGS"] = str(capture)
    environment["PATH"] = f"{install_fake_commands(tmp_path)}:{environment['PATH']}"

    result = run_script(environment)

    assert result.returncode == 0, result.stderr
    arguments = capture.read_text().splitlines()
    assert arguments[:6] == [
        "run",
        "--directory",
        str(SCRIPT.parents[2]),
        "--isolated",
        "--with",
        "huggingface-hub==1.21.0",
    ]
    assert arguments[6] == "python"
    assert arguments[7].endswith("deploy/create_huggingface_endpoint.py")
