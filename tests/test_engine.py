from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from glitchloom.catalog import control_port_name
from glitchloom.engine import GraphEngine
from glitchloom.models import (
    GraphEdge,
    GraphNode,
    GraphRunFailure,
    GraphSpec,
    WorkflowDraft,
    WorkflowInput,
    WorkflowOutput,
)
from glitchloom.workflows import WorkflowInUseError, WorkflowStore, workflow_kind


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
async def test_passthrough_preserves_any_value(tmp_path: Path) -> None:
    graph = GraphSpec(
        name="passthrough",
        nodes=[
            node("source", "list_input", items=["one", {"two": 2}]),
            node("pass", "passthrough"),
        ],
        edges=[edge("source", "items", "pass", "value")],
    )

    response = await GraphEngine(workspace=tmp_path).run(graph)

    assert response.terminal_outputs["pass"]["value"] == ["one", {"two": 2}]


@pytest.mark.asyncio
async def test_promoted_controls_connect_as_typed_ports(tmp_path: Path) -> None:
    replacement_port = control_port_name("replacement")
    literal_port = control_port_name("text")
    graph = GraphSpec(
        name="promoted controls",
        nodes=[
            GraphNode(
                id="literal",
                kind="text_input",
                config={"text": "glow"},
                control_ports={"text": "output"},
            ),
            node("text", "text_input", text="hello world"),
            GraphNode(
                id="replace",
                kind="replace",
                config={"find": "world", "replacement": "unused", "regex": False},
                control_ports={"replacement": "input"},
            ),
        ],
        edges=[
            edge("text", "text", "replace", "text"),
            edge("literal", literal_port, "replace", replacement_port),
        ],
    )

    response = await GraphEngine(workspace=tmp_path).run(graph)

    assert response.terminal_outputs["replace"]["text"] == "hello glow"
    literal_result = next(
        result for result in response.nodes if result.node_id == "literal"
    )
    assert literal_result.outputs[literal_port] == "glow"
    assert response.manifest.graph.nodes[0].control_ports == {"text": "output"}


@pytest.mark.asyncio
async def test_unconnected_promoted_input_uses_its_local_default(
    tmp_path: Path,
) -> None:
    graph = GraphSpec(
        nodes=[
            node("text", "text_input", text="hello"),
            GraphNode(
                id="replace",
                kind="replace",
                config={"find": "hello", "replacement": "goodbye", "regex": False},
                control_ports={"replacement": "input"},
            ),
        ],
        edges=[edge("text", "text", "replace", "text")],
    )

    response = await GraphEngine(workspace=tmp_path).run(graph)

    assert response.terminal_outputs["replace"]["text"] == "goodbye"


@pytest.mark.asyncio
async def test_number_source_drives_a_passthrough_control(
    tmp_path: Path,
) -> None:
    value_port = control_port_name("value")
    graph = GraphSpec(
        nodes=[
            node("source", "number_input", value=7),
            GraphNode(
                id="target",
                kind="number_input",
                config={"value": 11},
                control_ports={"value": "passthrough"},
            ),
        ],
        edges=[edge("source", "number", "target", value_port)],
    )

    response = await GraphEngine(workspace=tmp_path).run(graph)

    assert response.terminal_outputs["target"] == {
        "number": 7,
        value_port: 7,
    }


@pytest.mark.asyncio
async def test_unconnected_passthrough_control_emits_its_default(
    tmp_path: Path,
) -> None:
    value_port = control_port_name("value")
    graph = GraphSpec(
        nodes=[
            GraphNode(
                id="target",
                kind="number_input",
                config={"value": 11},
                control_ports={"value": "passthrough"},
            )
        ],
        edges=[],
    )

    response = await GraphEngine(workspace=tmp_path).run(graph)

    assert response.terminal_outputs["target"] == {
        "number": 11,
        value_port: 11,
    }


