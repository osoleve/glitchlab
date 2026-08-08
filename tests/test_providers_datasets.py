from __future__ import annotations

import json
import os
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from pydantic import ValidationError

from glitchloom.catalog import definitions_by_kind
from glitchloom.engine import GraphEngine
from glitchloom.huggingface_adapter import _resolve_hub_revision, load_huggingface_dataset
from glitchloom.models import GraphEdge, GraphNode, GraphSpec


def node(node_id: str, kind: str, **config: object) -> GraphNode:
    return GraphNode(id=node_id, kind=kind, config=config)


def edge(source: str, source_port: str, target: str, target_port: str) -> GraphEdge:
    return GraphEdge(
        id=f"{source}-{target}-{target_port}",
        source=source,
        source_port=source_port,
        target=target,
        target_port=target_port,
    )


def openrouter_graph(*, cache_mode: str = "use") -> GraphSpec:
    return GraphSpec(
        name="raw OpenRouter completion",
        nodes=[
            node("prompt", "text_input", text=" \n  Keep this whitespace.  \t"),
            node(
                "endpoint",
                "openrouter_endpoint",
                api_key_env="TEST_OPENROUTER_KEY",
                site_url="https://glitchloom.test",
                app_name="Glitchloom tests",
                timeout_seconds=7,
            ),
            node("model", "model", model_id="owner/runtime-model"),
            node(
                "completion",
                "completion",
                temperature=0.25,
                top_p=0.9,
                max_tokens=4,
                seed=19,
                stop="END",
                logprobs=2,
                extra_body={"top_k": 17},
                cache_mode=cache_mode,
            ),
        ],
        edges=[
            edge("prompt", "text", "completion", "prompt"),
            edge("endpoint", "endpoint", "completion", "endpoint"),
            edge("model", "model", "completion", "model"),
        ],
    )


