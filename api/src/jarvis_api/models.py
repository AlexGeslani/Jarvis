from __future__ import annotations

import asyncio
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class RenderedAudio:
    wav: bytes = field(repr=False)
    mp3: bytes = field(repr=False)


@dataclass(slots=True)
class SessionRecord:
    session_id: str
    csrf_token: str = field(repr=False)
    created_at: float
    expires_at: float
    active_turn_id: str | None = None


@dataclass(slots=True)
class TurnRecord:
    turn_id: str
    session_id: str
    created_at: float
    expires_at: float
    state: str = "processing"
    transcript: str = field(default="", repr=False)
    response_text: str = field(default="", repr=False)
    wav: bytes = field(default=b"", repr=False)
    mp3: bytes = field(default=b"", repr=False)
    task: asyncio.Task | None = field(default=None, repr=False)

    @property
    def audio_size(self) -> int:
        return len(self.wav) + len(self.mp3)