@pytest.mark.asyncio
async def test_unknown_control_cannot_be_promoted(tmp_path: Path) -> None:
    graph = GraphSpec(
        nodes=[
            GraphNode(
                id="text",
                kind="text_input",
                config={"text": "hello"},
                control_ports={"missing": "output"},
            )
        ],
        edges=[],
    )

    with pytest.raises(
        GraphRunFailure,
        match="has no configurable control 'missing'",
    ):
        await GraphEngine(workspace=tmp_path).run(graph)


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
    fill_result = next(result for result in response.nodes if result.node_id == "fill")
    assert fill_result.outputs["text"] == "Ada went to ?town."
    assert response.manifest.graph_digest
    assert all(result.status == "completed" for result in response.nodes)


@pytest.mark.asyncio
async def test_bound_text_can_drive_a_model_id_control(tmp_path: Path) -> None:
    model_id_port = control_port_name("model_id")
    graph = GraphSpec(
        nodes=[
            node(
                "template",
                "template_input",
                template="talkie-?version-13b-base",
            ),
            node("fill", "fill_hole", name="version", value="web"),
            GraphNode(
                id="model",
                kind="model",
                config={"model_id": "unused"},
                control_ports={"model_id": "input"},
            ),
        ],
        edges=[
            edge("template", "template", "fill", "template"),
            edge("fill", "text", "model", model_id_port),
        ],
    )

    response = await GraphEngine(workspace=tmp_path).run(graph)

    assert response.terminal_outputs["model"]["model"]["model_id"] == (
        "talkie-web-13b-base"
    )


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
    fill_result = next(
        result for result in error.value.results if result.node_id == "fill"
    )
    assert fill_result.outputs["text"] == "Ada went to ?store."


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


@pytest.mark.asyncio
async def test_versioned_workflow_executes_as_a_typed_node(tmp_path: Path) -> None:
    store = WorkflowStore(tmp_path)
    workflow = store.save(
        WorkflowDraft(
            name="Excited text",
            description="Add emphasis and expose the transformed text.",
            graph=GraphSpec(
                name="Excited text",
                nodes=[
                    node("replace", "replace", find=".", replacement="!", regex=False),
                ],
                edges=[],
            ),
            inputs=[
                WorkflowInput(
                    name="text",
                    label="Text",
                    type="text",
                    node_id="replace",
                    node_port="text",
                )
            ],
            outputs=[
                WorkflowOutput(
                    name="text",
                    label="Text",
                    type="text",
                    node_id="replace",
                    node_port="text",
                )
            ],
        )
    )
    graph = GraphSpec(
        name="parent",
        nodes=[
            node("source", "text_input", text="Hello."),
            node(
                "workflow",
                workflow_kind(workflow.id, workflow.version),
                workflow_digest=workflow.digest,
            ),
            node("preview", "preview"),
        ],
        edges=[
            edge("source", "text", "workflow", "text"),
            edge("workflow", "text", "preview", "value"),
        ],
    )

    response = await GraphEngine(
        workspace=tmp_path,
        workflow_store=store,
    ).run(graph)

    assert response.terminal_outputs["preview"]["value"] == "Hello!"
    workflow_result = next(result for result in response.nodes if result.node_id == "workflow")
    assert workflow_result.outputs == {"text": "Hello!"}
    frozen_workflow = next(
        item for item in response.manifest.graph.nodes if item.id == "workflow"
    )
    assert frozen_workflow.config["workflow_digest"] == workflow.digest


