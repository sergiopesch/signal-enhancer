"""Authentication and signed storage URL validation."""

from __future__ import annotations

import hmac
import ipaddress
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, unquote, urlsplit

from signal_enhancer_worker.config import Settings
from signal_enhancer_worker.contracts import SignedGetObject, SignedPutObject
from signal_enhancer_worker.errors import AuthenticationError, InvalidSignedUrlError


def authenticate_endpoint_secret(supplied_secret: str | None, expected_secret: str) -> None:
    if not expected_secret:
        raise AuthenticationError()
    if supplied_secret is None:
        raise AuthenticationError()
    if not supplied_secret or not hmac.compare_digest(supplied_secret, expected_secret):
        raise AuthenticationError()


def _host_matches(hostname: str, patterns: tuple[str, ...]) -> bool:
    for pattern in patterns:
        if pattern.startswith("*."):
            suffix = pattern[1:]
            if hostname.endswith(suffix) and hostname != suffix[1:]:
                return True
        elif hostname == pattern:
            return True
    return False


def validate_signed_url(
    descriptor: SignedGetObject | SignedPutObject,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> str:
    raw_url = descriptor.url.get_secret_value()
    try:
        parsed = urlsplit(raw_url)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise InvalidSignedUrlError() from exc

    allowed_schemes = {"https"}
    if settings.allow_insecure_storage_http and settings.environment != "production":
        allowed_schemes.add("http")
    if parsed.scheme.lower() not in allowed_schemes:
        raise InvalidSignedUrlError()
    if any(ord(character) <= 32 or ord(character) == 127 for character in raw_url):
        raise InvalidSignedUrlError()
    if (
        not hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise InvalidSignedUrlError()

    if hostname.endswith("."):
        raise InvalidSignedUrlError()
    try:
        canonical_host = hostname.encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise InvalidSignedUrlError() from exc
    if canonical_host != hostname.lower():
        raise InvalidSignedUrlError()
    if not _host_matches(canonical_host, settings.allowed_storage_hosts):
        raise InvalidSignedUrlError()

    if port is not None:
        expected_port = 443 if parsed.scheme.lower() == "https" else 80
        if port != expected_port:
            raise InvalidSignedUrlError()

    try:
        ip = ipaddress.ip_address(canonical_host.strip("[]"))
    except ValueError:
        ip = None
    if ip is not None and (
        settings.environment == "production" or not settings.allow_insecure_storage_http
    ):
        raise InvalidSignedUrlError()

    try:
        signed_query = parse_qs(
            parsed.query,
            keep_blank_values=True,
            max_num_fields=32,
        )
    except ValueError as exc:
        raise InvalidSignedUrlError() from exc
    for credential in ("vercel-blob-delegation", "vercel-blob-signature"):
        values = signed_query.get(credential)
        if values is None or len(values) != 1 or not values[0]:
            raise InvalidSignedUrlError()

    if isinstance(descriptor, SignedGetObject):
        if "%2f" in parsed.path.lower() or "%5c" in parsed.path.lower():
            raise InvalidSignedUrlError()
        decoded_path = unquote(parsed.path).lstrip("/")
        if decoded_path != descriptor.object_path:
            raise InvalidSignedUrlError()
    else:
        # Vercel Blob presigned PUTs use the control-plane root path and bind the
        # object pathname in the signed query string.
        if parsed.path not in {"", "/"}:
            raise InvalidSignedUrlError()
        if signed_query.get("pathname") != [descriptor.object_path]:
            raise InvalidSignedUrlError()
        if signed_query.get("vercel-blob-allow-overwrite") != ["false"]:
            raise InvalidSignedUrlError()
        if signed_query.get("vercel-blob-add-random-suffix") != ["false"]:
            raise InvalidSignedUrlError()
        if signed_query.get("vercel-blob-allowed-content-types") != [descriptor.content_type]:
            raise InvalidSignedUrlError()
        try:
            signed_maximum = int(
                signed_query["vercel-blob-maximum-size-in-bytes"][0]
            )
        except (KeyError, IndexError, ValueError) as exc:
            raise InvalidSignedUrlError() from exc
        if signed_maximum <= 0 or signed_maximum > descriptor.max_bytes:
            raise InvalidSignedUrlError()

    current = now or datetime.now(UTC)
    expiry = descriptor.expires_at.astimezone(UTC)
    if expiry <= current + timedelta(seconds=3) or expiry > current + timedelta(minutes=15):
        raise InvalidSignedUrlError()
    return raw_url
