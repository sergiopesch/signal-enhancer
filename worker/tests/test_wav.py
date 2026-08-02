from __future__ import annotations

import hashlib
import struct

import numpy as np
import pytest

from signal_enhancer_worker.errors import IntegrityError, InvalidAudioError
from signal_enhancer_worker.wav import decode_and_validate_wav, encode_pcm16_wav

PCM_GUID = bytes.fromhex("0100000000001000800000aa00389b71")


def decode(payload: bytes, *, seconds: float = 20.0):
    return decode_and_validate_wav(
        payload,
        expected_sha256=hashlib.sha256(payload).hexdigest(),
        expected_bytes=len(payload),
        max_bytes=4 * 1024 * 1024,
        max_duration_seconds=seconds,
    )


def test_pcm16_round_trip_is_mono_and_bounded() -> None:
    source = np.asarray([-1.0, -0.25, 0.0, 0.25, 1.0], dtype=np.float32)
    encoded = encode_pcm16_wav(source, 48_000)
    decoded = decode(encoded)

    assert decoded.metadata.sample_rate_hz == 48_000
    assert decoded.metadata.frame_count == 5
    assert decoded.metadata.codec == "pcm_s16le"
    np.testing.assert_allclose(decoded.samples, source, atol=1 / 32767)


def test_integrity_is_checked_before_decode() -> None:
    encoded = encode_pcm16_wav(np.zeros(20, dtype=np.float32), 16_000)
    with pytest.raises(IntegrityError):
        decode_and_validate_wav(
            encoded,
            expected_sha256="0" * 64,
            expected_bytes=len(encoded),
            max_bytes=4 * 1024 * 1024,
            max_duration_seconds=20,
        )
    with pytest.raises(IntegrityError):
        decode_and_validate_wav(
            encoded,
            expected_sha256=hashlib.sha256(encoded).hexdigest(),
            expected_bytes=len(encoded) + 1,
            max_bytes=4 * 1024 * 1024,
            max_duration_seconds=20,
        )


@pytest.mark.parametrize(
    "mutate",
    [
        lambda wav: b"NOPE" + wav[4:],
        lambda wav: wav[:4] + struct.pack("<I", 1) + wav[8:],
        lambda wav: wav[:20],
        lambda wav: wav[:12] + wav[12:36] + wav[12:36] + wav[36:],
    ],
)
def test_malformed_riff_is_rejected(mutate) -> None:
    encoded = encode_pcm16_wav(np.zeros(20, dtype=np.float32), 16_000)
    malformed = mutate(encoded)
    with pytest.raises(InvalidAudioError):
        decode(malformed)


def test_duration_limit_rejects_one_extra_frame() -> None:
    encoded = encode_pcm16_wav(np.zeros(16_001, dtype=np.float32), 8_000)
    with pytest.raises(InvalidAudioError):
        decode(encoded, seconds=2.0)


def test_float_nan_is_rejected() -> None:
    samples = np.asarray([0.0, np.nan], dtype="<f4").tobytes()
    fmt = struct.pack("<HHIIHH", 3, 1, 16_000, 64_000, 4, 32)
    riff_size = 4 + 8 + len(fmt) + 8 + len(samples)
    encoded = b"".join(
        (
            b"RIFF",
            struct.pack("<I", riff_size),
            b"WAVEfmt ",
            struct.pack("<I", len(fmt)),
            fmt,
            b"data",
            struct.pack("<I", len(samples)),
            samples,
        )
    )
    with pytest.raises(InvalidAudioError):
        decode(encoded)


def test_stereo_and_compressed_codecs_are_rejected() -> None:
    payload = b"\x00\x00\x00\x00"
    for codec, channels, bits in [(1, 2, 16), (6, 1, 8)]:
        align = channels * max(1, bits // 8)
        fmt = struct.pack("<HHIIHH", codec, channels, 16_000, 16_000 * align, align, bits)
        riff_size = 4 + 8 + len(fmt) + 8 + len(payload)
        encoded = b"".join(
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
        with pytest.raises(InvalidAudioError):
            decode(encoded)


def extensible_pcm(*, valid_bits: int = 16, channel_mask: int = 0x4) -> bytes:
    payload = struct.pack("<hh", -1024, 1024)
    fmt = b"".join(
        (
            struct.pack("<HHIIHH", 0xFFFE, 1, 16_000, 32_000, 2, 16),
            struct.pack("<HHI", 22, valid_bits, channel_mask),
            PCM_GUID,
        )
    )
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


def test_valid_extensible_pcm_is_supported() -> None:
    decoded = decode(extensible_pcm())
    assert decoded.metadata.codec == "pcm_s16le"
    assert decoded.metadata.frame_count == 2


@pytest.mark.parametrize(
    ("valid_bits", "channel_mask"),
    [(12, 0x4), (16, 0x3)],
)
def test_inconsistent_extensible_layout_is_rejected(
    valid_bits: int,
    channel_mask: int,
) -> None:
    with pytest.raises(InvalidAudioError):
        decode(extensible_pcm(valid_bits=valid_bits, channel_mask=channel_mask))
