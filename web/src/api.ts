import type {
  CatalogResponse,
  LoomEdge,
  LoomNode,
  RunErrorDetail,
  RunResponse,
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
        config: node.data.config,
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
