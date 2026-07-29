import type {
  CatalogResponse,
  DeleteLoomResponse,
  DeleteWorkflowResponse,
  GraphSpec,
  LoadLoomResponse,
  LoadLoomTemplateResponse,
  LoomDraft,
  LoadWorkflowResponse,
  LoomSpec,
  LoomSummary,
  LoomTemplateSummary,
  RunErrorDetail,
  RunResponse,
  RunScope,
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
  graph: GraphSpec,
  scope: RunScope,
): Promise<RunResponse> {
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph, scope }),
  });
  const payload = await response.json();
  if (!response.ok) {
    const detail = payload.detail as RunErrorDetail | undefined;
    throw new ApiError(detail ?? { message: `Run failed with ${response.status}.` });
  }
  return payload as RunResponse;
}

async function documentResponseError(
  response: Response,
  fallback: string,
): Promise<Error> {
  const payload = (await response.json().catch(() => ({}))) as {
    detail?: {
      message?: string;
      current_revision?: number;
      current_digest?: string;
    } | string;
  };
  const detail =
    typeof payload.detail === "string"
      ? payload.detail
      : payload.detail?.message;
  return new Error(detail ?? `${fallback} (${response.status}).`);
}

export async function fetchLooms(): Promise<LoomSummary[]> {
  const response = await fetch("/api/looms");
  if (!response.ok) {
    throw await documentResponseError(response, "Loom list failed");
  }
  const payload = (await response.json()) as { looms: LoomSummary[] };
  return payload.looms;
}

export async function createLoom(draft: LoomDraft): Promise<LoomSpec> {
  const response = await fetch("/api/looms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!response.ok) {
    throw await documentResponseError(response, "Loom save failed");
  }
  const payload = (await response.json()) as { loom: LoomSpec };
  return payload.loom;
}

export async function fetchLoom(loomId: string): Promise<LoadLoomResponse> {
  const response = await fetch(`/api/looms/${encodeURIComponent(loomId)}`);
  if (!response.ok) {
    throw await documentResponseError(response, "Loom load failed");
  }
  return response.json() as Promise<LoadLoomResponse>;
}

export async function updateLoom(
  loomId: string,
  expectedRevision: number,
  graph: GraphSpec,
): Promise<LoomSpec> {
  const response = await fetch(`/api/looms/${encodeURIComponent(loomId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      graph,
      expected_revision: expectedRevision,
    }),
  });
  if (!response.ok) {
    throw await documentResponseError(response, "Loom update failed");
  }
  const payload = (await response.json()) as { loom: LoomSpec };
  return payload.loom;
}

export async function deleteLoom(
  loomId: string,
): Promise<DeleteLoomResponse> {
  const response = await fetch(`/api/looms/${encodeURIComponent(loomId)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw await documentResponseError(response, "Loom delete failed");
  }
  return response.json() as Promise<DeleteLoomResponse>;
}

export async function fetchLoomTemplates(): Promise<LoomTemplateSummary[]> {
  const response = await fetch("/api/loom-templates");
  if (!response.ok) {
    throw await documentResponseError(response, "Template list failed");
  }
  const payload = (await response.json()) as {
    templates: LoomTemplateSummary[];
  };
  return payload.templates;
}

export async function fetchLoomTemplate(
  templateId: string,
): Promise<LoadLoomTemplateResponse> {
  const response = await fetch(
    `/api/loom-templates/${encodeURIComponent(templateId)}`,
  );
  if (!response.ok) {
    throw await documentResponseError(response, "Template load failed");
  }
  return response.json() as Promise<LoadLoomTemplateResponse>;
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
