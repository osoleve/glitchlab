from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from glitchloom.engine import GraphEngine
from glitchloom.models import GraphEdge, GraphNode, GraphRunFailure, GraphSpec


def node(node_id: str, kind: str, **config: object) -> GraphNode:
    return GraphNode(id=node_id, kind=kind, config=config)


def edge(
    source: str,
    source_port: str,
    target: str,
    target_port: str,
) -> GraphEdge:
    return GraphEdge(
        id=f"{source}-{target}-{target_port}",
        source=source,
        source_port=source_port,
        target=target,
        target_port=target_port,
    )


@pytest.mark.asyncio
async def test_template_bind_and_render(tmp_path: Path) -> None:
    graph = GraphSpec(
        name="template",
        nodes=[
            node("template", "template_input", template="?person went to ??town."),
            node("fill", "fill_hole", name="person", value="Ada"),
            node("render", "render_template"),
            node("preview", "preview"),
        ],
        edges=[
            edge("template", "template", "fill", "template"),
            edge("fill", "template", "render", "template"),
            edge("render", "text", "preview", "value"),
        ],
    )

    response = await GraphEngine(workspace=tmp_path).run(graph)

    assert response.terminal_outputs["preview"]["value"] == "Ada went to ?town."
    assert response.manifest.graph_digest
    assert all(result.status == "completed" for result in response.nodes)


@pytest.mark.asyncio
async def test_unbound_template_stops_at_render(tmp_path: Path) -> None:
    graph = GraphSpec(
        nodes=[
            node("template", "template_input", template="?person went to ?store."),
            node("fill", "fill_hole", name="person", value="Ada"),
            node("render", "render_template"),
        ],
        edges=[
            edge("template", "template", "fill", "template"),
            edge("fill", "template", "render", "template"),
        ],
    )

    with pytest.raises(GraphRunFailure, match="unbound holes: store") as error:
        await GraphEngine(workspace=tmp_path).run(graph)

    assert error.value.node_id == "render"


@pytest.mark.asyncio
async def test_cycle_is_rejected(tmp_path: Path) -> None:
    graph = GraphSpec(
        nodes=[
            node("left", "replace", find="a", replacement="b", regex=False),
            node("right", "replace", find="b", replacement="a", regex=False),
        ],
        edges=[
            edge("left", "text", "right", "text"),
            edge("right", "text", "left", "text"),
        ],
    )

    with pytest.raises(GraphRunFailure, match="cycles are not allowed"):
        await GraphEngine(workspace=tmp_path).run(graph)


