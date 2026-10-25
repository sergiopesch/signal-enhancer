#!/usr/bin/env python3
"""Prove native and locale preconditions behind the worker's glibc VEX."""

from __future__ import annotations

import argparse
import ast
import importlib.util
import marshal
import sys
import hashlib
import json
import os
import platform
import re
import stat
import subprocess
from pathlib import Path
from typing import Any

FORBIDDEN_IMPORTS = {
    "fp_nquery",
    "ns_printrr",
    "ns_printrrf",
    "strfmon",
    "strfmon_l",
    "__strfmon_l",
    "__vstrfmon_l",
    "gzwrite",
    "gzfwrite",
    "gzprintf",
    "gzvprintf",
    "gzputc",
    "gzputs",
    "gzflush",
}
GZIP_WRITE_SYMBOLS = {"gzwrite", "gzfwrite", "gzprintf", "gzvprintf", "gzputc", "gzputs", "gzflush"}
MONETARY_SYMBOLS = {"strfmon", "strfmon_l", "__strfmon_l", "__vstrfmon_l"}
ALIGNED_NEW_LIBRARY_SHA256 = "972bb2a18b71140dab0240f8a1f68ab3fb1d56bcd4c4f824a91b70888faf5a00"
# Pygments2.20.0 official blob1f93215d78a5617fcc98b0d52b5b9ee8720d52cf.
PHP_KEYWORDS_SOURCE_SHA256 = "f60f962d3dea6d21a8950241ff83d2e855bfafb1d55c15af239396c4ab5bc289"
DISABLED_PACKAGE_WRITERS = {
    "/usr/bin/dpkg-deb": "5346e5fdfdc81d58bbc9d2a3de20ff3738dc479cdb04cc52b91503cbb13440eb",
    "/usr/lib/x86_64-linux-gnu/libapt-pkg.so.7.0.0": "d3dca8bc35a1addcc03808792768ce82ca59bb3623f8053e58b3402ac5898974",
}
DISABLED_WRITER_SYMBOLS = {"gzwrite"}
# Official locked nvidia-cuda-nvrtc13.0.88 wheel SHA256
# ad9b6d2ead2435f11cbb6868809d2adeeee302e9bb94bcf0539c7a40d80e8575.
# Each exact ELF has one strfmon substring in a compiler name/type/ID table.
# Registration copies names into an identifier hash table, including optional
# __builtin_ aliases. Its loader calls resolve fixed NVIDIA APIs, not strfmon.
# This classifies immutable metadata only; it never permits an undefined import.
NVRTC_BUILTIN_METADATA = {
    "/app/.venv/lib/python3.12/site-packages/nvidia/cu13/lib/libnvrtc.so.13": {
        "sha256": "a49e67e8e74590f1e98de55c39c6287efd3f59e3c3797464d7bbe0fe01349b11",
        "name_offset": 84121488,
        "name_address": 0x5039790,
        "descriptor_offset": 0x66B4DC0,
        "descriptor_address": 0x66B5DC0,
        "relocation_offset": 4504824,
        "table_offset": 107666528,
        "table_sha256": "64fb9036763794fa9dbb5529452c5517cc9025e4945fa8a7bac8551ae827404c",
    },
    "/app/.venv/lib/python3.12/site-packages/nvidia/cu13/lib/libnvrtc.alt.so.13": {
        "sha256": "c1e3f9b5194970fb1de865620a67a5c7e7ea199425df8df5963bd883f843acb6",
        "name_offset": 84125736,
        "name_address": 0x503A828,
        "descriptor_offset": 0x66B5E00,
        "descriptor_address": 0x66B6E00,
        "relocation_offset": 4505016,
        "table_offset": 107670688,
        "table_sha256": "666a2e078c858a6d67b3691d09ee5f9c3757d6f57a5a3a3586b011faf4ec021d",
    },
}
NVRTC_BUILTIN_CONTEXT = (
    b"\0__builtin_strdup\0__builtin_strfmon\0__builtin_strftime\0__builtin_strlen\0"
)
NVRTC_BUILTIN_TABLE_BYTES = (2264 + 1) * 16
NVRTC_BUILTIN_ROW_INDEX = 1814
ALLOCATING_SCANF_BYTES = re.compile(rb"%(?:[0-9]+\$)?['I]*([0-9]+)m(?:lc|[cC])")
SYMBOL_PROVIDERS = {"libc.so.6", "libresolv.so.2"}
READELF = "/usr/bin/readelf"
SOURCE_SUFFIXES = {".js", ".py", ".pyc", ".sh"}
EXCLUDED_ROOTS = {"/audit", "/dev", "/proc", "/run", "/sys"}


