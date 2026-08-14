import asyncio
import base64
import re
import uuid

import pytest
from aiohttp import FormData
from aiohttp.test_utils import TestClient, TestServer

from jarvis_api.app import REASONING, create_app
from jarvis_api.audio import AudioFailureStage, AudioFailureSubtype, AudioFormatError
from jarvis_api.config import Config
from jarvis_api.models import RenderedAudio
from jarvis_api.upstreams import N8NReasoningClient, ReasoningResult, UpstreamError


ORIGIN = "https://jarvis.example"


class FakeVoice:
    def __init__(self):
        self.transcribe_calls = []
        self.synthesize_calls = []

    async def transcribe(self, wav_audio):
        self.transcribe_calls.append(wav_audio)
        return "Turn on the kitchen lights"

    async def synthesize(self, text, voice):
        self.synthesize_calls.append((text, voice))
        return b"upstream-wave"

    async def close(self):
        return None


class FakeReasoning:
    def __init__(self, response="The kitchen lights are on."):
        self.calls = []
        self.response = response

    async def process(self, text, conversation_id, turn_id):
        self.calls.append((text, conversation_id, turn_id))
        return ReasoningResult(spoken_text=self.response)

    async def close(self):
        return None


class FailingReasoning:
    def __init__(self):
        self.calls = []

    async def process(self, text, conversation_id, turn_id):
        self.calls.append((text, conversation_id, turn_id))
        raise UpstreamError("private upstream detail")

    async def close(self):
        return None


class FakeAudio:
    def __init__(self):
        self.inputs = []
        self.outputs = []

    async def normalize_input(self, payload, input_format):
        self.inputs.append((payload, input_format))
        return b"normalized-wave"

    async def render_output(self, payload):
        self.outputs.append(payload)
        return RenderedAudio(wav=b"RIFF-web-audio", mp3=b"ID3-watch-audio")


def api_config(**overrides):
    values = {
        "allowed_origin": ORIGIN,
        "stt_url": "http://voice.test/stt",
        "tts_url": "http://voice.test/tts",
        "reasoning_url": "http://reasoning.test/v1",
        "reasoning_model": "example-model",
        "max_audio_bytes": 1024,
        "max_payload_bytes": 4096,
        "max_text_chars": 500,
        "rate_limit_requests": 30,
        "rate_limit_window_seconds": 60.0,
        "session_ttl_seconds": 300.0,
        "turn_ttl_seconds": 300.0,
        "max_sessions": 20,
        "max_turns": 20,
        "max_audio_store_bytes": 100_000,
    }
    values.update(overrides)
    return Config(**values)


async def open_client(config=None, voice=None, reasoning=None, audio=None):
    voice = voice or FakeVoice()
    reasoning = reasoning or FakeReasoning()
    audio = audio or FakeAudio()
    app = create_app(
        config or api_config(),
        voice_client=voice,
        reasoning_client=reasoning,
        audio_processor=audio,
    )
    client = TestClient(TestServer(app))
    await client.start_server()
    return client, voice, reasoning, audio


async def create_session(client, key=None):
    response = await client.post(
        "/api/v1/sessions",
        headers={"Origin": ORIGIN, "Idempotency-Key": key or str(uuid.uuid4())},
    )
    assert response.status == 201
    return await response.json()


def test_n8n_backend_builds_strict_reasoning_client_from_credential_file(tmp_path):
    credential = tmp_path / "n8n-token"
    credential.write_text("opaque-test-token")
    config = api_config(
        reasoning_backend="n8n",
        reasoning_url="",
        reasoning_model="",
        n8n_webhook_url="http://host.docker.internal:5678/webhook/jarvis",
        n8n_api_key_file=credential,
    )

    app = create_app(config, voice_client=FakeVoice(), audio_processor=FakeAudio())

    assert isinstance(app[REASONING], N8NReasoningClient)
    assert app[REASONING].webhook_url == config.n8n_webhook_url
    assert app[REASONING].api_key == "opaque-test-token"


def mutation_headers(session, key=None):
    return {
        "Origin": ORIGIN,
        "X-Jarvis-Session": session["session_id"],
        "X-Jarvis-CSRF": session["csrf_token"],
        "Idempotency-Key": key or str(uuid.uuid4()),
    }


