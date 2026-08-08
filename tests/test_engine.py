from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import pytest

from glitchlab.catalog import control_port_name
from glitchlab.engine import GraphEngine, compute_execution_scope
from glitchlab.graphs import GraphConflictError, GraphStore
from glitchlab.models import (
    GraphDocumentDraft,
    GraphEdge,
    GraphNode,
    GraphRunFailure,
    GraphSpec,
    LoomEntry,
    LoomState,
    RunScope,
    WorkflowDraft,
    WorkflowInput,
    WorkflowOutput,
)
from glitchlab.workflows import WorkflowInUseError, WorkflowStore, workflow_kind


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
async def test_collect_preserves_groups_and_flatten_is_explicit(tmp_path: Path) -> None:
    graph = GraphSpec(
        nodes=[
            node("left", "list_input", items=["a", "b"]),
            node("right", "list_input", items=["c", "d"]),
            node("collect", "collect"),
            node("flatten", "flatten"),
        ],
        edges=[
            edge("left", "items", "collect", "item"),
            edge("right", "items", "collect", "item"),
            edge("collect", "items", "flatten", "items"),
        ],
    )

    response = await GraphEngine(workspace=tmp_path).run(graph)

    collect_result = next(result for result in response.nodes if result.node_id == "collect")
    assert collect_result.outputs["items"] == [["a", "b"], ["c", "d"]]
    assert response.terminal_outputs["flatten"]["items"] == ["a", "b", "c", "d"]


@pytest.mark.asyncio
async def test_saved_collect_flatten_config_remains_backward_compatible(tmp_path: Path) -> None:
    graph = GraphSpec(
        nodes=[
            node("left", "list_input", items=["a", "b"]),
            node("right", "list_input", items=["c"]),
            node("collect", "collect", flatten=True),
        ],
        edges=[
            edge("left", "items", "collect", "item"),
            edge("right", "items", "collect", "item"),
        ],
    )

    response = await GraphEngine(workspace=tmp_path).run(graph)

    assert response.terminal_outputs["collect"]["items"] == ["a", "b", "c"]


@pytest.mark.asyncio
async def test_compare_preview_preserves_each_input_sequence(tmp_path: Path) -> None:
    graph = GraphSpec(
        nodes=[
            node("left", "list_input", items=["old one", "old two"]),
            node("right", "list_input", items=["new one"]),
            node("compare", "compare_preview"),
        ],
        edges=[
            edge("left", "items", "compare", "series"),
            edge("right", "items", "compare", "series"),
        ],
    )

    response = await GraphEngine(workspace=tmp_path).run(graph)

    assert response.terminal_outputs["compare"]["values"] == [
        ["old one", "old two"],
        ["new one"],
    ]


def branching_graph() -> GraphSpec:
    return GraphSpec(
        name="partial branch",
        nodes=[
            node("shared", "text_input", text="thread"),
            node("left", "passthrough"),
            node("left-preview", "preview"),
            node("right", "passthrough"),
            node("right-preview", "preview"),
        ],
        edges=[
            edge("shared", "text", "left", "value"),
            edge("left", "value", "left-preview", "value"),
            edge("shared", "text", "right", "value"),
            edge("right", "value", "right-preview", "value"),
        ],
    )


def test_target_scope_is_the_stable_induced_upstream_closure() -> None:
    graph = branching_graph()

    scoped = compute_execution_scope(
        graph,
        RunScope(
            mode="targets",
            target_node_ids=["right-preview", "left", "right-preview"],
        ),
    )

    assert scoped.target_node_ids == ("right-preview", "left")
    assert [item.id for item in scoped.graph.nodes] == [
        "shared",
        "left",
        "right",
        "right-preview",
    ]
    assert [item.id for item in scoped.graph.edges] == [
        "shared-left-value",
        "shared-right-value",
        "right-right-preview-value",
    ]


@pytest.mark.asyncio
async def test_target_run_executes_only_upstream_and_returns_requested_target(
    tmp_path: Path,
) -> None:
    response = await GraphEngine(workspace=tmp_path).run(
        branching_graph(),
        scope=RunScope(mode="targets", target_node_ids=["left"]),
    )

    assert [result.node_id for result in response.nodes] == ["shared", "left"]
    assert response.terminal_outputs == {"left": {"value": "thread"}}
    assert response.manifest.scope.mode == "targets"
    assert response.manifest.scope.target_node_ids == ["left"]
    assert response.manifest.scope.executed_node_ids == ["shared", "left"]
    assert len(response.manifest.graph.nodes) == 5


