"""Bounded private-object transfer without redirects, proxies, or URL logging."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
from pathlib import Path

import httpx

from signal_enhancer_worker.config import Settings
from signal_enhancer_worker.contracts import SignedGetObject, SignedPutObject
from signal_enhancer_worker.errors import IntegrityError, InvalidAudioError, StorageError
from signal_enhancer_worker.security import validate_signed_url


class StorageClient:
    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._settings = settings
        self._client = httpx.AsyncClient(
            transport=transport,
            follow_redirects=False,
            trust_env=False,
            timeout=httpx.Timeout(settings.storage_timeout_seconds, connect=8.0),
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
        )

    async def __aenter__(self) -> StorageClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self._client.aclose()

    async def download(self, descriptor: SignedGetObject, destination: Path) -> None:
        url = validate_signed_url(descriptor, self._settings)
        try:
            async with asyncio.timeout(self._settings.storage_timeout_seconds):
                downloaded, actual_hash = await self._stream_download(
                    url,
                    descriptor,
                    destination,
                )
        except (IntegrityError, InvalidAudioError, StorageError):
            raise
        except TimeoutError as exc:
            raise StorageError("capture download") from exc
        except (httpx.TimeoutException, httpx.NetworkError, OSError) as exc:
            raise StorageError("capture download") from exc

        if downloaded != descriptor.byte_size:
            raise IntegrityError("The stored capture size does not match its metadata.")
        if not hmac.compare_digest(actual_hash, descriptor.sha256):
            raise IntegrityError("The stored capture hash does not match its metadata.")

    async def _stream_download(
        self,
        url: str,
        descriptor: SignedGetObject,
        destination: Path,
    ) -> tuple[int, str]:
        digest = hashlib.sha256()
        downloaded = 0
        async with self._client.stream(
            "GET",
            url,
            headers={"Accept": "audio/wav", "Accept-Encoding": "identity"},
        ) as response:
            if response.status_code != 200:
                raise StorageError("capture download")
            encoding = response.headers.get("content-encoding", "identity").lower()
            if encoding not in {"", "identity"}:
                raise StorageError("capture download")
            declared_length = response.headers.get("content-length")
            if declared_length is not None:
                try:
                    declared = int(declared_length)
                except ValueError as exc:
                    raise StorageError("capture download") from exc
                if declared > self._settings.max_wav_bytes or declared != descriptor.byte_size:
                    raise IntegrityError("The stored capture size does not match its metadata.")
            with destination.open("xb") as output:
                async for chunk in response.aiter_bytes(64 * 1024):
                    downloaded += len(chunk)
                    if downloaded > self._settings.max_wav_bytes:
                        raise InvalidAudioError("The capture exceeds the 4 MiB limit.")
                    if downloaded > descriptor.byte_size:
                        raise IntegrityError("The stored capture is larger than its metadata.")
                    digest.update(chunk)
                    output.write(chunk)
        return downloaded, digest.hexdigest()

    async def upload(self, descriptor: SignedPutObject, source: Path) -> None:
        size = source.stat().st_size
        if size > descriptor.max_bytes:
            raise StorageError("artifact upload")
        url = validate_signed_url(descriptor, self._settings)
        try:
            async with asyncio.timeout(self._settings.storage_timeout_seconds):
                payload = await _read_bytes(source)
                response = await self._client.put(
                    url,
                    content=payload,
                    headers={
                        "Accept-Encoding": "identity",
                        "Content-Type": descriptor.content_type,
                        "Content-Length": str(size),
                    },
                )
            if response.status_code not in {200, 201, 204}:
                raise StorageError("artifact upload")
        except StorageError:
            raise
        except (TimeoutError, httpx.TimeoutException, httpx.NetworkError, OSError) as exc:
            raise StorageError("artifact upload") from exc


async def _read_bytes(path: Path) -> bytes:
    # Files are bounded to 4 MiB by the descriptor before this helper is called.
    return await asyncio.to_thread(path.read_bytes)
