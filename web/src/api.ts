import type { paths } from "./generated/api";
import { parseRunEventStream, type RunStreamEvent } from "./runStream";
import type {
  CatalogResponse,
  DeleteGraphDocumentResponse,
  DeleteWorkflowResponse,
  GraphDocument,
  GraphDocumentDraft,
  GraphDocumentSummary,
  GraphSpec,
  GraphTemplateSummary,
  LoadGraphDocumentResponse,
  LoadGraphTemplateResponse,
  LoadWorkflowResponse,
  NodeRunResult,
  RunErrorDetail,
  RunResponse,
  RunScope,
  SaveWorkflowResponse,
  WorkflowDraft,
} from "./types";

type JsonContent<Response> = Response extends {
  content: { "application/json": infer Payload };
}
  ? Payload
  : never;

type SuccessPayload<Operation, Status extends number> = Operation extends {
  responses: infer Responses;
}
  ? Status extends keyof Responses
    ? JsonContent<Responses[Status]>
    : never
  : never;

type RequestPayload<Operation> = Operation extends {
  requestBody: { content: { "application/json": infer Payload } };
}
  ? Payload
  : never;

type CatalogPayload = SuccessPayload<paths["/api/catalog"]["get"], 200>;
type GraphListPayload = SuccessPayload<paths["/api/graphs"]["get"], 200>;
type CreateGraphPayload = SuccessPayload<paths["/api/graphs"]["post"], 201>;
type LoadGraphPayload = SuccessPayload<paths["/api/graphs/{graph_id}"]["get"], 200>;
type UpdateGraphPayload = SuccessPayload<paths["/api/graphs/{graph_id}"]["put"], 200>;
type DeleteGraphPayload = SuccessPayload<paths["/api/graphs/{graph_id}"]["delete"], 200>;
type GraphTemplateListPayload = SuccessPayload<paths["/api/graph-templates"]["get"], 200>;
type LoadGraphTemplatePayload = SuccessPayload<
  paths["/api/graph-templates/{template_id}"]["get"],
  200
>;
type RunPayload = SuccessPayload<paths["/api/runs"]["post"], 200>;
type SaveWorkflowPayload = SuccessPayload<paths["/api/workflows"]["post"], 201>;
type LoadWorkflowPayload = SuccessPayload<
  paths["/api/workflows/{workflow_id}/versions/{version}"]["get"],
  200
>;
type UpdateWorkflowPayload = SuccessPayload<
  paths["/api/workflows/{workflow_id}/versions"]["post"],
  201
>;
type DeleteWorkflowPayload = SuccessPayload<paths["/api/workflows/{workflow_id}"]["delete"], 200>;

type RunRequestPayload = RequestPayload<paths["/api/runs"]["post"]>;
type CreateGraphRequestPayload = RequestPayload<paths["/api/graphs"]["post"]>;
type UpdateGraphRequestPayload = RequestPayload<paths["/api/graphs/{graph_id}"]["put"]>;
type SaveWorkflowRequestPayload = RequestPayload<paths["/api/workflows"]["post"]>;
type UpdateWorkflowRequestPayload = RequestPayload<
  paths["/api/workflows/{workflow_id}/versions"]["post"]
>;

type Decoder<T> = (value: unknown) => value is T;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCatalogPayload(value: unknown): value is CatalogPayload & CatalogResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.glitchlings) &&
    isRecord(value.plugin) &&
    (value.plugin.path === undefined || typeof value.plugin.path === "string")
  );
}

function isGraphSpec(value: unknown): value is GraphSpec {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    Array.isArray(value.nodes) &&
    value.nodes.every(
      (node) =>
        isRecord(node) &&
        typeof node.id === "string" &&
        typeof node.kind === "string" &&
        isRecord(node.config) &&
        isRecord(node.control_ports) &&
        isRecord(node.position) &&
        typeof node.position.x === "number" &&
        typeof node.position.y === "number",
    ) &&
    Array.isArray(value.edges)
  );
}