@pytest.mark.asyncio
async def test_openrouter_endpoint_uses_raw_completions_and_env_secret(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []
    monkeypatch.setenv("TEST_OPENROUTER_KEY", "first-secret-key")

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        calls.append({"body": body, "headers": dict(request.headers)})
        assert request.url == "https://openrouter.ai/api/v1/completions"
        assert body["prompt"] == " \n  Keep this whitespace.  \t"
        assert body["model"] == "owner/runtime-model"
        assert body["top_k"] == 17
        assert request.headers["Authorization"] == f"Bearer {os.getenv('TEST_OPENROUTER_KEY')}"
        assert request.headers["HTTP-Referer"] == "https://glitchloom.test"
        assert request.headers["X-OpenRouter-Title"] == "Glitchloom tests"
        return httpx.Response(
            200,
            json={
                "id": f"generation-{len(calls)}",
                "model": body["model"],
                "choices": [
                    {"text": " raw result", "finish_reason": "length", "logprobs": None}
                ],
                "usage": {"prompt_tokens": 5, "completion_tokens": 2},
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        engine = GraphEngine(workspace=tmp_path, http_client=client)
        first = await engine.run(openrouter_graph())
        cached = await engine.run(openrouter_graph())
        monkeypatch.setenv("TEST_OPENROUTER_KEY", "rotated-secret-key")
        rotated = await engine.run(openrouter_graph())

    assert len(calls) == 2
    first_result = first.terminal_outputs["completion"]["result"]
    assert first_result["provider"] == "openrouter"
    assert first_result["parameters"]["prompt"] == " \n  Keep this whitespace.  \t"
    assert cached.terminal_outputs["completion"]["result"]["cache"]["hit"]
    assert not rotated.terminal_outputs["completion"]["result"]["cache"]["hit"]
    persisted = json.dumps(first.model_dump(mode="json"))
    persisted += "".join(
        path.read_text(encoding="utf-8")
        for path in (tmp_path / ".glitchloom" / "cache").rglob("*.json")
    )
    assert "first-secret-key" not in persisted
    assert "rotated-secret-key" not in persisted


def test_provider_and_dataset_nodes_have_typed_catalog_contracts() -> None:
    definitions = definitions_by_kind()

    assert definitions["openrouter_endpoint"]["outputs"][0]["type"] == "endpoint"
    dataset_outputs = {
        output["name"]: output["type"]
        for output in definitions["huggingface_dataset"]["outputs"]
    }
    assert dataset_outputs == {"dataset": "dataset", "rows": "collection"}
    assert {
        "dataset_id",
        "config_name",
        "revision",
        "split",
        "offset",
        "limit",
        "token_env",
    } == {
        field["name"] for field in definitions["huggingface_dataset"]["fields"]
    }


class FakeFeatures(dict[str, str]):
    def to_dict(self) -> dict[str, str]:
        return dict(self)


def test_huggingface_revision_resolver_uses_official_hub_api(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    class FakeHfApi:
        def dataset_info(self, **kwargs: Any) -> SimpleNamespace:
            captured.update(kwargs)
            return SimpleNamespace(sha="resolved-commit-sha")

    monkeypatch.setattr(
        "glitchloom.huggingface_adapter.importlib.import_module",
        lambda name: SimpleNamespace(HfApi=FakeHfApi) if name == "huggingface_hub" else None,
    )

    assert (
        _resolve_hub_revision("owner/corpus", "release-tag", token="hf_private")
        == "resolved-commit-sha"
    )
    assert captured == {
        "repo_id": "owner/corpus",
        "revision": "release-tag",
        "token": "hf_private",
    }


class FakeArray:
    def __init__(self, values: list[Any]):
        self.values = values

    def tolist(self) -> list[Any]:
        return self.values


class FakeDataset:
    def __init__(
        self,
        rows: list[dict[str, Any]],
        *,
        offset: int = 0,
        limit: int | None = None,
        trace: dict[str, Any] | None = None,
    ):
        self._rows = rows
        self._offset = offset
        self._limit = limit
        self._trace = trace if trace is not None else {"decode": []}
        self._fingerprint = "fake-fingerprint"
        self.features = FakeFeatures({"text": "string", "payload": "binary"})
        self.info = SimpleNamespace(version="2.1.0")

    def decode(self, decode: bool) -> FakeDataset:
        self._trace["decode"].append(decode)
        return FakeDataset(
            self._rows,
            offset=self._offset,
            limit=self._limit,
            trace=self._trace,
        )

    def skip(self, offset: int) -> FakeDataset:
        return FakeDataset(
            self._rows,
            offset=self._offset + offset,
            limit=self._limit,
            trace=self._trace,
        )

    def take(self, limit: int) -> FakeDataset:
        return FakeDataset(
            self._rows,
            offset=self._offset,
            limit=limit,
            trace=self._trace,
        )

    def __iter__(self):
        stop = None if self._limit is None else self._offset + self._limit
        yield from self._rows[self._offset : stop]


def test_huggingface_dataset_records_exact_bounded_source_and_hides_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}
    trace: dict[str, Any] = {"decode": []}
    rows = [
        {"text": "zero", "payload": b"0"},
        {
            "text": "one",
            "payload": b"1",
            "values": FakeArray([1.5, float("nan"), float("inf"), float("-inf")]),
        },
        {"text": "two", "payload": b"2"},
    ]

    def load_dataset(**kwargs: Any) -> FakeDataset:
        captured.update(kwargs)
        return FakeDataset(rows, trace=trace)

    runtime = SimpleNamespace(__version__="4.8.5", load_dataset=load_dataset)
    monkeypatch.setattr(
        "glitchloom.huggingface_adapter._require_datasets_runtime",
        lambda: runtime,
    )
    monkeypatch.setattr(
        "glitchloom.huggingface_adapter._resolve_hub_revision",
        lambda dataset_id, requested_revision, *, token: (
            captured.update(
                resolved_dataset_id=dataset_id,
                requested_revision=requested_revision,
                resolver_token=token,
            )
            or "fedcba9876543210"
        ),
    )
    monkeypatch.setenv("PRIVATE_HF_TOKEN", "hf_secret_value")

    result = load_huggingface_dataset(
        {
            "dataset_id": "owner/corpus",
            "config_name": "plain",
            "revision": "0123456789abcdef",
            "split": "validation",
            "offset": 1,
            "limit": 2,
            "token_env": "PRIVATE_HF_TOKEN",
        }
    )

    assert captured == {
        "path": "owner/corpus",
        "name": "plain",
        "split": "validation",
        "revision": "fedcba9876543210",
        "streaming": True,
        "token": "hf_secret_value",
        "resolved_dataset_id": "owner/corpus",
        "requested_revision": "0123456789abcdef",
        "resolver_token": "hf_secret_value",
    }
    assert trace["decode"] == [False]
    assert result["source"] == {
        "dataset_id": "owner/corpus",
        "config_name": "plain",
        "requested_revision": "0123456789abcdef",
        "resolved_revision": "fedcba9876543210",
        "split": "validation",
        "slice": {"offset": 1, "limit": 2},
        "streaming": True,
    }
    assert [row["text"] for row in result["rows"]] == ["one", "two"]
    assert result["rows"][0]["payload"] == {"encoding": "base64", "data": "MQ=="}
    assert result["rows"][0]["values"] == [
        1.5,
        {"encoding": "nonfinite-float", "value": "nan"},
        {"encoding": "nonfinite-float", "value": "infinity"},
        {"encoding": "nonfinite-float", "value": "-infinity"},
    ]
    assert result["row_count"] == 2
    assert result["features"] == {"text": "string", "payload": "binary"}
    assert result["fingerprint"] == "fake-fingerprint"
    assert "hf_secret_value" not in json.dumps(result)
    assert "PRIVATE_HF_TOKEN" not in json.dumps(result)
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"dataset_id": "./local-script.py"}, "owner/name"),
        ({"split": "train[:10]"}, "without bracket slicing"),
        ({"offset": -1}, "offset must be zero"),
        ({"limit": 10_001}, "between 1 and 10,000"),
        ({"token_env": "hf_secret_value"}, "must name an environment variable"),
    ],
)
def test_huggingface_dataset_rejects_unsafe_or_unbounded_specs(
    override: dict[str, Any],
    message: str,
) -> None:
    config = {
        "dataset_id": "owner/corpus",
        "config_name": "",
        "revision": "main",
        "split": "train",
        "offset": 0,
        "limit": 10,
        "token_env": "",
        **override,
    }

    with pytest.raises(ValueError, match=message):
        load_huggingface_dataset(config)


