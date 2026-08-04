#!/usr/bin/env python3
"""Prove native and locale preconditions behind the worker's glibc VEX."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import stat
import subprocess
from pathlib import Path
from typing import Any

FORBIDDEN_IMPORTS = {"fp_nquery", "ns_printrr", "ns_printrrf"}
ALLOCATING_SCANF_BYTES = re.compile(rb"%(?:[0-9]+\$)?['I]*([0-9]+)m(?:lc|[cC])")
SYMBOL_PROVIDERS = {"libc.so.6", "libresolv.so.2"}
READELF = "/usr/bin/readelf"
SOURCE_SUFFIXES = {".js", ".py", ".pyc", ".sh"}
EXCLUDED_ROOTS = {"/audit", "/dev", "/proc", "/run", "/sys"}


class NativeBoundaryError(RuntimeError):
    """The final image does not satisfy a reviewed native-code boundary."""


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


def _assert_no_source_symbol_lookup() -> None:
    needles = tuple(symbol.encode() for symbol in FORBIDDEN_IMPORTS)
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
            if any(needle in contents for needle in needles):
                raise NativeBoundaryError("a runtime source contains a forbidden dynamic symbol")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def write_inventory(path: Path) -> None:
    _assert_platform_and_locale()
    _assert_no_source_symbol_lookup()
    files = _image_elf_files()
    if not files:
        raise NativeBoundaryError("no final-image ELF files were discovered")
    inventory = {
        "schemaVersion": 1,
        "files": [
            {"path": str(file), "size": file.stat().st_size, "sha256": _sha256(file)}
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
        or document.get("schemaVersion") != 1
        or not isinstance(files, list)
        or not files
    ):
        raise NativeBoundaryError("native inventory has an invalid shape")
    for item in files:
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("path"), str)
            or not item["path"].startswith("/")
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
    if any(
        "libtasn" in Path(item["path"]).name.lower()
        or "libgnutls" in Path(item["path"]).name.lower()
        for item in inventory
    ):
        raise NativeBoundaryError("an unreviewed ASN.1/TLS native library is shipped")

    forbidden_references: list[str] = []
    forbidden_dynamic_lookups: list[str] = []
    forbidden_formats: list[str] = []
    for item in inventory:
        elf = Path(item["path"])
        try:
            metadata = elf.stat()
        except OSError as error:
            raise NativeBoundaryError("an inventoried ELF disappeared") from error
        if metadata.st_size != item["size"] or not _is_elf(elf):
            raise NativeBoundaryError("an inventoried ELF changed shape")
        actual_sha256, widths, symbol_strings = _digest_and_scan(elf)
        if actual_sha256 != item["sha256"]:
            raise NativeBoundaryError("an inventoried ELF changed after tool installation")
        imported = _undefined_symbols(elf) & FORBIDDEN_IMPORTS
        if imported:
            forbidden_references.append(f"{elf}: {','.join(sorted(imported))}")
        if elf.name not in SYMBOL_PROVIDERS and symbol_strings:
            forbidden_dynamic_lookups.append(f"{elf}: {','.join(sorted(symbol_strings))}")
        if elf.name != "libc.so.6" and widths:
            forbidden_formats.append(f"{elf}: {','.join(map(str, sorted(widths)))}")
    if forbidden_references:
        raise NativeBoundaryError(
            "forbidden resolver imports found: " + "; ".join(forbidden_references)
        )
    if forbidden_dynamic_lookups:
        raise NativeBoundaryError(
            "forbidden resolver symbol strings found outside providers: "
            + "; ".join(forbidden_dynamic_lookups)
        )
    if forbidden_formats:
        raise NativeBoundaryError(
            "forbidden allocating scanf formats found: " + "; ".join(forbidden_formats)
        )
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