@pytest.mark.asyncio
async def test_multiple_targets_execute_their_union_once_in_stable_order(
    tmp_path: Path,
) -> None:
    response = await GraphEngine(workspace=tmp_path).run(
        branching_graph(),
        scope=RunScope(
            mode="targets",
            target_node_ids=["right-preview", "left"],
        ),
    )

    assert [result.node_id for result in response.nodes] == [
        "shared",
        "left",
        "right",
        "right-preview",
    ]
    assert response.terminal_outputs == {
        "right-preview": {"value": "thread"},
        "left": {"value": "thread"},
    }


@pytest.mark.asyncio
async def test_unrelated_invalid_branch_and_cycle_do_not_block_target_run(
    tmp_path: Path,
) -> None:
    graph = branching_graph()
    graph.nodes.extend(
        [
            node("missing-input", "preview"),
            node("cycle-a", "passthrough"),
            node("cycle-b", "passthrough"),
        ]
    )
    graph.edges.extend(
        [
            edge("cycle-a", "value", "cycle-b", "value"),
            edge("cycle-b", "value", "cycle-a", "value"),
        ]
    )

    response = await GraphEngine(workspace=tmp_path).run(
        graph,
        scope=RunScope(mode="targets", target_node_ids=["left"]),
    )

    assert [result.node_id for result in response.nodes] == ["shared", "left"]


@pytest.mark.asyncio
async def test_invalidity_inside_target_closure_fails_before_execution(
    tmp_path: Path,
) -> None:
    missing_input = GraphSpec(
        name="missing",
        nodes=[node("preview", "preview")],
        edges=[],
    )
    cycle = GraphSpec(
        name="cycle",
        nodes=[
            node("cycle-a", "passthrough"),
            node("cycle-b", "passthrough"),
        ],
        edges=[
            edge("cycle-a", "value", "cycle-b", "value"),
            edge("cycle-b", "value", "cycle-a", "value"),
        ],
    )
    engine = GraphEngine(workspace=tmp_path)

    with pytest.raises(GraphRunFailure, match="missing required input") as missing:
        await engine.run(
            missing_input,
            scope=RunScope(mode="targets", target_node_ids=["preview"]),
        )
    with pytest.raises(GraphRunFailure, match="cycles are not allowed") as cyclic:
        await engine.run(
            cycle,
            scope=RunScope(mode="targets", target_node_ids=["cycle-a"]),
        )

    assert missing.value.results == []
    assert cyclic.value.results == []


@pytest.mark.asyncio
async def test_target_run_does_not_execute_unrelated_side_effect(
    tmp_path: Path,
) -> None:
    graph = branching_graph()
    graph.nodes.append(node("write", "write_file", path="should-not-exist.txt"))
    graph.edges.append(edge("shared", "text", "write", "value"))

    await GraphEngine(workspace=tmp_path).run(
        graph,
        scope=RunScope(mode="targets", target_node_ids=["left"]),
    )

    assert not (tmp_path / "should-not-exist.txt").exists()


@pytest.mark.asyncio
async def test_target_validation_and_partial_failure_results(
    tmp_path: Path,
) -> None:
    graph = GraphSpec(
        name="failure",
        nodes=[
            node("source", "text_input", text="thread"),
            node("broken", "replace", find="[", replacement="", regex=True),
        ],
        edges=[edge("source", "text", "broken", "text")],
    )
    engine = GraphEngine(workspace=tmp_path)

    with pytest.raises(GraphRunFailure, match="Target node\\(s\\) not found") as missing:
        await engine.run(
            graph,
            scope=RunScope(mode="targets", target_node_ids=["absent"]),
        )
    with pytest.raises(GraphRunFailure, match="Replace failed") as failed:
        await engine.run(
            graph,
            scope=RunScope(
                mode="targets",
                target_node_ids=["broken", "broken"],
            ),
        )

    assert missing.value.results == []
    assert [result.node_id for result in failed.value.results] == ["source", "broken"]
    assert [result.status for result in failed.value.results] == ["completed", "failed"]


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
    assert response.manifest.scope.mode == "full"
    assert response.manifest.scope.target_node_ids == []
    assert response.manifest.scope.executed_node_ids == ["source", "pass"]


@pytest.mark.asyncio
async def test_loom_node_emits_selected_path_without_generating(tmp_path: Path) -> None:
    graph = GraphSpec(
        name="embedded loom",
        nodes=[
            node("endpoint", "endpoint", base_url="http://unused.test/v1"),
            node("model", "model", model_id="unused-model"),
            GraphNode(
                id="loom",
                kind="loom",
                config={"temperature": 0.8, "max_tokens": 32, "seed": 7},
                state=LoomState(
                    entries=[
                        LoomEntry(
                            id="root",
                            text="context ",
                            created_at="2026-08-03T00:00:00+00:00",
                        ),
                        LoomEntry(
                            id="candidate",
                            parent_id="root",
                            text="  selected value  ",
                            source="model",
                            created_at="2026-08-03T00:00:01+00:00",
                        ),
                    ],
                    selected_id="candidate",
                ),
            ),
        ],
        edges=[
            edge("endpoint", "endpoint", "loom", "endpoint"),
            edge("model", "model", "loom", "model"),
        ],
    )

    response = await GraphEngine(workspace=tmp_path).run(graph)

    assert response.terminal_outputs["loom"] == {"text": "context   selected value  "}
    assert [result.kind for result in response.nodes] == ["endpoint", "model", "loom"]


