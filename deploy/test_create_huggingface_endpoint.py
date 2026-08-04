from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from typing import Any

from create_huggingface_endpoint import (
    build_endpoint_request,
    create_endpoint,
    load_endpoint_secret,
    validate_endpoint_request,
    validate_storage_hosts,
)
from validate_worker_release import ReleaseValidationError, load_json

POLICY_PATH = Path(__file__).with_name("huggingface-endpoint.production.json")
VALID_IMAGE = "ghcr.io/example/signal-enhancer-worker@sha256:" + "c" * 64


class FakeEndpoint:
    def __init__(self, raw: dict[str, Any]) -> None:
        self.raw = raw
        self.namespace = "test-namespace"
        self.fetch_calls = 0

    def fetch(self) -> None:
        self.fetch_calls += 1


class FakeApi:
    def __init__(self, raw: dict[str, Any], *, fail_delete: bool = False) -> None:
        self.endpoint = FakeEndpoint(raw)
        self.fail_delete = fail_delete
        self.create_requests: list[dict[str, Any]] = []
        self.delete_requests: list[tuple[str, str | None]] = []

    def create_inference_endpoint(self, **request: Any) -> FakeEndpoint:
        self.create_requests.append(request)
        return self.endpoint

    def delete_inference_endpoint(self, name: str, *, namespace: str | None = None) -> None:
        self.delete_requests.append((name, namespace))
        if self.fail_delete:
            raise RuntimeError("provider deletion failed")


class CreateHuggingFaceEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = load_json(POLICY_PATH)

    def test_request_is_locked_to_the_reviewed_policy(self) -> None:
        request = build_endpoint_request(
            self.policy,
            VALID_IMAGE,
            "private-store.private.blob.vercel-storage.com,blob.vercel-storage.com",
            "s" * 40,
        )

        self.assertEqual(request["name"], "signal-enhancer-" + "c" * 12)
        self.assertEqual(request["accelerator"], "gpu")
        self.assertEqual(request["instance_type"], "nvidia-l4")
        self.assertEqual(request["instance_size"], "x1")
        self.assertEqual(request["vendor"], "aws")
        self.assertEqual(request["region"], "eu-west-1")
        self.assertEqual(request["min_replica"], 0)
        self.assertEqual(request["max_replica"], 1)
        self.assertEqual(request["scale_to_zero_timeout"], 15)
        self.assertIs(request["cache_http_responses"], False)
        self.assertNotIn("task", request)
        validate_endpoint_request(request, self.policy, VALID_IMAGE)

    def endpoint_snapshot(self, request: dict[str, Any]) -> dict[str, Any]:
        return {
            "name": request["name"],
            "type": request["type"],
            "route": {},
            "healthRoute": request["custom_image"]["healthRoute"],
            "provider": {
                "vendor": request["vendor"],
                "region": request["region"],
            },
            "compute": {
                "accelerator": request["accelerator"],
                "instanceType": request["instance_type"],
                "instanceSize": request["instance_size"],
                "scaling": {
                    "minReplica": request["min_replica"],
                    "maxReplica": request["max_replica"],
                    "scaleToZeroTimeout": request["scale_to_zero_timeout"],
                },
            },
            "model": {
                "repository": request["repository"],
                "framework": request["framework"],
                "revision": request["revision"],
                "image": {"custom": request["custom_image"]},
                "env": request["env"],
                "secrets": {"SIGNAL_ENDPOINT_SECRET": None},
            },
        }

    def production_request(self) -> dict[str, Any]:
        return build_endpoint_request(
            self.policy,
            VALID_IMAGE,
            "private-store.private.blob.vercel-storage.com,blob.vercel-storage.com",
            "s" * 40,
        )

    def test_documented_provider_snapshot_is_accepted_without_request_only_fields(
        self,
    ) -> None:
        request = self.production_request()
        api = FakeApi(self.endpoint_snapshot(request))

        name = create_endpoint(api, request, self.policy, VALID_IMAGE)

        self.assertEqual(name, request["name"])
        self.assertEqual(api.endpoint.fetch_calls, 1)
        self.assertEqual(api.delete_requests, [])

    def test_tampered_request_is_rejected_before_provider_creation(self) -> None:
        request = self.production_request()
        request["cache_http_responses"] = True
        api = FakeApi(self.endpoint_snapshot(request))

        with self.assertRaises(ReleaseValidationError):
            create_endpoint(api, request, self.policy, VALID_IMAGE)

        self.assertEqual(api.create_requests, [])
        self.assertEqual(api.delete_requests, [])

    def test_invalid_post_create_snapshot_deletes_only_the_digest_named_endpoint(
        self,
    ) -> None:
        request = self.production_request()
        snapshot = self.endpoint_snapshot(request)
        snapshot["type"] = "public"
        api = FakeApi(snapshot)

        with self.assertRaisesRegex(ReleaseValidationError, "was deleted"):
            create_endpoint(api, request, self.policy, VALID_IMAGE)

        self.assertEqual(
            api.delete_requests,
            [(request["name"], "test-namespace")],
        )

    def test_failed_automatic_rollback_is_reported_without_provider_details(
        self,
    ) -> None:
        request = self.production_request()
        snapshot = self.endpoint_snapshot(request)
        snapshot["type"] = "public"
        api = FakeApi(snapshot, fail_delete=True)

        with self.assertRaisesRegex(ReleaseValidationError, "automatic rollback failed") as raised:
            create_endpoint(api, request, self.policy, VALID_IMAGE)

        self.assertNotIn("provider deletion failed", str(raised.exception))

    def test_secret_file_must_be_private_and_contain_one_value(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "endpoint.secrets"
            path.write_text(f"SIGNAL_ENDPOINT_SECRET={'s' * 40}\n", encoding="utf-8")
            path.chmod(0o600)
            self.assertEqual(load_endpoint_secret(path), "s" * 40)

            path.write_text(
                f"SIGNAL_ENDPOINT_SECRET={'s' * 40}\nEXTRA_SECRET=forbidden\n",
                encoding="utf-8",
            )
            with self.assertRaises(ReleaseValidationError):
                load_endpoint_secret(path)

            path.write_text(f"SIGNAL_ENDPOINT_SECRET={'s' * 40}\n", encoding="utf-8")
            path.chmod(0o644)
            with self.assertRaises(ReleaseValidationError):
                load_endpoint_secret(path)

    def test_storage_hosts_must_be_exact_and_unique(self) -> None:
        self.assertEqual(
            validate_storage_hosts("DATA.EXAMPLE.,control.example"),
            "data.example,control.example",
        )
        for value in (
            "",
            "*.example",
            "https://data.example",
            "data.example,data.example",
        ):
            with self.subTest(value=value), self.assertRaises(ReleaseValidationError):
                validate_storage_hosts(value)


if __name__ == "__main__":
    unittest.main()
