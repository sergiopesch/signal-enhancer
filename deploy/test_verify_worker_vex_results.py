from __future__ import annotations

import copy
import unittest

from verify_worker_vex_results import VexScanError, verify

TARGET = (
    "CVE-2026-5435",
    "pkg:deb/debian/libc6@2.41-12%2Bdeb13u4?arch=amd64&distro=debian-13&upstream=glibc",
)


def match(*, ignored: bool = False, version: str = "2.41-12%2Bdeb13u4") -> dict[str, object]:
    result: dict[str, object] = {
        "vulnerability": {"id": TARGET[0], "severity": "High"},
        "artifact": {
            "purl": f"pkg:deb/debian/libc6@{version}?arch=amd64&distro=debian-13&upstream=glibc"
        },
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
        candidate["matches"].append(match(version="2.41-12%2Bdeb13u3"))
        with self.assertRaises(VexScanError):
            verify(candidate, self.vexed, self.mismatch, self.vex, target=TARGET)

    def test_rejects_a_version_mismatch_that_was_ignored(self) -> None:
        mismatch = {"matches": [], "ignoredMatches": [match(ignored=True)]}
        with self.assertRaises(VexScanError):
            verify(self.baseline, self.vexed, mismatch, self.vex, target=TARGET)

    def test_rejects_an_unreviewed_cve_on_the_same_package(self) -> None:
        candidate = copy.deepcopy(self.baseline)
        unexpected = match()
        unexpected["vulnerability"]["id"] = "CVE-2026-999999"
        candidate["matches"].append(unexpected)
        with self.assertRaises(VexScanError):
            verify(candidate, self.vexed, self.mismatch, self.vex, target=TARGET)

    def test_rejects_an_unreviewed_product_at_the_same_version(self) -> None:
        candidate = copy.deepcopy(self.baseline)
        unexpected = match()
        unexpected["artifact"]["purl"] = TARGET[1].replace("/libc6@", "/unreviewed@")
        candidate["matches"].append(unexpected)
        with self.assertRaises(VexScanError):
            verify(candidate, self.vexed, self.mismatch, self.vex, target=TARGET)

    def test_rejects_suppression_beyond_the_exact_baseline_pairs(self) -> None:
        candidate = copy.deepcopy(self.vexed)
        candidate["ignoredMatches"].append(match(ignored=True, version="2.41-12%2Bdeb13u3"))
        with self.assertRaises(VexScanError):
            verify(self.baseline, candidate, self.mismatch, self.vex, target=TARGET)


if __name__ == "__main__":
    unittest.main()
