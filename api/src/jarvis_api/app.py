from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import logging
import re
import secrets
import time
import uuid
from dataclasses import dataclass
from typing import Any, Protocol

from aiohttp import web

from .audio import (
    AudioFailureStage,
    AudioFailureSubtype,
    AudioFormatError,
    FFmpegAudioProcessor,
)
from .config import Config
from .models import RenderedAudio, SessionRecord, TurnRecord
from .policy import UnsafeIntentError, enforce_safe_intent
from .storage import EphemeralStore, FixedWindowRateLimiter
from .upstreams import OpenAIReasoningClient, UpstreamError, VoiceClient as UpstreamVoiceClient


LOGGER = logging.getLogger(__name__)


class VoiceClient(Protocol):
    async def transcribe(self, wav_audio: bytes) -> str: ...

    async def synthesize(self, text: str, voice: str) -> bytes: ...

    async def close(self) -> None: ...


class ReasoningClient(Protocol):
    async def process(self, text: str, conversation_id: str) -> str: ...

    async def close(self) -> None: ...


class AudioProcessor(Protocol):
    async def normalize_input(self, payload: bytes, input_format: str) -> bytes: ...

    async def render_output(self, payload: bytes) -> RenderedAudio: ...


@dataclass(frozen=True, slots=True)
class ParsedTurn:
    session_id: str
    turn_id: str
    input_type: str
    text: str
    audio: bytes
    audio_format: str
    response_format: str


class APIError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        *,
        normalization_subtype: AudioFailureSubtype | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.normalization_subtype = normalization_subtype


CONFIG = web.AppKey("config", Config)
STORE = web.AppKey("store", EphemeralStore)
LIMITER = web.AppKey("limiter", FixedWindowRateLimiter)
SEMAPHORE = web.AppKey("turn_semaphore", asyncio.Semaphore)
VOICE = web.AppKey("voice", VoiceClient)
REASONING = web.AppKey("reasoning", ReasoningClient)
AUDIO = web.AppKey("audio", AudioProcessor)

_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")
_ALLOWED_JSON_TURN_KEYS = {"session_id", "turn_id", "input", "response_format"}


def create_app(
    config: Config,
    *,
    voice_client: VoiceClient | None = None,
    reasoning_client: ReasoningClient | None = None,
    audio_processor: AudioProcessor | None = None,
) -> web.Application:
    app = web.Application(
        client_max_size=config.max_payload_bytes,
        middlewares=[_error_middleware, _origin_middleware],
    )
    app[CONFIG] = config
    app[STORE] = EphemeralStore(
        max_sessions=config.max_sessions,
        max_turns=config.max_turns,
        max_audio_bytes=config.max_audio_store_bytes,
    )
    app[LIMITER] = FixedWindowRateLimiter(
        limit=config.rate_limit_requests,
        window_seconds=config.rate_limit_window_seconds,
    )
    app[SEMAPHORE] = asyncio.Semaphore(config.max_concurrent_turns)
    app[VOICE] = voice_client or UpstreamVoiceClient(
        stt_url=config.stt_url,
        tts_url=config.tts_url,
        timeout_seconds=config.upstream_timeout_seconds,
        max_audio_bytes=config.max_audio_bytes,
    )
    if reasoning_client is not None:
        app[REASONING] = reasoning_client
    else:
        reasoning_api_key = ""
        if config.reasoning_api_key_file is not None:
            try:
                reasoning_api_key = config.reasoning_api_key_file.read_text().strip()
            except OSError as error:
                raise ValueError("Jarvis reasoning credential is unavailable") from error
            if not reasoning_api_key:
                raise ValueError("Jarvis reasoning credential is empty")
        app[REASONING] = OpenAIReasoningClient(
            base_url=config.reasoning_url,
            model=config.reasoning_model,
            api_key=reasoning_api_key,
            timeout_seconds=config.upstream_timeout_seconds,
            max_sessions=config.max_sessions,
        )

    app[AUDIO] = audio_processor or FFmpegAudioProcessor(
        temp_root=config.temp_root,
        max_seconds=config.max_audio_seconds,
    )
    app.router.add_get("/api/v1/health", _health)
    app.router.add_post("/api/v1/sessions", _create_session)
    app.router.add_post("/api/v1/turns", _create_turn)
    app.router.add_post("/api/v1/turns/{turn_id}/cancel", _cancel_turn)
    app.router.add_get("/api/v1/turns/{turn_id}/audio", _turn_audio)
    app.on_cleanup.append(_cleanup)
    return app


