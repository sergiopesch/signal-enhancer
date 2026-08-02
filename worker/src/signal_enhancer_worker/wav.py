"""Bounded RIFF/WAVE validation, decoding, and deterministic PCM16 encoding."""

from __future__ import annotations

import hashlib
import hmac
import struct
from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import NDArray

from signal_enhancer_worker.contracts import AudioMetadata
from signal_enhancer_worker.errors import IntegrityError, InvalidAudioError

FloatSamples = NDArray[np.float32]
Codec = Literal["pcm_s16le", "pcm_s24le", "pcm_s32le", "float32le"]
_PCM_GUID = bytes.fromhex("0100000000001000800000aa00389b71")
_FLOAT_GUID = bytes.fromhex("0300000000001000800000aa00389b71")


@dataclass(frozen=True, slots=True)
class DecodedWav:
    samples: FloatSamples
    metadata: AudioMetadata


def _fail(message: str = "The capture is not a supported WAV file.") -> InvalidAudioError:
    return InvalidAudioError(message)


def decode_and_validate_wav(
    data: bytes,
    *,
    expected_sha256: str,
    expected_bytes: int,
    max_bytes: int,
    max_duration_seconds: float,
) -> DecodedWav:
    actual_size = len(data)
    if actual_size != expected_bytes:
        raise IntegrityError("The capture size does not match its committed metadata.")
    if actual_size > max_bytes:
        raise InvalidAudioError("The capture exceeds the 4 MiB limit.")
    actual_sha = hashlib.sha256(data).hexdigest()
    if not hmac.compare_digest(actual_sha, expected_sha256):
        raise IntegrityError("The capture hash does not match its committed metadata.")
    if actual_size < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise _fail()
    if struct.unpack_from("<I", data, 4)[0] + 8 != actual_size:
        raise _fail("The WAV container length is inconsistent.")

    fmt_chunk: bytes | None = None
    payload: bytes | None = None
    offset = 12
    chunk_count = 0
    while offset < actual_size:
        if offset + 8 > actual_size:
            raise _fail("The WAV contains a truncated chunk header.")
        chunk_count += 1
        if chunk_count > 64:
            raise _fail("The WAV contains too many chunks.")
        chunk_id = data[offset : offset + 4]
        chunk_size = struct.unpack_from("<I", data, offset + 4)[0]
        chunk_start = offset + 8
        chunk_end = chunk_start + chunk_size
        padded_end = chunk_end + (chunk_size & 1)
        if chunk_end > actual_size or padded_end > actual_size:
            raise _fail("The WAV contains a truncated chunk.")
        if chunk_id == b"fmt ":
            if fmt_chunk is not None:
                raise _fail("The WAV contains duplicate format chunks.")
            fmt_chunk = data[chunk_start:chunk_end]
        elif chunk_id == b"data":
            if fmt_chunk is None:
                raise _fail("The WAV data chunk appears before its format chunk.")
            if payload is not None:
                raise _fail("The WAV contains duplicate data chunks.")
            payload = data[chunk_start:chunk_end]
        offset = padded_end
    if offset != actual_size or fmt_chunk is None or payload is None:
        raise _fail("The WAV is missing required chunks.")
    if len(fmt_chunk) < 16:
        raise _fail("The WAV format chunk is truncated.")

    audio_format, channels, sample_rate, byte_rate, block_align, bits = struct.unpack_from(
        "<HHIIHH", fmt_chunk, 0
    )
    if audio_format == 0xFFFE:
        if len(fmt_chunk) < 40 or struct.unpack_from("<H", fmt_chunk, 16)[0] < 22:
            raise _fail("The extensible WAV format is invalid.")
        valid_bits = struct.unpack_from("<H", fmt_chunk, 18)[0]
        channel_mask = struct.unpack_from("<I", fmt_chunk, 20)[0]
        if valid_bits != bits or channel_mask not in {0, 0x4}:
            raise _fail("The extensible WAV channel or bit layout is invalid.")
        subformat = fmt_chunk[24:40]
        if subformat == _PCM_GUID:
            audio_format = 1
        elif subformat == _FLOAT_GUID:
            audio_format = 3
        else:
            raise _fail("The WAV codec is not supported.")
    if audio_format not in {1, 3}:
        raise _fail("Only uncompressed PCM or float WAV captures are supported.")
    if channels != 1:
        raise _fail("Version 1 requires a mono WAV capture.")
    if sample_rate < 8_000 or sample_rate > 96_000:
        raise _fail("The WAV sample rate is outside the supported range.")
    if audio_format == 1 and bits not in {16, 24, 32}:
        raise _fail("The PCM bit depth is not supported.")
    if audio_format == 3 and bits != 32:
        raise _fail("Only 32-bit IEEE float WAV captures are supported.")

    bytes_per_sample = bits // 8
    expected_align = channels * bytes_per_sample
    if block_align != expected_align or byte_rate != sample_rate * expected_align:
        raise _fail("The WAV format rates are inconsistent.")
    if not payload or len(payload) % block_align:
        raise _fail("The WAV sample data is empty or misaligned.")
    frame_count = len(payload) // block_align
    duration = frame_count / sample_rate
    if frame_count > 1_920_000 or duration > max_duration_seconds + (0.5 / sample_rate):
        raise _fail("The WAV capture exceeds the 20-second duration limit.")

    samples, codec = _decode_samples(payload, audio_format, bits)
    if samples.size != frame_count or not np.all(np.isfinite(samples)):
        raise _fail("The WAV contains invalid sample values.")
    if audio_format == 3 and np.any(np.abs(samples) > 1.000001):
        raise _fail("The float WAV contains out-of-range sample values.")
    samples = np.clip(samples, -1.0, 1.0).astype(np.float32, copy=False)
    metadata = AudioMetadata(
        sha256=actual_sha,
        byte_size=actual_size,
        codec=codec,
        sample_rate_hz=sample_rate,
        channels=1,
        bits_per_sample=bits,
        frame_count=frame_count,
        duration_seconds=round(duration, 6),
    )
    return DecodedWav(samples=samples, metadata=metadata)


