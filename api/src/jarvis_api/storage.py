from __future__ import annotations

import time
from collections import OrderedDict, deque
from dataclasses import dataclass
from typing import Callable

from .models import SessionRecord, TurnRecord


@dataclass(frozen=True, slots=True)
class CachedResponse:
    fingerprint: str
    status: int
    body: dict


class EphemeralStore:
    def __init__(
        self,
        *,
        max_sessions: int,
        max_turns: int,
        max_audio_bytes: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_sessions = max_sessions
        self.max_turns = max_turns
        self.max_audio_bytes = max_audio_bytes
        self.clock = clock
        self.sessions: OrderedDict[str, SessionRecord] = OrderedDict()
        self.turns: OrderedDict[str, TurnRecord] = OrderedDict()
        self.idempotency: OrderedDict[tuple[str, str], CachedResponse] = OrderedDict()

    def put_session(self, session: SessionRecord) -> None:
        self.cleanup()
        self.sessions[session.session_id] = session
        self.sessions.move_to_end(session.session_id)
        while len(self.sessions) > self.max_sessions:
            session_id, _ = self.sessions.popitem(last=False)
            self._drop_session_turns(session_id)

    def get_session(self, session_id: str) -> SessionRecord | None:
        self.cleanup()
        session = self.sessions.get(session_id)
        if session is not None:
            self.sessions.move_to_end(session_id)
        return session

    def put_turn(self, turn: TurnRecord) -> None:
        self.cleanup()
        self.turns[turn.turn_id] = turn
        self.turns.move_to_end(turn.turn_id)
        self._enforce_turn_bounds()

    def get_turn(self, turn_id: str) -> TurnRecord | None:
        self.cleanup()
        turn = self.turns.get(turn_id)
        if turn is not None:
            self.turns.move_to_end(turn_id)
        return turn

    def cache_response(
        self, scope: str, key: str, fingerprint: str, status: int, body: dict
    ) -> None:
        cache_key = (scope, key)
        self.idempotency[cache_key] = CachedResponse(fingerprint, status, body)
        self.idempotency.move_to_end(cache_key)
        while len(self.idempotency) > self.max_sessions + self.max_turns * 3:
            self.idempotency.popitem(last=False)

    def get_cached_response(self, scope: str, key: str) -> CachedResponse | None:
        cache_key = (scope, key)
        result = self.idempotency.get(cache_key)
        if result is not None:
            self.idempotency.move_to_end(cache_key)
        return result

    def cleanup(self) -> None:
        now = self.clock()
        expired_sessions = [
            session_id
            for session_id, session in self.sessions.items()
            if session.expires_at <= now
        ]
        for session_id in expired_sessions:
            self.sessions.pop(session_id, None)
            self._drop_session_turns(session_id)
        expired_turns = [
            turn_id for turn_id, turn in self.turns.items() if turn.expires_at <= now
        ]
        for turn_id in expired_turns:
            self.turns.pop(turn_id, None)
        self._enforce_turn_bounds()

    def _drop_session_turns(self, session_id: str) -> None:
        for turn_id in [
            turn_id for turn_id, turn in self.turns.items() if turn.session_id == session_id
        ]:
            self.turns.pop(turn_id, None)

    def _enforce_turn_bounds(self) -> None:
        while len(self.turns) > self.max_turns or self._audio_bytes() > self.max_audio_bytes:
            self.turns.popitem(last=False)

    def _audio_bytes(self) -> int:
        return sum(turn.audio_size for turn in self.turns.values())


class FixedWindowRateLimiter:
    def __init__(
        self,
        *,
        limit: int,
        window_seconds: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self.clock = clock
        self.entries: dict[str, deque[float]] = {}

    def admit(self, key: str) -> bool:
        now = self.clock()
        earliest = now - self.window_seconds
        queue = self.entries.setdefault(key, deque())
        while queue and queue[0] <= earliest:
            queue.popleft()
        if len(queue) >= self.limit:
            return False
        queue.append(now)
        return True
