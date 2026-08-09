from pathlib import Path

import httpx
import pytest

from glitchlab.engine import GraphEngine
from glitchlab.models import GraphSpec

EXAMPLES = sorted((Path(__file__).resolve().parents[1] / "examples").glob("*.json"))


@pytest.mark.parametrize("path", EXAMPLES, ids=lambda path: path.stem)
def test_checked_in_example_passes_typed_graph_preflight(path: Path, tmp_path: Path) -> None:
    graph = GraphSpec.model_validate_json(path.read_text(encoding="utf-8"))

    ordered, _incoming, _terminal = GraphEngine(workspace=tmp_path)._validate_and_order(
        graph,
        {},
    )

    assert len(ordered) == len(graph.nodes)


@pytest.mark.parametrize(
    "name",
    ["phased-math-worksheet", "prompt-corruption-ab", "two-model-synthesis"],
)
def test_new_public_starters_include_canvas_guidance(name: str) -> None:
    path = Path(__file__).resolve().parents[1] / "examples" / f"{name}.json"
    graph = GraphSpec.model_validate_json(path.read_text(encoding="utf-8"))

    assert graph.presentation.notes
    assert all(note.text.strip() for note in graph.presentation.notes)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("name", "expected_completion_calls"),
    [
        ("phased-math-worksheet", 3),
        ("prompt-corruption-ab", 2),
        ("two-model-synthesis", 3),
    ],
)
async def test_new_public_starters_run_with_plain_completion_text(
    name: str,
    expected_completion_calls: int,
    tmp_path: Path,
) -> None:
    path = Path(__file__).resolve().parents[1] / "examples" / f"{name}.json"
    graph = GraphSpec.model_validate_json(path.read_text(encoding="utf-8"))
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            200,
            json={
                "id": f"starter-{len(calls)}",
                "choices": [
                    {
                        "text": f"Plain completion {len(calls)} without special markers.",
                        "finish_reason": "stop",
                        "logprobs": None,
                    }
                ],
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        response = await GraphEngine(workspace=tmp_path, http_client=client).run(graph)

    assert len(calls) == expected_completion_calls
    assert all(node.status == "completed" for node in response.nodes)
    if name == "prompt-corruption-ab":
        assert {node.kind for node in graph.nodes} >= {"glitchling", "corrupt"}
