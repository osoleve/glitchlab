"""Wire models shared by the API and graph runner."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

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


class GraphNode(BaseModel):
    """A configured node in a Glitchloom graph."""

    id: str
    kind: str
    title: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)
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

    name: str = "Untitled loom"
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class RunScope(BaseModel):
    """Requested portion of a submitted graph to execute."""

    mode: Literal["full", "targets"] = "full"
    target_node_ids: list[str] = Field(default_factory=list)


class RunRequest(BaseModel):
    """Graph execution request with an explicit scope envelope."""

    graph: GraphSpec
    scope: RunScope = Field(default_factory=RunScope)


class LoomDraft(BaseModel):
    """An editable top-level graph before document identity is assigned."""

    graph: GraphSpec


class LoomUpdate(LoomDraft):
    """A guarded update to an existing mutable loom document."""

    expected_revision: int = Field(ge=1)


class LoomSpec(LoomDraft):
    """A mutable top-level graph document stored independently of workflows."""

    id: str
    revision: int
    digest: str
    created_at: str
    updated_at: str


class LoomSummary(BaseModel):
    """Compact metadata used by the saved-loom picker."""

    id: str
    name: str
    revision: int
    digest: str
    created_at: str
    updated_at: str
    node_count: int


class LoomTemplate(BaseModel):
    """A checked-in graph example exposed as a read-only starting point."""

    id: str
    graph: GraphSpec


class LoomTemplateSummary(BaseModel):
    """Compact metadata for the template picker."""

    id: str
    name: str
    node_count: int


class LoomListResponse(BaseModel):
    """Saved mutable loom summaries."""

    looms: list[LoomSummary]


class LoomResponse(BaseModel):
    """Envelope returned after creating or updating a loom."""

    loom: LoomSpec


class LoadLoomResponse(LoomResponse):
    """A saved loom plus exact catalog definitions needed to render it."""

    definitions: list[NodeDefinition]


class LoomTemplateListResponse(BaseModel):
    """Checked-in graph template summaries."""

    templates: list[LoomTemplateSummary]


class LoadLoomTemplateResponse(BaseModel):
    """A checked-in template plus exact definitions needed to render it."""

    template: LoomTemplate
    definitions: list[NodeDefinition]


class DeletedLoom(BaseModel):
    """Recoverable deletion metadata for one mutable loom."""

    id: str
    name: str
    revision: int
    recoverable_path: str


class DeleteLoomResponse(BaseModel):
    """Envelope returned after moving a loom to recoverable trash."""

    deleted: DeletedLoom


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
