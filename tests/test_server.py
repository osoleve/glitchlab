from __future__ import annotations

import httpx
import pytest

from glitchlab.server import app


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
        "trim",
        "extract_text",
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
    inline_fields = {
        field["name"] for field in completion["fields"] if field["inline"]
    }
    assert inline_fields == {"temperature", "max_tokens", "seed"}
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
    assert number_input["fields"][0]["inline"] is True
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
    passthrough = next(
        node for node in catalog.json()["nodes"] if node["kind"] == "passthrough"
    )
    assert passthrough["inputs"][0]["type"] == "any"
    assert passthrough["outputs"][0]["type"] == "any"
    trim = next(node for node in catalog.json()["nodes"] if node["kind"] == "trim")
    assert trim["inputs"][0]["type"] == "text"
    assert trim["outputs"][0]["type"] == "text"
    assert trim["fields"] == []
    extract = next(
        node for node in catalog.json()["nodes"] if node["kind"] == "extract_text"
    )
    assert extract["inputs"][0]["type"] == "any"
    assert [(output["name"], output["type"]) for output in extract["outputs"]] == [
        ("text", "text"),
        ("matched", "boolean"),
    ]
    assert {field["name"] for field in extract["fields"]} == {
        "start_marker",
        "end_marker",
        "require_match",
    }