@pytest.mark.asyncio
async def test_huggingface_dataset_graph_exposes_result_and_rows(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    result = {
        "kind": "dataset_result",
        "source": {
            "dataset_id": "owner/corpus",
            "config_name": None,
            "requested_revision": "commit",
            "resolved_revision": "commit",
            "split": "test",
            "slice": {"offset": 3, "limit": 1},
            "streaming": True,
        },
        "rows": [{"text": "row three"}],
        "row_count": 1,
    }
    monkeypatch.setattr(
        "glitchloom.engine.load_huggingface_dataset",
        lambda _config: result,
    )
    graph = GraphSpec(
        nodes=[
            node(
                "dataset",
                "huggingface_dataset",
                dataset_id="owner/corpus",
                config_name="",
                revision="commit",
                split="test",
                offset=3,
                limit=1,
                token_env="",
            )
        ],
        edges=[],
    )

    response = await GraphEngine(workspace=tmp_path).run(graph)

    assert response.terminal_outputs["dataset"] == {
        "dataset": result,
        "rows": [{"text": "row three"}],
    }
    assert response.manifest.graph.nodes[0].config["revision"] == "commit"


def test_graph_presentation_defaults_and_round_trips() -> None:
    empty = GraphSpec.model_validate({"name": "empty", "nodes": [], "edges": []})
    assert empty.presentation.model_dump() == {
        "edge_routing": "smoothstep",
        "frames": [],
        "wires": [],
        "wire_bundles": [],
    }

    graph = GraphSpec.model_validate(
        {
            "name": "organized",
            "nodes": [
                {"id": "source-a", "kind": "text_input"},
                {"id": "source-b", "kind": "text_input"},
            ],
            "edges": [],
            "presentation": {
                "edge_routing": "bezier",
                "frames": [
                    {
                        "id": "frame-1",
                        "title": "Inputs",
                        "color": "teal",
                        "position": {"x": 12.5, "y": 24},
                        "width": 420,
                        "height": 260,
                        "collapsed": True,
                        "node_ids": ["source-a", "source-b"],
                    }
                ],
            },
        }
    )
    dumped = graph.model_dump(mode="json")
    assert GraphSpec.model_validate(dumped).model_dump(mode="json") == dumped

    dumped["presentation"]["frames"][0]["width"] = 0
    with pytest.raises(ValidationError, match="greater than 0"):
        GraphSpec.model_validate(dumped)


@pytest.mark.parametrize(
    ("nodes", "frames", "message"),
    [
        (
            [{"id": "node-a", "kind": "text_input"}],
            [
                {
                    "id": "frame-a",
                    "title": "A",
                    "color": "slate",
                    "position": {},
                    "width": 10,
                    "height": 10,
                    "node_ids": [],
                },
                {
                    "id": "frame-a",
                    "title": "B",
                    "color": "rose",
                    "position": {},
                    "width": 10,
                    "height": 10,
                    "node_ids": [],
                },
            ],
            "Frame IDs must be unique",
        ),
        (
            [{"id": "node-a", "kind": "text_input"}],
            [
                {
                    "id": "node-a",
                    "title": "Collision",
                    "color": "amber",
                    "position": {},
                    "width": 10,
                    "height": 10,
                    "node_ids": [],
                }
            ],
            "collides with a semantic node ID",
        ),
        (
            [{"id": "node-a", "kind": "text_input"}],
            [
                {
                    "id": "frame-a",
                    "title": "Unknown",
                    "color": "violet",
                    "position": {},
                    "width": 10,
                    "height": 10,
                    "node_ids": ["missing"],
                }
            ],
            "references unknown node",
        ),
        (
            [{"id": "node-a", "kind": "text_input"}],
            [
                {
                    "id": "frame-a",
                    "title": "First",
                    "color": "teal",
                    "position": {},
                    "width": 10,
                    "height": 10,
                    "node_ids": ["node-a"],
                },
                {
                    "id": "frame-b",
                    "title": "Second",
                    "color": "slate",
                    "position": {},
                    "width": 10,
                    "height": 10,
                    "node_ids": ["node-a"],
                },
            ],
            "cannot belong to more than one frame",
        ),
    ],
)
def test_graph_presentation_rejects_ambiguous_frame_membership(
    nodes: list[dict[str, Any]],
    frames: list[dict[str, Any]],
    message: str,
) -> None:
    with pytest.raises(ValidationError, match=message):
        GraphSpec.model_validate(
            {
                "nodes": nodes,
                "edges": [],
                "presentation": {"frames": frames},
            }
        )


def test_graph_presentation_round_trips_and_validates_wires_and_bundles() -> None:
    graph = GraphSpec.model_validate(
        {
            "nodes": [
                {"id": "source-a", "kind": "text_input"},
                {"id": "source-b", "kind": "text_input"},
                {"id": "target", "kind": "gaggle"},
            ],
            "edges": [
                {
                    "id": "edge-a",
                    "source": "source-a",
                    "source_port": "text",
                    "target": "target",
                    "target_port": "items",
                },
                {
                    "id": "edge-b",
                    "source": "source-b",
                    "source_port": "text",
                    "target": "target",
                    "target_port": "items",
                },
            ],
            "presentation": {
                "wires": [{"edge_id": "edge-a", "color": "rose"}],
                "wire_bundles": [
                    {
                        "id": "bundle-a",
                        "edge_ids": ["edge-a", "edge-b"],
                        "waypoints": [
                            {"x": 120, "y": 80},
                            {"x": 280, "y": 120},
                        ],
                    }
                ]
            },
        }
    )

    assert graph.presentation.wires[0].color == "rose"
    assert graph.presentation.wire_bundles[0].edge_ids == ["edge-a", "edge-b"]
    dumped = graph.model_dump(mode="json")
    assert GraphSpec.model_validate(dumped).model_dump(mode="json") == dumped

    dumped["presentation"]["wire_bundles"][0]["edge_ids"] = ["edge-a", "missing"]
    with pytest.raises(ValidationError, match="references unknown edge"):
        GraphSpec.model_validate(dumped)
