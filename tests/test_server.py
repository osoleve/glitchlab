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
        "number_input",
        "endpoint",
        "model",
        "completion",
        "glitchling",
        "gaggle",
        "corrupt",
        "preview",
    }.issubset(kinds)
    completion = next(
        node for node in catalog.json()["nodes"] if node["kind"] == "completion"
    )
    field_types = {
        field["name"]: field["type"] for field in completion["fields"]
    }
    assert field_types["temperature"] == "number"
    assert field_types["stop"] == "text"
    assert field_types["extra_body"] == "any"
    number_input = next(
        node for node in catalog.json()["nodes"] if node["kind"] == "number_input"
    )
    assert number_input["outputs"] == [
        {
            "name": "number",
            "label": "Number",
            "type": "number",
            "required": True,
            "multiple": False,
        }
    ]
    assert number_input["fields"][0]["default"] == 0
    fill_hole = next(
        node for node in catalog.json()["nodes"] if node["kind"] == "fill_hole"
    )
    assert [
        (output["name"], output["label"], output["type"])
        for output in fill_hole["outputs"]
    ] == [
        ("template", "Template", "template"),
        ("text", "Bound text", "text"),
    ]


@pytest.mark.asyncio
async def test_saved_workflow_appears_in_catalog(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GLITCHLOOM_WORKSPACE", str(tmp_path))
    payload = {
        "name": "Reusable preview",
        "description": "Expose a value through a saved graph.",
        "graph": {
            "name": "Reusable preview",
            "nodes": [
                {
                    "id": "preview",
                    "kind": "preview",
                    "config": {},
                    "position": {"x": 0, "y": 0},
                }
            ],
            "edges": [],
        },
        "inputs": [
            {
                "name": "value",
                "label": "Value",
                "type": "any",
                "required": True,
                "multiple": False,
                "node_id": "preview",
                "node_port": "value",
            }
        ],
        "outputs": [
            {
                "name": "value",
                "label": "Value",
                "type": "any",
                "node_id": "preview",
                "node_port": "value",
            }
        ],
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        saved = await client.post("/api/workflows", json=payload)
        catalog = await client.get("/api/catalog")

    assert saved.status_code == 201
    definition = saved.json()["definition"]
    assert definition["kind"].endswith(":v1")
    assert definition["inputs"][0]["type"] == "any"
    assert any(
        item["kind"] == definition["kind"]
        for item in catalog.json()["nodes"]
    )


@pytest.mark.asyncio
async def test_two_source_nodes_save_as_a_zero_input_workflow(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GLITCHLOOM_WORKSPACE", str(tmp_path))
    payload = {
        "name": "Vintage Talkie (elsie-1)",
        "description": "Bundle an endpoint and model reference.",
        "graph": {
            "name": "Vintage Talkie (elsie-1)",
            "nodes": [
                {
                    "id": "endpoint",
                    "kind": "endpoint",
                    "title": "Elsie completion API",
                    "config": {
                        "base_url": "http://elsie-1:8790/v1",
                        "api_key_env": "",
                        "timeout_seconds": 120,
                    },
                    "position": {"x": 0, "y": 0},
                },
                {
                    "id": "model",
                    "kind": "model",
                    "title": "Vintage Talkie",
                    "config": {"model_id": "talkie-1930-13b-base"},
                    "position": {"x": 280, "y": 0},
                },
            ],
            "edges": [],
        },
        "inputs": [],
        "outputs": [
            {
                "name": "endpoint",
                "label": "Elsie completion API · Endpoint",
                "type": "endpoint",
                "node_id": "endpoint",
                "node_port": "endpoint",
            },
            {
                "name": "model",
                "label": "Vintage Talkie · Model",
                "type": "model",
                "node_id": "model",
                "node_port": "model",
            },
        ],
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.post("/api/workflows", json=payload)
        saved = response.json()
        workflow_id = saved["workflow"]["id"]
        loaded = await client.get(
            f"/api/workflows/{workflow_id}/versions/1"
        )
        edited_payload = {
            **payload,
            "name": "Vintage Talkie renamed",
            "description": "Edited in its own graph tab.",
            "outputs": [
                {
                    **payload["outputs"][0],
                    "label": "Completion API",
                },
                {
                    **payload["outputs"][1],
                    "label": "Talkie model",
                },
            ],
        }
        updated = await client.post(
            f"/api/workflows/{workflow_id}/versions",
            json=edited_payload,
        )
        deleted = await client.delete(f"/api/workflows/{workflow_id}")
        remaining = await client.get("/api/workflows")

    assert response.status_code == 201
    definition = saved["definition"]
    assert definition["inputs"] == []
    assert [output["type"] for output in definition["outputs"]] == [
        "endpoint",
        "model",
    ]
    assert [output["label"] for output in definition["outputs"]] == [
        "Endpoint",
        "Model",
    ]
    assert loaded.status_code == 200
    assert loaded.json()["workflow"]["graph"]["nodes"][0]["title"] == (
        "Elsie completion API"
    )
    assert updated.status_code == 201
    assert updated.json()["workflow"]["id"] == workflow_id
    assert updated.json()["workflow"]["version"] == 2
    assert updated.json()["workflow"]["name"] == "Vintage Talkie renamed"
    assert [
        output["label"] for output in updated.json()["definition"]["outputs"]
    ] == ["Completion API", "Talkie model"]
    assert deleted.status_code == 200
    assert deleted.json()["deleted"]["versions"] == 2
    assert remaining.json()["workflows"] == []
    trashed = list((tmp_path / ".glitchloom" / "workflows" / ".trash").glob("*/v*.json"))
    assert len(trashed) == 2
