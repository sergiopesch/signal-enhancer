from __future__ import annotations

import hashlib
import importlib.util
import marshal
import py_compile
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

from verify_worker_native_boundary import (
    ALIGNED_NEW_LIBRARY_SHA256,
    DISABLED_PACKAGE_WRITERS,
    FORBIDDEN_IMPORTS,
    NativeBoundaryError,
    _assert_aligned_new_runtime,
    _assert_no_source_symbol_lookup,
    _assert_required_disabled_writers,
    _assert_regular_file_privileges,
    _digest_and_scan,
    _format_widths,
    _is_symbol_provider,
    _is_disabled_package_writer,
    _is_verified_php_keyword_data,
    _native_reference_violations,
    _verify_inventory_shape,
)

KEYWORDS = b'''"""PHP lexer keyword fixture."""
MODULES = {"Zlib": ("gzwrite", "gzputs")}
if __name__ == "__main__":
    pass
'''


def keyword_source(directory: str) -> Path:
    source = Path(directory, "pygments/lexers/_php_builtins.py")
    source.parent.mkdir(parents=True)
    source.write_bytes(KEYWORDS)
    return source


class NativeBoundaryFormatTests(unittest.TestCase):
    def test_only_exact_root_owned_inaccessible_package_bytes_qualify(self) -> None:
        for filename, digest in DISABLED_PACKAGE_WRITERS.items():
            fields = {"uid": 0, "gid": 0, "mode": 0, "sha256": digest}
            self.assertTrue(_is_disabled_package_writer(Path(filename), **fields))
            for replacement in (
                {"uid": 10_001},
                {"gid": 10_001},
                {"mode": 0o400},
                {"mode": 0o100},
                {"mode": 0o755},
                {"sha256": "0" * 64},
            ):
                with (
                    self.subTest(filename=filename, replacement=replacement),
                    self.assertRaises(NativeBoundaryError),
                ):
                    _is_disabled_package_writer(Path(filename), **{**fields, **replacement})
            self.assertFalse(
                _is_disabled_package_writer(Path("/unexpected/copied-writer"), **fields)
            )

    def test_disabled_writers_cannot_exempt_other_symbols_or_other_elfs(self) -> None:
        filename, digest = next(iter(DISABLED_PACKAGE_WRITERS.items()))
        fields = {"uid": 0, "gid": 0, "mode": 0, "sha256": digest}
        references, lookups, disabled = _native_reference_violations(
            Path(filename),
            {"gzwrite", "gzprintf", "strfmon"},
            {"gzwrite", "gzprintf", "strfmon"},
            **fields,
        )
        self.assertTrue(disabled)
        self.assertEqual({"gzprintf", "strfmon"}, references)
        self.assertEqual({"gzprintf", "strfmon"}, lookups)
        references, lookups, disabled = _native_reference_violations(
            Path("/app/extra.so"), {"gzwrite"}, {"gzwrite"}, **fields
        )
        self.assertFalse(disabled)
        self.assertEqual({"gzwrite"}, references)
        self.assertEqual({"gzwrite"}, lookups)

    def test_both_disabled_writers_must_be_in_the_original_inventory(self) -> None:
        _assert_required_disabled_writers(set(DISABLED_PACKAGE_WRITERS))
        for paths in (
            set(),
            {next(iter(DISABLED_PACKAGE_WRITERS))},
            set(DISABLED_PACKAGE_WRITERS) | {"/extra.so"},
        ):
            with self.subTest(paths=paths), self.assertRaises(NativeBoundaryError):
                _assert_required_disabled_writers(paths)

    def test_audit_cannot_leave_changed_modes_or_owners_after_tool_installation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "fixture")
            path.write_bytes(b"\x7fELFfixture")
            path.chmod(0o644)
            metadata = path.stat()
            original = {
                "size": metadata.st_size,
                "uid": metadata.st_uid,
                "gid": metadata.st_gid,
                "mode": 0o644,
            }
            _verify_inventory_shape(path, original)
            path.chmod(0o755)
            for expected in (original, {**original, "mode": 0}):
                with self.assertRaises(NativeBoundaryError):
                    _verify_inventory_shape(path, expected)
            path.chmod(0o644)
            for replacement in ({"uid": metadata.st_uid + 1}, {"gid": metadata.st_gid + 1}):
                with self.assertRaises(NativeBoundaryError):
                    _verify_inventory_shape(path, {**original, **replacement})

    def test_keyword_data_requires_exact_provenance_and_namespace(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = keyword_source(directory)
            self.assertFalse(_is_verified_php_keyword_data(source, KEYWORDS))
            with patch(
                "verify_worker_native_boundary.PHP_KEYWORDS_SOURCE_SHA256",
                hashlib.sha256(KEYWORDS).hexdigest(),
            ):
                self.assertTrue(_is_verified_php_keyword_data(source, KEYWORDS))
                renamed = source.with_name("native_lookup.py")
                renamed.write_bytes(KEYWORDS)
                self.assertFalse(_is_verified_php_keyword_data(renamed, KEYWORDS))
                source.write_bytes(KEYWORDS + b"# altered source\n")
                self.assertFalse(_is_verified_php_keyword_data(source, source.read_bytes()))

    def test_keyword_cache_must_be_exact_compiler_output_not_arbitrary_bytecode(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = keyword_source(directory)
            with patch(
                "verify_worker_native_boundary.PHP_KEYWORDS_SOURCE_SHA256",
                hashlib.sha256(KEYWORDS).hexdigest(),
            ):
                for optimize in (0, 1, 2):
                    cached = Path(py_compile.compile(str(source), doraise=True, optimize=optimize))
                    original = cached.read_bytes()
                    with self.subTest(optimize=optimize):
                        self.assertTrue(_is_verified_php_keyword_data(cached, original))
                        self.assertFalse(
                            _is_verified_php_keyword_data(cached, original + b"unreviewed trailer")
                        )
                        malicious = compile(
                            "raise RuntimeError('gzwrite')", str(source), "exec", dont_inherit=True
                        )
                        tampered = (
                            importlib.util.MAGIC_NUMBER + b"\0" * 12 + marshal.dumps(malicious)
                        )
                        self.assertFalse(_is_verified_php_keyword_data(cached, tampered))
                source.unlink()
                self.assertFalse(_is_verified_php_keyword_data(cached, original))

    def test_keyword_table_must_be_literal_and_native_names_cannot_escape_the_table(self) -> None:
        replacements = (
            KEYWORDS.replace(b'("gzwrite", "gzputs")', b'("gzwrite", lookup())'),
            KEYWORDS + b"getattr(libc, 'gzwrite')\n",
        )
        with tempfile.TemporaryDirectory() as directory:
            source = keyword_source(directory)
            for contents in replacements:
                source.write_bytes(contents)
                with patch(
                    "verify_worker_native_boundary.PHP_KEYWORDS_SOURCE_SHA256",
                    hashlib.sha256(contents).hexdigest(),
                ):
                    self.assertFalse(_is_verified_php_keyword_data(source, contents))

    def test_source_audit_still_rejects_and_identifies_an_actual_lookup(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = keyword_source(directory)
            lookup = source.with_name("actual_lookup.py")
            lookup.write_text("getattr(libc, 'strfmon')\n")
            walked = [(str(source.parent), [], [source.name, lookup.name])]
            with patch(
                "verify_worker_native_boundary.PHP_KEYWORDS_SOURCE_SHA256",
                hashlib.sha256(KEYWORDS).hexdigest(),
            ):
                with patch("verify_worker_native_boundary.os.walk", return_value=iter(walked)):
                    with self.assertRaisesRegex(NativeBoundaryError, "actual_lookup.py: strfmon"):
                        _assert_no_source_symbol_lookup()

    def test_rejects_set_id_files_and_executable_capabilities(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "fixture")
            path.write_bytes(b"no executable code")
            path.chmod(0o644)
            _assert_regular_file_privileges(path)
            for mode in (0o4644, 0o2644):
                path.chmod(mode)
                with self.subTest(mode=mode), self.assertRaises(NativeBoundaryError):
                    _assert_regular_file_privileges(path)
            path.chmod(0o644)
            with patch(
                "verify_worker_native_boundary.os.listxattr", return_value=["security.capability"]
            ):
                with self.assertRaises(NativeBoundaryError):
                    _assert_regular_file_privileges(path)

    def test_rejects_a_shipped_pbds_development_implementation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "ext/pb_ds/detail/binary_heap_/erase_fn_imps.hpp")
            path.parent.mkdir(parents=True)
            path.write_text("template implementation")
            with self.assertRaises(NativeBoundaryError):
                _assert_regular_file_privileges(path)

    def test_requires_the_exact_reviewed_posix_memalign_runtime(self) -> None:
        library = {
            "path": "/usr/lib/x86_64-linux-gnu/libstdc++.so.6.0.33",
            "sha256": ALIGNED_NEW_LIBRARY_SHA256,
        }
        _assert_aligned_new_runtime([library])
        for inventory in (
            [],
            [{**library, "sha256": "0" * 64}],
            [library, {**library, "path": "/unexpected/libstdc++.so.6", "sha256": "0" * 64}],
        ):
            with self.subTest(inventory=inventory), self.assertRaises(NativeBoundaryError):
                _assert_aligned_new_runtime(inventory)

    def test_symbol_provider_exceptions_are_limited_to_the_actual_component(self) -> None:
        self.assertTrue(_is_symbol_provider(Path("libc.so.6"), "strfmon"))
        self.assertFalse(_is_symbol_provider(Path("libresolv.so.2"), "strfmon"))
        self.assertTrue(_is_symbol_provider(Path("libz.so.1.3.1"), "gzprintf"))
        self.assertTrue(_is_symbol_provider(Path("libz.b9a71669.so.1"), "gzprintf"))
        self.assertFalse(_is_symbol_provider(Path("libc.so.6"), "gzprintf"))
        self.assertFalse(_is_symbol_provider(Path("libz-malicious.so"), "gzprintf"))

    def test_scans_each_reviewed_native_symbol_in_binary_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "fixture")
            for symbol in FORBIDDEN_IMPORTS:
                path.write_bytes(b"prefix\0" + symbol.encode() + b"\0suffix")
                with self.subTest(symbol=symbol):
                    self.assertIn(symbol, _digest_and_scan(path)[2])

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
