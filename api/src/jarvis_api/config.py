from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


@dataclass(frozen=True, slots=True)
class Config:
    allowed_origin: str = "https://jarvis.example"
    stt_url: str = ""
    tts_url: str = ""
    reasoning_backend: str = "direct"
    reasoning_url: str = ""
    reasoning_model: str = ""
    reasoning_api_key_file: Path | None = None
    n8n_webhook_url: str = ""
    n8n_api_key_file: Path | None = None
    piper_voice: str = "piper:en_US-danny-low"
    upstream_timeout_seconds: float = 30.0
    max_payload_bytes: int = 2_000_000
    max_audio_bytes: int = 1_500_000
    max_audio_seconds: float = 15.0
    max_text_chars: int = 2_000
    max_response_chars: int = 4_000
    max_concurrent_turns: int = 2
    rate_limit_requests: int = 12
    rate_limit_window_seconds: float = 60.0
    session_ttl_seconds: float = 1_800.0
    turn_ttl_seconds: float = 600.0
    max_sessions: int = 100
    max_turns: int = 100
    max_audio_store_bytes: int = 32_000_000
    temp_root: Path = Path("/tmp/jarvis")
    host: str = "0.0.0.0"
    port: int = 8080

    @classmethod
    def from_env(cls) -> "Config":
        config = cls(
            allowed_origin=os.getenv("JARVIS_ALLOWED_ORIGIN", cls.allowed_origin),
            stt_url=os.getenv("JARVIS_STT_URL", ""),
            tts_url=os.getenv("JARVIS_TTS_URL", ""),
            reasoning_backend=os.getenv("JARVIS_REASONING_BACKEND", "direct").strip(),
            reasoning_url=os.getenv("JARVIS_REASONING_URL", ""),
            reasoning_model=os.getenv("JARVIS_REASONING_MODEL", ""),
            reasoning_api_key_file=_optional_path("JARVIS_REASONING_API_KEY_FILE"),
            n8n_webhook_url=os.getenv("JARVIS_N8N_WEBHOOK_URL", ""),
            n8n_api_key_file=_optional_path("JARVIS_N8N_API_KEY_FILE"),
            piper_voice=os.getenv("JARVIS_PIPER_VOICE", cls.piper_voice),
            upstream_timeout_seconds=_float("JARVIS_UPSTREAM_TIMEOUT_SECONDS", 30.0),
            max_payload_bytes=_int("JARVIS_MAX_PAYLOAD_BYTES", 2_000_000),
            max_audio_bytes=_int("JARVIS_MAX_AUDIO_BYTES", 1_500_000),
            max_audio_seconds=_float("JARVIS_MAX_AUDIO_SECONDS", 15.0),
            max_text_chars=_int("JARVIS_MAX_TEXT_CHARS", 2_000),
            max_response_chars=_int("JARVIS_MAX_RESPONSE_CHARS", 4_000),
            max_concurrent_turns=_int("JARVIS_MAX_CONCURRENT_TURNS", 2),
            rate_limit_requests=_int("JARVIS_RATE_LIMIT_REQUESTS", 12),
            rate_limit_window_seconds=_float("JARVIS_RATE_LIMIT_WINDOW_SECONDS", 60.0),
            session_ttl_seconds=_float("JARVIS_SESSION_TTL_SECONDS", 1_800.0),
            turn_ttl_seconds=_float("JARVIS_TURN_TTL_SECONDS", 600.0),
            max_sessions=_int("JARVIS_MAX_SESSIONS", 100),
            max_turns=_int("JARVIS_MAX_TURNS", 100),
            max_audio_store_bytes=_int("JARVIS_MAX_AUDIO_STORE_BYTES", 32_000_000),
            temp_root=Path(os.getenv("JARVIS_TEMP_ROOT", "/tmp/jarvis")),
            host=os.getenv("JARVIS_HOST", "0.0.0.0"),
            port=_int("JARVIS_PORT", 8080),
        )
        config.validate()
        return config

    def validate(self) -> None:
        _absolute_url("JARVIS_ALLOWED_ORIGIN", self.allowed_origin, require_https=True)
        _absolute_url("JARVIS_STT_URL", self.stt_url, allow_host_bridge=True)
        _absolute_url("JARVIS_TTS_URL", self.tts_url, allow_host_bridge=True)
        if self.reasoning_backend not in {"direct", "n8n"}:
            raise ValueError("JARVIS_REASONING_BACKEND must be direct or n8n")
        if self.reasoning_backend == "direct":
            if not self.reasoning_url or not self.reasoning_model:
                raise ValueError("JARVIS_REASONING_URL and JARVIS_REASONING_MODEL are both required")
            _absolute_url("JARVIS_REASONING_URL", self.reasoning_url, allow_host_bridge=True)
            _validate_optional_credential(
                "JARVIS_REASONING_API_KEY_FILE", self.reasoning_api_key_file
            )
        else:
            if self.reasoning_url or self.reasoning_model or self.reasoning_api_key_file is not None:
                raise ValueError("Jarvis direct fallback must be unset when n8n is selected")
            _absolute_url("JARVIS_N8N_WEBHOOK_URL", self.n8n_webhook_url, allow_host_bridge=True)
            _validate_required_credential("JARVIS_N8N_API_KEY_FILE", self.n8n_api_key_file)
        if self.piper_voice != "piper:en_US-danny-low":
            raise ValueError("JARVIS_PIPER_VOICE must remain piper:en_US-danny-low")
        positive = (
            self.upstream_timeout_seconds,
            self.max_payload_bytes,
            self.max_audio_bytes,
            self.max_audio_seconds,
            self.max_text_chars,
            self.max_response_chars,
            self.max_concurrent_turns,
            self.rate_limit_requests,
            self.rate_limit_window_seconds,
            self.session_ttl_seconds,
            self.turn_ttl_seconds,
            self.max_sessions,
            self.max_turns,
            self.max_audio_store_bytes,
        )
        if any(value <= 0 for value in positive):
            raise ValueError("Jarvis limits must be positive")
        if self.max_audio_bytes > self.max_payload_bytes:
            raise ValueError("JARVIS_MAX_AUDIO_BYTES cannot exceed JARVIS_MAX_PAYLOAD_BYTES")

def _int(name: str, default: int) -> int:
    return int(os.getenv(name, str(default)))


def _float(name: str, default: float) -> float:
    return float(os.getenv(name, str(default)))


def _optional_path(name: str) -> Path | None:
    value = os.getenv(name, "").strip()
    return Path(value) if value else None


def _validate_optional_credential(name: str, path: Path | None) -> None:
    if path is not None and not path.is_absolute():
        raise ValueError(f"{name} must be an absolute path")


def _validate_required_credential(name: str, path: Path | None) -> None:
    if path is None or not path.is_absolute() or not path.is_file():
        raise ValueError(f"{name} credential is unavailable")


def _absolute_url(
    name: str,
    value: str,
    *,
    require_https: bool = False,
    allow_host_bridge: bool = False,
) -> None:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{name} must be an absolute HTTP(S) URL")
    if parsed.scheme == "https":
        return
    host = (parsed.hostname or "").lower()
    if allow_host_bridge and host in {
        "127.0.0.1",
        "localhost",
        "host.docker.internal",
        "host.internal",
    }:
        return
    if require_https:
        raise ValueError(f"{name} must use HTTPS")
    raise ValueError(f"{name} may use HTTP only through the local host bridge")
