from __future__ import annotations

import asyncio
import json
from datetime import datetime
from pathlib import Path

import httpx
import pytest

import glitchloom.server as server_module
from glitchloom.engine import GraphEngine, RunEventSinkError
from glitchloom.models import (
    GraphEdge,
    GraphNode,
    GraphRunFailure,
    GraphSpec,
    RunRequest,
    RunScope,
    RunStartedEvent,
)
from glitchloom.server import app


def node(node_id: str, kind: str, **config: object) -> GraphNode:
    return GraphNode(id=node_id, kind=kind, config=config)


def edge(
    edge_id: str,
    source: str,
    source_port: str,
    target: str,
    target_port: str,
) -> GraphEdge:
    return GraphEdge(
        id=edge_id,
        source=source,
        source_port=source_port,
        target=target,
        target_port=target_port,
    )


def branching_graph() -> GraphSpec:
    return GraphSpec(
        name="stream branch",
        nodes=[
            node("source", "text_input", text="thread"),
            node("left", "passthrough"),
            node("right", "passthrough"),
        ],
        edges=[
            edge("source-left", "source", "text", "left", "value"),
            edge("source-right", "source", "text", "right", "value"),
        ],
    )


@pytest.mark.asyncio
async def test_engine_events_follow_real_partial_execution_boundaries(tmp_path: Path) -> None:
    events = []

    async def collect(event) -> None:
        events.append(event)

    response = await GraphEngine(workspace=tmp_path).run(
        branching_graph(),
        scope=RunScope(mode="targets", target_node_ids=["left"]),
        event_sink=collect,
    )

    assert [event.event for event in events] == [
        "run_started",
        "run_planned",
        "node_started",
        "node_completed",
        "node_started",
        "edges_transferred",
        "node_completed",
        "run_completed",
    ]
    assert [event.sequence for event in events] == list(range(1, len(events) + 1))
    assert len({event.run_id for event in events}) == 1
    assert all(datetime.fromisoformat(event.at) for event in events)

    planned = events[1]
    assert planned.plan.mode == "targets"
    assert planned.plan.target_node_ids == ["left"]
    assert planned.plan.node_ids == ["source", "left"]
    assert planned.plan.edge_ids == ["source-left"]

    transferred = events[5]
    assert transferred.node_id == "left"
    assert transferred.edge_ids == ["source-left"]
    assert set(transferred.model_dump()) == {
        "protocol_version",
        "sequence",
        "at",
        "run_id",
        "event",
        "node_id",
        "edge_ids",
    }
    assert events[-1].response == response
    assert response.manifest.scope.executed_node_ids == ["source", "left"]


@pytest.mark.asyncio
async def test_engine_stream_reports_preflight_and_node_failures(tmp_path: Path) -> None:
    missing_events = []

    async def collect_missing(event) -> None:
        missing_events.append(event)

    with pytest.raises(GraphRunFailure, match="missing required input"):
        await GraphEngine(workspace=tmp_path).run(
            GraphSpec(nodes=[node("preview", "preview")], edges=[]),
            event_sink=collect_missing,
        )

    assert [event.event for event in missing_events] == ["run_started", "run_failed"]
    assert missing_events[-1].detail.node_id == "preview"
    assert missing_events[-1].detail.nodes == []

    failure_events = []

    async def collect_failure(event) -> None:
        failure_events.append(event)

    failing = GraphSpec(
        nodes=[
            node("source", "text_input", text="thread"),
            node("broken", "replace", find="[", replacement="", regex=True),
        ],
        edges=[edge("source-broken", "source", "text", "broken", "text")],
    )
    with pytest.raises(GraphRunFailure, match="Replace failed"):
        await GraphEngine(workspace=tmp_path).run(failing, event_sink=collect_failure)

    assert [event.event for event in failure_events[-2:]] == ["node_failed", "run_failed"]
    assert failure_events[-2].node_id == "broken"
    assert [result.status for result in failure_events[-1].detail.nodes] == [
        "completed",
        "failed",
    ]


@pytest.mark.parametrize(
    "failed_event",
    [
        "run_started",
        "run_planned",
        "node_started",
        "edges_transferred",
        "node_completed",
        "node_failed",
        "run_completed",
        "run_failed",
    ],
)
@pytest.mark.asyncio
async def test_event_sink_failures_never_fabricate_dag_failures(
    tmp_path: Path,
    failed_event: str,
) -> None:
    seen = []

    class SinkFailure(RuntimeError):
        pass

    async def fail_at_boundary(event) -> None:
        seen.append(event.event)
        if event.event == failed_event:
            raise SinkFailure("observer unavailable")

    graph = branching_graph()
    if failed_event in {"node_failed", "run_failed"}:
        graph = GraphSpec(
            nodes=[
                node("source", "text_input", text="thread"),
                node("broken", "replace", find="[", replacement="", regex=True),
            ],
            edges=[edge("source-broken", "source", "text", "broken", "text")],
        )

    with pytest.raises(RunEventSinkError, match=failed_event) as raised:
        await GraphEngine(workspace=tmp_path).run(graph, event_sink=fail_at_boundary)

    assert seen[-1] == failed_event
    assert raised.value.event.event == failed_event
    assert isinstance(raised.value.cause, SinkFailure)
    if failed_event not in {"node_failed", "run_failed"}:
        assert "node_failed" not in seen
        assert "run_failed" not in seen


