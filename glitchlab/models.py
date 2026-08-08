"""Wire models shared by the API and graph runner."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, RootModel, model_validator

ValueType = Literal[
    "any",
    "boolean",
    "number",
    "text",
    "template",
    "collection",
    "endpoint",
    "model",
    "completion",
    "dataset",
    "glitchling",
    "gaggle",
    "corruption",
    "file",
]
ControlPortMode = Literal["input", "output", "passthrough"]
FieldControl = Literal[
    "text",
    "textarea",
    "number",
    "number_optional",
    "checkbox",
    "select",
    "json",
]
NodeEditor = Literal["loom"]


class PortDefinition(BaseModel):
    """One typed node input or output exposed by the catalog."""

    name: str
    label: str
    type: ValueType
    required: bool
    multiple: bool
    control: str | None = Field(
        default=None,
        exclude_if=lambda value: value is None,
    )


class FieldOption(BaseModel):
    """One selectable catalog-field option."""

    label: str
    value: str


class FieldDefinition(BaseModel):
    """One catalog-driven node configuration control."""

    name: str
    label: str
    type: ValueType
    control: FieldControl
    default: Any = None
    help: str
    options: list[FieldOption]
    placeholder: str
    inline: bool


class WorkflowReference(BaseModel):
    """Immutable workflow identity embedded in a catalog definition."""

    id: str
    version: int
    digest: str


class NodeDefinition(BaseModel):
    """Catalog contract used to render and validate one node kind."""

    kind: str
    label: str
    category: str
    description: str
    inputs: list[PortDefinition]
    outputs: list[PortDefinition]
    fields: list[FieldDefinition]
    editor: NodeEditor | None = Field(
        default=None,
        exclude_if=lambda value: value is None,
    )
    workflow: WorkflowReference | None = Field(
        default=None,
        exclude_if=lambda value: value is None,
    )


class GlitchlingParameter(BaseModel):
    """Constructor metadata for one discovered Glitchling parameter."""

    name: str
    required: bool
    default: Any = None
    annotation: str | None
    choices: list[Any]


class GlitchlingDescriptor(BaseModel):
    """One Glitchling discovered from the optional public registry."""

    name: str
    label: str
    class_name: str = Field(alias="class")
    parameters: list[GlitchlingParameter]


class PluginStatus(BaseModel):
    """Availability metadata for the optional Glitchlings integration."""

    available: bool
    version: str | None
    path: str | None = Field(
        default=None,
        exclude_if=lambda value: value is None,
    )
    error: str | None = None


class HealthResponse(BaseModel):
    """Backend and optional-plugin health."""

    status: Literal["ok"]
    version: str
    workspace: str
    glitchlings: PluginStatus


class CatalogResponse(BaseModel):
    """Complete catalog and live optional-plugin metadata."""

    nodes: list[NodeDefinition]
    glitchlings: list[GlitchlingDescriptor]
    plugin: PluginStatus


class Position(BaseModel):
    """Canvas position retained as part of a graph snapshot."""

    x: float = 0
    y: float = 0


class FramePresentation(BaseModel):
    """One visual-only frame used to organize nodes on the canvas."""

    id: str
    title: str
    color: Literal["violet", "teal", "amber", "rose", "slate"]
    position: Position
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    collapsed: bool = False
    node_ids: list[str] = Field(default_factory=list)


WireColor = Literal[
    "slate",
    "amber",
    "cyan",
    "teal",
    "violet",
    "coral",
    "blue",
    "rose",
]


class WirePresentation(BaseModel):
    """Visual overrides for one semantic graph edge."""

    edge_id: str
    color: WireColor | None = None


class WireBundlePresentation(BaseModel):
    """A visual-only routed bundle of graph edges."""

    id: str
    edge_ids: list[str] = Field(min_length=2)
    waypoints: list[Position] = Field(min_length=2)
    collapsed: bool = False
    label: str | None = None


class NodePreviewPresentation(BaseModel):
    """Canvas visibility for an inspect node's presentation-only value preview."""

    node_id: str
    visible: bool = True


class GraphPresentation(BaseModel):
    """Visual graph preferences that do not change execution semantics."""

    edge_routing: Literal["smoothstep", "bezier"] = "smoothstep"
    frames: list[FramePresentation] = Field(default_factory=list)
    wires: list[WirePresentation] = Field(default_factory=list)
    wire_bundles: list[WireBundlePresentation] = Field(default_factory=list)
    node_previews: list[NodePreviewPresentation] = Field(default_factory=list)


class LoomRunReference(BaseModel):
    """Compact graph-run identity retained with one generated Loom entry."""

    run_id: str
    graph_digest: str
    finished_at: str