@web.middleware
async def _error_middleware(request: web.Request, handler):
    request["request_id"] = uuid.uuid4().hex
    error_code = None
    normalization_subtype = None
    try:
        response = await handler(request)
    except APIError as error:
        error_code = error.code
        normalization_subtype = error.normalization_subtype
        response = _error_response(request, error.status, error.code, error.message)
    except web.HTTPRequestEntityTooLarge:
        error_code = "payload_too_large"
        response = _error_response(
            request, 413, "payload_too_large", "Request payload exceeds the configured limit."
        )
    except (json.JSONDecodeError, UnicodeDecodeError):
        error_code = "invalid_request"
        response = _error_response(request, 400, "invalid_request", "Request body is invalid.")
    except Exception:
        error_code = "internal_error"
        response = _error_response(request, 500, "internal_error", "The request could not be completed.")
    if error_code is not None:
        if normalization_subtype is None:
            LOGGER.warning(
                "request_failed status=%s code=%s request_id=%s",
                response.status,
                error_code,
                request["request_id"],
            )
        else:
            LOGGER.warning(
                "request_failed status=%s code=%s request_id=%s normalization_subtype=%s",
                response.status,
                error_code,
                request["request_id"],
                normalization_subtype.value,
            )
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@web.middleware
async def _origin_middleware(request: web.Request, handler):
    origin = request.headers.get("Origin")
    if origin is not None and origin != request.app[CONFIG].allowed_origin:
        raise APIError(403, "origin_denied", "Request origin is not allowed.")
    return await handler(request)


async def _health(request: web.Request) -> web.Response:
    return web.json_response({"status": "ready", "api_version": "v1"})


async def _create_session(request: web.Request) -> web.Response:
    key = _idempotency_key(request)
    store = request.app[STORE]
    scope = f"session:{request.remote or 'local'}"
    cached = store.get_cached_response(scope, key)
    if cached is not None:
        return web.json_response(cached.body, status=cached.status)

    now = store.clock()
    config = request.app[CONFIG]
    session = SessionRecord(
        session_id=str(uuid.uuid4()),
        csrf_token=secrets.token_urlsafe(32),
        created_at=now,
        expires_at=now + config.session_ttl_seconds,
    )
    store.put_session(session)
    body = {
        "session_id": session.session_id,
        "csrf_token": session.csrf_token,
        "expires_in_seconds": int(config.session_ttl_seconds),
    }
    store.cache_response(scope, key, "create-session-v1", 201, body)
    return web.json_response(body, status=201)


