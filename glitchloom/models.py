"""Wire models shared by the API and graph runner."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class Position(BaseModel):
    """Canvas position retained as part of a graph snapshot."""

    x: float = 0
    y: float = 0


class GraphNode(BaseModel):
    """A configured node in a Glitchloom graph."""

    id: str
    kind: str
    title: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    control_ports: dict[str, Literal["input", "output", "passthrough"]] = Field(
        default_factory=dict
    )
    position: Position = Field(default_factory=Position)


class GraphEdge(BaseModel):
    """A typed connection between two node ports."""

    id: str
    source: str
    source_port: str
    target: str
    target_port: str


class GraphSpec(BaseModel):
    """Serializable graph submitted for execution."""

    name: str = "Untitled loom"
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class WorkflowInput(BaseModel):
    """One public workflow input bound to an internal node port."""

    name: str
    label: str
    type: str
    required: bool = True
    multiple: bool = False
    node_id: str
    node_port: str


class WorkflowOutput(BaseModel):
    """One public workflow output sourced from an internal node port."""

    name: str
    label: str
    type: str
    node_id: str
    node_port: str


class WorkflowDraft(BaseModel):
    """A named reusable graph before immutable identity and version assignment."""

    name: str
    description: str = ""
    graph: GraphSpec
    inputs: list[WorkflowInput] = Field(default_factory=list)
    outputs: list[WorkflowOutput] = Field(default_factory=list)


class WorkflowSpec(WorkflowDraft):
    """An immutable, versioned reusable workflow stored on disk."""

    id: str
    version: int
    digest: str
    created_at: str


class NodeRunResult(BaseModel):
    """One node's execution outcome."""

    node_id: str
    kind: str
    status: str
    duration_ms: float
    outputs: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None


class RunManifest(BaseModel):
    """Reproducibility metadata for a complete graph run."""

    run_id: str
    graph_name: str
    graph_digest: str
    engine_version: str
    started_at: str
    finished_at: str
    python_version: str
    workspace: str
    glitchlings_version: str | None = None
    graph: GraphSpec


class RunResponse(BaseModel):
    """Successful graph execution response."""

    status: str
    manifest: RunManifest
    nodes: list[NodeRunResult]
    terminal_outputs: dict[str, dict[str, Any]]


class GraphRunFailure(Exception):
    """Raised when graph validation or node execution fails."""

    def __init__(
        self,
        message: str,
        *,
        node_id: str | None = None,
        results: list[NodeRunResult] | None = None,
    ) -> None:
        super().__init__(message)
        self.node_id = node_id
        self.results = results or []