class LoomEntry(BaseModel):
    """One ordered text segment in an embedded branching Loom."""

    id: str
    parent_id: str | None = None
    text: str = ""
    source: Literal["human", "model", "edited"] = "human"
    created_at: str
    updated_at: str | None = None
    completion: dict[str, Any] | None = None
    run: LoomRunReference | None = None


class LoomState(BaseModel):
    """Validated tree state owned by a Loom workflow node."""

    kind: Literal["loom"] = "loom"
    version: Literal[1] = 1
    entries: list[LoomEntry]
    selected_id: str

    @model_validator(mode="after")
    def validate_tree(self) -> LoomState:
        """Require one connected, acyclic tree with a valid selected entry."""

        by_id = {entry.id: entry for entry in self.entries}
        if len(by_id) != len(self.entries):
            raise ValueError("Loom entry IDs must be unique.")
        if any(not entry_id for entry_id in by_id):
            raise ValueError("Loom entry IDs cannot be empty.")
        if self.selected_id not in by_id:
            raise ValueError("The selected Loom entry does not exist.")

        roots = [entry for entry in self.entries if entry.parent_id is None]
        if len(roots) != 1:
            raise ValueError("A Loom must contain exactly one root entry.")
        for entry in self.entries:
            if entry.parent_id is not None and entry.parent_id not in by_id:
                raise ValueError(
                    f"Loom entry {entry.id!r} references missing parent {entry.parent_id!r}."
                )
            if entry.parent_id == entry.id:
                raise ValueError(f"Loom entry {entry.id!r} cannot parent itself.")

        visited: set[str] = set()
        visiting: set[str] = set()
        children: dict[str, list[str]] = {entry_id: [] for entry_id in by_id}
        for entry in self.entries:
            if entry.parent_id is not None:
                children[entry.parent_id].append(entry.id)

        def visit(entry_id: str) -> None:
            if entry_id in visiting:
                raise ValueError("Loom entries cannot contain a cycle.")
            if entry_id in visited:
                return
            visiting.add(entry_id)
            for child_id in children[entry_id]:
                visit(child_id)
            visiting.remove(entry_id)
            visited.add(entry_id)

        visit(roots[0].id)
        if len(visited) != len(self.entries):
            raise ValueError("Every Loom entry must descend from its root.")
        return self

    def selected_entry(self) -> LoomEntry:
        """Return the currently selected text segment."""

        return next(entry for entry in self.entries if entry.id == self.selected_id)

    def selected_text(self) -> str:
        """Return the exact text along the path from the root to the selection."""

        by_id = {entry.id: entry for entry in self.entries}
        segments: list[str] = []
        current = by_id[self.selected_id]
        while True:
            segments.append(current.text)
            if current.parent_id is None:
                break
            current = by_id[current.parent_id]
        return "".join(reversed(segments))


