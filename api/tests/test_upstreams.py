import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from jarvis_api.upstreams import OpenAIReasoningClient, ReasoningResult, VoiceClient


@pytest.mark.asyncio
async def test_voice_client_uses_raw_wav_and_the_pinned_piper_selector():
    observed = {}

    async def transcribe(request):
        observed["stt_content_type"] = request.content_type
        observed["stt_body"] = await request.read()
        return web.json_response({"text": "Jarvis link check."})

    async def synthesize(request):
        observed["tts_json"] = await request.json()
        return web.Response(body=b"RIFF-wave", content_type="audio/wav")

    app = web.Application()
    app.router.add_post("/stt", transcribe)
    app.router.add_post("/tts", synthesize)
    server = TestServer(app)
    await server.start_server()
    client = VoiceClient(
        stt_url=str(server.make_url("/stt")),
        tts_url=str(server.make_url("/tts")),
        timeout_seconds=2,
        max_audio_bytes=4096,
    )
    try:
        assert await client.transcribe(b"RIFF-input") == "Jarvis link check."
        assert await client.synthesize("Ready.", "piper:en_US-danny-low") == b"RIFF-wave"
        assert observed["stt_content_type"] == "audio/wav"
        assert observed["stt_body"] == b"RIFF-input"
        assert observed["tts_json"]["voice"] == "piper:en_US-danny-low"
    finally:
        await client.close()
        await server.close()


@pytest.mark.asyncio
async def test_local_reasoning_keeps_bounded_session_context_and_disables_thinking():
    requests = []

    async def chat(request):
        assert request.headers.get("Authorization") == "Bearer opaque-test-key"
        payload = await request.json()
        requests.append(payload)
        return web.json_response({
            "choices": [{"message": {"content": f"Reply {len(requests)}."}}],
        })

    app = web.Application()
    app.router.add_post("/v1/chat/completions", chat)
    server = TestServer(app)
    await server.start_server()
    client = OpenAIReasoningClient(
        base_url=str(server.make_url("/v1")),
        model="local-test-model",
        api_key="opaque-test-key",
        timeout_seconds=2,
        max_sessions=2,
        max_history_messages=4,
    )
    try:
        assert await client.process("First", "session-one") == ReasoningResult("Reply 1.")
        assert await client.process("Second", "session-one") == ReasoningResult("Reply 2.")
        second = requests[1]
        assert second["model"] == "local-test-model"
        assert second["chat_template_kwargs"] == {"enable_thinking": False}
        assert [item["role"] for item in second["messages"]] == [
            "system", "user", "assistant", "user",
        ]
        assert second["messages"][-1]["content"] == "Second"
    finally:
        await client.close()
        await server.close()
