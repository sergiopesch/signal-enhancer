"""Stable, URL-safe worker errors."""

from __future__ import annotations


class WorkerError(Exception):
    """An expected failure that is safe to map to the public API."""

    def __init__(self, code: str, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.safe_message = message
        self.status_code = status_code


class ConfigurationError(WorkerError):
    def __init__(self, message: str = "The upgrade engine is not ready.") -> None:
        super().__init__("worker_not_ready", message, 503)


class AuthenticationError(WorkerError):
    def __init__(self) -> None:
        super().__init__("unauthorized", "Valid worker authentication is required.", 401)


class InvalidSignedUrlError(WorkerError):
    def __init__(self) -> None:
        super().__init__("invalid_storage_url", "A storage URL is not permitted.", 422)


class InvalidAudioError(WorkerError):
    def __init__(self, message: str = "The capture is not a supported WAV file.") -> None:
        super().__init__("invalid_audio", message, 422)


class IntegrityError(WorkerError):
    def __init__(self, message: str = "The capture failed its integrity check.") -> None:
        super().__init__("integrity_mismatch", message, 422)


class StorageError(WorkerError):
    def __init__(self, operation: str) -> None:
        super().__init__(
            "storage_unavailable",
            f"Private storage was unavailable during {operation}.",
            502,
        )


class EngineError(WorkerError):
    def __init__(self, message: str = "The deeper restoration pass was unavailable.") -> None:
        super().__init__("restoration_unavailable", message, 503)


class BusyError(WorkerError):
    def __init__(self) -> None:
        super().__init__(
            "worker_busy",
            "The upgrade engine is already processing another capture.",
            429,
        )