class GraphNode(BaseModel):
    """A configured node in a Glitchlab graph."""

    id: str
    kind: str
    title: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    state: LoomState | None = Field(
        default=None,
        exclude_if=lambda value: value is None,
    )
    control_ports: dict[str, ControlPortMode] = Field(default_factory=dict)
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

    name: str = "Untitled graph"
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    presentation: GraphPresentation = Field(default_factory=GraphPresentation)

    @model_validator(mode="after")
    def validate_presentation(self) -> GraphSpec:
        """Keep visual grouping identity and membership unambiguous."""

        semantic_node_ids = {node.id for node in self.nodes}
        frame_ids: set[str] = set()
        framed_node_ids: set[str] = set()
        for frame in self.presentation.frames:
            if frame.id in frame_ids:
                raise ValueError(f"Frame IDs must be unique; duplicate {frame.id!r}.")
            frame_ids.add(frame.id)
            if frame.id in semantic_node_ids:
                raise ValueError(
                    f"Frame ID {frame.id!r} collides with a semantic node ID."
                )
            for node_id in frame.node_ids:
                if node_id not in semantic_node_ids:
                    raise ValueError(
                        f"Frame {frame.id!r} references unknown node {node_id!r}."
                    )
                if node_id in framed_node_ids:
                    raise ValueError(
                        f"Node {node_id!r} cannot belong to more than one frame."
                    )
                framed_node_ids.add(node_id)

        semantic_edge_ids = {edge.id for edge in self.edges}
        wire_edge_ids: set[str] = set()
        for wire in self.presentation.wires:
            if wire.edge_id in wire_edge_ids:
                raise ValueError(
                    f"Wire presentation edge IDs must be unique; duplicate {wire.edge_id!r}."
                )
            wire_edge_ids.add(wire.edge_id)
            if wire.edge_id not in semantic_edge_ids:
                raise ValueError(
                    f"Wire presentation references unknown edge {wire.edge_id!r}."
                )

        wire_bundle_ids: set[str] = set()
        bundled_edge_ids: set[str] = set()
        for wire_bundle in self.presentation.wire_bundles:
            if wire_bundle.id in wire_bundle_ids:
                raise ValueError(
                    f"Wire bundle IDs must be unique; duplicate {wire_bundle.id!r}."
                )
            wire_bundle_ids.add(wire_bundle.id)
            unique_edge_ids = set(wire_bundle.edge_ids)
            if len(unique_edge_ids) != len(wire_bundle.edge_ids):
                raise ValueError(
                    f"Wire bundle {wire_bundle.id!r} cannot repeat an edge."
                )
            unknown_edge_ids = unique_edge_ids - semantic_edge_ids
            if unknown_edge_ids:
                unknown = sorted(unknown_edge_ids)[0]
                raise ValueError(
                    f"Wire bundle {wire_bundle.id!r} references unknown edge {unknown!r}."
                )
            reused_edge_ids = unique_edge_ids & bundled_edge_ids
            if reused_edge_ids:
                reused = sorted(reused_edge_ids)[0]
                raise ValueError(
                    f"Edge {reused!r} cannot belong to more than one wire bundle."
                )
            bundled_edge_ids.update(unique_edge_ids)

        preview_node_ids: set[str] = set()
        node_kinds = {node.id: node.kind for node in self.nodes}
        for node_preview in self.presentation.node_previews:
            if node_preview.node_id in preview_node_ids:
                raise ValueError(
                    f"Node preview IDs must be unique; duplicate {node_preview.node_id!r}."
                )
            preview_node_ids.add(node_preview.node_id)
            if node_preview.node_id not in semantic_node_ids:
                raise ValueError(
                    f"Node preview references unknown node {node_preview.node_id!r}."
                )
            if node_kinds[node_preview.node_id] not in {"preview", "compare_preview"}:
                raise ValueError(
                    f"Node preview {node_preview.node_id!r} must reference an inspect node."
                )
        return self


class RunScope(BaseModel):
    """Requested portion of a submitted graph to execute."""

    mode: Literal["full", "targets"] = "full"
    target_node_ids: list[str] = Field(default_factory=list)


class RunRequest(BaseModel):
    """Graph execution request with an explicit scope envelope."""

    graph: GraphSpec
    scope: RunScope = Field(default_factory=RunScope)


class GraphDocumentDraft(BaseModel):
    """An editable top-level graph before document identity is assigned."""

    graph: GraphSpec


class GraphDocumentUpdate(GraphDocumentDraft):
    """A guarded update to an existing mutable graph document."""

    expected_revision: int = Field(ge=1)


class GraphDocument(GraphDocumentDraft):
    """A mutable top-level graph document stored independently of workflows."""

    id: str
    revision: int
    digest: str
    created_at: str
    updated_at: str


class GraphDocumentSummary(BaseModel):
    """Compact metadata used by the saved-graph picker."""

    id: str
    name: str
    revision: int
    digest: str
    created_at: str
    updated_at: str
    node_count: int


class GraphTemplate(BaseModel):
    """A checked-in graph example exposed as a read-only starting point."""

    id: str
    graph: GraphSpec


class GraphTemplateSummary(BaseModel):
    """Compact metadata for the template picker."""

    id: str
    name: str
    node_count: int


class GraphDocumentListResponse(BaseModel):
    """Saved mutable graph summaries."""

    graphs: list[GraphDocumentSummary]


class GraphDocumentResponse(BaseModel):
    """Envelope returned after creating or updating a graph."""

    graph: GraphDocument


class LoadGraphDocumentResponse(GraphDocumentResponse):
    """A saved graph plus exact catalog definitions needed to render it."""

    definitions: list[NodeDefinition]


class GraphTemplateListResponse(BaseModel):
    """Checked-in graph template summaries."""

    templates: list[GraphTemplateSummary]


class LoadGraphTemplateResponse(BaseModel):
    """A checked-in template plus exact definitions needed to render it."""

    template: GraphTemplate
    definitions: list[NodeDefinition]


class DeletedGraphDocument(BaseModel):
    """Recoverable deletion metadata for one mutable graph."""

    id: str
    name: str
    revision: int
    recoverable_path: str


class DeleteGraphDocumentResponse(BaseModel):
    """Envelope returned after moving a graph to recoverable trash."""

    deleted: DeletedGraphDocument


class WorkflowInput(BaseModel):
    """One public workflow input bound to an internal node port."""

    name: str
    label: str
    type: ValueType
    required: bool = True
    multiple: bool = False
    node_id: str
    node_port: str


