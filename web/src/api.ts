import type { paths } from "./generated/api";
import type {
  CatalogResponse,
  DeleteLoomResponse,
  DeleteWorkflowResponse,
  GraphSpec,
  LoadLoomResponse,
  LoadLoomTemplateResponse,
  LoadWorkflowResponse,
  LoomDraft,
  LoomSpec,
  LoomSummary,
  LoomTemplateSummary,
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
type LoomListPayload = SuccessPayload<paths["/api/looms"]["get"], 200>;
type CreateLoomPayload = SuccessPayload<paths["/api/looms"]["post"], 201>;
type LoadLoomPayload = SuccessPayload<paths["/api/looms/{loom_id}"]["get"], 200>;
type UpdateLoomPayload = SuccessPayload<paths["/api/looms/{loom_id}"]["put"], 200>;
type DeleteLoomPayload = SuccessPayload<paths["/api/looms/{loom_id}"]["delete"], 200>;
type LoomTemplateListPayload = SuccessPayload<paths["/api/loom-templates"]["get"], 200>;
type LoadLoomTemplatePayload = SuccessPayload<
  paths["/api/loom-templates/{template_id}"]["get"],
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
type CreateLoomRequestPayload = RequestPayload<paths["/api/looms"]["post"]>;
type UpdateLoomRequestPayload = RequestPayload<paths["/api/looms/{loom_id}"]["put"]>;
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

function isLoomSpec(value: unknown): value is LoomSpec {
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

function isLoomSummary(value: unknown): value is LoomSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.revision === "number" &&
    typeof value.node_count === "number"
  );
}

function isLoomListPayload(value: unknown): value is LoomListPayload {
  return isRecord(value) && Array.isArray(value.looms) && value.looms.every(isLoomSummary);
}

function isCreateLoomPayload(value: unknown): value is CreateLoomPayload &
  UpdateLoomPayload & {
    loom: LoomSpec;
  } {
  return isRecord(value) && isLoomSpec(value.loom);
}

function isLoadLoomPayload(value: unknown): value is LoadLoomPayload & LoadLoomResponse {
  return isRecord(value) && isLoomSpec(value.loom) && Array.isArray(value.definitions);
}

function isDeleteLoomPayload(value: unknown): value is DeleteLoomPayload {
  return (
    isRecord(value) &&
    isRecord(value.deleted) &&
    typeof value.deleted.id === "string" &&
    typeof value.deleted.name === "string" &&
    typeof value.deleted.revision === "number" &&
    typeof value.deleted.recoverable_path === "string"
  );
}

function isLoomTemplateListPayload(value: unknown): value is LoomTemplateListPayload {
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

function isLoadLoomTemplatePayload(
  value: unknown,
): value is LoadLoomTemplatePayload & LoadLoomTemplateResponse {
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

async function documentResponseError(response: Response, fallback: string): Promise<Error> {
  const detail = detailMessage(await readOptionalJson(response));
  return new Error(detail ?? `${fallback} (${response.status}).`);
}

export async function fetchLooms(): Promise<LoomSummary[]> {
  const response = await fetch("/api/looms");
  if (!response.ok) {
    throw await documentResponseError(response, "Loom list failed");
  }
  const payload = await decodeJson(response, "Loom list request", isLoomListPayload);
  return payload.looms;
}

export async function createLoom(draft: LoomDraft): Promise<LoomSpec> {
  const body = draft satisfies CreateLoomRequestPayload;
  const response = await fetch("/api/looms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await documentResponseError(response, "Loom save failed");
  }
  const payload = await decodeJson(response, "Loom save request", isCreateLoomPayload);
  return payload.loom;
}

export async function fetchLoom(loomId: string): Promise<LoadLoomResponse> {
  const response = await fetch(`/api/looms/${encodeURIComponent(loomId)}`);
  if (!response.ok) {
    throw await documentResponseError(response, "Loom load failed");
  }
  return decodeJson(response, "Loom load request", isLoadLoomPayload);
}

export async function updateLoom(
  loomId: string,
  expectedRevision: number,
  graph: GraphSpec,
): Promise<LoomSpec> {
  const body = {
    graph,
    expected_revision: expectedRevision,
  } satisfies UpdateLoomRequestPayload;
  const response = await fetch(`/api/looms/${encodeURIComponent(loomId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await documentResponseError(response, "Loom update failed");
  }
  const payload = await decodeJson(response, "Loom update request", isCreateLoomPayload);
  return payload.loom;
}

export async function deleteLoom(loomId: string): Promise<DeleteLoomResponse> {
  const response = await fetch(`/api/looms/${encodeURIComponent(loomId)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw await documentResponseError(response, "Loom delete failed");
  }
  return decodeJson(response, "Loom delete request", isDeleteLoomPayload);
}

export async function fetchLoomTemplates(): Promise<LoomTemplateSummary[]> {
  const response = await fetch("/api/loom-templates");
  if (!response.ok) {
    throw await documentResponseError(response, "Template list failed");
  }
  const payload = await decodeJson(response, "Template list request", isLoomTemplateListPayload);
  return payload.templates;
}

export async function fetchLoomTemplate(templateId: string): Promise<LoadLoomTemplateResponse> {
  const response = await fetch(`/api/loom-templates/${encodeURIComponent(templateId)}`);
  if (!response.ok) {
    throw await documentResponseError(response, "Template load failed");
  }
  return decodeJson(response, "Template load request", isLoadLoomTemplatePayload);
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
        "The running Glitchloom backend does not support reusable workflows. " +
          "Restart Glitchloom, reload the page, and try again.",
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