@pytest.mark.asyncio
async def test_reasoning_failure_replays_generic_error_without_fallback_or_piper():
    reasoning = FailingReasoning()
    client, voice, _, _ = await open_client(reasoning=reasoning)
    try:
        session = await create_session(client)
        key = str(uuid.uuid4())
        payload = {
            "session_id": session["session_id"],
            "turn_id": str(uuid.uuid4()),
            "input": {"type": "text", "text": "Read the home status"},
            "response_format": "wav",
        }
        first = await client.post(
            "/api/v1/turns",
            headers=mutation_headers(session, key),
            json=payload,
        )
        second = await client.post(
            "/api/v1/turns",
            headers=mutation_headers(session, key),
            json=payload,
        )

        assert first.status == second.status == 502
        assert await first.json() == await second.json()
        assert (await second.json())["error"]["code"] == "upstream_unavailable"
        assert len(reasoning.calls) == 1
        assert voice.synthesize_calls == []
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_health_and_text_turn_use_reasoning_then_return_bounded_audio():
    client, voice, reasoning, audio = await open_client()
    try:
        health = await client.get("/api/v1/health")
        assert health.status == 200
        assert await health.json() == {"status": "ready", "api_version": "v1"}

        session = await create_session(client)
        turn_id = str(uuid.uuid4())
        response = await client.post(
            "/api/v1/turns",
            headers=mutation_headers(session),
            json={
                "session_id": session["session_id"],
                "turn_id": turn_id,
                "input": {"type": "text", "text": "Turn on the kitchen lights"},
                "response_format": "wav",
            },
        )

        assert response.status == 201
        body = await response.json()
        assert body["turn_id"] == turn_id
        assert body["state"] == "complete"
        assert body["transcript"] == "Turn on the kitchen lights"
        assert body["response_text"] == "The kitchen lights are on."
        assert body["audio"]["content_type"] == "audio/wav"
        assert reasoning.calls == [
            ("Turn on the kitchen lights", session["session_id"], turn_id)
        ]
        assert voice.synthesize_calls == [
            ("The kitchen lights are on.", "piper:en_US-danny-low")
        ]

        audio_response = await client.get(
            f"/api/v1/turns/{turn_id}/audio?format=wav",
            headers={
                "Origin": ORIGIN,
                "X-Jarvis-Session": session["session_id"],
                "X-Jarvis-CSRF": session["csrf_token"],
            },
        )
        assert audio_response.status == 200
        assert audio_response.content_type == "audio/wav"
        assert await audio_response.read() == b"RIFF-web-audio"
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_failed_request_logs_only_status_code_and_request_id(caplog):
    client, _, _, _ = await open_client()
    try:
        session = await create_session(client)
        caplog.clear()
        response = await client.post(
            "/api/v1/turns",
            headers=mutation_headers(session),
            json={
                "session_id": session["session_id"],
                "turn_id": str(uuid.uuid4()),
                "input": {"type": "text", "text": "x" * 501},
                "response_format": "wav",
            },
        )

        assert response.status == 413
        messages = "\n".join(record.getMessage() for record in caplog.records)
        assert "status=413 code=text_too_large request_id=" in messages
        assert session["session_id"] not in messages
        assert session["csrf_token"] not in messages
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_invalid_audio_logs_only_bounded_subtype_and_never_sensitive_values(caplog):
    class SensitiveFailingAudio(FakeAudio):
        sensitive_message = ""

        async def normalize_input(self, payload, input_format):
            raise AudioFormatError(
                self.sensitive_message,
                stage=AudioFailureStage.NORMALIZATION,
                subtype=AudioFailureSubtype.ZEPP_FRAME_TRUNCATED,
            )

    audio = SensitiveFailingAudio()
    client, voice, _, _ = await open_client(audio=audio)
    try:
        session = await create_session(client)
        audio.sensitive_message = (
            f"session={session['session_id']} csrf={session['csrf_token']} "
            "path=/tmp/private/audio payload=voice-bytes"
        )
        caplog.clear()
        response = await client.post(
            "/api/v1/turns",
            headers=mutation_headers(session),
            json={
                "session_id": session["session_id"],
                "turn_id": str(uuid.uuid4()),
                "input": {
                    "type": "audio",
                    "audio_format": "opus",
                    "audio_base64": base64.b64encode(b"private-audio").decode("ascii"),
                },
                "response_format": "mp3",
            },
        )

        assert response.status == 422
        body = await response.json()
        assert body["error"]["code"] == "invalid_audio"
        assert "subtype" not in body["error"]
        failure_logs = [
            record.getMessage()
            for record in caplog.records
            if record.getMessage().startswith("request_failed ")
        ]
        assert len(failure_logs) == 1
        assert re.fullmatch(
            r"request_failed status=422 code=invalid_audio request_id=[0-9a-f]{32} "
            r"normalization_subtype=zepp_frame_truncated",
            failure_logs[0],
        )
        for sensitive in (
            session["session_id"],
            session["csrf_token"],
            "private-audio",
            "voice-bytes",
            "/tmp/private/audio",
        ):
            assert sensitive not in "\n".join(failure_logs)
        assert voice.transcribe_calls == []
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_watch_base64_opus_and_browser_multipart_webm_are_normalized():
    client, voice, _, audio = await open_client()
    try:
        session = await create_session(client)
        opus = b"OggS-watch-opus"
        watch = await client.post(
            "/api/v1/turns",
            headers=mutation_headers(session),
            json={
                "session_id": session["session_id"],
                "turn_id": str(uuid.uuid4()),
                "input": {
                    "type": "audio",
                    "audio_format": "opus",
                    "audio_base64": base64.b64encode(opus).decode("ascii"),
                },
                "response_format": "mp3",
            },
        )
        assert watch.status == 201
        watch_body = await watch.json()
        assert watch_body["audio"]["content_type"] == "audio/mpeg"

        form = FormData()
        form.add_field("session_id", session["session_id"])
        form.add_field("turn_id", str(uuid.uuid4()))
        form.add_field("response_format", "wav")
        form.add_field("audio", b"webm-browser-opus", filename="capture.webm", content_type="audio/webm;codecs=opus")
        browser = await client.post(
            "/api/v1/turns",
            headers=mutation_headers(session),
            data=form,
        )
        assert browser.status == 201
        assert audio.inputs == [(opus, "opus"), (b"webm-browser-opus", "webm")]
        assert voice.transcribe_calls == [b"normalized-wave", b"normalized-wave"]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_unsafe_intent_is_rejected_before_reasoning_or_tts():
    client, voice, reasoning, _ = await open_client()
    try:
        session = await create_session(client)
        response = await client.post(
            "/api/v1/turns",
            headers=mutation_headers(session),
            json={
                "session_id": session["session_id"],
                "turn_id": str(uuid.uuid4()),
                "input": {"type": "text", "text": "Unlock the front door"},
                "response_format": "wav",
            },
        )
        assert response.status == 403
        assert (await response.json())["error"]["code"] == "unsafe_intent"
        assert reasoning.calls == []
        assert voice.synthesize_calls == []
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_csrf_origin_payload_and_rate_limits_fail_closed():
    client, _, reasoning, _ = await open_client(api_config(rate_limit_requests=1))
    try:
        denied = await client.post(
            "/api/v1/sessions",
            headers={"Origin": "https://evil.example", "Idempotency-Key": str(uuid.uuid4())},
        )
        assert denied.status == 403

        session = await create_session(client)
        too_long = await client.post(
            "/api/v1/turns",
            headers=mutation_headers(session),
            json={
                "session_id": session["session_id"],
                "turn_id": str(uuid.uuid4()),
                "input": {"type": "text", "text": "x" * 501},
                "response_format": "wav",
            },
        )
        assert too_long.status == 413

        first = await client.post(
            "/api/v1/turns",
            headers=mutation_headers(session),
            json={
                "session_id": session["session_id"],
                "turn_id": str(uuid.uuid4()),
                "input": {"type": "text", "text": "Turn on the desk light"},
                "response_format": "wav",
            },
        )
        assert first.status == 201
        second = await client.post(
            "/api/v1/turns",
            headers=mutation_headers(session),
            json={
                "session_id": session["session_id"],
                "turn_id": str(uuid.uuid4()),
                "input": {"type": "text", "text": "Turn off the desk light"},
                "response_format": "wav",
            },
        )
        assert second.status == 429
        assert len(reasoning.calls) == 1
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_idempotency_replays_response_without_repeating_upstreams():
    client, voice, reasoning, _ = await open_client()
    try:
        session = await create_session(client)
        key = str(uuid.uuid4())
        payload = {
            "session_id": session["session_id"],
            "turn_id": str(uuid.uuid4()),
            "input": {"type": "text", "text": "Turn on the office light"},
            "response_format": "wav",
        }
        first = await client.post("/api/v1/turns", headers=mutation_headers(session, key), json=payload)
        second = await client.post("/api/v1/turns", headers=mutation_headers(session, key), json=payload)
        assert first.status == second.status == 201
        assert await first.json() == await second.json()
        assert len(reasoning.calls) == 1
        assert len(voice.synthesize_calls) == 1
    finally:
        await client.close()


