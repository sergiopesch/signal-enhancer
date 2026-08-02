"""FastAPI application for the private Hugging Face endpoint."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Literal

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from signal_enhancer_worker.config import Settings
from signal_enhancer_worker.contracts import (
    AnalyzeRequest,
    AnalyzeResponse,
    EnhanceRequest,
    ErrorResponse,
    HealthResponse,
)
from signal_enhancer_worker.errors import AuthenticationError, WorkerError
from signal_enhancer_worker.observability import configure_safe_logging
from signal_enhancer_worker.security import authenticate_endpoint_secret
from signal_enhancer_worker.service import WorkerRuntime

NO_STORE_HEADERS = {
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
}


def _request_id() -> str:
    return str(uuid.uuid4())


def _retryable(status_code: int) -> bool:
    return status_code in {429, 502, 503, 504}


def _error_response(error: WorkerError, request_id: str) -> JSONResponse:
    body = ErrorResponse(
        request_id=request_id,
        code=error.code,
        message=error.safe_message,
        retryable=_retryable(error.status_code),
    )
    headers = {**NO_STORE_HEADERS, "X-Request-ID": request_id}
    if error.status_code == 429:
        headers["Retry-After"] = "2"
    return JSONResponse(
        body.model_dump(mode="json"),
        status_code=error.status_code,
        headers=headers,
    )


class AuthorizationGuard:
    """Authenticate protected routes before reading or validating their bodies."""

    def __init__(self, app: ASGIApp, secret: str) -> None:
        self.app = app
        self.secret = secret

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("path") == "/health":
            await self.app(scope, receive, send)
            return
        values = [
            value.decode("latin-1")
            for key, value in scope.get("headers", [])
            if key.lower() == b"x-signal-endpoint-secret"
        ]
        try:
            if len(values) != 1:
                raise AuthenticationError()
            authenticate_endpoint_secret(values[0], self.secret)
        except AuthenticationError as error:
            response = _error_response(error, _request_id())
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


class RequestBodyGuard:
    """Reject non-JSON and oversized POST bodies before framework buffering."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") != "POST":
            await self.app(scope, receive, send)
            return
        raw_headers = scope.get("headers", [])
        content_types = [
            value for key, value in raw_headers if key.lower() == b"content-type"
        ]
        if len(content_types) != 1:
            await self._reject(
                send,
                415,
                "unsupported_media_type",
                "Exactly one application/json Content-Type is required.",
            )
            return
        content_type = content_types[0].split(b";", 1)[0].strip().lower()
        if content_type != b"application/json":
            await self._reject(
                send,
                415,
                "unsupported_media_type",
                "Content-Type must be application/json.",
            )
            return
        declared_values = [
            value for key, value in raw_headers if key.lower() == b"content-length"
        ]
        if len(declared_values) > 1:
            await self._reject(
                send,
                400,
                "invalid_request",
                "The request headers are malformed.",
            )
            return
        declared_size: int | None = None
        if declared_values:
            try:
                declared_size = int(declared_values[0])
                if declared_size < 0:
                    raise ValueError
                if declared_size > self.max_bytes:
                    await self._reject(
                        send,
                        413,
                        "request_too_large",
                        "The request body is too large.",
                    )
                    return
            except ValueError:
                await self._reject(
                    send,
                    400,
                    "invalid_request",
                    "The request headers are malformed.",
                )
                return

        body = bytearray()
        more_body = True
        while more_body:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > self.max_bytes:
                await self._reject(send, 413, "request_too_large", "The request body is too large.")
                return
            more_body = bool(message.get("more_body", False))
        if declared_size is not None and declared_size != len(body):
            await self._reject(
                send,
                400,
                "invalid_request",
                "The request body length is inconsistent.",
            )
            return
        delivered = False

        async def replay() -> Message:
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay, send)

    @staticmethod
    async def _reject(send: Send, status: int, code: str, message: str) -> None:
        request_id = _request_id()
        payload = ErrorResponse(
            request_id=request_id,
            code=code,
            message=message,
            retryable=False,
        ).model_dump_json().encode()
        headers = [
            (b"content-type", b"application/json"),
            (b"cache-control", b"no-store"),
            (b"x-content-type-options", b"nosniff"),
            (b"x-request-id", request_id.encode()),
        ]
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": payload})