class NativeBoundaryError(RuntimeError):
    """The final image does not satisfy a reviewed native-code boundary."""


def _is_symbol_provider(path: Path, symbol: str) -> bool:
    if symbol in GZIP_WRITE_SYMBOLS:
        return (
            re.fullmatch(r"libz(?:\.so(?:\.[0-9]+)*|\.[a-f0-9]+\.so\.[0-9]+)", path.name)
            is not None
        )
    if symbol in MONETARY_SYMBOLS:
        return path.name == "libc.so.6"
    return path.name in SYMBOL_PROVIDERS


def _assert_absent_perl_module_path(path: Path) -> None:
    for namespace, module in (("Pod", "Text"), ("Archive", "Tar")):
        if path.parent.name == namespace and path.name in {module + ".pm", module + ".pmc"}:
            raise NativeBoundaryError("an unreviewed Perl POD formatter or archive module is shipped")
        # Pod::Text's Color/Overstrike/Termcap wrappers share the vulnerable
        # formatter behavior. Reject the complete tree, including cached modules.
        if any(
            path.parts[index : index + 2] == (namespace, module)
            for index in range(len(path.parts) - 1)
        ):
            raise NativeBoundaryError("an unreviewed Perl module implementation tree is shipped")


def _assert_regular_file_privileges(path: Path) -> None:
    _assert_absent_perl_module_path(path)
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode):
        return
    if metadata.st_mode & (stat.S_ISUID | stat.S_ISGID):
        raise NativeBoundaryError("a final-image regular file retains set-ID privileges")
    if "security.capability" in os.listxattr(path, follow_symlinks=False):
        raise NativeBoundaryError("a final-image regular file retains executable capabilities")
    if path.name == "erase_fn_imps.hpp" and "pb_ds" in path.parts and "binary_heap_" in path.parts:
        raise NativeBoundaryError("an unreviewed PBDS binary-heap implementation is shipped")


def _assert_final_file_privileges() -> None:
    for current, directories, names in os.walk("/", topdown=True, followlinks=False):
        for name in directories:
            _assert_absent_perl_module_path(Path(current, name))
        if any(
            name in {"Pod", "Archive"} and Path(current, name).is_symlink()
            for name in directories
        ):
            raise NativeBoundaryError("a Perl module directory has an unreviewed symlink alias")
        directories[:] = [
            name
            for name in directories
            if str(Path(current, name)) not in EXCLUDED_ROOTS
            and not Path(current, name).is_symlink()
        ]
        for name in names:
            _assert_regular_file_privileges(Path(current, name))


def _assert_aligned_new_runtime(inventory: list[dict[str, Any]]) -> None:
    libraries = [item for item in inventory if Path(item["path"]).name.startswith("libstdc++")]
    if not libraries or any(item["sha256"] != ALIGNED_NEW_LIBRARY_SHA256 for item in libraries):
        raise NativeBoundaryError("the reviewed posix_memalign C++ runtime is missing or changed")


def _is_disabled_package_writer(path: Path, *, uid: int, gid: int, mode: int, sha256: str) -> bool:
    expected = DISABLED_PACKAGE_WRITERS.get(str(path))
    if expected is None:
        return False
    if uid != 0 or gid != 0 or mode != 0 or sha256 != expected:
        raise NativeBoundaryError("a disabled package writer changed owner, mode, or bytes")
    return True