@pytest.mark.asyncio
async def test_openai_compatible_completion_preserves_provenance(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert request.url == "http://models.test/v1/completions"
        assert body["model"] == "talkie-1930-13b-base"
        assert body["prompt"] == "Once upon a time"
        assert body["seed"] == 23
        assert "model_revision" not in body
        return httpx.Response(
            200,
            json={
                "id": "cmpl-test",
                "model_revision": "b7c9768",
                "choices": [
                    {
                        "text": ", there was a machine.",
                        "finish_reason": "length",
                        "logprobs": None,
                    }
                ],
                "usage": {"prompt_tokens": 4, "completion_tokens": 6},
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        graph = GraphSpec(
            nodes=[
                node("prompt", "text_input", text="Once upon a time"),
                node(
                    "endpoint",
                    "endpoint",
                    base_url="http://models.test/v1",
                    api_key_env="",
                    timeout_seconds=5,
                ),
                node("model", "model", model_id="talkie-1930-13b-base"),
                node(
                    "complete",
                    "completion",
                    temperature=0.8,
                    top_p=0.95,
                    max_tokens=6,
                    seed=23,
                    stop="",
                    logprobs=None,
                    extra_body={},
                ),
            ],
            edges=[
                edge("prompt", "text", "complete", "prompt"),
                edge("endpoint", "endpoint", "complete", "endpoint"),
                edge("model", "model", "complete", "model"),
            ],
        )

        response = await GraphEngine(workspace=tmp_path, http_client=client).run(graph)

    result = response.terminal_outputs["complete"]["result"]
    assert result["kind"] == "completion_result"
    assert result["text"] == ", there was a machine."
    assert result["request_id"] == "cmpl-test"
    assert result["model_revision"] == "b7c9768"
    assert result["parameters"]["seed"] == 23


@pytest.mark.asyncio
async def test_completion_exact_request_cache_avoids_duplicate_calls(tmp_path: Path) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(
            200,
            json={
                "id": f"cmpl-{calls}",
                "choices": [
                    {
                        "text": " cached answer",
                        "finish_reason": "length",
                        "logprobs": None,
                    }
                ],
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        graph = GraphSpec(
            nodes=[
                node("prompt", "text_input", text="Cache me"),
                node(
                    "endpoint",
                    "endpoint",
                    base_url="http://models.test/v1",
                    api_key_env="",
                    timeout_seconds=5,
                ),
                node("model", "model", model_id="talkie-web-13b-base"),
                node(
                    "complete",
                    "completion",
                    temperature=0.8,
                    top_p=0.95,
                    max_tokens=4,
                    seed=31,
                    stop="",
                    logprobs=None,
                    extra_body={},
                    cache_mode="use",
                ),
            ],
            edges=[
                edge("prompt", "text", "complete", "prompt"),
                edge("endpoint", "endpoint", "complete", "endpoint"),
                edge("model", "model", "complete", "model"),
            ],
        )
        engine = GraphEngine(workspace=tmp_path, http_client=client)
        first = await engine.run(graph)
        second = await engine.run(graph)

    assert calls == 1
    assert not first.terminal_outputs["complete"]["result"]["cache"]["hit"]
    assert second.terminal_outputs["complete"]["result"]["cache"]["hit"]
    assert (
        first.terminal_outputs["complete"]["result"]["cache"]["key"]
        == second.terminal_outputs["complete"]["result"]["cache"]["key"]
    )


@pytest.mark.asyncio
async def test_generic_completion_branches_collect_talkie_results(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert request.url == "http://elsie.test:8790/v1/completions"
        assert body["model"] in {
            "talkie-1930-13b-base",
            "talkie-web-13b-base",
        }
        return httpx.Response(
            200,
            json={
                "id": f"cmpl-{body['model']}",
                "model": body["model"],
                "model_revision": f"revision-{body['model']}",
                "choices": [
                    {
                        "text": (
                            " vintage answer"
                            if body["model"] == "talkie-1930-13b-base"
                            else " web answer"
                        ),
                        "finish_reason": "length",
                        "logprobs": None,
                    },
                ],
                "usage": {"completion_tokens": 2},
                "elapsed_seconds": 0.2,
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        graph = GraphSpec(
            nodes=[
                node("prompt", "text_input", text="Atomic means"),
                node(
                    "endpoint",
                    "endpoint",
                    base_url="http://elsie.test:8790/v1",
                    api_key_env="",
                    timeout_seconds=5,
                ),
                node("vintage", "model", model_id="talkie-1930-13b-base"),
                node("web", "model", model_id="talkie-web-13b-base"),
                node(
                    "complete-vintage",
                    "completion",
                    temperature=0.8,
                    top_p=0.95,
                    max_tokens=8,
                    seed=7,
                    stop="",
                    logprobs=None,
                    extra_body={"top_k": 40, "presence_penalty": 0.0},
                    cache_mode="off",
                ),
                node(
                    "complete-web",
                    "completion",
                    temperature=0.8,
                    top_p=0.95,
                    max_tokens=8,
                    seed=7,
                    stop="",
                    logprobs=None,
                    extra_body={"top_k": 40, "presence_penalty": 0.0},
                    cache_mode="off",
                ),
                node("collect", "collect", flatten=False),
            ],
            edges=[
                edge("endpoint", "endpoint", "complete-vintage", "endpoint"),
                edge("endpoint", "endpoint", "complete-web", "endpoint"),
                edge("vintage", "model", "complete-vintage", "model"),
                edge("web", "model", "complete-web", "model"),
                edge("prompt", "text", "complete-vintage", "prompt"),
                edge("prompt", "text", "complete-web", "prompt"),
                edge("complete-vintage", "result", "collect", "item"),
                edge("complete-web", "result", "collect", "item"),
            ],
        )

        response = await GraphEngine(workspace=tmp_path, http_client=client).run(graph)

    results = response.terminal_outputs["collect"]["items"]
    assert [result["model"] for result in results] == [
        "talkie-1930-13b-base",
        "talkie-web-13b-base",
    ]
    assert [result["text"] for result in results] == [" vintage answer", " web answer"]
    assert [result["model_revision"] for result in results] == [
        "revision-talkie-1930-13b-base",
        "revision-talkie-web-13b-base",
    ]


@pytest.mark.asyncio
async def test_write_file_is_workspace_scoped(tmp_path: Path) -> None:
    graph = GraphSpec(
        nodes=[
            node("text", "text_input", text="hello"),
            node(
                "write",
                "write_file",
                path="runs/result.txt",
                format="text",
                overwrite=False,
            ),
        ],
        edges=[edge("text", "text", "write", "value")],
    )

    response = await GraphEngine(workspace=tmp_path).run(graph)

    path = tmp_path / "runs" / "result.txt"
    assert path.read_text(encoding="utf-8") == "hello"
    assert response.terminal_outputs["write"]["file"]["sha256"]