function isGraphDocument(value: unknown): value is GraphDocument {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.revision === "number" &&
    typeof value.digest === "string" &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string" &&
    isGraphSpec(value.graph)
  );
}

function isGraphDocumentSummary(value: unknown): value is GraphDocumentSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.revision === "number" &&
    typeof value.node_count === "number"
  );
}

function isGraphListPayload(value: unknown): value is GraphListPayload {
  return (
    isRecord(value) && Array.isArray(value.graphs) && value.graphs.every(isGraphDocumentSummary)
  );
}

function isCreateGraphPayload(value: unknown): value is CreateGraphPayload &
  UpdateGraphPayload & {
    graph: GraphDocument;
  } {
  return isRecord(value) && isGraphDocument(value.graph);
}

function isLoadGraphPayload(value: unknown): value is LoadGraphPayload & LoadGraphDocumentResponse {
  return isRecord(value) && isGraphDocument(value.graph) && Array.isArray(value.definitions);
}

function isDeleteGraphPayload(value: unknown): value is DeleteGraphPayload {
  return (
    isRecord(value) &&
    isRecord(value.deleted) &&
    typeof value.deleted.id === "string" &&
    typeof value.deleted.name === "string" &&
    typeof value.deleted.revision === "number" &&
    typeof value.deleted.recoverable_path === "string"
  );
}

function isGraphTemplateListPayload(value: unknown): value is GraphTemplateListPayload {
  return (
    isRecord(value) &&
    Array.isArray(value.templates) &&
    value.templates.every(
      (template) =>
        isRecord(template) &&
        typeof template.id === "string" &&
        typeof template.name === "string" &&
        typeof template.node_count === "number",
    )
  );
}

function isLoadGraphTemplatePayload(
  value: unknown,
): value is LoadGraphTemplatePayload & LoadGraphTemplateResponse {
  return (
    isRecord(value) &&
    isRecord(value.template) &&
    typeof value.template.id === "string" &&
    isGraphSpec(value.template.graph) &&
    Array.isArray(value.definitions)
  );
}

function isNodeRunResult(value: unknown): value is NodeRunResult {
  return (
    isRecord(value) &&
    typeof value.node_id === "string" &&
    typeof value.kind === "string" &&
    (value.status === "completed" || value.status === "failed") &&
    typeof value.duration_ms === "number" &&
    isRecord(value.outputs)
  );
}

function isRunPayload(value: unknown): value is RunPayload & RunResponse {
  return (
    isRecord(value) &&
    value.status === "completed" &&
    isRecord(value.manifest) &&
    isRecord(value.manifest.scope) &&
    Array.isArray(value.manifest.scope.target_node_ids) &&
    Array.isArray(value.manifest.scope.executed_node_ids) &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isNodeRunResult) &&
    isRecord(value.terminal_outputs)
  );
}

function isWorkflowSpec(value: unknown): value is SaveWorkflowResponse["workflow"] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.version === "number" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.digest === "string" &&
    typeof value.created_at === "string" &&
    isGraphSpec(value.graph) &&
    Array.isArray(value.inputs) &&
    Array.isArray(value.outputs)
  );
}

function isSaveWorkflowPayload(
  value: unknown,
): value is SaveWorkflowPayload & UpdateWorkflowPayload & SaveWorkflowResponse {
  return isRecord(value) && isWorkflowSpec(value.workflow) && isRecord(value.definition);
}

function isLoadWorkflowPayload(
  value: unknown,
): value is LoadWorkflowPayload & LoadWorkflowResponse {
  return isRecord(value) && isWorkflowSpec(value.workflow) && Array.isArray(value.definitions);
}

function isDeleteWorkflowPayload(value: unknown): value is DeleteWorkflowPayload {
  return (
    isRecord(value) &&
    isRecord(value.deleted) &&
    typeof value.deleted.id === "string" &&
    typeof value.deleted.name === "string" &&
    typeof value.deleted.versions === "number" &&
    Array.isArray(value.deleted.dependents) &&
    typeof value.deleted.recoverable_path === "string"
  );
}