def test_loom_state_requires_one_connected_acyclic_tree() -> None:
    with pytest.raises(ValueError, match="missing parent"):
        LoomState(
            entries=[
                LoomEntry(
                    id="root",
                    created_at="2026-08-03T00:00:00+00:00",
                ),
                LoomEntry(
                    id="orphan",
                    parent_id="missing",
                    created_at="2026-08-03T00:00:01+00:00",
                ),
            ],
            selected_id="orphan",
        )

    with pytest.raises(ValueError, match="exactly one root"):
        LoomState(
            entries=[
                LoomEntry(
                    id="first",
                    created_at="2026-08-03T00:00:00+00:00",
                ),
                LoomEntry(
                    id="second",
                    created_at="2026-08-03T00:00:01+00:00",
                ),
            ],
            selected_id="first",
        )


@pytest.mark.asyncio
async def test_trim_removes_only_leading_and_trailing_whitespace(tmp_path: Path) -> None:
    graph = GraphSpec(
        name="trim whitespace",
        nodes=[
            node("source", "text_input", text=" \t\n  keep  internal\tspace  \r\n "),
            node("trim", "trim"),
        ],
        edges=[edge("source", "text", "trim", "text")],
    )

    response = await GraphEngine(workspace=tmp_path).run(graph)

    assert response.terminal_outputs["trim"]["text"] == "keep  internal\tspace"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("source", "start_marker", "end_marker", "expected"),
    [
        ("prefix <FILL>  Ada Lovelace  </FILL> suffix", "<FILL>", "</FILL>", "  Ada Lovelace  "),
        ("label: selected value", "label: ", "", "selected value"),
        ("selected value END trailing", "", " END", "selected value"),
    ],
)
async def test_extract_text_supports_bounded_and_one_sided_markers(
    tmp_path: Path,
    source: str,
    start_marker: str,
    end_marker: str,
    expected: str,
) -> None:
    graph = GraphSpec(
        name="extract delimited text",
        nodes=[
            node("source", "text_input", text=source),
            node(
                "extract",
                "extract_text",
                start_marker=start_marker,
                end_marker=end_marker,
                require_match=True,
            ),
        ],
        edges=[edge("source", "text", "extract", "value")],
    )

    response = await GraphEngine(workspace=tmp_path).run(graph)

    assert response.terminal_outputs["extract"] == {
        "text": expected,
        "matched": True,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("source", "expected_marker_kind"),
    [
        ("unstructured answer", "start"),
        ("<FILL>partial answer", "end"),
    ],
)
async def test_extract_text_reports_or_requires_missing_markers(
    tmp_path: Path,
    source: str,
    expected_marker_kind: str,
) -> None:
    def graph(*, require_match: bool) -> GraphSpec:
        return GraphSpec(
            nodes=[
                node("source", "text_input", text=source),
                node(
                    "extract",
                    "extract_text",
                    start_marker="<FILL>",
                    end_marker="</FILL>",
                    require_match=require_match,
                ),
            ],
            edges=[edge("source", "text", "extract", "value")],
        )

    response = await GraphEngine(workspace=tmp_path).run(graph(require_match=False))
    assert response.terminal_outputs["extract"] == {"text": "", "matched": False}

    with pytest.raises(
        GraphRunFailure,
        match=rf"could not find {expected_marker_kind} marker",
    ) as error:
        await GraphEngine(workspace=tmp_path).run(graph(require_match=True))
    assert error.value.node_id == "extract"


@pytest.mark.asyncio
async def test_extract_text_requires_at_least_one_marker(tmp_path: Path) -> None:
    graph = GraphSpec(
        nodes=[
            node("source", "text_input", text="answer"),
            node(
                "extract",
                "extract_text",
                start_marker="",
                end_marker="",
                require_match=False,
            ),
        ],
        edges=[edge("source", "text", "extract", "value")],
    )

    with pytest.raises(GraphRunFailure, match="requires at least one marker") as error:
        await GraphEngine(workspace=tmp_path).run(graph)
    assert error.value.node_id == "extract"


