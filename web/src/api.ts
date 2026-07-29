import type {
  CatalogResponse,
  DeleteWorkflowResponse,
  LoadWorkflowResponse,
  LoomEdge,
  LoomNode,
  RunErrorDetail,
  RunResponse,
  SaveWorkflowResponse,
  WorkflowDraft,
} from "./types";

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
  return response.json() as Promise<CatalogResponse>;
}

export async function runGraph(
  name: string,
  nodes: LoomNode[],
  edges: LoomEdge[],
): Promise<RunResponse> {
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      nodes: nodes.map((node) => ({
        id: node.id,
        kind: node.data.kind,
        title: node.data.title,
        config: node.data.config,
        control_ports: node.data.controlPorts,
        position: node.position,
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        source_port: edge.sourceHandle,
        target: edge.target,
        target_port: edge.targetHandle,
      })),
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    const detail = payload.detail as RunErrorDetail | undefined;
    throw new ApiError(detail ?? { message: `Run failed with ${response.status}.` });
  }
  return payload as RunResponse;
}

export async function saveWorkflow(
  draft: WorkflowDraft,
): Promise<SaveWorkflowResponse> {
  const response = await fetch("/api/workflows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    detail?: { message?: string } | string;
  };
  if (!response.ok) {
    if (response.status === 404 || response.status === 405) {
      throw new Error(
        "The running Glitchloom backend does not support reusable workflows. " +
          "Restart Glitchloom, reload the page, and try again.",
      );
    }
    const detail =
      typeof payload.detail === "string"
        ? payload.detail
        : payload.detail?.message;
    throw new Error(
      detail ?? `Workflow save failed with ${response.status}.`,
    );
  }
  return payload as unknown as SaveWorkflowResponse;
}

async function workflowResponseError(
  response: Response,
  fallback: string,
): Promise<Error> {
  const payload = (await response.json().catch(() => ({}))) as {
    detail?: { message?: string; dependents?: string[] } | string;
  };
  const detail =
    typeof payload.detail === "string"
      ? payload.detail
      : payload.detail?.message;
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
  return response.json() as Promise<LoadWorkflowResponse>;
}

export async function updateWorkflow(
  workflowId: string,
  draft: WorkflowDraft,
): Promise<SaveWorkflowResponse> {
  const response = await fetch(
    `/api/workflows/${encodeURIComponent(workflowId)}/versions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    },
  );
  if (!response.ok) {
    throw await workflowResponseError(response, "Workflow update failed");
  }
  return response.json() as Promise<SaveWorkflowResponse>;
}

export async function deleteWorkflow(
  workflowId: string,
): Promise<DeleteWorkflowResponse> {
  const response = await fetch(
    `/api/workflows/${encodeURIComponent(workflowId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw await workflowResponseError(response, "Workflow delete failed");
  }
  return response.json() as Promise<DeleteWorkflowResponse>;
}