def create_app(
    settings: Settings | None = None,
    *,
    storage_transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    runtime = WorkerRuntime(resolved_settings, storage_transport=storage_transport)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        configure_safe_logging()
        await runtime.initialize()
        yield

    application = FastAPI(
        title="Signal Enhancer Worker",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    application.add_middleware(RequestBodyGuard, max_bytes=resolved_settings.max_request_bytes)
    application.add_middleware(AuthorizationGuard, secret=resolved_settings.endpoint_secret)
    application.state.runtime = runtime

    @application.exception_handler(WorkerError)
    async def worker_error_handler(_: Request, error: WorkerError) -> JSONResponse:
        return _error_response(error, _request_id())

    @application.exception_handler(RequestValidationError)
    async def validation_error_handler(_: Request, __: RequestValidationError) -> JSONResponse:
        worker_error = WorkerError(
            "invalid_request",
            "The request does not match the strict v1 schema.",
            422,
        )
        return _error_response(worker_error, _request_id())

    @application.exception_handler(Exception)
    async def unexpected_error_handler(_: Request, __: Exception) -> JSONResponse:
        worker_error = WorkerError(
            "internal_error",
            "The worker could not complete the request.",
            500,
        )
        return _error_response(worker_error, _request_id())

    def authorize() -> None:
        runtime.require_ready()

    @application.get("/health", response_model=HealthResponse)
    async def health() -> Response:
        status: Literal["ready", "starting"] = "ready" if runtime.ready else "starting"
        return JSONResponse(
            HealthResponse(status=status).model_dump(mode="json"),
            status_code=200 if runtime.ready else 503,
            headers=NO_STORE_HEADERS,
        )

    @application.get("/version", response_model=None)
    async def version() -> JSONResponse:
        authorize()
        return JSONResponse(runtime.versions().model_dump(mode="json"), headers=NO_STORE_HEADERS)

    @application.post("/v1/analyze", response_model=AnalyzeResponse)
    async def analyze(
        body: AnalyzeRequest,
    ) -> JSONResponse:
        authorize()
        result = await runtime.analyze(body)
        return JSONResponse(result.model_dump(mode="json"), headers=NO_STORE_HEADERS)

    @application.post("/v1/enhance", response_model=None)
    async def enhance(
        body: EnhanceRequest,
        request: Request,
    ) -> JSONResponse | StreamingResponse:
        authorize()
        accepts_ndjson = "application/x-ndjson" in request.headers.get("accept", "").lower()
        if not accepts_ndjson:
            result = await runtime.enhance(body)
            return JSONResponse(result.model_dump(mode="json"), headers=NO_STORE_HEADERS)

        async def stream() -> AsyncIterator[bytes]:
            try:
                async for event in runtime.enhance_events(body):
                    yield _ndjson(event.model_dump(mode="json"))
            except WorkerError as error:
                yield _ndjson(
                    {
                        "schema_version": "1",
                        "type": "error",
                        "sequence": 8,
                        "error": ErrorResponse(
                            request_id=_request_id(),
                            code=error.code,
                            message=error.safe_message,
                            retryable=_retryable(error.status_code),
                        ).model_dump(mode="json"),
                    }
                )
            except Exception:
                yield _ndjson(
                    {
                        "schema_version": "1",
                        "type": "error",
                        "sequence": 8,
                        "error": ErrorResponse(
                            request_id=_request_id(),
                            code="internal_error",
                            message="The worker could not complete the request.",
                            retryable=False,
                        ).model_dump(mode="json"),
                    }
                )

        return StreamingResponse(
            stream(),
            media_type="application/x-ndjson",
            headers=NO_STORE_HEADERS,
        )

    return application


def _ndjson(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n").encode()


app = create_app()
