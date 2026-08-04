#!/usr/bin/env python3
"""Validate and issue exact-package VEX for one immutable image SBOM."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
OCI_DIGEST_PURL = re.compile(r"^pkg:oci/.+@sha256%3A[0-9a-f]{64}(?:\?.*)?$")
CVE_NAME = re.compile(r"^CVE-[0-9]{4}-[0-9]{4,}$")
APPROVED_JUSTIFICATIONS = {
    "inline_mitigations_already_exist",
    "vulnerable_code_not_in_execute_path",
    "vulnerable_code_not_present",
}
MAX_REVIEW_AGE = timedelta(days=90)
BOUNDARY_PATHS = {
    ".github/workflows/ci.yml",
    ".github/workflows/publish-worker.yml",
    "deploy/render_worker_vex.py",
    "deploy/test_render_worker_vex.py",
    "deploy/test_verify_worker_native_boundary.py",
    "deploy/test_verify_worker_vex_results.py",
    "deploy/verify_worker_native_boundary.py",
    "deploy/verify_worker_vex_results.py",
    "deploy/verify_worker_vex_scan.sh",
    "worker/.dockerignore",
    "worker/Dockerfile",
    "worker/pyproject.toml",
    "worker/src",
    "worker/tests/test_wav.py",
    "worker/uv.lock",
}
IGNORED_BOUNDARY_NAMES = {".DS_Store", "__pycache__"}
IGNORED_BOUNDARY_SUFFIXES = {".pyc", ".pyo"}


class VexRenderError(ValueError):
    """The policy or SBOM cannot produce narrowly scoped VEX evidence."""


def load_json(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as source:
            return json.load(source)
    except (OSError, json.JSONDecodeError) as error:
        raise VexRenderError(f"{path.name}: unreadable JSON") from error


def _package_purls(package: Any) -> tuple[str, ...]:
    if not isinstance(package, dict):
        return ()
    references = package.get("externalRefs", [])
    if not isinstance(references, list):
        return ()
    return tuple(
        reference["referenceLocator"]
        for reference in references
        if isinstance(reference, dict)
        and reference.get("referenceType") == "purl"
        and isinstance(reference.get("referenceLocator"), str)
    )


def _boundary_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    if path.is_file() and not path.is_symlink():
        digest.update(path.read_bytes())
        return digest.hexdigest()
    if not path.is_dir() or path.is_symlink():
        raise VexRenderError("reviewed boundary path is missing or unsafe")
    candidates = sorted(path.rglob("*"))
    if any(candidate.is_symlink() for candidate in candidates):
        raise VexRenderError("reviewed boundary directory contains a symlink")
    files = [
        candidate
        for candidate in candidates
        if candidate.is_file()
        and not any(part in IGNORED_BOUNDARY_NAMES for part in candidate.parts)
        and candidate.suffix not in IGNORED_BOUNDARY_SUFFIXES
    ]
    if not files:
        raise VexRenderError("reviewed boundary directory has no source files")
    for candidate in files:
        relative = candidate.relative_to(path).as_posix().encode()
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        contents = candidate.read_bytes()
        digest.update(len(contents).to_bytes(8, "big"))
        digest.update(contents)
    return digest.hexdigest()


def _validate_reviewed_boundary(policy: Any, repository_root: Path) -> None:
    boundary = policy.get("x-signal-enhancer-boundary") if isinstance(policy, dict) else None
    if not isinstance(boundary, dict) or boundary.get("algorithm") != "sha256":
        raise VexRenderError("component policy has no reviewed boundary manifest")
    expected = boundary.get("paths")
    if not isinstance(expected, dict) or set(expected) != BOUNDARY_PATHS:
        raise VexRenderError("component policy boundary paths are incomplete")
    for relative_path, expected_sha256 in expected.items():
        if (
            not isinstance(expected_sha256, str)
            or not re.fullmatch(r"[0-9a-f]{64}", expected_sha256)
            or _boundary_sha256(repository_root / relative_path) != expected_sha256
        ):
            raise VexRenderError("reviewed execution boundary changed")


def _root_image_purl(sbom: Any) -> str:
    if not isinstance(sbom, dict):
        raise VexRenderError("SBOM root must be an object")
    relationships = sbom.get("relationships", [])
    packages = sbom.get("packages", [])
    if not isinstance(relationships, list) or not isinstance(packages, list):
        raise VexRenderError("SBOM packages or relationships are invalid")

    described_ids = {
        relationship.get("relatedSpdxElement")
        for relationship in relationships
        if isinstance(relationship, dict)
        and relationship.get("spdxElementId") == "SPDXRef-DOCUMENT"
        and relationship.get("relationshipType") == "DESCRIBES"
        and isinstance(relationship.get("relatedSpdxElement"), str)
    }
    candidates: list[str] = []
    for package in packages:
        if not isinstance(package, dict) or package.get("SPDXID") not in described_ids:
            continue
        candidates.extend(purl for purl in _package_purls(package) if purl.startswith("pkg:oci/"))
    if len(candidates) != 1 or not OCI_DIGEST_PURL.fullmatch(candidates[0]):
        raise VexRenderError("SBOM must describe exactly one digest-scoped OCI image")
    qualifiers = parse_qs(urlsplit(candidates[0]).query, keep_blank_values=True)
    if qualifiers.get("arch") != ["amd64"]:
        raise VexRenderError("SBOM image PURL must be scoped to amd64")
    return candidates[0]


def _validated_policy_statements(policy: Any) -> list[dict[str, Any]]:
    if not isinstance(policy, dict) or policy.get("@context") != "https://openvex.dev/ns/v0.2.0":
        raise VexRenderError("component policy is not OpenVEX 0.2")
    if (
        policy.get("version") != 1
        or not isinstance(policy.get("@id"), str)
        or not isinstance(policy.get("author"), str)
    ):
        raise VexRenderError("component policy identity is invalid")
    try:
        reviewed_at = datetime.fromisoformat(str(policy.get("timestamp")).replace("Z", "+00:00"))
    except ValueError as error:
        raise VexRenderError("component policy review timestamp is invalid") from error
    now = datetime.now(UTC)
    if reviewed_at.tzinfo is None or reviewed_at > now + timedelta(minutes=5):
        raise VexRenderError("component policy review timestamp is not current UTC evidence")
    if now - reviewed_at > MAX_REVIEW_AGE:
        raise VexRenderError("component policy review has expired")
    statements = policy.get("statements")
    if not isinstance(statements, list) or not statements:
        raise VexRenderError("component policy has no statements")

    seen_vulnerabilities: set[str] = set()
    validated: list[dict[str, Any]] = []
    for statement in statements:
        if not isinstance(statement, dict):
            raise VexRenderError("component policy statement is invalid")
        vulnerability = statement.get("vulnerability")
        cve = vulnerability.get("name") if isinstance(vulnerability, dict) else None
        if not isinstance(cve, str) or not CVE_NAME.fullmatch(cve) or cve in seen_vulnerabilities:
            raise VexRenderError("component policy CVE names must be unique and canonical")
        seen_vulnerabilities.add(cve)
        if statement.get("status") != "not_affected":
            raise VexRenderError("component policy may contain only not_affected statements")
        if statement.get("justification") not in APPROVED_JUSTIFICATIONS:
            raise VexRenderError("component policy justification is not approved")
        impact = statement.get("impact_statement")
        if not isinstance(impact, str) or not all(
            marker in impact for marker in ("Boundary:", "Evidence: https://", "Reassess:")
        ):
            raise VexRenderError("component policy impact statement lacks review evidence")
        products = statement.get("products")
        if not isinstance(products, list) or not products:
            raise VexRenderError("component policy statement has no package products")
        product_ids = [
            product.get("@id") if isinstance(product, dict) else None for product in products
        ]
        if (
            not all(isinstance(product_id, str) for product_id in product_ids)
            or len(set(product_ids)) != len(product_ids)
            or any(
                "@" not in product_id or product_id.startswith("pkg:oci/")
                for product_id in product_ids
            )
        ):
            raise VexRenderError("component policy products must be unique versioned package PURLs")
        validated.append(statement)
    return validated


def render_vex(
    policy: Any, sbom: Any, *, repository_root: Path = REPOSITORY_ROOT
) -> dict[str, Any]:
    """Return exact-package VEX validated against the OCI SBOM and source boundary.

    Grype reconstructs package PURLs, but not the root image identity, when it reads
    SPDX JSON. Keeping each exact package PURL as the OpenVEX product therefore makes
    the scanner's matching fail closed on package versions. The immutable image PURL
    remains issuance evidence on the rendered document and in its deterministic ID.
    """

    _validate_reviewed_boundary(policy, repository_root)
    root_purl = _root_image_purl(sbom)
    statements = _validated_policy_statements(policy)
    packages = sbom.get("packages", []) if isinstance(sbom, dict) else []
    sbom_purls = {
        purl
        for package in packages
        for purl in _package_purls(package)
        if isinstance(package, dict)
    }

    rendered_statements: list[dict[str, Any]] = []
    for statement in statements:
        component_purls = [product["@id"] for product in statement["products"]]
        if any(component not in sbom_purls for component in component_purls):
            raise VexRenderError("reviewed VEX component is absent or changed in the SBOM")
        rendered_statements.append(copy.deepcopy(statement))

    document_id = uuid.uuid5(uuid.NAMESPACE_URL, f"{policy.get('@id')}#{root_purl}")
    return {
        "@context": policy["@context"],
        "@id": f"urn:uuid:{document_id}",
        "author": policy.get("author"),
        "timestamp": policy.get("timestamp"),
        "version": policy.get("version"),
        "x-signal-enhancer-image": {"purl": root_purl},
        "x-signal-enhancer-boundary": copy.deepcopy(policy.get("x-signal-enhancer-boundary")),
        "statements": rendered_statements,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--sbom", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.output in {args.policy, args.sbom}:
        raise VexRenderError("output must not overwrite policy or SBOM evidence")
    rendered = render_vex(load_json(args.policy), load_json(args.sbom))
    args.output.write_text(json.dumps(rendered, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except VexRenderError as error:
        print(f"VEX render failed: {error}")
        raise SystemExit(1) from None
