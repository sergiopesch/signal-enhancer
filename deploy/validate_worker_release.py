#!/usr/bin/env python3
"""Validate the checked-in HF policy and optional release evidence without printing secrets."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
WORKER_SOURCE = REPOSITORY_ROOT / "worker" / "src"
sys.path.insert(0, str(WORKER_SOURCE))

from signal_enhancer_worker.config import (  # noqa: E402
    DEFAULT_RESEMBLE_CHECKPOINT_SHA256,
    DEFAULT_RESEMBLE_MODEL_REVISION,
    DEFAULT_RESEMBLE_SOURCE_REVISION,
)

IMAGE_REFERENCE = re.compile(
    r"^[a-z0-9][a-z0-9._-]*(?::[0-9]+)?/"
    r"[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$"
)
GIT_REVISION = re.compile(r"^[0-9a-f]{40}$")
ENVIRONMENT_NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")
HF_TOKEN = re.compile(r"hf_[A-Za-z0-9]{20,}")


class ReleaseValidationError(ValueError):
    """A safe validation failure that never includes the rejected value."""


def load_json(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as source:
            return json.load(source)
    except (OSError, json.JSONDecodeError) as error:
        raise ReleaseValidationError(f"{path.name}: unreadable JSON") from error


def field(document: Any, *path: str) -> Any:
    current = document
    for segment in path:
        if not isinstance(current, dict) or segment not in current:
            raise ReleaseValidationError(f"missing field: {'.'.join(path)}")
        current = current[segment]
    return current


def require_equal(document: Any, expected: Any, *path: str) -> None:
    if field(document, *path) != expected:
        raise ReleaseValidationError(f"unexpected field: {'.'.join(path)}")


def require_unset(document: Any, *path: str) -> None:
    current = document
    for segment in path[:-1]:
        if not isinstance(current, dict) or segment not in current:
            return
        current = current[segment]
    if isinstance(current, dict) and current.get(path[-1]) not in (None, []):
        raise ReleaseValidationError(f"unexpected override: {'.'.join(path)}")


def validate_no_secret_material(document: Any) -> None:
    serialized = json.dumps(document, separators=(",", ":"))
    if HF_TOKEN.search(serialized):
        raise ReleaseValidationError("policy contains token-like material")

    runtime = field(document, "endpoint", "runtime")
    allowed_sensitive_key = "requiredSecretNames"
    for key in runtime:
        if (
            re.search(r"secret|token|password|credential", key, re.IGNORECASE)
            and key != allowed_sensitive_key
        ):
            raise ReleaseValidationError("policy contains a secret-value field")
    secret_names = field(document, "endpoint", "runtime", allowed_sensitive_key)
    if secret_names != ["SIGNAL_ENDPOINT_SECRET"] or not all(
        isinstance(name, str) and ENVIRONMENT_NAME.fullmatch(name) for name in secret_names
    ):
        raise ReleaseValidationError("unexpected required secret names")


def validate_policy(document: Any) -> None:
    require_equal(document, "1", "schemaVersion")
    require_equal(document, "signal-enhancer-worker", "service")
    require_equal(document, "signal-enhancer-", "endpoint", "namePrefix")
    require_equal(document, "protected", "endpoint", "access", "policy")
    require_equal(document, "authenticated", "endpoint", "access", "hfEndpointType")
    require_equal(document, False, "endpoint", "access", "privateLinkEnabled")
    require_equal(document, False, "endpoint", "cacheHttpResponses")
    require_equal(document, "aws", "endpoint", "provider", "vendor")
    require_equal(document, "eu-west-1", "endpoint", "provider", "region")
    require_equal(document, "gpu", "endpoint", "compute", "accelerator")
    require_equal(document, "nvidia-l4", "endpoint", "compute", "instanceType")
    require_equal(document, "x1", "endpoint", "compute", "instanceSize")
    require_equal(document, 0, "endpoint", "compute", "minReplica")
    require_equal(document, 1, "endpoint", "compute", "maxReplica")
    require_equal(document, 15, "endpoint", "compute", "scaleToZeroTimeoutMinutes")
    require_equal(
        document,
        "ResembleAI/resemble-enhance",
        "endpoint",
        "model",
        "repository",
    )
    require_equal(document, "custom", "endpoint", "model", "framework")
    require_equal(
        document,
        DEFAULT_RESEMBLE_MODEL_REVISION,
        "endpoint",
        "model",
        "revision",
    )
    require_equal(
        document,
        DEFAULT_RESEMBLE_CHECKPOINT_SHA256,
        "endpoint",
        "model",
        "checkpointSha256",
    )
    require_equal(document, "linux/amd64", "endpoint", "container", "platform")
    require_equal(document, None, "endpoint", "container", "imageReference")
    require_equal(document, "digest-only", "endpoint", "container", "imageReferencePolicy")
    require_equal(document, 7860, "endpoint", "container", "port")
    require_equal(document, "/health", "endpoint", "container", "healthRoute")

    expected_plain_environment = {
        "SIGNAL_ENVIRONMENT": "production",
        "SIGNAL_ENGINE": "resemble",
        "SIGNAL_ALLOW_DSP_FALLBACK": "false",
        "SIGNAL_RESEMBLE_RUN_DIR": "/repository/enhancer_stage2",
        "SIGNAL_RESEMBLE_DEVICE": "cuda",
        "SIGNAL_RESEMBLE_SOURCE_REVISION": DEFAULT_RESEMBLE_SOURCE_REVISION,
        "SIGNAL_RESEMBLE_MODEL_REVISION": DEFAULT_RESEMBLE_MODEL_REVISION,
    }
    require_equal(
        document,
        expected_plain_environment,
        "endpoint",
        "runtime",
        "plainEnvironment",
    )
    require_equal(
        document,
        ["SIGNAL_ALLOWED_STORAGE_HOSTS"],
        "endpoint",
        "runtime",
        "requiredPlainEnvironmentNames",
    )
    validate_no_secret_material(document)


def validate_image_reference(reference: str) -> None:
    if not IMAGE_REFERENCE.fullmatch(reference):
        raise ReleaseValidationError(
            "image reference must be registry/name@sha256:<64 lowercase hex>"
        )


def expected_endpoint_name(policy: Any, image_reference: str) -> str:
    validate_image_reference(image_reference)
    image_digest = image_reference.rsplit("@sha256:", maxsplit=1)[1]
    return f"{field(policy, 'endpoint', 'namePrefix')}{image_digest[:12]}"


def validate_inspect(document: Any, policy: Any, build_revision: str) -> None:
    if not GIT_REVISION.fullmatch(build_revision):
        raise ReleaseValidationError("expected build revision must be a full lowercase Git SHA")
    if not isinstance(document, list) or len(document) != 1 or not isinstance(document[0], dict):
        raise ReleaseValidationError("Docker inspect evidence has an unexpected shape")

    image = document[0]
    require_equal(image, "linux", "Os")
    require_equal(image, "amd64", "Architecture")
    require_equal(image, "10001:10001", "Config", "User")
    require_equal(image, build_revision, "Config", "Labels", "org.opencontainers.image.revision")
    require_equal(image, "1", "Config", "Labels", "io.signal-enhancer.resemble-installed")
    require_equal(
        image,
        field(policy, "endpoint", "runtime", "plainEnvironment")["SIGNAL_RESEMBLE_SOURCE_REVISION"],
        "Config",
        "Labels",
        "io.signal-enhancer.resemble-source-revision",
    )
    require_equal(
        image,
        field(policy, "endpoint", "model", "revision"),
        "Config",
        "Labels",
        "io.signal-enhancer.resemble-model-revision",
    )
    require_equal(
        image,
        field(policy, "endpoint", "model", "checkpointSha256"),
        "Config",
        "Labels",
        "io.signal-enhancer.resemble-checkpoint-sha256",
    )
    if "7860/tcp" not in field(image, "Config", "ExposedPorts"):
        raise ReleaseValidationError("worker image does not expose port 7860/tcp")
    image_environment = field(image, "Config", "Env")
    if not isinstance(image_environment, list) or not all(
        isinstance(item, str) for item in image_environment
    ):
        raise ReleaseValidationError("worker image environment has an unexpected shape")
    parsed_environment: dict[str, str] = {}
    for item in image_environment:
        name, separator, value = item.partition("=")
        if not separator or not ENVIRONMENT_NAME.fullmatch(name) or name in parsed_environment:
            raise ReleaseValidationError("worker image environment entries are invalid")
        parsed_environment[name] = value
    required_environment = {
        "HOME": "/var/lib/signal-enhancer",
        "XDG_CACHE_HOME": "/var/lib/signal-enhancer/cache",
        "TRITON_CACHE_DIR": "/var/lib/signal-enhancer/cache/triton",
        "SIGNAL_TMP_ROOT": "/tmp/signal-enhancer",  # noqa: S108 - dedicated 0700 dir
        "SIGNAL_BUILD_REVISION": build_revision,
    }
    if any(parsed_environment.get(name) != value for name, value in required_environment.items()):
        raise ReleaseValidationError("worker image required runtime environment is missing")
    health_test = field(image, "Config", "Healthcheck", "Test")
    if not isinstance(health_test, list) or not any(
        "http://127.0.0.1:7860/health" in item for item in health_test if isinstance(item, str)
    ):
        raise ReleaseValidationError(
            "worker image health check does not target /health on port 7860"
        )


def validate_endpoint_snapshot(document: Any, policy: Any, expected_image: str) -> None:
    # The HF API now calls the formerly "protected" access level "authenticated".
    # Its documented EndpointWithStatus response does not expose accountId or the
    # cacheHttpResponses request setting. Those request-only invariants are checked
    # before provisioning; this function validates only fields the response can prove.
    require_equal(document, expected_endpoint_name(policy, expected_image), "name")
    require_equal(document, "authenticated", "type")
    for path in (
        ("domain",),
        ("path",),
        ("route", "domain"),
        ("route", "path"),
        ("model", "task"),
        ("model", "command"),
        ("model", "args"),
    ):
        require_unset(document, *path)
    if isinstance(document, dict) and "cacheHttpResponses" in document:
        require_equal(
            document,
            field(policy, "endpoint", "cacheHttpResponses"),
            "cacheHttpResponses",
        )
    require_equal(
        document,
        field(policy, "endpoint", "container", "healthRoute"),
        "healthRoute",
    )
    for path in (
        ("provider", "vendor"),
        ("provider", "region"),
        ("compute", "accelerator"),
        ("compute", "instanceType"),
        ("compute", "instanceSize"),
    ):
        require_equal(document, field(policy, "endpoint", *path), *path)
    for name in ("minReplica", "maxReplica"):
        require_equal(
            document,
            field(policy, "endpoint", "compute", name),
            "compute",
            "scaling",
            name,
        )
    require_equal(
        document,
        field(policy, "endpoint", "compute", "scaleToZeroTimeoutMinutes"),
        "compute",
        "scaling",
        "scaleToZeroTimeout",
    )
    require_equal(
        document,
        field(policy, "endpoint", "model", "repository"),
        "model",
        "repository",
    )
    require_equal(
        document,
        field(policy, "endpoint", "model", "framework"),
        "model",
        "framework",
    )
    require_equal(
        document,
        field(policy, "endpoint", "model", "revision"),
        "model",
        "revision",
    )
    require_equal(
        document,
        field(policy, "endpoint", "container", "port"),
        "model",
        "image",
        "custom",
        "port",
    )
    require_equal(
        document,
        field(policy, "endpoint", "container", "healthRoute"),
        "model",
        "image",
        "custom",
        "healthRoute",
    )
    image_reference = field(document, "model", "image", "custom", "url")
    if not isinstance(image_reference, str):
        raise ReleaseValidationError("endpoint image reference is missing")
    validate_image_reference(image_reference)
    if image_reference != expected_image:
        raise ReleaseValidationError("endpoint image digest differs from the approved release")
    custom_image = field(document, "model", "image", "custom")
    required_custom_image_fields = {
        "healthRoute",
        "port",
        "url",
    }
    allowed_custom_image_fields = required_custom_image_fields | {"credentials"}
    if (
        not isinstance(custom_image, dict)
        or not required_custom_image_fields.issubset(custom_image)
        or not set(custom_image).issubset(allowed_custom_image_fields)
        or custom_image.get("credentials") is not None
    ):
        raise ReleaseValidationError("endpoint custom image fields do not match policy")

    plain_environment = field(document, "model", "env")
    if not isinstance(plain_environment, dict):
        raise ReleaseValidationError("endpoint plain environment has an unexpected shape")
    expected_plain = field(policy, "endpoint", "runtime", "plainEnvironment")
    required_plain_names = field(policy, "endpoint", "runtime", "requiredPlainEnvironmentNames")
    expected_plain_names = set(expected_plain) | set(required_plain_names)
    if set(plain_environment) != expected_plain_names:
        raise ReleaseValidationError("endpoint plain environment names do not match policy")
    for name, value in expected_plain.items():
        if plain_environment.get(name) != value:
            raise ReleaseValidationError(f"endpoint plain environment mismatch: {name}")
    for name in required_plain_names:
        if not isinstance(plain_environment.get(name), str) or not plain_environment[name].strip():
            raise ReleaseValidationError(f"endpoint plain environment missing: {name}")

    secrets = field(document, "model", "secrets")
    if not isinstance(secrets, dict) or set(secrets) != set(
        field(policy, "endpoint", "runtime", "requiredSecretNames")
    ):
        raise ReleaseValidationError("endpoint secret names do not match policy")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--policy",
        type=Path,
        default=REPOSITORY_ROOT / "deploy" / "huggingface-endpoint.production.json",
    )
    parser.add_argument("--image-reference")
    parser.add_argument("--inspect-json", type=Path)
    parser.add_argument("--expected-build-revision")
    parser.add_argument("--endpoint-json", type=Path)
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    try:
        policy = load_json(arguments.policy)
        validate_policy(policy)
        if arguments.image_reference is not None:
            validate_image_reference(arguments.image_reference)
        if arguments.inspect_json is not None:
            if arguments.expected_build_revision is None:
                raise ReleaseValidationError("--inspect-json requires --expected-build-revision")
            validate_inspect(
                load_json(arguments.inspect_json),
                policy,
                arguments.expected_build_revision,
            )
        elif arguments.expected_build_revision is not None:
            raise ReleaseValidationError("--expected-build-revision requires --inspect-json")
        if arguments.endpoint_json is not None:
            if arguments.image_reference is None:
                raise ReleaseValidationError("--endpoint-json requires --image-reference")
            validate_endpoint_snapshot(
                load_json(arguments.endpoint_json),
                policy,
                arguments.image_reference,
            )
    except ReleaseValidationError as error:
        print(f"worker release validation failed: {error}", file=sys.stderr)
        return 1
    print("worker release policy and supplied evidence are valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