def _native_reference_violations(
    path: Path,
    imported: set[str],
    symbol_strings: set[str],
    *,
    uid: int,
    gid: int,
    mode: int,
    sha256: str,
) -> tuple[set[str], set[str], bool]:
    disabled = _is_disabled_package_writer(
        path, uid=uid, gid=gid, mode=mode, sha256=sha256
    )
    permitted = DISABLED_WRITER_SYMBOLS if disabled else set()
    references = (imported & FORBIDDEN_IMPORTS) - permitted
    builtin_metadata = (
        "strfmon" in symbol_strings
        and not imported & FORBIDDEN_IMPORTS
        and _is_verified_nvrtc_builtin_data(path, sha256)
    )
    lookups = {
        symbol
        for symbol in symbol_strings & FORBIDDEN_IMPORTS
        if not _is_symbol_provider(path, symbol)
        and symbol not in permitted
        and not (symbol == "strfmon" and builtin_metadata)
    }
    if builtin_metadata:
        print(f"verified immutable NVRTC builtin-name metadata: {path}")
    return references, lookups, disabled


def _is_verified_nvrtc_builtin_data(path: Path, sha256: str) -> bool:
    """Bind one inert compiler-name record to its fully reviewed ELF bytes.

    The full binary hash binds its instruction/loader dataflow review. Separate
    exact occurrence, context, table and RELATIVE relocation checks make the
    metadata boundary explicit. No library or subject code is loaded/executed.
    """
    expected = NVRTC_BUILTIN_METADATA.get(str(path))
    if expected is None or sha256 != expected["sha256"] or path.is_symlink():
        return False
    try:
        with path.open("rb") as source:
            digest = hashlib.sha256()
            occurrences: set[int] = set()
            position = 0
            carry = b""
            needle = b"strfmon"
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
                block = carry + chunk
                start = 0
                while (found := block.find(needle, start)) >= 0:
                    occurrences.add(position - len(carry) + found)
                    start = found + 1
                position += len(chunk)
                carry = block[-(len(needle) - 1) :]
            name_offset = int(expected["name_offset"])
            if digest.hexdigest() != sha256 or occurrences != {name_offset + 10}:
                return False

            def read_at(offset: int, size: int) -> bytes:
                source.seek(offset)
                return source.read(size)

            name_address = int(expected["name_address"])
            descriptor_address = int(expected["descriptor_address"])
            table_offset = int(expected["table_offset"])
            if int(expected["descriptor_offset"]) != (
                table_offset + NVRTC_BUILTIN_ROW_INDEX * 16
            ):
                return False
            descriptor = name_address.to_bytes(8, "little") + (0x415501B3023B).to_bytes(
                8, "little"
            )
            relocation = (
                descriptor_address.to_bytes(8, "little")
                + (8).to_bytes(8, "little")  # R_X86_64_RELATIVE, symbol index zero
                + name_address.to_bytes(8, "little")
            )
            table = read_at(table_offset, NVRTC_BUILTIN_TABLE_BYTES)
            return (
                read_at(name_offset - 18, len(NVRTC_BUILTIN_CONTEXT))
                == NVRTC_BUILTIN_CONTEXT
                and read_at(int(expected["descriptor_offset"]), 16) == descriptor
                and read_at(int(expected["relocation_offset"]), 24) == relocation
                and len(table) == NVRTC_BUILTIN_TABLE_BYTES
                and table[-16:] == b"\0" * 16
                and hashlib.sha256(table).hexdigest() == expected["table_sha256"]
            )
    except (OSError, ValueError, OverflowError):
        return False


def _assert_required_disabled_writers(paths: set[str]) -> None:
    if paths != set(DISABLED_PACKAGE_WRITERS):
        raise NativeBoundaryError(
            "an expected disabled package writer is absent from the inventory"
        )


def _verify_inventory_shape(elf: Path, expected: dict[str, Any]) -> os.stat_result:
    try:
        metadata = elf.stat()
    except OSError as error:
        raise NativeBoundaryError("an inventoried ELF disappeared") from error
    if (
        metadata.st_size != expected["size"]
        or metadata.st_uid != expected["uid"]
        or metadata.st_gid != expected["gid"]
        or stat.S_IMODE(metadata.st_mode) != expected["mode"]
        or not _is_elf(elf)
    ):
        raise NativeBoundaryError("an inventoried ELF changed shape")
    return metadata


def _assert_platform_and_locale() -> None:
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise NativeBoundaryError("native-boundary audit requires linux/amd64")
    if os.environ.get("LANG") != "C.UTF-8" or os.environ.get("LC_ALL") != "C.UTF-8":
        raise NativeBoundaryError("worker locale is not locked to C.UTF-8")


