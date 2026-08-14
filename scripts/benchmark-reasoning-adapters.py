#!/usr/bin/env python3
"""Measure deterministic direct-vs-n8n adapter overhead without model or private traffic."""

from __future__ import annotations

import asyncio
import math
import statistics
import time
from contextlib import asynccontextmanager

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from jarvis_api.upstreams import N8NReasoningClient, OpenAIReasoningClient, ReasoningResult

WARMUPS = 10
RUNS = 200
TRANSCRIPT = "Measure the bounded local reasoning path."
SESSION_ID = "session-benchmark-0001"


def percentile(samples: list[float], quantile: float) -> float:
    ordered = sorted(samples)
    index = max(0, math.ceil(quantile * len(ordered)) - 1)
    return ordered[index]


@asynccontextmanager
async def fixture_server():
    async def direct(request: web.Request) -> web.Response:
        payload = await request.json()
        if payload.get("stream") is not False:
            raise web.HTTPBadRequest()
        return web.json_response(
            {"choices": [{"message": {"content": "Deterministic response."}}]}
        )

    async def n8n(request: web.Request) -> web.Response:
        payload = await request.json()
        if request.headers.get("Idempotency-Key") != payload.get("turn_id"):
            raise web.HTTPBadRequest()
        return web.json_response(
            {
                "schema_version": "1",
                "session_id": payload["session_id"],
                "turn_id": payload["turn_id"],
                "status": "complete",
                "spoken_text": "Deterministic response.",
                "tool_results": [],
            }
        )

    app = web.Application()
    app.router.add_post("/v1/chat/completions", direct)
    app.router.add_post("/webhook/jarvis", n8n)
    server = TestServer(app)
    await server.start_server()
    try:
        yield str(server.make_url("")).rstrip("/")
    finally:
        await server.close()


async def measure(client, label: str) -> tuple[str, list[float]]:
    expected = ReasoningResult(spoken_text="Deterministic response.")
    samples: list[float] = []
    for index in range(WARMUPS + RUNS):
        turn_id = f"turn-benchmark-{index:08d}"
        start = time.perf_counter_ns()
        result = await client.process(TRANSCRIPT, SESSION_ID, turn_id)
        elapsed_ms = (time.perf_counter_ns() - start) / 1_000_000
        if result != expected:
            raise RuntimeError(f"{label}_result_mismatch")
        if index >= WARMUPS:
            samples.append(elapsed_ms)
    return label, samples


async def main() -> None:
    async with fixture_server() as base:
        direct = OpenAIReasoningClient(
            base_url=f"{base}/v1",
            model="deterministic-local-fixture",
            timeout_seconds=2,
            max_sessions=1,
            max_history_messages=2,
        )
        n8n = N8NReasoningClient(
            webhook_url=f"{base}/webhook/jarvis",
            api_key="opaque-benchmark-fixture",
            timeout_seconds=2,
            max_response_chars=500,
        )
        try:
            direct_label, direct_samples = await measure(direct, "direct")
            n8n_label, n8n_samples = await measure(n8n, "n8n")
        finally:
            await direct.close()
            await n8n.close()

    direct_median = statistics.median(direct_samples)
    n8n_median = statistics.median(n8n_samples)
    direct_p95 = percentile(direct_samples, 0.95)
    n8n_p95 = percentile(n8n_samples, 0.95)
    print("benchmark_scope=local_deterministic_adapter_overhead")
    print(f"warmups={WARMUPS} runs={RUNS}")
    print(f"{direct_label}_median_ms={direct_median:.3f}")
    print(f"{direct_label}_p95_ms={direct_p95:.3f}")
    print(f"{n8n_label}_median_ms={n8n_median:.3f}")
    print(f"{n8n_label}_p95_ms={n8n_p95:.3f}")
    print(f"median_delta_ms={n8n_median - direct_median:.3f}")
    print(f"p95_delta_ms={n8n_p95 - direct_p95:.3f}")
    print("typed_results_verified=true")
    print("private_values_printed=0 external_requests=0")


@pytest.mark.asyncio
async def test_reasoning_adapter_latency() -> None:
    await main()


if __name__ == "__main__":
    asyncio.run(main())
