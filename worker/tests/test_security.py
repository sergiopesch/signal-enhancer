from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import pytest
from pydantic import SecretStr

from signal_enhancer_worker.config import Settings
from signal_enhancer_worker.contracts import SignedGetObject, SignedPutObject
from signal_enhancer_worker.errors import InvalidSignedUrlError
from signal_enhancer_worker.security import validate_signed_url


def descriptor(url: str, *, expiry_minutes: int = 5) -> SignedGetObject:
    return SignedGetObject(
        object_path="captures/input-a.wav",
        url=SecretStr(url),
        expires_at=datetime.now(UTC) + timedelta(minutes=expiry_minutes),
        byte_size=44,
        sha256="0" * 64,
        content_type="audio/wav",
    )


@pytest.mark.parametrize(
    "url",
    [
        "http://storage.example/captures/input-a.wav",
        "file:///captures/input-a.wav",
        "https://user@storage.example/captures/input-a.wav",
        "https://storage.example:444/captures/input-a.wav",
        "https://storage.example/captures/input-a.wav#fragment",
        "https://storage.example/captures/%2Finput-a.wav",
        "https://storage.example/captures/other.wav",
        "https://storage.example.attacker.test/captures/input-a.wav",
    ],
)
def test_signed_url_rejects_ambiguous_or_non_allowlisted_urls(url: str, settings: Settings) -> None:
    with pytest.raises(InvalidSignedUrlError):
        validate_signed_url(descriptor(url), settings)


def test_signed_url_accepts_exact_https_path(settings: Settings) -> None:
    url = (
        "https://storage.example/captures/input-a.wav"
        "?vercel-blob-delegation=delegation&vercel-blob-signature=signature"
    )
    assert validate_signed_url(descriptor(url), settings) == url


def test_expired_and_long_lived_urls_are_rejected(settings: Settings) -> None:
    with pytest.raises(InvalidSignedUrlError):
        validate_signed_url(
            descriptor(
                "https://storage.example/captures/input-a.wav",
                expiry_minutes=-1,
            ),
            settings,
        )
    with pytest.raises(InvalidSignedUrlError):
        validate_signed_url(
            descriptor(
                "https://storage.example/captures/input-a.wav",
                expiry_minutes=30,
            ),
            settings,
        )


def test_put_url_requires_one_matching_signed_query_path(settings: Settings) -> None:
    path = "results/job/attempt/enhanced.wav"
    base = {
        "object_path": path,
        "expires_at": datetime.now(UTC) + timedelta(minutes=5),
        "max_bytes": 1024,
        "content_type": "audio/wav",
    }
    signed_query = urlencode(
        {
            "pathname": path,
            "vercel-blob-allow-overwrite": "false",
            "vercel-blob-add-random-suffix": "false",
            "vercel-blob-allowed-content-types": "audio/wav",
            "vercel-blob-maximum-size-in-bytes": "1024",
            "vercel-blob-delegation": "delegation",
            "vercel-blob-signature": "signature",
        }
    )
    accepted = SignedPutObject(
        **base,
        url=SecretStr(f"https://storage.example/?{signed_query}"),
    )
    assert "vercel-blob-signature=signature" in validate_signed_url(accepted, settings)

    for url in (
        "https://storage.example/results/job/attempt/enhanced.wav?signature=x",
        "https://storage.example/?pathname=results%2Fother%2Fenhanced.wav&signature=x",
        "https://storage.example/?pathname=results%2Fjob%2Fattempt%2Fenhanced.wav&pathname=other",
    ):
        rejected = SignedPutObject(**base, url=SecretStr(url))
        with pytest.raises(InvalidSignedUrlError):
            validate_signed_url(rejected, settings)
