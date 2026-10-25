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
        # A changed target version must stay active while other reviewed pairs
        # legitimately remain suppressed in the negative report.
        self.add_other_reviewed_pair()
        verify(self.baseline, self.vexed, self.mismatch, self.vex, target=TARGET)

    def add_other_reviewed_pair(self) -> None:
        other = match()
        other["vulnerability"]["id"] = "CVE-2026-19499"
        other_ignored = match(ignored=True)
        other_ignored["vulnerability"]["id"] = "CVE-2026-19499"
        self.baseline["matches"].append(other)
        self.vexed["ignoredMatches"].append(other_ignored)
        self.mismatch["ignoredMatches"] = [other_ignored]
        self.vex["statements"].append(
            {
                "vulnerability": {"name": "CVE-2026-19499"},
                "products": [{"@id": TARGET[1]}],
            }
        )

    def test_rejects_high_or_critical_suppression_in_the_baseline(self) -> None:
        for severity in ("High", "Critical"):
            for rules in (
                None,
                [{"namespace": "configuration"}],
                [{"namespace": "vex", "vex-status": "not_affected"}],
            ):
                candidate = copy.deepcopy(self.baseline)
                ignored = match()
                ignored["vulnerability"]["severity"] = severity
                if rules is not None:
                    ignored["appliedIgnoreRules"] = rules
                candidate["ignoredMatches"] = [ignored]
                with self.subTest(severity=severity, rules=rules), self.assertRaises(VexScanError):
                    verify(candidate, self.vexed, self.mismatch, self.vex, target=TARGET)

    def test_rejects_implicit_or_unreviewed_suppressions_in_scan_reports(self) -> None:
        missing_rule = match()
        configuration_rule = match()
        configuration_rule["appliedIgnoreRules"] = [{"namespace": "configuration"}]
        wrong_status = match(ignored=True)
        wrong_status["appliedIgnoreRules"][0]["vex-status"] = "affected"
        wrong_cve = match(ignored=True)
        wrong_cve["vulnerability"]["id"] = "CVE-2026-999999"
        wrong_product = match(ignored=True)
        wrong_product["artifact"]["purl"] = TARGET[1].replace("/libc6@", "/unreviewed@")
        for report_name in ("vexed", "mismatch"):
            for severity in ("High", "Critical"):
                for ignored in (
                    missing_rule,
                    configuration_rule,
                    wrong_status,
                    wrong_cve,
                    wrong_product,
                ):
                    reports = {
                        "vexed": copy.deepcopy(self.vexed),
                        "mismatch": copy.deepcopy(self.mismatch),
                    }
                    entry = copy.deepcopy(ignored)
                    entry["vulnerability"]["severity"] = severity
                    reports[report_name].setdefault("ignoredMatches", []).append(entry)
                    with (
                        self.subTest(report=report_name, severity=severity, entry=entry),
                        self.assertRaises(VexScanError),
                    ):
                        verify(
                            self.baseline,
                            reports["vexed"],
                            reports["mismatch"],
                            self.vex,
                            target=TARGET,
                        )
        self.add_other_reviewed_pair()
        for case in (
            "unknown_active",
            "duplicate_active",
            "duplicate_ignored",
            "missing_active",
            "missing_ignored",
        ):
            candidate = copy.deepcopy(self.mismatch)
            if case == "unknown_active":
                unknown = match()
                unknown["vulnerability"] = {"id": "CVE-2026-999999", "severity": "Critical"}
                candidate["matches"].append(unknown)
            elif case == "duplicate_active":
                candidate["matches"].append(match())
            elif case == "duplicate_ignored":
                candidate["ignoredMatches"].append(copy.deepcopy(candidate["ignoredMatches"][0]))
            elif case == "missing_active":
                candidate["matches"] = []
            else:
                candidate["ignoredMatches"] = []
            with self.subTest(mismatch_case=case), self.assertRaises(VexScanError):
                verify(self.baseline, self.vexed, candidate, self.vex, target=TARGET)

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
