import asyncio

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from jarvis_api.upstreams import N8NReasoningClient, ReasoningResult, ToolReceipt, UpstreamError


@pytest.mark.asyncio
async def test_n8n_reasoning_sends_minimal_typed_turn_and_accepts_exact_response():
    observed = {}

    async def agent(request):
        observed["authorization"] = request.headers.get("Authorization")
        observed["idempotency_key"] = request.headers.get("Idempotency-Key")
        observed["payload"] = await request.json()
        return web.json_response({
            "schema_version": "1",
            "session_id": "session-12345678",
            "turn_id": "turn-12345678",
            "status": "complete",
            "spoken_text": "The kitchen lights are on.",
            "tool_results": [{
                "tool": "get_home_status",
                "status": "succeeded",
                "receipt_id": "receipt-12345678",
            }],
        })

    app = web.Application()
    app.router.add_post("/webhook/jarvis", agent)
    server = TestServer(app)
    await server.start_server()
    client = N8NReasoningClient(
        webhook_url=str(server.make_url("/webhook/jarvis")),
        api_key="opaque-test-key",
        timeout_seconds=2,
        max_response_chars=500,
    )
    try:
        answer = await client.process(
            "Turn on the kitchen lights", "session-12345678", "turn-12345678"
        )
        assert answer == ReasoningResult(
            spoken_text="The kitchen lights are on.",
            tool_results=(
                ToolReceipt(
                    tool="get_home_status",
                    status="succeeded",
                    receipt_id="receipt-12345678",
                ),
            ),
        )
        assert observed == {
            "authorization": "Bearer opaque-test-key",
            "idempotency_key": "turn-12345678",
            "payload": {
                "schema_version": "1",
                "session_id": "session-12345678",
                "turn_id": "turn-12345678",
                "transcript": "Turn on the kitchen lights",
            },
        }
    finally:
        await client.close()
        await server.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response_payload",
    [
        {
            "schema_version": "1",
            "session_id": "wrong-session",
            "turn_id": "turn-12345678",
            "status": "complete",
            "spoken_text": "Ready.",
            "tool_results": [],
        },
        {
            "schema_version": "1",
            "session_id": "session-12345678",
            "turn_id": "turn-12345678",
            "status": "complete",
            "spoken_text": "Ready.",
            "tool_results": [],
            "unexpected": True,
        },
        {
            "schema_version": "1",
            "session_id": "session-12345678",
            "turn_id": "turn-12345678",
            "status": "complete",
            "spoken_text": "Ready.",
            "tool_results": [{
                "tool": "home_assistant_service",
                "status": "succeeded",
                "receipt_id": "receipt-12345678",
            }],
        },
        {
            "schema_version": "1",
            "session_id": "session-12345678",
            "turn_id": "turn-12345678",
            "status": "complete",
            "spoken_text": "Ready.",
            "tool_results": [{
                "tool": "set_room_lights",
                "status": "succeeded",
                "receipt_id": "receipt-12345678",
            }],
        },
        {
            "schema_version": "1",
            "session_id": "session-12345678",
            "turn_id": "turn-12345678",
            "status": "complete",
            "spoken_text": "Ready.",
            "tool_results": [{
                "tool": "set_room_lights",
                "status": "failed",
                "receipt_id": "receipt-12345678",
            }],
        },
        {
            "schema_version": "1",
            "session_id": "session-12345678",
            "turn_id": "turn-12345678",
            "status": "complete",
            "spoken_text": "Ready.",
            "tool_results": [
                {
                    "tool": "get_home_status",
                    "status": "succeeded",
                    "receipt_id": f"receipt-{index:08d}",
                }
                for index in range(5)
            ],
        },
        {
            "schema_version": "1",
            "session_id": "session-12345678",
            "turn_id": "turn-12345678",
            "status": "complete",
            "spoken_text": "Ready.",
            "tool_results": [{
                "tool": "get_home_status",
                "status": "succeeded",
                "receipt_id": "invalid receipt",
            }],
        },
    ],
)
async def test_n8n_reasoning_rejects_mismatched_extra_broad_or_failed_results(response_payload):
    async def agent(_request):
        return web.json_response(response_payload)

    app = web.Application()
    app.router.add_post("/webhook/jarvis", agent)
    server = TestServer(app)
    await server.start_server()
    client = N8NReasoningClient(
        webhook_url=str(server.make_url("/webhook/jarvis")),
        api_key="opaque-test-key",
        timeout_seconds=2,
        max_response_chars=500,
    )
    try:
        with pytest.raises(UpstreamError, match="n8n reasoning returned an invalid response"):
            await client.process("private transcript", "session-12345678", "turn-12345678")
    finally:
        await client.close()
        await server.close()


@pytest.mark.asyncio
async def test_n8n_reasoning_transport_propagates_cancellation():
    started = asyncio.Event()
    released = asyncio.Event()

    async def agent(_request):
        started.set()
        await released.wait()
        return web.json_response({})

    app = web.Application()
    app.router.add_post("/webhook/jarvis", agent)
    server = TestServer(app)
    await server.start_server()
    client = N8NReasoningClient(
        webhook_url=str(server.make_url("/webhook/jarvis")),
        api_key="opaque-test-key",
        timeout_seconds=2,
        max_response_chars=500,
    )
    task = asyncio.create_task(
        client.process("Cancel this turn", "session-12345678", "turn-12345678")
    )
    try:
        await asyncio.wait_for(started.wait(), timeout=1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        released.set()
        await client.close()
        await server.close()
