import type { GraphSpec, LoomEdge } from "./types";

export interface GraphTraversalIndex {
  incoming: Map<string, string[]>;
  outgoing: Map<string, string[]>;
}

export function buildGraphTraversalIndex(
  nodeIds: readonly string[],
  edges: readonly Pick<LoomEdge, "source" | "target">[],
): GraphTraversalIndex {
  const incoming = new Map(nodeIds.map((nodeId) => [nodeId, [] as string[]]));
  const outgoing = new Map(nodeIds.map((nodeId) => [nodeId, [] as string[]]));
  for (const edge of edges) {
    incoming.get(edge.target)?.push(edge.source);
    outgoing.get(edge.source)?.push(edge.target);
  }
  return { incoming, outgoing };
}

function closure(
  nodeIds: readonly string[],
  startIds: readonly string[],
  adjacency: Map<string, string[]>,
): string[] {
  const known = new Set(nodeIds);
  const reachable = new Set(startIds.filter((nodeId) => known.has(nodeId)));
  const queue = [...reachable];
  for (let index = 0; index < queue.length; index += 1) {
    for (const adjacent of adjacency.get(queue[index]) ?? []) {
      if (reachable.has(adjacent) || !known.has(adjacent)) continue;
      reachable.add(adjacent);
      queue.push(adjacent);
    }
  }
  return nodeIds.filter((nodeId) => reachable.has(nodeId));
}

export function upstreamClosure(
  nodeIds: readonly string[],
  edges: readonly Pick<LoomEdge, "source" | "target">[],
  targetIds: readonly string[],
): string[] {
  const index = buildGraphTraversalIndex(nodeIds, edges);
  return closure(nodeIds, targetIds, index.incoming);
}

export function downstreamClosure(
  nodeIds: readonly string[],
  edges: readonly Pick<LoomEdge, "source" | "target">[],
  sourceIds: readonly string[],
): string[] {
  const index = buildGraphTraversalIndex(nodeIds, edges);
  return closure(nodeIds, sourceIds, index.outgoing);
}

export function inducedEdgeIds(
  edges: readonly Pick<LoomEdge, "id" | "source" | "target">[],
  nodeIds: readonly string[],
): string[] {
  const included = new Set(nodeIds);
  return edges
    .filter((edge) => included.has(edge.source) && included.has(edge.target))
    .map((edge) => edge.id);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function semanticExecutionFingerprint(graph: GraphSpec): string {
  return JSON.stringify(
    canonicalize({
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        config: node.config,
        control_ports: node.control_ports,
      })),
      edges: graph.edges.map((edge) => ({
        source: edge.source,
        source_port: edge.source_port,
        target: edge.target,
        target_port: edge.target_port,
      })),
    }),
  );
}
