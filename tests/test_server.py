from __future__ import annotations

import httpx
import pytest

from glitchloom.server import app


@pytest.mark.asyncio
async def test_health_and_catalog_contract() -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        health = await client.get("/api/health")
        catalog = await client.get("/api/catalog")

    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert catalog.status_code == 200
    kinds = {node["kind"] for node in catalog.json()["nodes"]}
    assert {
        "text_input",
        "endpoint",
        "model",
        "completion",
        "glitchling",
        "gaggle",
        "corrupt",
        "preview",
    }.issubset(kinds)