class WorkflowOutput(BaseModel):
    """One public workflow output sourced from an internal node port."""

    name: str
    label: str
    type: ValueType
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


class WorkflowListResponse(BaseModel):
    """Latest immutable version of every saved workflow."""

    workflows: list[WorkflowSpec]


class SaveWorkflowResponse(BaseModel):
    """A saved workflow and its catalog node definition."""

    workflow: WorkflowSpec
    definition: NodeDefinition


class LoadWorkflowResponse(BaseModel):
    """An exact workflow version plus definitions for its graph."""

    workflow: WorkflowSpec
    definitions: list[NodeDefinition]


class DeletedWorkflow(BaseModel):
    """Recoverable deletion metadata for one workflow family."""

    id: str
    name: str
    versions: int
    dependents: list[str]
    recoverable_path: str


class DeleteWorkflowResponse(BaseModel):
    """Envelope returned after moving workflow versions to recoverable trash."""

    deleted: DeletedWorkflow


class NodeRunResult(BaseModel):
    """One node's execution outcome."""

    node_id: str
    kind: str
    status: Literal["completed", "failed"]
    duration_ms: float
    outputs: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None


class RunManifestScope(BaseModel):
    """Normalized effective scope recorded for a graph run."""

    mode: Literal["full", "targets"]
    target_node_ids: list[str] = Field(default_factory=list)
    executed_node_ids: list[str] = Field(default_factory=list)


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
    scope: RunManifestScope
    graph: GraphSpec


class RunResponse(BaseModel):
    """Successful graph execution response."""

    status: Literal["completed"]
    manifest: RunManifest
    nodes: list[NodeRunResult]
    terminal_outputs: dict[str, dict[str, Any]]


class RunErrorDetail(BaseModel):
    """Structured graph validation or node-execution failure."""

    message: str
    node_id: str | None = None
    nodes: list[NodeRunResult] = Field(default_factory=list)


class RunPlan(BaseModel):
    """Backend-authoritative graph slice and order for one run."""

    mode: Literal["full", "targets"]
    target_node_ids: list[str] = Field(default_factory=list)
    node_ids: list[str] = Field(default_factory=list)
    edge_ids: list[str] = Field(default_factory=list)


class RunEventBase(BaseModel):
    """Common identity and ordering metadata for protocol-v1 run events."""

    protocol_version: Literal[1]
    sequence: int = Field(ge=1)
    at: str
    run_id: str


class RunStartedEvent(RunEventBase):
    """A run request has been accepted but has not necessarily passed preflight."""

    event: Literal["run_started"]
    requested_scope: RunScope


class RunPlannedEvent(RunEventBase):
    """Preflight succeeded and the effective execution slice is frozen."""

    event: Literal["run_planned"]
    plan: RunPlan


class NodeStartedEvent(RunEventBase):
    """A node has begun gathering its inputs and executing."""

    event: Literal["node_started"]
    node_id: str
    kind: str


class EdgesTransferredEvent(RunEventBase):
    """Named graph edges supplied values to one node without exposing the values."""

    event: Literal["edges_transferred"]
    node_id: str
    edge_ids: list[str]


class NodeCompletedEvent(RunEventBase):
    """A node completed successfully."""

    event: Literal["node_completed"]
    node_id: str
    kind: str
    duration_ms: float


class NodeFailedEvent(RunEventBase):
    """A node stopped the run with an error."""

    event: Literal["node_failed"]
    node_id: str
    kind: str
    duration_ms: float
    error: str


class RunCompletedEvent(RunEventBase):
    """Terminal successful event containing the ordinary run response."""

    event: Literal["run_completed"]
    response: RunResponse


class RunFailedEvent(RunEventBase):
    """Terminal failed event containing the ordinary structured error detail."""

    event: Literal["run_failed"]
    detail: RunErrorDetail


type RunEvent = Annotated[
    RunStartedEvent
    | RunPlannedEvent
    | NodeStartedEvent
    | EdgesTransferredEvent
    | NodeCompletedEvent
    | NodeFailedEvent
    | RunCompletedEvent
    | RunFailedEvent,
    Field(discriminator="event"),
]


class RunStreamEvent(RootModel[RunEvent]):
    """Discriminated protocol-v1 event union used by the NDJSON stream."""


class ValidationIssue(BaseModel):
    """One request-validation issue emitted by FastAPI."""

    loc: list[str | int]
    msg: str
    type: str
    input: Any = None
    ctx: dict[str, Any] | None = None


class RunErrorResponse(BaseModel):
    """Graph failure or request-validation detail returned with HTTP 422."""

    detail: RunErrorDetail | list[ValidationIssue]


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