def _is_elf(path: Path) -> bool:
    try:
        with path.open("rb") as source:
            return source.read(4) == b"\x7fELF"
    except OSError:
        return False


def _image_elf_files() -> list[Path]:
    files: list[Path] = []
    for current, directories, names in os.walk("/", topdown=True, followlinks=False):
        directories[:] = [
            name
            for name in directories
            if str(Path(current, name)) not in EXCLUDED_ROOTS
            and not Path(current, name).is_symlink()
        ]
        for name in names:
            path = Path(current, name)
            try:
                metadata = path.lstat()
            except OSError:
                continue
            if stat.S_ISREG(metadata.st_mode) and _is_elf(path):
                files.append(path)
    return sorted(files)


def _is_verified_php_keyword_data(path: Path, contents: bytes) -> bool:
    """Distinguish one immutable PHP lexer table from native symbol lookups.

    The exact upstream source imports MODULES only as syntax-highlighting names.
    Cached bytecode must be the compiler output of that same verified source;
    neither the source module nor its cached code is executed by this audit.
    """
    optimize = 0
    if path.name == "_php_builtins.py":
        source = path
    else:
        cache_tag = sys.implementation.cache_tag
        if not cache_tag or path.parent.name != "__pycache__":
            return False
        cached = re.fullmatch(
            r"_php_builtins\." + re.escape(cache_tag) + r"(?:\.opt-([12]))?\.pyc",
            path.name,
        )
        if cached is None:
            return False
        optimize = int(cached.group(1) or "0")
        source = path.parent.parent / "_php_builtins.py"
    if source.parent.name != "lexers" or source.parent.parent.name != "pygments":
        return False
    if source.is_symlink():
        return False
    try:
        source_bytes = source.read_bytes()
        if hashlib.sha256(source_bytes).hexdigest() != PHP_KEYWORDS_SOURCE_SHA256:
            return False
        tree = ast.parse(source_bytes)
        if len(tree.body) != 3:
            return False
        documentation, assignment, generator = tree.body
        if not (
            isinstance(documentation, ast.Expr)
            and isinstance(documentation.value, ast.Constant)
            and isinstance(documentation.value.value, str)
            and isinstance(assignment, ast.Assign)
            and len(assignment.targets) == 1
            and isinstance(assignment.targets[0], ast.Name)
            and assignment.targets[0].id == "MODULES"
            and isinstance(generator, ast.If)
            and not generator.orelse
            and ast.dump(generator.test)
            == ast.dump(ast.parse("__name__ == '__main__'", mode="eval").body)
        ):
            return False
        modules = ast.literal_eval(assignment.value)
        if not isinstance(modules, dict) or not all(
            isinstance(name, str)
            and isinstance(names, tuple)
            and all(isinstance(function, str) for function in names)
            for name, names in modules.items()
        ):
            return False
        outside_table = ast.unparse(ast.Module(body=[documentation, generator], type_ignores=[]))
        if any(symbol in outside_table for symbol in FORBIDDEN_IMPORTS):
            return False
        if path == source:
            return contents == source_bytes
        if len(contents) < 16 or contents[:4] != importlib.util.MAGIC_NUMBER:
            return False
        expected = compile(source_bytes, str(source), "exec", dont_inherit=True, optimize=optimize)
        return contents[16:] == marshal.dumps(expected)
    except (OSError, ValueError, SyntaxError, TypeError, EOFError):
        return False


