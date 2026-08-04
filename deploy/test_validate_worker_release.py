from __future__ import annotations

import copy
import unittest
from pathlib import Path

from validate_worker_release import (
    ReleaseValidationError,
    load_json,
    validate_endpoint_snapshot,
    validate_image_reference,
    validate_inspect,
    validate_policy,
)

POLICY_PATH = Path(__file__).with_name("huggingface-endpoint.production.json")
VALID_IMAGE = "ghcr.io/example/signal-enhancer-worker@sha256:" + "b" * 64


class WorkerReleaseValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = load_json(POLICY_PATH)

    def endpoint_snapshot(self) -> dict[str, object]:
        endpoint_policy = self.policy["endpoint"]
        compute = endpoint_policy["compute"]
        runtime = endpoint_policy["runtime"]
        return {
            "name": endpoint_policy["namePrefix"] + "b" * 12,
            "type": "authenticated",
            "route": {},
            "healthRoute": endpoint_policy["container"]["healthRoute"],
            "provider": endpoint_policy["provider"],
            "compute": {
                "accelerator": compute["accelerator"],
                "instanceType": compute["instanceType"],
                "instanceSize": compute["instanceSize"],
                "scaling": {
                    "minReplica": compute["minReplica"],
                    "maxReplica": compute["maxReplica"],
                    "scaleToZeroTimeout": compute["scaleToZeroTimeoutMinutes"],
                },
            },
            "model": {
                "repository": endpoint_policy["model"]["repository"],
                "framework": endpoint_policy["model"]["framework"],
                "revision": endpoint_policy["model"]["revision"],
                "image": {
                    "custom": {
                        "port": endpoint_policy["container"]["port"],
                        "healthRoute": endpoint_policy["container"]["healthRoute"],
                        "url": VALID_IMAGE,
                        "credentials": None,
                    }
                },
                "env": {
                    **runtime["plainEnvironment"],
                    "SIGNAL_ALLOWED_STORAGE_HOSTS": "data.invalid,control.invalid",
                },
                "secrets": {"SIGNAL_ENDPOINT_SECRET": "redacted-by-provider"},
            },
        }

    def image_inspect(self) -> list[dict[str, object]]:
        endpoint_policy = self.policy["endpoint"]
        build_revision = "a" * 40
        return [
            {
                "Os": "linux",
                "Architecture": "amd64",
                "Config": {
                    "User": "10001:10001",
                    "Labels": {
                        "org.opencontainers.image.revision": build_revision,
                        "io.signal-enhancer.resemble-installed": "1",
                        "io.signal-enhancer.resemble-source-revision": endpoint_policy["runtime"][
                            "plainEnvironment"
                        ]["SIGNAL_RESEMBLE_SOURCE_REVISION"],
                        "io.signal-enhancer.resemble-model-revision": endpoint_policy["model"][
                            "revision"
                        ],
                        "io.signal-enhancer.resemble-checkpoint-sha256": endpoint_policy["model"][
                            "checkpointSha256"
                        ],
                    },
                    "ExposedPorts": {"7860/tcp": {}},
                    "Env": [
                        "HOME=/var/lib/signal-enhancer",
                        "XDG_CACHE_HOME=/var/lib/signal-enhancer/cache",
                        "TRITON_CACHE_DIR=/var/lib/signal-enhancer/cache/triton",
                        "SIGNAL_TMP_ROOT=/tmp/signal-enhancer",
                        f"SIGNAL_BUILD_REVISION={build_revision}",
                    ],
                    "Healthcheck": {
                        "Test": [
                            "CMD-SHELL",
                            "check http://127.0.0.1:7860/health",
                        ]
                    },
                },
            }
        ]

    def test_checked_in_policy_is_valid(self) -> None:
        validate_policy(self.policy)

    def test_worker_image_requires_the_runtime_cache_environment_contract(self) -> None:
        inspect = self.image_inspect()
        validate_inspect(inspect, self.policy, "a" * 40)

        environment = inspect[0]["Config"]["Env"]
        self.assertIsInstance(environment, list)
        for required in (
            "HOME=/var/lib/signal-enhancer",
            "XDG_CACHE_HOME=/var/lib/signal-enhancer/cache",
            "TRITON_CACHE_DIR=/var/lib/signal-enhancer/cache/triton",
            "SIGNAL_TMP_ROOT=/tmp/signal-enhancer",
        ):
            candidate = copy.deepcopy(inspect)
            candidate_environment = candidate[0]["Config"]["Env"]
            self.assertIsInstance(candidate_environment, list)
            candidate_environment.remove(required)
            with (
                self.subTest(required=required),
                self.assertRaises(ReleaseValidationError),
            ):
                validate_inspect(candidate, self.policy, "a" * 40)

    def test_worker_image_rejects_shadowed_or_wrong_runtime_cache_environment(self) -> None:
        for replacement, append in (
            ("HOME=/tmp", False),
            ("HOME=/tmp", True),
        ):
            candidate = self.image_inspect()
            environment = candidate[0]["Config"]["Env"]
            self.assertIsInstance(environment, list)
            if append:
                environment.append(replacement)
            else:
                environment[environment.index("HOME=/var/lib/signal-enhancer")] = replacement
            with self.subTest(duplicate=append), self.assertRaises(ReleaseValidationError):
                validate_inspect(candidate, self.policy, "a" * 40)

    def test_only_immutable_lowercase_digest_references_are_accepted(self) -> None:
        validate_image_reference(VALID_IMAGE)
        for reference in (
            "ghcr.io/example/signal-enhancer-worker:latest",
            "ghcr.io/example/signal-enhancer-worker@sha256:" + "A" * 64,
            "signal-enhancer-worker@sha256:" + "b" * 64,
        ):
            with self.subTest(reference=reference), self.assertRaises(ReleaseValidationError):
                validate_image_reference(reference)

    def test_public_endpoint_is_rejected_without_echoing_secret_values(self) -> None:
        snapshot = self.endpoint_snapshot()
        validate_endpoint_snapshot(snapshot, self.policy, VALID_IMAGE)
        snapshot["type"] = "public"
        with self.assertRaises(ReleaseValidationError) as raised:
            validate_endpoint_snapshot(snapshot, self.policy, VALID_IMAGE)
        self.assertNotIn("redacted-by-provider", str(raised.exception))

    def test_endpoint_name_is_derived_from_the_immutable_digest(self) -> None:
        snapshot = self.endpoint_snapshot()
        validate_endpoint_snapshot(snapshot, self.policy, VALID_IMAGE)
        snapshot["name"] = "signal-enhancer-production"
        with self.assertRaises(ReleaseValidationError):
            validate_endpoint_snapshot(snapshot, self.policy, VALID_IMAGE)

    def test_undocumented_cache_field_is_checked_when_the_provider_returns_it(
        self,
    ) -> None:
        snapshot = self.endpoint_snapshot()
        snapshot["cacheHttpResponses"] = False
        validate_endpoint_snapshot(snapshot, self.policy, VALID_IMAGE)
        snapshot["cacheHttpResponses"] = True
        with self.assertRaises(ReleaseValidationError):
            validate_endpoint_snapshot(snapshot, self.policy, VALID_IMAGE)

    def test_policy_cannot_embed_an_image_or_enable_fallback(self) -> None:
        for path, value in (
            (("container", "imageReference"), VALID_IMAGE),
            (("runtime", "plainEnvironment", "SIGNAL_ALLOW_DSP_FALLBACK"), "true"),
        ):
            candidate = copy.deepcopy(self.policy)
            target = candidate["endpoint"]
            for segment in path[:-1]:
                target = target[segment]
            target[path[-1]] = value
            with self.subTest(path=path), self.assertRaises(ReleaseValidationError):
                validate_policy(candidate)

    def test_endpoint_rejects_identity_and_entrypoint_overrides(self) -> None:
        for path, value in (
            (("model", "env", "SIGNAL_BUILD_REVISION"), "a" * 40),
            (("model", "command"), ["python", "unexpected.py"]),
            (("model", "args"), ["--unsafe"]),
            (("model", "task"), "text-generation"),
            (("domain",), "alternate.example"),
            (("path",), "/alternate"),
            (("route", "domain"), "alternate.example"),
            (("route", "path"), "/alternate"),
        ):
            snapshot = self.endpoint_snapshot()
            target = snapshot
            for segment in path[:-1]:
                target = target[segment]
            target[path[-1]] = value
            with self.subTest(path=path), self.assertRaises(ReleaseValidationError):
                validate_endpoint_snapshot(snapshot, self.policy, VALID_IMAGE)


if __name__ == "__main__":
    unittest.main()