async function decodeJson<T>(response: Response, label: string, decoder: Decoder<T>): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
  if (!decoder(payload)) {
    throw new Error(`${label} returned an unexpected response shape.`);
  }
  return payload;
}

async function readOptionalJson(response: Response): Promise<unknown> {
  try {
    const payload: unknown = await response.json();
    return payload;
  } catch {
    return undefined;
  }
}

function detailMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  if (typeof payload.detail === "string") {
    return payload.detail;
  }
  if (isRecord(payload.detail) && typeof payload.detail.message === "string") {
    return payload.detail.message;
  }
  return undefined;
}

function runErrorDetail(payload: unknown, status: number): RunErrorDetail {
  if (
    !isRecord(payload) ||
    !isRecord(payload.detail) ||
    typeof payload.detail.message !== "string"
  ) {
    return { message: `Run failed with ${status}.` };
  }
  const nodeId = typeof payload.detail.node_id === "string" ? payload.detail.node_id : undefined;
  const nodes = Array.isArray(payload.detail.nodes)
    ? payload.detail.nodes.filter(isNodeRunResult)
    : undefined;
  return {
    message: payload.detail.message,
    ...(nodeId === undefined ? {} : { node_id: nodeId }),
    ...(nodes === undefined ? {} : { nodes }),
  };
}

export class ApiError extends Error {
  readonly detail: RunErrorDetail;

  constructor(detail: RunErrorDetail) {
    super(detail.message);
    this.detail = detail;
  }
}

export async function fetchCatalog(): Promise<CatalogResponse> {
  const response = await fetch("/api/catalog");
  if (!response.ok) {
    throw new Error(`Catalog request failed with ${response.status}.`);
  }
  return decodeJson(response, "Catalog request", isCatalogPayload);
}

export async function runGraph(graph: GraphSpec, scope: RunScope): Promise<RunResponse> {
  const body = { graph, scope } satisfies RunRequestPayload;
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new ApiError(runErrorDetail(await readOptionalJson(response), response.status));
  }
  return decodeJson(response, "Run request", isRunPayload);
}

export async function runGraphStreaming(
  graph: GraphSpec,
  scope: RunScope,
  onEvent: (event: RunStreamEvent) => void | Promise<void>,
): Promise<RunResponse> {
  if (typeof ReadableStream === "undefined" || typeof TextDecoder === "undefined") {
    return runGraph(graph, scope);
  }
  const body = { graph, scope } satisfies RunRequestPayload;
  const response = await fetch("/api/runs/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify(body),
  });
  if (response.status === 404 || response.status === 405) {
    return runGraph(graph, scope);
  }
  if (!response.ok) {
    throw new ApiError(runErrorDetail(await readOptionalJson(response), response.status));
  }
  if (!response.body) {
    throw new Error(
      "Run stream succeeded without a readable response body; the run was not replayed.",
    );
  }
  const terminal = await parseRunEventStream(response.body, onEvent);
  if (terminal.event === "run_failed") throw new ApiError(terminal.detail);
  if (!isRunPayload(terminal.response)) {
    throw new Error("Run stream returned an unexpected terminal response shape.");
  }
  return terminal.response;
}

async function documentResponseError(response: Response, fallback: string): Promise<Error> {
  const detail = detailMessage(await readOptionalJson(response));
  return new Error(detail ?? `${fallback} (${response.status}).`);
}

export async function fetchGraphs(): Promise<GraphDocumentSummary[]> {
  const response = await fetch("/api/graphs");
  if (!response.ok) {
    throw await documentResponseError(response, "Graph list failed");
  }
  const payload = await decodeJson(response, "Graph list request", isGraphListPayload);
  return payload.graphs;
}