def _assert_no_source_symbol_lookup() -> None:
    violations: list[str] = []
    verified_keyword_files = 0
    for current, directories, names in os.walk("/", topdown=True, followlinks=False):
        directories[:] = [
            name
            for name in directories
            if str(Path(current, name)) not in EXCLUDED_ROOTS
            and not Path(current, name).is_symlink()
        ]
        for name in names:
            path = Path(current, name)
            if path.suffix.lower() not in SOURCE_SUFFIXES or path.is_symlink():
                continue
            try:
                if path.stat().st_size > 32 * 1024 * 1024:
                    continue
                contents = path.read_bytes()
            except OSError:
                continue
            symbols = {symbol for symbol in FORBIDDEN_IMPORTS if symbol.encode() in contents}
            if symbols:
                if _is_verified_php_keyword_data(path, contents):
                    verified_keyword_files += 1
                else:
                    violations.append(f"{path}: {','.join(sorted(symbols))}")
    if violations:
        raise NativeBoundaryError(
            "runtime sources contain forbidden dynamic symbols: " + "; ".join(violations)
        )
    if verified_keyword_files:
        print(
            f"verified immutable PHP syntax keyword data in {verified_keyword_files} source/cache files"
        )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def write_inventory(path: Path) -> None:
    _assert_platform_and_locale()
    _assert_no_source_symbol_lookup()
    _assert_final_file_privileges()
    files = _image_elf_files()
    if not files:
        raise NativeBoundaryError("no final-image ELF files were discovered")
    inventory = {
        "schemaVersion": 3,
        "files": [
            {
                "path": str(file),
                "size": file.stat().st_size,
                "mode": stat.S_IMODE(file.stat().st_mode),
                "uid": file.stat().st_uid,
                "gid": file.stat().st_gid,
                "sha256": _sha256(file),
            }
            for file in files
        ],
    }
    path.write_text(json.dumps(inventory, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"inventoried {len(files)} final-image ELF files before audit-tool installation")


def _load_inventory(path: Path) -> list[dict[str, Any]]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise NativeBoundaryError("native inventory is unreadable") from error
    files = document.get("files") if isinstance(document, dict) else None
    if (
        not isinstance(document, dict)
        or document.get("schemaVersion") != 3
        or not isinstance(files, list)
        or not files
    ):
        raise NativeBoundaryError("native inventory has an invalid shape")
    for item in files:
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("path"), str)
            or not item["path"].startswith("/")
            or not isinstance(item.get("uid"), int)
            or item["uid"] < 0
            or not isinstance(item.get("gid"), int)
            or item["gid"] < 0
            or not isinstance(item.get("mode"), int)
            or item["mode"] < 0
            or item["mode"] > 0o7777
            or not isinstance(item.get("size"), int)
            or not isinstance(item.get("sha256"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"])
        ):
            raise NativeBoundaryError("native inventory entry is invalid")
    return files


def _undefined_symbols(path: Path) -> set[str]:
    # The executable is an absolute constant installed by the workflow, and *path*
    # is an inventoried, byte-verified regular ELF passed as a discrete argv item.
    result = subprocess.run(  # noqa: S603
        [READELF, "--dyn-syms", "--wide", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    symbols: set[str] = set()
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) >= 8 and fields[6] == "UND":
            symbols.add(fields[7].split("@", maxsplit=1)[0])
    return symbols


def _utf32_char(block: bytes, offset: int, byteorder: str) -> str | None:
    encoded = block[offset : offset + 4]
    if len(encoded) != 4:
        return None
    value = int.from_bytes(encoded, byteorder)
    return chr(value) if value < 128 else None


def _utf32_allocating_width(block: bytes, start: int, byteorder: str) -> int | None:
    offset = start + 4
    digits: list[str] = []
    while (character := _utf32_char(block, offset, byteorder)) is not None and character.isdigit():
        digits.append(character)
        offset += 4
    if digits and _utf32_char(block, offset, byteorder) == "$":
        offset += 4
        digits = []
        while _utf32_char(block, offset, byteorder) in {"'", "I"}:
            offset += 4
        while (
            character := _utf32_char(block, offset, byteorder)
        ) is not None and character.isdigit():
            digits.append(character)
            offset += 4
    elif not digits:
        while _utf32_char(block, offset, byteorder) in {"'", "I"}:
            offset += 4
        while (
            character := _utf32_char(block, offset, byteorder)
        ) is not None and character.isdigit():
            digits.append(character)
            offset += 4
    if not digits:
        return None
    if _utf32_char(block, offset, byteorder) != "m":
        return None
    offset += 4
    suffix = _utf32_char(block, offset, byteorder)
    if suffix == "l":
        offset += 4
        suffix = "l" + (_utf32_char(block, offset, byteorder) or "")
    if suffix not in {"c", "C", "lc"}:
        return None
    normalized_width = "".join(digits).lstrip("0") or "0"
    if len(normalized_width) > 18:
        return 10**18
    return int(normalized_width)


def _utf32_format_widths(block: bytes, byteorder: str) -> set[int]:
    marker = b"%\x00\x00\x00" if byteorder == "little" else b"\x00\x00\x00%"
    widths: set[int] = set()
    start = 0
    while (position := block.find(marker, start)) >= 0:
        width = _utf32_allocating_width(block, position, byteorder)
        if width is not None:
            widths.add(width)
        start = position + 1
    return widths


def _format_widths(block: bytes) -> set[int]:
    widths = {int(match.group(1)) for match in ALLOCATING_SCANF_BYTES.finditer(block)}
    widths.update(_utf32_format_widths(block, "little"))
    widths.update(_utf32_format_widths(block, "big"))
    return {width for width in widths if width > 1024}


def _digest_and_scan(path: Path) -> tuple[str, set[int], set[str]]:
    digest = hashlib.sha256()
    widths: set[int] = set()
    symbol_strings: set[str] = set()
    carry = b""
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            block = carry + chunk
            widths.update(_format_widths(block))
            symbol_strings.update(
                symbol for symbol in FORBIDDEN_IMPORTS if symbol.encode() in block
            )
            carry = block[-4096:]
    return digest.hexdigest(), widths, symbol_strings


def verify_inventory(path: Path) -> None:
    _assert_platform_and_locale()
    if not Path(READELF).is_file():
        raise NativeBoundaryError("readelf is required for the native-boundary audit")
    inventory = _load_inventory(path)
    _assert_final_file_privileges()
    _assert_aligned_new_runtime(inventory)
    if any(
        "libtasn" in Path(item["path"]).name.lower()
        or "libgnutls" in Path(item["path"]).name.lower()
        for item in inventory
    ):
        raise NativeBoundaryError("an unreviewed ASN.1/TLS native library is shipped")

    forbidden_references: list[str] = []
    forbidden_dynamic_lookups: list[str] = []
    forbidden_formats: list[str] = []
    verified_disabled_writers: set[str] = set()
    for item in inventory:
        elf = Path(item["path"])
        metadata = _verify_inventory_shape(elf, item)
        actual_sha256, widths, symbol_strings = _digest_and_scan(elf)
        if actual_sha256 != item["sha256"]:
            raise NativeBoundaryError("an inventoried ELF changed after tool installation")
        imported, lookup_strings, disabled_writer = _native_reference_violations(
            elf,
            _undefined_symbols(elf),
            symbol_strings,
            uid=metadata.st_uid,
            gid=metadata.st_gid,
            mode=stat.S_IMODE(metadata.st_mode),
            sha256=actual_sha256,
        )
        if disabled_writer:
            verified_disabled_writers.add(str(elf))
        if imported:
            forbidden_references.append(f"{elf}: {','.join(sorted(imported))}")
        if lookup_strings:
            forbidden_dynamic_lookups.append(f"{elf}: {','.join(sorted(lookup_strings))}")
        if elf.name != "libc.so.6" and widths:
            forbidden_formats.append(f"{elf}: {','.join(map(str, sorted(widths)))}")
    _assert_required_disabled_writers(verified_disabled_writers)
    violations: list[str] = []
    if forbidden_references:
        violations.append("forbidden native imports found: " + "; ".join(forbidden_references))
    if forbidden_dynamic_lookups:
        violations.append(
            "forbidden native symbol strings found outside providers: "
            + "; ".join(forbidden_dynamic_lookups)
        )
    if forbidden_formats:
        violations.append(
            "forbidden allocating scanf formats found: " + "; ".join(forbidden_formats)
        )
    if violations:
        raise NativeBoundaryError(" | ".join(violations))
    print(f"native VEX boundary verified across all {len(inventory)} final-image ELF files")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write-inventory", type=Path)
    mode.add_argument("--verify-inventory", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.write_inventory is not None:
        write_inventory(args.write_inventory)
    else:
        verify_inventory(args.verify_inventory)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (NativeBoundaryError, subprocess.CalledProcessError) as error:
        print(f"native-boundary audit failed: {error}")
        raise SystemExit(1) from None