async def _create_turn(request: web.Request) -> web.Response:
    parsed = await _parse_turn(request)
    session = _authorized_session(request, parsed.session_id)
    key = _idempotency_key(request)
    store = request.app[STORE]
    fingerprint = _turn_fingerprint(parsed)
    scope = f"turn:{session.session_id}"
    cached = store.get_cached_response(scope, key)
    if cached is not None:
        if not hmac.compare_digest(cached.fingerprint, fingerprint):
            raise APIError(409, "idempotency_conflict", "Idempotency key was already used.")
        return web.json_response(cached.body, status=cached.status)

    if store.get_turn(parsed.turn_id) is not None:
        raise APIError(409, "turn_exists", "Turn identifier is already in use.")
    if session.active_turn_id is not None:
        raise APIError(409, "session_busy", "This session already has an active turn.")
    if not request.app[LIMITER].admit(session.session_id):
        raise APIError(429, "rate_limited", "Turn rate limit exceeded. Try again later.")

    now = store.clock()
    config = request.app[CONFIG]
    turn = TurnRecord(
        turn_id=parsed.turn_id,
        session_id=session.session_id,
        created_at=now,
        expires_at=now + config.turn_ttl_seconds,
        task=asyncio.current_task(),
    )
    session.active_turn_id = turn.turn_id
    store.put_turn(turn)

    try:
        async with request.app[SEMAPHORE]:
            transcript = await _transcript(request, parsed)
            if len(transcript) > config.max_text_chars:
                raise APIError(422, "transcript_too_long", "Recognized speech exceeds the text limit.")
            enforce_safe_intent(transcript)
            response_text = await request.app[REASONING].process(
                transcript, session.session_id
            )
            response_text = response_text.strip()
            if not response_text:
                raise UpstreamError("empty reasoning response")
            if len(response_text) > config.max_response_chars:
                response_text = response_text[: config.max_response_chars - 1].rstrip() + "…"
            synthesized = await request.app[VOICE].synthesize(
                response_text, config.piper_voice
            )
            rendered = await request.app[AUDIO].render_output(synthesized)
            if len(rendered.wav) + len(rendered.mp3) > config.max_audio_store_bytes:
                raise UpstreamError("rendered audio exceeds ephemeral storage bound")
            turn.transcript = transcript
            turn.response_text = response_text
            turn.wav = rendered.wav
            turn.mp3 = rendered.mp3
            turn.state = "complete"
            turn.task = None
            store.put_turn(turn)
            body = _turn_body(turn, parsed.response_format)
            store.cache_response(scope, key, fingerprint, 201, body)
            return web.json_response(body, status=201)
    except asyncio.CancelledError:
        turn.state = "cancelled"
        turn.task = None
        return _error_response(
            request, 409, "turn_cancelled", "The turn was cancelled before completion."
        )
    except UnsafeIntentError as error:
        turn.state = "rejected"
        turn.task = None
        raise APIError(403, "unsafe_intent", "That intent is not available in Jarvis.") from error
    except AudioFormatError as error:
        turn.state = "failed"
        turn.task = None
        subtype = (
            error.subtype if error.stage is AudioFailureStage.NORMALIZATION else None
        )
        raise APIError(
            422,
            "invalid_audio",
            "Audio could not be accepted.",
            normalization_subtype=subtype,
        ) from error
    except UpstreamError as error:
        turn.state = "failed"
        turn.task = None
        raise APIError(502, "upstream_unavailable", "A voice or reasoning service is unavailable.") from error
    finally:
        if session.active_turn_id == turn.turn_id:
            session.active_turn_id = None


async def _cancel_turn(request: web.Request) -> web.Response:
    turn_id = _validated_id(request.match_info["turn_id"], "turn_id")
    try:
        data = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as error:
        raise APIError(400, "invalid_request", "Request body is invalid.") from error
    if not isinstance(data, dict) or set(data) != {"session_id"}:
        raise APIError(400, "invalid_request", "Cancel request schema is invalid.")
    session = _authorized_session(request, data.get("session_id"))
    key = _idempotency_key(request)
    store = request.app[STORE]
    scope = f"cancel:{session.session_id}:{turn_id}"
    cached = store.get_cached_response(scope, key)
    if cached is not None:
        return web.json_response(cached.body, status=cached.status)

    turn = store.get_turn(turn_id)
    if turn is None or turn.session_id != session.session_id:
        raise APIError(404, "turn_not_found", "Turn was not found.")
    if turn.state == "complete":
        raise APIError(409, "turn_complete", "Completed turns cannot be cancelled.")
    turn.state = "cancelled"
    task = turn.task
    if task is not None and task is not asyncio.current_task() and not task.done():
        task.cancel()
    body = {"turn_id": turn.turn_id, "state": "cancelled"}
    store.cache_response(scope, key, "cancel-v1", 202, body)
    return web.json_response(body, status=202)