export async function createGraph(draft: GraphDocumentDraft): Promise<GraphDocument> {
  const body = draft satisfies CreateGraphRequestPayload;
  const response = await fetch("/api/graphs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await documentResponseError(response, "Graph save failed");
  }
  const payload = await decodeJson(response, "Graph save request", isCreateGraphPayload);
  return payload.graph;
}

export async function fetchGraph(graphId: string): Promise<LoadGraphDocumentResponse> {
  const response = await fetch(`/api/graphs/${encodeURIComponent(graphId)}`);
  if (!response.ok) {
    throw await documentResponseError(response, "Graph load failed");
  }
  return decodeJson(response, "Graph load request", isLoadGraphPayload);
}

export async function updateGraph(
  graphId: string,
  expectedRevision: number,
  graph: GraphSpec,
): Promise<GraphDocument> {
  const body = {
    graph,
    expected_revision: expectedRevision,
  } satisfies UpdateGraphRequestPayload;
  const response = await fetch(`/api/graphs/${encodeURIComponent(graphId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await documentResponseError(response, "Graph update failed");
  }
  const payload = await decodeJson(response, "Graph update request", isCreateGraphPayload);
  return payload.graph;
}

export async function deleteGraph(graphId: string): Promise<DeleteGraphDocumentResponse> {
  const response = await fetch(`/api/graphs/${encodeURIComponent(graphId)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw await documentResponseError(response, "Graph delete failed");
  }
  return decodeJson(response, "Graph delete request", isDeleteGraphPayload);
}

export async function fetchGraphTemplates(): Promise<GraphTemplateSummary[]> {
  const response = await fetch("/api/graph-templates");
  if (!response.ok) {
    throw await documentResponseError(response, "Template list failed");
  }
  const payload = await decodeJson(response, "Template list request", isGraphTemplateListPayload);
  return payload.templates;
}

export async function fetchGraphTemplate(templateId: string): Promise<LoadGraphTemplateResponse> {
  const response = await fetch(`/api/graph-templates/${encodeURIComponent(templateId)}`);
  if (!response.ok) {
    throw await documentResponseError(response, "Template load failed");
  }
  return decodeJson(response, "Template load request", isLoadGraphTemplatePayload);
}

export async function saveWorkflow(draft: WorkflowDraft): Promise<SaveWorkflowResponse> {
  const body = draft satisfies SaveWorkflowRequestPayload;
  const response = await fetch("/api/workflows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await readOptionalJson(response);
    if (response.status === 404 || response.status === 405) {
      throw new Error(
        "The running Glitchlab backend does not support reusable workflows. " +
          "Restart Glitchlab, reload the page, and try again.",
      );
    }
    throw new Error(detailMessage(payload) ?? `Workflow save failed with ${response.status}.`);
  }
  return decodeJson(response, "Workflow save request", isSaveWorkflowPayload);
}

async function workflowResponseError(response: Response, fallback: string): Promise<Error> {
  const detail = detailMessage(await readOptionalJson(response));
  return new Error(detail ?? `${fallback} (${response.status}).`);
}

export async function fetchWorkflow(
  workflowId: string,
  version: number,
): Promise<LoadWorkflowResponse> {
  const response = await fetch(
    `/api/workflows/${encodeURIComponent(workflowId)}/versions/${version}`,
  );
  if (!response.ok) {
    throw await workflowResponseError(response, "Workflow load failed");
  }
  return decodeJson(response, "Workflow load request", isLoadWorkflowPayload);
}

export async function updateWorkflow(
  workflowId: string,
  draft: WorkflowDraft,
): Promise<SaveWorkflowResponse> {
  const body = draft satisfies UpdateWorkflowRequestPayload;
  const response = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}/versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await workflowResponseError(response, "Workflow update failed");
  }
  return decodeJson(response, "Workflow update request", isSaveWorkflowPayload);
}

export async function deleteWorkflow(workflowId: string): Promise<DeleteWorkflowResponse> {
  const response = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw await workflowResponseError(response, "Workflow delete failed");
  }
  return decodeJson(response, "Workflow delete request", isDeleteWorkflowPayload);
}
