from __future__ import annotations

import unittest

from verify_worker_native_boundary import _format_widths


class NativeBoundaryFormatTests(unittest.TestCase):
    def test_detects_all_reviewed_allocating_character_formats(self) -> None:
        formats = (
            ("%1025mc", 1025),
            ("%2$2048mC", 2048),
            ("%4096mlc", 4096),
            ("%I8192mc", 8192),
            ("%'16384mC", 16384),
            ("%2$I32768mlc", 32768),
            ("%00002048mc", 2048),
            ("%2$I00004096mC", 4096),
        )
        for value, expected in formats:
            with self.subTest(value=value, encoding="narrow"):
                self.assertEqual({expected}, _format_widths(value.encode()))
            for encoding in ("utf-32-le", "utf-32-be"):
                with self.subTest(value=value, encoding=encoding):
                    self.assertEqual(
                        {expected},
                        _format_widths(b"unaligned-prefix" + value.encode(encoding)),
                    )

    def test_allows_non_allocating_or_bounded_formats(self) -> None:
        values = (
            "%1024mc",
            "%00001024mc",
            "%4096ms",
            "%0mc",
            "%2$999mC",
            "literal",
        )
        for value in values:
            with self.subTest(value=value):
                self.assertEqual(set(), _format_widths(value.encode()))
                self.assertEqual(set(), _format_widths(value.encode("utf-32-le")))
                self.assertEqual(set(), _format_widths(value.encode("utf-32-be")))


if __name__ == "__main__":
    unittest.main()