async def _turn_audio(request: web.Request) -> web.Response:
    turn_id = _validated_id(request.match_info["turn_id"], "turn_id")
    session_id = request.headers.get("X-Jarvis-Session", "")
    session = _authorized_session(request, session_id)
    turn = request.app[STORE].get_turn(turn_id)
    if turn is None or turn.session_id != session.session_id or turn.state != "complete":
        raise APIError(404, "audio_not_found", "Turn audio was not found.")
    audio_format = request.query.get("format", "wav")
    if audio_format == "wav":
        payload, content_type = turn.wav, "audio/wav"
    elif audio_format == "mp3":
        payload, content_type = turn.mp3, "audio/mpeg"
    else:
        raise APIError(400, "invalid_format", "Audio format must be wav or mp3.")
    return web.Response(
        body=payload,
        content_type=content_type,
        headers={"Content-Disposition": f'inline; filename="jarvis-{turn_id}.{audio_format}"'},
    )


async def _parse_turn(request: web.Request) -> ParsedTurn:
    if request.content_type == "application/json":
        try:
            data = await request.json()
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as error:
            raise APIError(400, "invalid_request", "Request body is invalid.") from error
        return _parse_json_turn(data, request.app[CONFIG])
    if request.content_type == "multipart/form-data":
        return await _parse_multipart_turn(request)
    raise APIError(415, "unsupported_media_type", "Use JSON or multipart form data.")


def _parse_json_turn(data: Any, config: Config) -> ParsedTurn:
    if not isinstance(data, dict) or set(data) != _ALLOWED_JSON_TURN_KEYS:
        raise APIError(400, "invalid_request", "Turn request schema is invalid.")
    session_id = _validated_id(data.get("session_id"), "session_id")
    turn_id = _validated_id(data.get("turn_id"), "turn_id")
    response_format = _response_format(data.get("response_format"))
    value = data.get("input")
    if not isinstance(value, dict) or value.get("type") not in {"text", "audio"}:
        raise APIError(400, "invalid_request", "Turn input schema is invalid.")
    if value["type"] == "text":
        if set(value) != {"type", "text"} or not isinstance(value.get("text"), str):
            raise APIError(400, "invalid_request", "Text input schema is invalid.")
        text = " ".join(value["text"].split())
        if not text:
            raise APIError(400, "invalid_request", "Text input cannot be empty.")
        if len(text) > config.max_text_chars:
            raise APIError(413, "text_too_large", "Text input exceeds the configured limit.")
        return ParsedTurn(session_id, turn_id, "text", text, b"", "", response_format)

    if set(value) != {"type", "audio_format", "audio_base64"}:
        raise APIError(400, "invalid_request", "Audio input schema is invalid.")
    audio_format = value.get("audio_format")
    if audio_format not in {"opus", "webm", "wav"}:
        raise APIError(400, "invalid_format", "Audio format is not supported.")
    encoded = value.get("audio_base64")
    if not isinstance(encoded, str):
        raise APIError(400, "invalid_request", "Audio payload is invalid.")
    try:
        payload = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise APIError(400, "invalid_request", "Audio payload is invalid.") from error
    _validate_audio_size(payload, config)
    return ParsedTurn(session_id, turn_id, "audio", "", payload, audio_format, response_format)


async def _parse_multipart_turn(request: web.Request) -> ParsedTurn:
    config = request.app[CONFIG]
    reader = await request.multipart()
    fields: dict[str, str] = {}
    audio = b""
    audio_format = ""
    seen: set[str] = set()
    async for part in reader:
        name = part.name or ""
        if name in seen or name not in {"session_id", "turn_id", "response_format", "audio"}:
            raise APIError(400, "invalid_request", "Multipart turn schema is invalid.")
        seen.add(name)
        if name == "audio":
            chunks = bytearray()
            while True:
                chunk = await part.read_chunk()
                if not chunk:
                    break
                chunks.extend(chunk)
                if len(chunks) > config.max_audio_bytes:
                    raise APIError(413, "audio_too_large", "Audio exceeds the configured limit.")
            audio = bytes(chunks)
            content_type = (part.headers.get("Content-Type") or "").split(";", 1)[0].lower()
            audio_format = {
                "audio/webm": "webm",
                "video/webm": "webm",
                "audio/opus": "opus",
                "audio/ogg": "opus",
                "audio/wav": "wav",
                "audio/x-wav": "wav",
            }.get(content_type, "")
        else:
            fields[name] = await part.text()
    if seen != {"session_id", "turn_id", "response_format", "audio"} or not audio_format:
        raise APIError(400, "invalid_request", "Multipart turn schema is invalid.")
    _validate_audio_size(audio, config)
    return ParsedTurn(
        _validated_id(fields.get("session_id"), "session_id"),
        _validated_id(fields.get("turn_id"), "turn_id"),
        "audio",
        "",
        audio,
        audio_format,
        _response_format(fields.get("response_format")),
    )


