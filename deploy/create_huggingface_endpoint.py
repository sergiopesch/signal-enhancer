#!/usr/bin/env python3
"""Create one policy-locked Hugging Face endpoint without exposing secrets."""

from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import Any

from validate_worker_release import (
    REPOSITORY_ROOT,
    ReleaseValidationError,
    expected_endpoint_name,
    field,
    load_json,
    require_equal,
    validate_endpoint_snapshot,
    validate_image_reference,
    validate_policy,
)

POLICY_PATH = REPOSITORY_ROOT / "deploy" / "huggingface-endpoint.production.json"


def validate_endpoint_secret(secret: Any) -> str:
    if (
        not isinstance(secret, str)
        or len(secret.encode()) < 32
        or any(character.isspace() for character in secret)
    ):
        raise ReleaseValidationError("SIGNAL_ENDPOINT_SECRET is missing or too weak")
    return secret


def load_endpoint_secret(path: Path) -> str:
    try:
        mode = stat.S_IMODE(path.stat().st_mode)
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise ReleaseValidationError("endpoint secrets file is unreadable") from error
    if mode != 0o600:
        raise ReleaseValidationError("endpoint secrets file must have mode 600")
    if len(lines) != 1 or not lines[0].startswith("SIGNAL_ENDPOINT_SECRET="):
        raise ReleaseValidationError(
            "endpoint secrets file must contain exactly SIGNAL_ENDPOINT_SECRET"
        )
    return validate_endpoint_secret(lines[0].partition("=")[2])


def validate_storage_hosts(value: str) -> str:
    hosts = [part.strip().lower().rstrip(".") for part in value.split(",") if part.strip()]
    if not hosts or len(hosts) != len(set(hosts)):
        raise ReleaseValidationError("storage host allowlist is missing or duplicated")
    if any(
        "://" in host
        or "/" in host
        or "*" in host
        or any(character.isspace() for character in host)
        for host in hosts
    ):
        raise ReleaseValidationError("storage host allowlist contains an invalid host")
    return ",".join(hosts)


def build_endpoint_request(
    policy: Any,
    image_reference: str,
    allowed_storage_hosts: str,
    endpoint_secret: str,
) -> dict[str, Any]:
    validate_policy(policy)
    validate_image_reference(image_reference)
    allowed_storage_hosts = validate_storage_hosts(allowed_storage_hosts)
    endpoint = field(policy, "endpoint")
    compute = field(policy, "endpoint", "compute")
    model = field(policy, "endpoint", "model")
    container = field(policy, "endpoint", "container")
    runtime = field(policy, "endpoint", "runtime")
    return {
        "name": expected_endpoint_name(policy, image_reference),
        "repository": model["repository"],
        "framework": model["framework"],
        "revision": model["revision"],
        "custom_image": {
            "url": image_reference,
            "port": container["port"],
            "healthRoute": container["healthRoute"],
        },
        "accelerator": compute["accelerator"],
        "instance_size": compute["instanceSize"],
        "instance_type": compute["instanceType"],
        "vendor": endpoint["provider"]["vendor"],
        "region": endpoint["provider"]["region"],
        "type": endpoint["access"]["hfEndpointType"],
        "min_replica": compute["minReplica"],
        "max_replica": compute["maxReplica"],
        "scale_to_zero_timeout": compute["scaleToZeroTimeoutMinutes"],
        "cache_http_responses": endpoint["cacheHttpResponses"],
        "env": {
            **runtime["plainEnvironment"],
            "SIGNAL_ALLOWED_STORAGE_HOSTS": allowed_storage_hosts,
        },
        "secrets": {"SIGNAL_ENDPOINT_SECRET": endpoint_secret},
    }