@pytest.mark.asyncio
async def test_workflow_exposes_promoted_control_ports(tmp_path: Path) -> None:
    store = WorkflowStore(tmp_path)
    replacement_port = control_port_name("replacement")
    find_port = control_port_name("find")
    workflow = store.save(
        WorkflowDraft(
            name="Configurable replacement",
            graph=GraphSpec(
                nodes=[
                    node("text", "text_input", text="hello world"),
                    GraphNode(
                        id="replace",
                        kind="replace",
                        config={
                            "find": "world",
                            "replacement": "unused",
                            "regex": False,
                        },
                        control_ports={
                            "replacement": "input",
                            "find": "output",
                        },
                    ),
                ],
                edges=[edge("text", "text", "replace", "text")],
            ),
            inputs=[
                WorkflowInput(
                    name="replacement",
                    label="Replace · Replacement",
                    type="text",
                    required=False,
                    node_id="replace",
                    node_port=replacement_port,
                )
            ],
            outputs=[
                WorkflowOutput(
                    name="text",
                    label="Replace · Text",
                    type="text",
                    node_id="replace",
                    node_port="text",
                ),
                WorkflowOutput(
                    name="find",
                    label="Replace · Find",
                    type="text",
                    node_id="replace",
                    node_port=find_port,
                ),
            ],
        )
    )
    graph = GraphSpec(
        nodes=[
            node("replacement", "text_input", text="moon"),
            node("workflow", workflow_kind(workflow.id, workflow.version)),
        ],
        edges=[edge("replacement", "text", "workflow", "replacement")],
    )

    response = await GraphEngine(
        workspace=tmp_path,
        workflow_store=store,
    ).run(graph)

    assert response.terminal_outputs["workflow"] == {
        "text": "hello moon",
        "find": "world",
    }

    defaulted_response = await GraphEngine(
        workspace=tmp_path,
        workflow_store=store,
    ).run(
        GraphSpec(
            nodes=[
                node(
                    "workflow",
                    workflow_kind(workflow.id, workflow.version),
                )
            ],
            edges=[],
        )
    )
    assert defaulted_response.terminal_outputs["workflow"] == {
        "text": "hello unused",
        "find": "world",
    }

    definition = store.definition_for_kind(
        workflow_kind(workflow.id, workflow.version)
    )
    assert definition["inputs"][0]["type"] == "text"
    assert definition["inputs"][0]["required"] is False
    assert {port["name"] for port in definition["outputs"]} == {"text", "find"}


@pytest.mark.asyncio
async def test_existing_workflow_node_keeps_its_immutable_version(tmp_path: Path) -> None:
    store = WorkflowStore(tmp_path)

    def draft(replacement: str) -> WorkflowDraft:
        return WorkflowDraft(
            name="Punctuation",
            graph=GraphSpec(
                nodes=[
                    node(
                        "replace",
                        "replace",
                        find=".",
                        replacement=replacement,
                        regex=False,
                    )
                ],
                edges=[],
            ),
            inputs=[
                WorkflowInput(
                    name="text",
                    label="Text",
                    type="text",
                    node_id="replace",
                    node_port="text",
                )
            ],
            outputs=[
                WorkflowOutput(
                    name="text",
                    label="Text",
                    type="text",
                    node_id="replace",
                    node_port="text",
                )
            ],
        )

    first = store.save(draft("!"))
    second = store.save(draft("?"))
    assert first.id == second.id
    assert second.version == 2

    graph = GraphSpec(
        nodes=[
            node("source", "text_input", text="Still stable."),
            node("first", workflow_kind(first.id, first.version)),
        ],
        edges=[edge("source", "text", "first", "text")],
    )
    response = await GraphEngine(
        workspace=tmp_path,
        workflow_store=store,
    ).run(graph)

    assert response.terminal_outputs["first"]["text"] == "Still stable!"


def test_workflow_delete_rejects_saved_dependents(tmp_path: Path) -> None:
    store = WorkflowStore(tmp_path)
    leaf = store.save(
        WorkflowDraft(
            name="Leaf",
            graph=GraphSpec(nodes=[node("text", "text_input", text="hello")], edges=[]),
            outputs=[
                WorkflowOutput(
                    name="text",
                    label="Text",
                    type="text",
                    node_id="text",
                    node_port="text",
                )
            ],
        )
    )
    store.save(
        WorkflowDraft(
            name="Parent",
            graph=GraphSpec(
                nodes=[node("leaf", workflow_kind(leaf.id, leaf.version))],
                edges=[],
            ),
            outputs=[
                WorkflowOutput(
                    name="text",
                    label="Text",
                    type="text",
                    node_id="leaf",
                    node_port="text",
                )
            ],
        )
    )

    with pytest.raises(WorkflowInUseError, match="Parent v1"):
        store.delete(leaf.id)