async def _transcript(request: web.Request, parsed: ParsedTurn) -> str:
    if parsed.input_type == "text":
        return parsed.text
    normalized = await request.app[AUDIO].normalize_input(parsed.audio, parsed.audio_format)
    transcript = (await request.app[VOICE].transcribe(normalized)).strip()
    if not transcript:
        raise UpstreamError("empty transcript")
    return transcript


def _authorized_session(request: web.Request, body_session_id: Any) -> SessionRecord:
    if not isinstance(body_session_id, str):
        raise APIError(400, "invalid_request", "Session identifier is invalid.")
    header_session = request.headers.get("X-Jarvis-Session", "")
    token = request.headers.get("X-Jarvis-CSRF", "")
    if not hmac.compare_digest(header_session, body_session_id):
        raise APIError(403, "session_denied", "Session authorization failed.")
    session = request.app[STORE].get_session(body_session_id)
    if session is None or not token or not hmac.compare_digest(session.csrf_token, token):
        raise APIError(403, "session_denied", "Session authorization failed.")
    return session


def _idempotency_key(request: web.Request) -> str:
    key = request.headers.get("Idempotency-Key", "")
    if not _ID_PATTERN.fullmatch(key):
        raise APIError(400, "idempotency_required", "A valid Idempotency-Key is required.")
    return key


def _validated_id(value: Any, field: str) -> str:
    if not isinstance(value, str) or not _ID_PATTERN.fullmatch(value):
        raise APIError(400, "invalid_request", f"{field} is invalid.")
    return value


def _response_format(value: Any) -> str:
    if value not in {"wav", "mp3"}:
        raise APIError(400, "invalid_format", "Response format must be wav or mp3.")
    return value


def _validate_audio_size(payload: bytes, config: Config) -> None:
    if not payload:
        raise APIError(400, "invalid_request", "Audio payload cannot be empty.")
    if len(payload) > config.max_audio_bytes:
        raise APIError(413, "audio_too_large", "Audio exceeds the configured limit.")


def _turn_fingerprint(parsed: ParsedTurn) -> str:
    digest = hashlib.sha256()
    digest.update(parsed.session_id.encode())
    digest.update(b"\0")
    digest.update(parsed.turn_id.encode())
    digest.update(b"\0")
    digest.update(parsed.input_type.encode())
    digest.update(b"\0")
    digest.update(parsed.response_format.encode())
    digest.update(b"\0")
    digest.update(parsed.audio_format.encode())
    digest.update(b"\0")
    digest.update(parsed.text.encode())
    digest.update(parsed.audio)
    return digest.hexdigest()


def _turn_body(turn: TurnRecord, response_format: str) -> dict[str, Any]:
    content_type = "audio/wav" if response_format == "wav" else "audio/mpeg"
    return {
        "turn_id": turn.turn_id,
        "session_id": turn.session_id,
        "state": turn.state,
        "transcript": turn.transcript,
        "response_text": turn.response_text,
        "audio": {
            "url": f"/api/v1/turns/{turn.turn_id}/audio?format={response_format}",
            "format": response_format,
            "content_type": content_type,
        },
    }


def _error_response(
    request: web.Request, status: int, code: str, message: str
) -> web.Response:
    return web.json_response(
        {
            "error": {
                "code": code,
                "message": message,
                "request_id": request.get("request_id", uuid.uuid4().hex),
            }
        },
        status=status,
    )


async def _cleanup(app: web.Application) -> None:
    await app[VOICE].close()
    await app[REASONING].close()
