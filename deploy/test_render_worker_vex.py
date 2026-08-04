from __future__ import annotations

import ast
import copy
import re
import unittest
from pathlib import Path

from render_worker_vex import VexRenderError, load_json, render_vex

POLICY_PATH = Path(__file__).with_name("worker.openvex.json")
REPOSITORY_ROOT = POLICY_PATH.parent.parent
WORKER_SOURCE = REPOSITORY_ROOT / "worker" / "src"
IMAGE_PURL = (
    "pkg:oci/local%2Fsignal-enhancer-worker@sha256%3A" + "a" * 64 + "?arch=amd64&tag=release"
)
EXPECTED_CVES = {
    "CVE-2025-69720",
    "CVE-2026-11822",
    "CVE-2026-11824",
    "CVE-2026-11940",
    "CVE-2026-11972",
    "CVE-2026-12087",
    "CVE-2026-13221",
    "CVE-2026-15308",
    "CVE-2026-3298",
    "CVE-2026-3644",
    "CVE-2026-37555",
    "CVE-2026-41992",
    "CVE-2026-4224",
    "CVE-2026-42496",
    "CVE-2026-42497",
    "CVE-2026-4786",
    "CVE-2026-48959",
    "CVE-2026-48961",
    "CVE-2026-48962",
    "CVE-2026-5435",
    "CVE-2026-54369",
    "CVE-2026-54370",
    "CVE-2026-5450",
    "CVE-2026-57432",
    "CVE-2026-57433",
    "CVE-2026-5928",
    "CVE-2026-6100",
    "CVE-2026-7017",
    "CVE-2026-7210",
    "CVE-2026-8376",
    "CVE-2026-9538",
    "CVE-2026-9669",
}
FORBIDDEN_RUNTIME_MODULES = {
    "bz2",
    "cffi",
    "ctypes",
    "gzip",
    "html.parser",
    "http.cookies",
    "lzma",
    "soundfile",
    "sqlite3",
    "subprocess",
    "tarfile",
    "webbrowser",
    "xml",
}