@pytest.mark.asyncio
async def test_duplicate_edge_ids_fail_only_when_they_are_in_scope(tmp_path: Path) -> None:
    graph = GraphSpec(
        nodes=[
            node("source", "text_input", text="thread"),
            node("left", "passthrough"),
            node("right", "passthrough"),
            node("right-preview", "preview"),
        ],
        edges=[
            edge("source-left", "source", "text", "left", "value"),
            edge("duplicate", "source", "text", "right", "value"),
            edge("duplicate", "right", "value", "right-preview", "value"),
        ],
    )
    events = []

    async def collect(event) -> None:
        events.append(event)

    with pytest.raises(GraphRunFailure, match="Edge IDs must be unique"):
        await GraphEngine(workspace=tmp_path).run(graph, event_sink=collect)
    assert [event.event for event in events] == ["run_started", "run_failed"]

    partial_events = []

    async def collect_partial(event) -> None:
        partial_events.append(event)

    response = await GraphEngine(workspace=tmp_path).run(
        graph,
        scope=RunScope(mode="targets", target_node_ids=["left"]),
        event_sink=collect_partial,
    )
    assert response.terminal_outputs == {"left": {"value": "thread"}}
    assert partial_events[1].plan.edge_ids == ["source-left"]


@pytest.mark.asyncio
async def test_stream_endpoint_emits_ndjson_and_preserves_legacy_route(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GLITCHLOOM_WORKSPACE", str(tmp_path))
    request = {
        "graph": branching_graph().model_dump(mode="json"),
        "scope": {"mode": "targets", "target_node_ids": ["left"]},
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        streamed = await client.post("/api/runs/stream", json=request)
        ordinary = await client.post("/api/runs", json=request)
        invalid_envelope = await client.post(
            "/api/runs/stream",
            json={"graph": {"name": "missing collections"}},
        )

    assert streamed.status_code == 200
    assert streamed.headers["content-type"].startswith("application/x-ndjson")
    assert streamed.headers["cache-control"] == "no-cache"
    events = [json.loads(line) for line in streamed.text.splitlines()]
    assert [event["sequence"] for event in events] == list(range(1, len(events) + 1))
    assert events[-1]["event"] == "run_completed"
    assert events[-1]["response"]["terminal_outputs"] == {"left": {"value": "thread"}}

    assert ordinary.status_code == 200
    assert ordinary.headers["content-type"].startswith("application/json")
    assert ordinary.json()["terminal_outputs"] == {"left": {"value": "thread"}}
    assert invalid_envelope.status_code == 422
    assert invalid_envelope.headers["content-type"].startswith("application/json")


@pytest.mark.asyncio
async def test_stream_graph_failure_is_terminal_in_band_but_legacy_is_422(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GLITCHLOOM_WORKSPACE", str(tmp_path))
    request = {
        "graph": {
            "name": "missing input",
            "nodes": [{"id": "preview", "kind": "preview"}],
            "edges": [],
        },
        "scope": {"mode": "full", "target_node_ids": []},
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        streamed = await client.post("/api/runs/stream", json=request)
        ordinary = await client.post("/api/runs", json=request)

    assert streamed.status_code == 200
    events = [json.loads(line) for line in streamed.text.splitlines()]
    assert [event["event"] for event in events] == ["run_started", "run_failed"]
    assert events[-1]["detail"]["node_id"] == "preview"
    assert ordinary.status_code == 422
    assert ordinary.json()["detail"]["node_id"] == "preview"


@pytest.mark.asyncio
async def test_closing_stream_best_effort_cancels_cooperative_engine(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started = asyncio.Event()
    cancelled = asyncio.Event()

    class BlockingEngine:
        async def run(self, graph, *, scope=None, event_sink=None):
            assert event_sink is not None
            await event_sink(
                RunStartedEvent(
                    protocol_version=1,
                    event="run_started",
                    sequence=1,
                    at="2026-08-02T00:00:00+00:00",
                    run_id="blocking-run",
                    requested_scope=scope or RunScope(),
                )
            )
            started.set()
            try:
                await asyncio.Future()
            finally:
                cancelled.set()

    monkeypatch.setattr(server_module, "GraphEngine", BlockingEngine)
    request = RunRequest(graph=branching_graph())
    lines = server_module._run_event_lines(request)

    first = json.loads((await anext(lines)).decode())
    assert first["event"] == "run_started"
    await asyncio.wait_for(started.wait(), timeout=1)
    await lines.aclose()
    await asyncio.wait_for(cancelled.wait(), timeout=1)


def test_stream_openapi_exposes_discriminated_protocol_event_union() -> None:
    schema = app.openapi()
    responses = schema["paths"]["/api/runs/stream"]["post"]["responses"]
    assert set(responses["200"]["content"]) == {"application/x-ndjson"}
    assert set(responses["422"]["content"]) == {"application/json"}
    assert "RunStreamEvent" in schema["components"]["schemas"]
    event_union = schema["components"]["schemas"]["RunEvent"]
    assert event_union["discriminator"]["propertyName"] == "event"
    assert len(event_union["oneOf"]) == 8
    for reference in event_union["oneOf"]:
        name = reference["$ref"].rsplit("/", 1)[-1]
        required = set(schema["components"]["schemas"][name]["required"])
        assert {"protocol_version", "event"} <= required
