#!/usr/bin/env python3
"""Verify positive and fail-closed Grype/OpenVEX integration evidence."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

HIGH_OR_CRITICAL = {"high", "critical"}


class VexScanError(RuntimeError):
    """The scanner results do not prove exact package/CVE VEX behavior."""


def _load_object(path: Path) -> dict[str, Any]:
    try:
        with path.open(encoding="utf-8") as source:
            document = json.load(source)
    except (OSError, json.JSONDecodeError) as error:
        raise VexScanError(f"{path.name}: unreadable JSON") from error
    if not isinstance(document, dict):
        raise VexScanError(f"{path.name}: expected a JSON object")
    return document


def _matches(document: dict[str, Any], key: str) -> list[dict[str, Any]]:
    matches = document.get(key, [])
    if not isinstance(matches, list) or not all(isinstance(match, dict) for match in matches):
        raise VexScanError(f"scanner report has invalid {key}")
    return matches


def _pair(match: dict[str, Any]) -> tuple[str, str]:
    vulnerability = match.get("vulnerability")
    artifact = match.get("artifact")
    cve = vulnerability.get("id") if isinstance(vulnerability, dict) else None
    purl = artifact.get("purl") if isinstance(artifact, dict) else None
    if not isinstance(cve, str) or not isinstance(purl, str):
        raise VexScanError("scanner match lacks a CVE or package PURL")
    return cve, purl


def _is_high_or_critical(match: dict[str, Any]) -> bool:
    vulnerability = match.get("vulnerability")
    severity = vulnerability.get("severity") if isinstance(vulnerability, dict) else None
    if not isinstance(severity, str):
        raise VexScanError("scanner match lacks severity")
    return severity.lower() in HIGH_OR_CRITICAL


def _is_vex_ignored(match: dict[str, Any]) -> bool:
    rules = match.get("appliedIgnoreRules", [])
    if not isinstance(rules, list):
        raise VexScanError("ignored scanner match has invalid applied rules")
    return any(
        isinstance(rule, dict)
        and rule.get("namespace") == "vex"
        and rule.get("vex-status") == "not_affected"
        for rule in rules
    )


def _allowed_pairs(vex: dict[str, Any]) -> set[tuple[str, str]]:
    statements = vex.get("statements")
    if not isinstance(statements, list):
        raise VexScanError("VEX document has no statements")
    allowed: set[tuple[str, str]] = set()
    for statement in statements:
        if not isinstance(statement, dict):
            raise VexScanError("VEX statement is invalid")
        vulnerability = statement.get("vulnerability")
        cve = vulnerability.get("name") if isinstance(vulnerability, dict) else None
        products = statement.get("products")
        if not isinstance(cve, str) or not isinstance(products, list):
            raise VexScanError("VEX statement lacks a CVE or products")
        for product in products:
            purl = product.get("@id") if isinstance(product, dict) else None
            if not isinstance(purl, str):
                raise VexScanError("VEX product lacks an exact PURL")
            allowed.add((cve, purl))
    return allowed


def verify(
    baseline: dict[str, Any],
    vexed: dict[str, Any],
    mismatch: dict[str, Any],
    vex: dict[str, Any],
    *,
    target: tuple[str, str],
) -> None:
    allowed = _allowed_pairs(vex)
    if target not in allowed:
        raise VexScanError("version-mismatch target is absent from the reviewed VEX")

    baseline_high = [
        match for match in _matches(baseline, "matches") if _is_high_or_critical(match)
    ]
    unexpected = sorted({_pair(match) for match in baseline_high} - allowed)
    if unexpected:
        raise VexScanError(f"unreviewed high/critical matches remain: {unexpected}")
    expected_ignored = Counter(_pair(match) for match in baseline_high)
    if not expected_ignored:
        raise VexScanError("baseline has no high/critical matches to prove")

    residual = [_pair(match) for match in _matches(vexed, "matches") if _is_high_or_critical(match)]
    if residual:
        raise VexScanError(f"high/critical matches remain active: {sorted(residual)}")
    actual_ignored = Counter(
        _pair(match)
        for match in _matches(vexed, "ignoredMatches")
        if _is_high_or_critical(match) and _is_vex_ignored(match)
    )
    if actual_ignored != expected_ignored:
        raise VexScanError("VEX did not suppress exactly the reviewed CVE/package pairs")

    mismatch_active = Counter(_pair(match) for match in _matches(mismatch, "matches"))
    mismatch_ignored = {
        _pair(match) for match in _matches(mismatch, "ignoredMatches") if _is_vex_ignored(match)
    }
    if mismatch_active[target] < 1 or target in mismatch_ignored:
        raise VexScanError("a changed package version did not fail closed")
    print(
        "VEX integration verified:",
        f"{sum(expected_ignored.values())} exact high/critical matches suppressed;",
        "package-version mismatch remained active",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--vexed", type=Path, required=True)
    parser.add_argument("--mismatch", type=Path, required=True)
    parser.add_argument("--vex", type=Path, required=True)
    parser.add_argument("--target-cve", required=True)
    parser.add_argument("--target-purl", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    verify(
        _load_object(args.baseline),
        _load_object(args.vexed),
        _load_object(args.mismatch),
        _load_object(args.vex),
        target=(args.target_cve, args.target_purl),
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except VexScanError as error:
        print(f"VEX scan proof failed: {error}")
        raise SystemExit(1) from None