@pytest.mark.asyncio
async def test_run_request_envelope_supports_target_scope(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GLITCHLAB_WORKSPACE", str(tmp_path))
    request = {
        "graph": {
            "name": "API partial",
            "nodes": [
                {
                    "id": "source",
                    "kind": "text_input",
                    "config": {"text": "thread"},
                },
                {"id": "target", "kind": "passthrough"},
                {"id": "downstream", "kind": "preview"},
            ],
            "edges": [
                {
                    "id": "source-target",
                    "source": "source",
                    "source_port": "text",
                    "target": "target",
                    "target_port": "value",
                },
                {
                    "id": "target-downstream",
                    "source": "target",
                    "source_port": "value",
                    "target": "downstream",
                    "target_port": "value",
                },
            ],
        },
        "scope": {"mode": "targets", "target_node_ids": ["target"]},
    }

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.post("/api/runs", json=request)

    assert response.status_code == 200
    payload = response.json()
    assert [result["node_id"] for result in payload["nodes"]] == ["source", "target"]
    assert payload["terminal_outputs"] == {"target": {"value": "thread"}}
    assert payload["manifest"]["scope"] == {
        "mode": "targets",
        "target_node_ids": ["target"],
        "executed_node_ids": ["source", "target"],
    }


@pytest.mark.asyncio
async def test_graph_documents_roundtrip_revision_guard_and_trash(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GLITCHLAB_WORKSPACE", str(tmp_path))
    graph = {
        "name": "Prompt sketch",
        "nodes": [
            {
                "id": "prompt",
                "kind": "text_input",
                "title": "Keep whitespace",
                "config": {"text": "  semantically spaced  "},
                "control_ports": {"text": "output"},
                "position": {"x": 12.5, "y": 30},
            },
            {
                "id": "pass",
                "kind": "passthrough",
                "config": {},
                "position": {"x": 280, "y": 30},
            },
        ],
        "edges": [
            {
                "id": "prompt-pass",
                "source": "prompt",
                "source_port": "text",
                "target": "pass",
                "target_port": "value",
            }
        ],
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        created = await client.post("/api/graphs", json={"graph": graph})
        duplicate_name = await client.post("/api/graphs", json={"graph": graph})
        graph_id = created.json()["graph"]["id"]
        listed = await client.get("/api/graphs")
        loaded = await client.get(f"/api/graphs/{graph_id}")
        updated_graph = {
            **graph,
            "nodes": [
                {
                    **graph["nodes"][0],
                    "config": {"text": "\n next revision \n"},
                },
                graph["nodes"][1],
            ],
        }
        updated = await client.put(
            f"/api/graphs/{graph_id}",
            json={"graph": updated_graph, "expected_revision": 1},
        )
        idempotent = await client.put(
            f"/api/graphs/{graph_id}",
            json={"graph": updated_graph, "expected_revision": 2},
        )
        stale = await client.put(
            f"/api/graphs/{graph_id}",
            json={"graph": graph, "expected_revision": 1},
        )
        deleted = await client.delete(f"/api/graphs/{graph_id}")

    assert created.status_code == 201
    assert duplicate_name.status_code == 201
    assert duplicate_name.json()["graph"]["id"] != graph_id
    assert len(listed.json()["graphs"]) == 2
    assert loaded.status_code == 200
    assert loaded.json()["graph"]["graph"]["nodes"][0]["title"] == "Keep whitespace"
    assert loaded.json()["graph"]["graph"]["nodes"][0]["config"]["text"] == (
        "  semantically spaced  "
    )
    assert {
        definition["kind"] for definition in loaded.json()["definitions"]
    } == {"text_input", "passthrough"}
    assert updated.status_code == 200
    assert updated.json()["graph"]["revision"] == 2
    assert idempotent.status_code == 200
    assert idempotent.json()["graph"]["revision"] == 2
    assert stale.status_code == 409
    assert stale.json()["detail"]["current_revision"] == 2
    assert deleted.status_code == 200
    recoverable = deleted.json()["deleted"]["recoverable_path"]
    assert (tmp_path / recoverable).is_file()


@pytest.mark.asyncio
async def test_saved_graph_round_trips_wire_colors_and_bundles(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GLITCHLAB_WORKSPACE", str(tmp_path))
    graph = {
        "name": "Wire presentation",
        "nodes": [
            {"id": "a", "kind": "text_input", "config": {"text": "a"}},
            {"id": "b", "kind": "text_input", "config": {"text": "b"}},
            {"id": "collect", "kind": "collect", "config": {}},
        ],
        "edges": [
            {
                "id": "edge-a",
                "source": "a",
                "source_port": "text",
                "target": "collect",
                "target_port": "item",
            },
            {
                "id": "edge-b",
                "source": "b",
                "source_port": "text",
                "target": "collect",
                "target_port": "item",
            },
        ],
        "presentation": {
            "edge_routing": "bezier",
            "wires": [
                {"edge_id": "edge-a", "color": "rose"},
                {"edge_id": "edge-b", "color": "cyan"},
            ],
            "wire_bundles": [
                {
                    "id": "bundle-a",
                    "edge_ids": ["edge-a", "edge-b"],
                    "waypoints": [{"x": 120, "y": 80}, {"x": 260, "y": 140}],
                    "label": "Talkie pair",
                }
            ],
        },
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        created = await client.post("/api/graphs", json={"graph": graph})
        graph_id = created.json()["graph"]["id"]
        loaded = await client.get(f"/api/graphs/{graph_id}")

    presentation = loaded.json()["graph"]["graph"]["presentation"]
    assert presentation["edge_routing"] == "bezier"
    assert presentation["wires"] == [
        {"edge_id": "edge-a", "color": "rose"},
        {"edge_id": "edge-b", "color": "cyan"},
    ]
    assert presentation["wire_bundles"] == [
        {
            "id": "bundle-a",
            "edge_ids": ["edge-a", "edge-b"],
            "waypoints": [{"x": 120.0, "y": 80.0}, {"x": 260.0, "y": 140.0}],
            "collapsed": False,
            "label": "Talkie pair",
        }
    ]


@pytest.mark.asyncio
async def test_checked_in_graph_templates_are_read_only(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GLITCHLAB_WORKSPACE", str(tmp_path))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        listed = await client.get("/api/graph-templates")
        loaded = await client.get("/api/graph-templates/openrouter-huggingface")
        traversal = await client.get("/api/graph-templates/..%2Fpyproject")

    assert listed.status_code == 200
    assert any(
        item["id"] == "openrouter-huggingface" for item in listed.json()["templates"]
    )
    assert loaded.status_code == 200
    assert loaded.json()["template"]["graph"]["name"] == (
        "Hugging Face prompts through OpenRouter"
    )
    assert loaded.json()["template"]["graph"]["nodes"]
    assert traversal.status_code == 404
    assert not (tmp_path / ".glitchlab" / "graphs").exists()


@pytest.mark.asyncio
async def test_saved_workflow_appears_in_catalog(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GLITCHLAB_WORKSPACE", str(tmp_path))
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
    monkeypatch.setenv("GLITCHLAB_WORKSPACE", str(tmp_path))
    payload = {
        "name": "Local Vintage Talkie",
        "description": "Bundle an endpoint and model reference.",
        "graph": {
            "name": "Local Vintage Talkie",
            "nodes": [
                {
                    "id": "endpoint",
                    "kind": "endpoint",
                    "title": "Local completion API",
                    "config": {
                        "base_url": "http://127.0.0.1:8790/v1",
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
                "label": "Local completion API · Endpoint",
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
    assert loaded.json()["workflow"]["graph"]["nodes"][0]["title"] == "Local completion API"
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
    trashed = list((tmp_path / ".glitchlab" / "workflows" / ".trash").glob("*/v*.json"))
    assert len(trashed) == 2
