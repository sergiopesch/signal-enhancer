#!/usr/bin/env python3
"""Verify the complete upstream snapshot and the downstream package identity."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
import tomllib
from pathlib import Path
from typing import Any

DISTRIBUTION = "signal-resemble-core"
VERSION = "0.1.0"
REVISION = "8e978149bfe8abab3eb77d965d579a111afdb0ff"
MANIFEST_SHA256 = "2befa0b35e544996648a56866270e43b53b087ade64d7335465b4aa087240471"
ENTRYPOINT = "resemble_enhance.enhancer.__main__:main"


class ProvenanceError(ValueError):
    """The package no longer matches the reviewed immutable source."""


def read_manifest(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != MANIFEST_SHA256:
        raise ProvenanceError("upstream provenance manifest changed")
    manifest: dict[str, Any] = json.loads(raw)
    if (
        manifest.get("upstream_revision") != REVISION
        or manifest.get("distribution_name") != DISTRIBUTION
        or manifest.get("distribution_version") != VERSION
    ):
        raise ProvenanceError("upstream source or downstream identity changed")
    return manifest


def verify_namespace(
    root: Path, manifest: dict[str, Any], license_path: Path, *, embedded_manifest: bool = False
) -> None:
    expected = {item["path"]: item for item in manifest["files"]}
    python_paths = {path for path in expected if path.endswith(".py")}
    namespace_paths = list((root / "resemble_enhance").rglob("*"))
    if any(path.is_symlink() for path in namespace_paths):
        raise ProvenanceError("the upstream namespace contains a symlink")
    actual_paths = {
        path.relative_to(root).as_posix()
        for path in namespace_paths
        if path.is_file()
        and "__pycache__" not in path.parts
        and path.suffix not in {".pyc", ".pyo"}
    }
    allowed_paths = python_paths | (
        {"resemble_enhance/_signal_upstream.json"} if embedded_manifest else set()
    )
    if len(python_paths) != 48 or actual_paths != allowed_paths:
        raise ProvenanceError("the complete upstream Python namespace changed")
    for relative, entry in expected.items():
        path = license_path if relative == "LICENSE" else root / relative
        if path.is_symlink() or not path.is_file():
            raise ProvenanceError(f"missing or unsafe upstream file: {relative}")
        contents = path.read_bytes()
        git_object = b"blob " + str(len(contents)).encode() + b"\0" + contents
        if (
            hashlib.sha256(contents).hexdigest() != entry["sha256"]
            or hashlib.sha1(git_object, usedforsecurity=False).hexdigest() != entry["git_blob"]
        ):
            raise ProvenanceError(f"upstream file changed: {relative}")


def normalize_requirement(requirement: str) -> str:
    return re.sub(r"\s+", "", requirement).lower()


def verify_requirements(requirements: list[str], manifest: dict[str, Any]) -> None:
    original = manifest["upstream_requirements"]
    excluded = manifest["excluded_demo_requirement"]
    if original.count(excluded) != 1 or excluded != "gradio>=4.8.0":
        raise ProvenanceError("the excluded standalone demo dependency changed")
    expected = {normalize_requirement(item) for item in original if item != excluded}
    if len(expected) != 17 or {normalize_requirement(item) for item in requirements} != expected:
        raise ProvenanceError("the retained upstream runtime requirements changed")


def verify_source(root: Path) -> None:
    manifest = read_manifest(root / "UPSTREAM_PROVENANCE.json")
    verify_namespace(root, manifest, root / "LICENSE")
    project = tomllib.loads((root / "pyproject.toml").read_text())["project"]
    if project["name"] != DISTRIBUTION or project["version"] != VERSION:
        raise ProvenanceError("downstream package identity changed")
    if project.get("scripts", {}).get("resemble-enhance") != ENTRYPOINT:
        raise ProvenanceError("the original CLI entrypoint changed")
    verify_requirements(project["dependencies"], manifest)


def verify_installed() -> None:
    distribution = importlib.metadata.distribution(DISTRIBUTION)
    if distribution.version != VERSION:
        raise ProvenanceError("the installed downstream package version changed")
    for forbidden in ("gradio", "resemble-enhance"):
        try:
            importlib.metadata.distribution(forbidden)
        except importlib.metadata.PackageNotFoundError:
            continue
        raise ProvenanceError(f"unexpected installed distribution: {forbidden}")
    root = Path(distribution.locate_file("."))
    manifest = read_manifest(root / "resemble_enhance" / "_signal_upstream.json")
    licenses = [
        Path(distribution.locate_file(path))
        for path in distribution.files or ()
        if str(path).endswith(".dist-info/licenses/LICENSE")
    ]
    if len(licenses) != 1:
        raise ProvenanceError("the complete upstream license is missing")
    verify_namespace(root, manifest, licenses[0], embedded_manifest=True)
    verify_requirements(distribution.requires or [], manifest)
    if not any(
        entry.group == "console_scripts"
        and entry.name == "resemble-enhance"
        and entry.value == ENTRYPOINT
        for entry in distribution.entry_points
    ):
        raise ProvenanceError("the installed CLI entrypoint changed")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--source", type=Path)
    selection.add_argument("--installed", action="store_true")
    args = parser.parse_args()
    if args.source:
        verify_source(args.source)
    else:
        verify_installed()
    print(f"verified {DISTRIBUTION} {VERSION}: 48 unchanged source files and MIT license")


if __name__ == "__main__":
    main()