class WorkerVexTests(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = load_json(POLICY_PATH)

    def sbom(self) -> dict[str, object]:
        component_purls = {
            product["@id"]
            for statement in self.policy["statements"]
            for product in statement["products"]
        }
        packages: list[dict[str, object]] = [
            {
                "SPDXID": "SPDXRef-DocumentRoot-Image",
                "externalRefs": [{"referenceType": "purl", "referenceLocator": IMAGE_PURL}],
            }
        ]
        packages.extend(
            {
                "SPDXID": f"SPDXRef-Component-{index}",
                "externalRefs": [{"referenceType": "purl", "referenceLocator": purl}],
            }
            for index, purl in enumerate(sorted(component_purls))
        )
        return {
            "packages": packages,
            "relationships": [
                {
                    "spdxElementId": "SPDXRef-DOCUMENT",
                    "relatedSpdxElement": "SPDXRef-DocumentRoot-Image",
                    "relationshipType": "DESCRIBES",
                }
            ],
        }

    def test_checked_in_policy_is_exact_and_reviewable(self) -> None:
        actual_cves = {
            statement["vulnerability"]["name"] for statement in self.policy["statements"]
        }
        self.assertEqual(EXPECTED_CVES, actual_cves)
        rendered = render_vex(self.policy, self.sbom())
        self.assertEqual(len(EXPECTED_CVES), len(rendered["statements"]))

    def test_worker_source_preserves_reviewed_execution_boundaries(self) -> None:
        violations: list[str] = []
        for source_path in sorted(WORKER_SOURCE.rglob("*.py")):
            source = source_path.read_text(encoding="utf-8")
            tree = ast.parse(source, filename=str(source_path))
            imported: set[str] = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imported.update(alias.name for alias in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    imported.add(node.module)
                elif isinstance(node, ast.Call):
                    if (
                        isinstance(node.func, ast.Attribute)
                        and isinstance(node.func.value, ast.Name)
                        and node.func.value.id == "os"
                        and node.func.attr in {"popen", "system"}
                    ):
                        violations.append(f"{source_path}: os.{node.func.attr}")
                    if (
                        isinstance(node.func, ast.Attribute)
                        and node.func.attr == "import_module"
                        and node.args
                        and isinstance(node.args[0], ast.Constant)
                        and isinstance(node.args[0].value, str)
                    ):
                        imported.add(node.args[0].value)
                elif isinstance(node, ast.Attribute) and node.attr in {"cookies", "js_output"}:
                    violations.append(f"{source_path}: .{node.attr}")
            for module in imported:
                if any(
                    module == forbidden or module.startswith(forbidden + ".")
                    for forbidden in FORBIDDEN_RUNTIME_MODULES
                ):
                    violations.append(f"{source_path}: import {module}")
            if any(symbol in source for symbol in ("fp_nquery", "ns_printrr", "ns_printrrf")):
                violations.append(f"{source_path}: forbidden native symbol lookup")
            allocating_widths = {
                int(match.group(1))
                for match in re.finditer(
                    r"%(?:[0-9]+\$)?['I]*([0-9]+)m(?:lc|[cC])",
                    source,
                )
            }
            if any(width > 1024 for width in allocating_widths):
                violations.append(f"{source_path}: allocating scanf format")
        self.assertEqual([], violations)

    def test_base_and_policy_are_pinned_to_the_reviewed_trixie_release(self) -> None:
        dockerfile = (REPOSITORY_ROOT / "worker" / "Dockerfile").read_text(encoding="utf-8")
        expected = (
            "FROM --platform=linux/amd64 "
            "python:3.12.13-slim-trixie@sha256:"
            "57cd7c3a7a273101a6485ba99423ee568157882804b1124b4dd04266317710de"
        )
        self.assertEqual(2, dockerfile.count(expected))
        self.assertNotIn("bookworm", dockerfile)

    def test_renderer_rejects_a_changed_boundary_manifest(self) -> None:
        candidate = copy.deepcopy(self.policy)
        candidate["x-signal-enhancer-boundary"]["paths"]["worker/Dockerfile"] = "0" * 64
        with self.assertRaises(VexRenderError):
            render_vex(candidate, self.sbom())

    def test_renderer_preserves_exact_package_products_and_records_image(self) -> None:
        rendered = render_vex(self.policy, self.sbom())
        for source, statement in zip(
            self.policy["statements"], rendered["statements"], strict=True
        ):
            self.assertEqual(source["products"], statement["products"])
            self.assertNotIn("subcomponents", statement["products"][0])
        self.assertEqual({"purl": IMAGE_PURL}, rendered["x-signal-enhancer-image"])
        self.assertEqual(
            self.policy["x-signal-enhancer-boundary"],
            rendered["x-signal-enhancer-boundary"],
        )
        self.assertTrue(rendered["@id"].startswith("urn:uuid:"))

    def test_renderer_rejects_a_missing_or_changed_component(self) -> None:
        sbom = self.sbom()
        packages = sbom["packages"]
        self.assertIsInstance(packages, list)
        packages.pop()
        with self.assertRaises(VexRenderError):
            render_vex(self.policy, sbom)

    def test_renderer_rejects_an_exact_component_version_mismatch(self) -> None:
        sbom = self.sbom()
        packages = sbom["packages"]
        self.assertIsInstance(packages, list)
        python_package = next(
            package
            for package in packages
            if package.get("externalRefs", [{}])[0].get("referenceLocator")
            == "pkg:generic/python@3.12.13"
        )
        python_package["externalRefs"][0]["referenceLocator"] = "pkg:generic/python@3.12.12"
        with self.assertRaises(VexRenderError):
            render_vex(self.policy, sbom)

    def test_renderer_rejects_a_tag_only_or_wrong_arch_image(self) -> None:
        for replacement in (
            "pkg:oci/local%2Fsignal-enhancer-worker@release?arch=amd64",
            IMAGE_PURL.replace("arch=amd64", "arch=arm64"),
        ):
            sbom = self.sbom()
            candidate = copy.deepcopy(sbom)
            candidate["packages"][0]["externalRefs"][0]["referenceLocator"] = replacement
            with self.subTest(replacement=replacement), self.assertRaises(VexRenderError):
                render_vex(self.policy, candidate)


if __name__ == "__main__":
    unittest.main()