def test_saved_graph_pins_workflow_version_and_blocks_its_deletion(
    tmp_path: Path,
) -> None:
    workflows = WorkflowStore(tmp_path)
    first = workflows.save(
        WorkflowDraft(
            name="Pinned source",
            graph=GraphSpec(
                name="Pinned source",
                nodes=[node("text", "text_input", text="v1")],
                edges=[],
            ),
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
    graphs = GraphStore(tmp_path, workflow_store=workflows)
    consumer = graphs.create(
        GraphDocumentDraft(
            graph=GraphSpec(
                name="Pinned consumer",
                nodes=[
                    node(
                        "workflow",
                        workflow_kind(first.id, first.version),
                        workflow_digest=first.digest,
                    )
                ],
                edges=[],
            )
        )
    )
    workflows.save(
        WorkflowDraft(
            name="Pinned source renamed",
            graph=GraphSpec(
                name="Pinned source renamed",
                nodes=[node("text", "text_input", text="v2")],
                edges=[],
            ),
            outputs=[
                WorkflowOutput(
                    name="text",
                    label="Updated text",
                    type="text",
                    node_id="text",
                    node_port="text",
                )
            ],
        ),
        workflow_id=first.id,
    )

    definitions = graphs.definitions(consumer.graph)

    assert definitions[0]["workflow"]["version"] == 1
    assert definitions[0]["outputs"][0]["label"] == "Text"
    with pytest.raises(WorkflowInUseError, match="Graph Pinned consumer"):
        workflows.delete(first.id)
    graphs.delete(consumer.id)
    assert workflows.delete(first.id)["versions"] == 2


def test_concurrent_graph_updates_allow_exactly_one_revision_winner(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = GraphStore(tmp_path)
    created = store.create(
        GraphDocumentDraft(
            graph=GraphSpec(
                name="Concurrent graph",
                nodes=[node("text", "text_input", text="original")],
                edges=[],
            )
        )
    )
    original_write = GraphStore._write
    start = threading.Barrier(2)

    def slow_revision_write(self: GraphStore, record) -> None:
        if record.id == created.id and record.revision == 2:
            time.sleep(0.1)
        original_write(self, record)

    monkeypatch.setattr(GraphStore, "_write", slow_revision_write)

    def update(value: str) -> tuple[str, int]:
        start.wait(timeout=2)
        draft = GraphDocumentDraft(
            graph=GraphSpec(
                name="Concurrent graph",
                nodes=[node("text", "text_input", text=value)],
                edges=[],
            )
        )
        try:
            saved = GraphStore(tmp_path).update(
                created.id,
                draft,
                expected_revision=1,
            )
        except GraphConflictError as error:
            return ("conflict", error.current_revision or 0)
        return ("saved", saved.revision)

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(update, ["left", "right"]))

    assert sorted(outcomes) == [("conflict", 2), ("saved", 2)]
    assert GraphStore(tmp_path).get(created.id).revision == 2


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
                        "text": "<FILL>  Ada Lovelace  </FILL> trailing text",
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
                node("extract", "extract_text", start_marker="<FILL>", end_marker="</FILL>"),
                node("trim", "trim"),
                node("template", "template_input", template="?person built a machine."),
                node("fill", "fill_hole", name="person", value="unused"),
            ],
            edges=[
                edge("prompt", "text", "complete", "prompt"),
                edge("endpoint", "endpoint", "complete", "endpoint"),
                edge("model", "model", "complete", "model"),
                edge("complete", "result", "extract", "value"),
                edge("extract", "text", "trim", "text"),
                edge("template", "template", "fill", "template"),
                edge("trim", "text", "fill", "value"),
            ],
        )

        response = await GraphEngine(workspace=tmp_path, http_client=client).run(graph)

    result = next(
        node_result.outputs["result"]
        for node_result in response.nodes
        if node_result.node_id == "complete"
    )
    assert result["kind"] == "completion_result"
    assert result["text"] == "<FILL>  Ada Lovelace  </FILL> trailing text"
    assert result["request_id"] == "cmpl-test"
    assert result["model_revision"] == "b7c9768"
    assert result["parameters"]["seed"] == 23
    assert response.terminal_outputs["fill"]["text"] == "Ada Lovelace built a machine."


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
        assert request.url == "http://completion.test:8790/v1/completions"
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
                    base_url="http://completion.test:8790/v1",
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

    engine = GraphEngine(
        workspace=tmp_path,
        workflow_store=store,
    )
    response = await engine.run(graph)
    partial = await engine.run(
        graph,
        scope=RunScope(mode="targets", target_node_ids=["workflow"]),
    )

    assert response.terminal_outputs["preview"]["value"] == "Hello!"
    workflow_result = next(result for result in response.nodes if result.node_id == "workflow")
    assert workflow_result.outputs == {"text": "Hello!"}
    frozen_workflow = next(
        item for item in response.manifest.graph.nodes if item.id == "workflow"
    )
    assert frozen_workflow.config["workflow_digest"] == workflow.digest
    assert [result.node_id for result in partial.nodes] == ["source", "workflow"]
    assert partial.terminal_outputs == {"workflow": {"text": "Hello!"}}


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