def _decode_samples(payload: bytes, audio_format: int, bits: int) -> tuple[FloatSamples, Codec]:
    if audio_format == 3:
        return np.frombuffer(payload, dtype="<f4").astype(np.float32, copy=True), "float32le"
    if bits == 16:
        samples = np.frombuffer(payload, dtype="<i2").astype(np.float32) / 32768.0
        return samples, "pcm_s16le"
    if bits == 32:
        samples = np.frombuffer(payload, dtype="<i4").astype(np.float32) / 2_147_483_648.0
        return samples, "pcm_s32le"

    octets = np.frombuffer(payload, dtype=np.uint8).reshape(-1, 3)
    values = (
        octets[:, 0].astype(np.int32)
        | (octets[:, 1].astype(np.int32) << 8)
        | (octets[:, 2].astype(np.int32) << 16)
    )
    values = np.where(values & 0x800000, values - 0x1000000, values)
    return (values.astype(np.float32) / 8_388_608.0), "pcm_s24le"


def encode_pcm16_wav(samples: FloatSamples, sample_rate: int) -> bytes:
    clean = np.nan_to_num(samples, nan=0.0, posinf=1.0, neginf=-1.0)
    integers = np.clip(np.rint(clean * 32767.0), -32768, 32767).astype("<i2")
    payload = integers.tobytes()
    fmt = struct.pack("<HHIIHH", 1, 1, sample_rate, sample_rate * 2, 2, 16)
    riff_size = 4 + 8 + len(fmt) + 8 + len(payload)
    return b"".join(
        (
            b"RIFF",
            struct.pack("<I", riff_size),
            b"WAVEfmt ",
            struct.pack("<I", len(fmt)),
            fmt,
            b"data",
            struct.pack("<I", len(payload)),
            payload,
        )
    )