class BlockingReasoning(FakeReasoning):
    def __init__(self):
        super().__init__()
        self.started = asyncio.Event()

    async def process(self, text, conversation_id, turn_id):
        self.calls.append((text, conversation_id, turn_id))
        self.started.set()
        await asyncio.Event().wait()


class ReleasableReasoning(FakeReasoning):
    def __init__(self):
        super().__init__()
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def process(self, text, conversation_id, turn_id):
        self.calls.append((text, conversation_id, turn_id))
        self.started.set()
        await self.release.wait()
        return ReasoningResult(spoken_text=self.response)


@pytest.mark.asyncio
async def test_concurrent_idempotent_turns_share_one_authoritative_result():
    reasoning = ReleasableReasoning()
    client, voice, _, _ = await open_client(reasoning=reasoning)
    try:
        session = await create_session(client)
        key = str(uuid.uuid4())
        payload = {
            "session_id": session["session_id"],
            "turn_id": str(uuid.uuid4()),
            "input": {"type": "text", "text": "Read the home status"},
            "response_format": "wav",
        }
        first_task = asyncio.create_task(
            client.post(
                "/api/v1/turns",
                headers=mutation_headers(session, key),
                json=payload,
            )
        )
        await asyncio.wait_for(reasoning.started.wait(), timeout=1)
        second_task = asyncio.create_task(
            client.post(
                "/api/v1/turns",
                headers=mutation_headers(session, key),
                json=payload,
            )
        )
        await asyncio.sleep(0.05)
        assert not second_task.done()
        reasoning.release.set()

        first, second = await asyncio.gather(first_task, second_task)
        assert first.status == second.status == 201
        assert await first.json() == await second.json()
        assert len(reasoning.calls) == 1
        assert len(voice.synthesize_calls) == 1
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_concurrent_idempotency_key_reuse_with_different_payload_fails_closed():
    reasoning = ReleasableReasoning()
    client, voice, _, _ = await open_client(reasoning=reasoning)
    try:
        session = await create_session(client)
        key = str(uuid.uuid4())
        first_payload = {
            "session_id": session["session_id"],
            "turn_id": str(uuid.uuid4()),
            "input": {"type": "text", "text": "Read the home status"},
            "response_format": "wav",
        }
        first_task = asyncio.create_task(
            client.post(
                "/api/v1/turns",
                headers=mutation_headers(session, key),
                json=first_payload,
            )
        )
        await asyncio.wait_for(reasoning.started.wait(), timeout=1)
        conflicting_payload = {
            **first_payload,
            "turn_id": str(uuid.uuid4()),
            "input": {"type": "text", "text": "Read a different status"},
        }
        conflict = await client.post(
            "/api/v1/turns",
            headers=mutation_headers(session, key),
            json=conflicting_payload,
        )
        assert conflict.status == 409
        assert (await conflict.json())["error"]["code"] == "idempotency_conflict"
        assert len(reasoning.calls) == 1
        assert voice.synthesize_calls == []
        reasoning.release.set()
        assert (await first_task).status == 201
    finally:
        reasoning.release.set()
        await client.close()


@pytest.mark.asyncio
async def test_cancel_interrupts_the_owned_turn_and_fences_completion():
    reasoning = BlockingReasoning()
    client, _, _, _ = await open_client(reasoning=reasoning)
    try:
        session = await create_session(client)
        turn_id = str(uuid.uuid4())
        turn_task = asyncio.create_task(
            client.post(
                "/api/v1/turns",
                headers=mutation_headers(session),
                json={
                    "session_id": session["session_id"],
                    "turn_id": turn_id,
                    "input": {"type": "text", "text": "Turn on the office light"},
                    "response_format": "wav",
                },
            )
        )
        await asyncio.wait_for(reasoning.started.wait(), timeout=1)
        cancelled = await client.post(
            f"/api/v1/turns/{turn_id}/cancel",
            headers=mutation_headers(session),
            json={"session_id": session["session_id"]},
        )
        assert cancelled.status == 202
        assert (await cancelled.json())["state"] == "cancelled"
        turn_response = await asyncio.wait_for(turn_task, timeout=1)
        assert turn_response.status == 409
        assert (await turn_response.json())["error"]["code"] == "turn_cancelled"
    finally:
        await client.close()
