from __future__ import annotations

import copy
import unittest

from verify_worker_vex_results import VexScanError, verify

TARGET = ("CVE-2026-7210", "pkg:generic/python@3.12.13")


def match(*, ignored: bool = False, version: str = "3.12.13") -> dict[str, object]:
    result: dict[str, object] = {
        "vulnerability": {"id": TARGET[0], "severity": "High"},
        "artifact": {"purl": f"pkg:generic/python@{version}"},
    }
    if ignored:
        result["appliedIgnoreRules"] = [{"namespace": "vex", "vex-status": "not_affected"}]
    return result


class WorkerVexResultTests(unittest.TestCase):
    def setUp(self) -> None:
        self.baseline = {"matches": [match()]}
        self.vexed = {"matches": [], "ignoredMatches": [match(ignored=True)]}
        self.mismatch = {"matches": [match()], "ignoredMatches": []}
        self.vex = {
            "statements": [
                {
                    "vulnerability": {"name": TARGET[0]},
                    "products": [{"@id": TARGET[1]}],
                }
            ]
        }

    def test_accepts_exact_positive_and_negative_match_evidence(self) -> None:
        verify(self.baseline, self.vexed, self.mismatch, self.vex, target=TARGET)

    def test_rejects_an_unreviewed_high_finding(self) -> None:
        candidate = copy.deepcopy(self.baseline)
        candidate["matches"].append(match(version="3.12.14"))
        with self.assertRaises(VexScanError):
            verify(candidate, self.vexed, self.mismatch, self.vex, target=TARGET)

    def test_rejects_a_version_mismatch_that_was_ignored(self) -> None:
        mismatch = {"matches": [], "ignoredMatches": [match(ignored=True)]}
        with self.assertRaises(VexScanError):
            verify(self.baseline, self.vexed, mismatch, self.vex, target=TARGET)


if __name__ == "__main__":
    unittest.main()