def validate_endpoint_request(request: Any, policy: Any, image: str) -> None:
    """Validate every provider request field before provisioning billable compute."""

    validate_policy(policy)
    validate_image_reference(image)
    expected_fields = {
        "accelerator",
        "cache_http_responses",
        "custom_image",
        "env",
        "framework",
        "instance_size",
        "instance_type",
        "max_replica",
        "min_replica",
        "name",
        "region",
        "repository",
        "revision",
        "scale_to_zero_timeout",
        "secrets",
        "type",
        "vendor",
    }
    if not isinstance(request, dict) or set(request) != expected_fields:
        raise ReleaseValidationError("endpoint request fields do not match policy")

    endpoint = field(policy, "endpoint")
    compute = field(policy, "endpoint", "compute")
    model = field(policy, "endpoint", "model")
    container = field(policy, "endpoint", "container")
    runtime = field(policy, "endpoint", "runtime")

    for name, expected in (
        ("name", expected_endpoint_name(policy, image)),
        ("repository", model["repository"]),
        ("framework", model["framework"]),
        ("revision", model["revision"]),
        ("accelerator", compute["accelerator"]),
        ("instance_size", compute["instanceSize"]),
        ("instance_type", compute["instanceType"]),
        ("vendor", endpoint["provider"]["vendor"]),
        ("region", endpoint["provider"]["region"]),
        ("type", endpoint["access"]["hfEndpointType"]),
        ("min_replica", compute["minReplica"]),
        ("max_replica", compute["maxReplica"]),
        ("scale_to_zero_timeout", compute["scaleToZeroTimeoutMinutes"]),
        ("cache_http_responses", endpoint["cacheHttpResponses"]),
    ):
        require_equal(request, expected, name)

    custom_image = field(request, "custom_image")
    if not isinstance(custom_image, dict) or set(custom_image) != {
        "healthRoute",
        "port",
        "url",
    }:
        raise ReleaseValidationError("endpoint request custom image fields do not match policy")
    require_equal(request, image, "custom_image", "url")
    require_equal(request, container["port"], "custom_image", "port")
    require_equal(
        request,
        container["healthRoute"],
        "custom_image",
        "healthRoute",
    )

    plain_environment = field(request, "env")
    expected_plain = runtime["plainEnvironment"]
    required_plain_names = runtime["requiredPlainEnvironmentNames"]
    if not isinstance(plain_environment, dict) or set(plain_environment) != set(
        expected_plain
    ) | set(required_plain_names):
        raise ReleaseValidationError("endpoint request environment names do not match policy")
    for name, expected in expected_plain.items():
        require_equal(request, expected, "env", name)
    for name in required_plain_names:
        value = field(request, "env", name)
        if not isinstance(value, str) or validate_storage_hosts(value) != value:
            raise ReleaseValidationError(
                "endpoint request storage host allowlist is not normalized"
            )

    secrets = field(request, "secrets")
    if not isinstance(secrets, dict) or set(secrets) != set(runtime["requiredSecretNames"]):
        raise ReleaseValidationError("endpoint request secret names do not match policy")
    validate_endpoint_secret(field(request, "secrets", "SIGNAL_ENDPOINT_SECRET"))


def create_endpoint(api: Any, request: dict[str, Any], policy: Any, image: str) -> str:
    validate_endpoint_request(request, policy, image)
    endpoint = api.create_inference_endpoint(**request)
    try:
        endpoint.fetch()
        validate_endpoint_snapshot(endpoint.raw, policy, image)
    except Exception as validation_error:
        try:
            api.delete_inference_endpoint(
                request["name"], namespace=getattr(endpoint, "namespace", None)
            )
        except Exception:
            raise ReleaseValidationError(
                "endpoint post-create validation failed and automatic rollback failed; "
                "delete the digest-named endpoint immediately"
            ) from validation_error
        raise ReleaseValidationError(
            "endpoint post-create validation failed; the new endpoint was deleted"
        ) from validation_error
    return request["name"]


def main() -> int:
    image = os.environ.get("HF_ENDPOINT_IMAGE", "")
    hosts = os.environ.get("SIGNAL_ALLOWED_STORAGE_HOSTS", "")
    secrets_path = os.environ.get("HF_ENDPOINT_SECRETS_FILE", "")
    if not secrets_path:
        raise SystemExit("worker endpoint deployment failed: secrets file is not configured")

    try:
        policy = load_json(POLICY_PATH)
        secret = load_endpoint_secret(Path(secrets_path))
        request = build_endpoint_request(policy, image, hosts, secret)
        from huggingface_hub import HfApi

        name = create_endpoint(HfApi(), request, policy, image)
    except (ReleaseValidationError, ImportError) as error:
        raise SystemExit(f"worker endpoint deployment failed: {error}") from error
    except Exception:
        raise SystemExit(
            "worker endpoint deployment failed: provider request failed; "
            "inspect the protected provider logs"
        ) from None

    print(f"Created and validated Hugging Face endpoint {name}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
