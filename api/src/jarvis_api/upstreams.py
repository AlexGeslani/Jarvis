from __future__ import annotations

import base64
from collections import OrderedDict
from typing import Any

import aiohttp


class UpstreamError(RuntimeError):
    """Safe upstream failure marker; response bodies are deliberately not retained."""


class VoiceClient:
    def __init__(
        self,
        *,
        stt_url: str,
        tts_url: str,
        timeout_seconds: float,
        max_audio_bytes: int,
        session: aiohttp.ClientSession | None = None,
    ) -> None:
        self.stt_url = stt_url
        self.tts_url = tts_url
        self.max_audio_bytes = max_audio_bytes
        self._owns_session = session is None
        self.session = session
        self.timeout = aiohttp.ClientTimeout(total=timeout_seconds)

    def _session(self) -> aiohttp.ClientSession:
        if self.session is None:
            self.session = aiohttp.ClientSession(timeout=self.timeout)
        return self.session

    async def transcribe(self, wav_audio: bytes) -> str:
        try:
            async with self._session().post(
                self.stt_url,
                data=wav_audio,
                headers={"Content-Type": "audio/wav"},
            ) as response:
                if response.status < 200 or response.status >= 300:
                    raise UpstreamError("speech recognition unavailable")
                data = await response.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError, ValueError) as error:
            raise UpstreamError("speech recognition unavailable") from error
        text = _extract_text(data, ("text",), ("transcript",), ("result", "text"))
        if not text:
            raise UpstreamError("speech recognition returned no text")
        return text

    async def synthesize(self, text: str, voice: str) -> bytes:
        try:
            async with self._session().post(
                self.tts_url,
                json={"text": text, "voice": voice, "format": "wav"},
            ) as response:
                if response.status < 200 or response.status >= 300:
                    raise UpstreamError("speech synthesis unavailable")
                content_type = response.headers.get("Content-Type", "").lower()
                if "json" in content_type:
                    data = await response.json(content_type=None)
                    encoded = _extract_text(
                        data, ("audio_base64",), ("audio",), ("result", "audio_base64")
                    )
                    try:
                        audio = base64.b64decode(encoded, validate=True)
                    except (ValueError, TypeError) as error:
                        raise UpstreamError("speech synthesis returned invalid audio") from error
                else:
                    audio = await response.read()
        except (aiohttp.ClientError, TimeoutError, ValueError) as error:
            raise UpstreamError("speech synthesis unavailable") from error
        if not audio or len(audio) > self.max_audio_bytes:
            raise UpstreamError("speech synthesis audio exceeded its bound")
        return audio

    async def close(self) -> None:
        if self._owns_session and self.session is not None:
            await self.session.close()


class OpenAIReasoningClient:
    """Bounded, non-tool local reasoning client hidden behind the Jarvis API."""

    SYSTEM_PROMPT = (
        "You are Jarvis, a concise private household voice assistant. "
        "Answer naturally in one or two short spoken sentences. "
        "Never claim that you performed a physical or account action. "
        "If an action is unavailable, say so plainly."
    )

    def __init__(
        self,
        *,
        base_url: str,
        model: str,
        api_key: str = "",
        timeout_seconds: float,
        max_sessions: int = 100,
        max_history_messages: int = 12,
        session: aiohttp.ClientSession | None = None,
    ) -> None:
        self.url = f"{base_url.rstrip('/')}/chat/completions"
        self.model = model
        self.api_key = api_key
        self.max_sessions = max_sessions
        self.max_history_messages = max_history_messages
        self.history: OrderedDict[str, list[dict[str, str]]] = OrderedDict()
        self._owns_session = session is None
        self.session = session
        self.timeout = aiohttp.ClientTimeout(total=timeout_seconds)

    def _session(self) -> aiohttp.ClientSession:
        if self.session is None:
            self.session = aiohttp.ClientSession(timeout=self.timeout)
        return self.session

    async def process(self, text: str, conversation_id: str) -> str:
        prior = list(self.history.get(conversation_id, []))
        messages = [
            {"role": "system", "content": self.SYSTEM_PROMPT},
            *prior,
            {"role": "user", "content": text},
        ]
        try:
            async with self._session().post(
                self.url,
                headers={"Authorization": f"Bearer {self.api_key}"} if self.api_key else None,
                json={
                    "model": self.model,
                    "messages": messages,
                    "temperature": 0.2,
                    "top_p": 0.8,
                    "max_tokens": 256,
                    "stream": False,
                    "chat_template_kwargs": {"enable_thinking": False},
                },
            ) as response:
                if response.status < 200 or response.status >= 300:
                    raise UpstreamError("local reasoning unavailable")
                data = await response.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError, ValueError) as error:
            raise UpstreamError("local reasoning unavailable") from error

        choices = data.get("choices") if isinstance(data, dict) else None
        message = choices[0].get("message") if isinstance(choices, list) and choices else None
        answer = message.get("content") if isinstance(message, dict) else None
        if not isinstance(answer, str) or not answer.strip():
            raise UpstreamError("local reasoning returned no response")
        answer = answer.strip()

        updated = prior + [
            {"role": "user", "content": text},
            {"role": "assistant", "content": answer},
        ]
        self.history[conversation_id] = updated[-self.max_history_messages :]
        self.history.move_to_end(conversation_id)
        while len(self.history) > self.max_sessions:
            self.history.popitem(last=False)
        return answer

    async def close(self) -> None:
        self.history.clear()
        if self._owns_session and self.session is not None:
            await self.session.close()


def _extract_text(data: Any, *paths: tuple[str, ...]) -> str:
    for path in paths:
        value = data
        for key in path:
            if not isinstance(value, dict) or key not in value:
                value = None
                break
            value = value[key]
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""
