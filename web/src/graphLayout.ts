import { type EdgeLabel, Graph, type GraphLabel, layout, type NodeLabel } from "@dagrejs/dagre";

export interface LayoutNode {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
}

export interface LayoutEdge {
  id?: string;
  source: string;
  target: string;
}

export interface LayoutWireBundle {
  id: string;
  edgeIds: readonly string[];
}

export interface TidyGraphLayoutResult {
  nodePositions: Map<string, { x: number; y: number }>;
  wireBundleWaypoints: Map<string, [{ x: number; y: number }, { x: number; y: number }]>;
}

export interface LayoutOptions {
  nodeGap?: number;
  rankGap?: number;
}

function centerOfBounds(
  nodes: readonly LayoutNode[],
  positions: ReadonlyMap<string, { x: number; y: number }>,
): { x: number; y: number } {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const position = positions.get(node.id) ?? node.position;
    left = Math.min(left, position.x);
    top = Math.min(top, position.y);
    right = Math.max(right, position.x + node.width);
    bottom = Math.max(bottom, position.y + node.height);
  }

  return {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
  };
}

interface ActiveWireBundle {
  id: string;
  edgeIds: string[];
  startNodeId: string;
  endNodeId: string;
}

const WIRE_BUNDLE_WAYPOINT_SIZE = 18;

function wireBundleNodeId(
  bundleId: string,
  end: "start" | "end",
  occupiedNodeIds: Set<string>,
): string {
  const base = `__glitchloom_wire_bundle__${bundleId}__${end}`;
  let candidate = base;
  let suffix = 1;
  while (occupiedNodeIds.has(candidate)) {
    candidate = `${base}__${suffix}`;
    suffix += 1;
  }
  occupiedNodeIds.add(candidate);
  return candidate;
}

export function tidyGraphLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  wireBundles: readonly LayoutWireBundle[] = [],
  options: LayoutOptions = {},
): TidyGraphLayoutResult {
  if (nodes.length === 0) {
    return { nodePositions: new Map(), wireBundleWaypoints: new Map() };
  }

  const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>({
    multigraph: true,
  });
  graph.setGraph({
    rankdir: "LR",
    ranker: "network-simplex",
    acyclicer: "greedy",
    rankalign: "center",
    nodesep: options.nodeGap ?? 72,
    edgesep: 28,
    ranksep: options.rankGap ?? 112,
    marginx: 0,
    marginy: 0,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const nodeIds = new Set(nodes.map((node) => node.id));
  const occupiedNodeIds = new Set(nodeIds);
  for (const node of [...nodes].sort((left, right) => left.id.localeCompare(right.id))) {
    graph.setNode(node.id, {
      width: Math.max(1, node.width),
      height: Math.max(1, node.height),
    });
  }

  const includedEdges = edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.target.localeCompare(right.target) ||
        (left.id ?? "").localeCompare(right.id ?? ""),
    );
  const includedEdgesById = new Map(
    includedEdges.flatMap((edge) => (edge.id ? [[edge.id, edge] as const] : [])),
  );
  const claimedEdgeIds = new Set<string>();
  const activeWireBundles: ActiveWireBundle[] = [];

  for (const bundle of [...wireBundles].sort((left, right) => left.id.localeCompare(right.id))) {
    const edgeIds = [...new Set(bundle.edgeIds)].sort();
    if (
      edgeIds.length < 2 ||
      edgeIds.some((edgeId) => !includedEdgesById.has(edgeId) || claimedEdgeIds.has(edgeId))
    ) {
      continue;
    }
    const startNodeId = wireBundleNodeId(bundle.id, "start", occupiedNodeIds);
    const endNodeId = wireBundleNodeId(bundle.id, "end", occupiedNodeIds);
    graph.setNode(startNodeId, {
      width: WIRE_BUNDLE_WAYPOINT_SIZE,
      height: WIRE_BUNDLE_WAYPOINT_SIZE,
    });
    graph.setNode(endNodeId, {
      width: WIRE_BUNDLE_WAYPOINT_SIZE,
      height: WIRE_BUNDLE_WAYPOINT_SIZE,
    });
    activeWireBundles.push({ id: bundle.id, edgeIds, startNodeId, endNodeId });
    edgeIds.forEach((edgeId) => {
      claimedEdgeIds.add(edgeId);
    });
  }

  const layoutEdges: { source: string; target: string; id: string }[] = [];
  for (const edge of includedEdges) {
    if (!edge.id || !claimedEdgeIds.has(edge.id)) {
      layoutEdges.push({ source: edge.source, target: edge.target, id: `edge:${edge.id ?? ""}` });
    }
  }
  for (const bundle of activeWireBundles) {
    for (const edgeId of bundle.edgeIds) {
      const edge = includedEdgesById.get(edgeId)!;
      layoutEdges.push({
        source: edge.source,
        target: bundle.startNodeId,
        id: `bundle:${bundle.id}:in:${edgeId}`,
      });
      layoutEdges.push({
        source: bundle.endNodeId,
        target: edge.target,
        id: `bundle:${bundle.id}:out:${edgeId}`,
      });
    }
    layoutEdges.push({
      source: bundle.startNodeId,
      target: bundle.endNodeId,
      id: `bundle:${bundle.id}:trunk`,
    });
  }
  layoutEdges
    .sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.target.localeCompare(right.target) ||
        left.id.localeCompare(right.id),
    )
    .forEach((edge, index) => {
      graph.setEdge(edge.source, edge.target, {}, `edge-${index}`);
    });

  layout(graph);

  const nodePositions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const result = graph.node(node.id);
    nodePositions.set(node.id, {
      x: result.x! - node.width / 2,
      y: result.y! - node.height / 2,
    });
  }

  const originalPositions = new Map(nodes.map((node) => [node.id, node.position]));
  const originalCenter = centerOfBounds(nodes, originalPositions);
  const layoutCenter = centerOfBounds(nodes, nodePositions);
  const offset = {
    x: originalCenter.x - layoutCenter.x,
    y: originalCenter.y - layoutCenter.y,
  };
  for (const [nodeId, position] of nodePositions) {
    nodePositions.set(nodeId, {
      x: position.x + offset.x,
      y: position.y + offset.y,
    });
  }

  const wireBundleWaypoints = new Map<
    string,
    [{ x: number; y: number }, { x: number; y: number }]
  >();
  for (const bundle of activeWireBundles) {
    const start = graph.node(bundle.startNodeId);
    const end = graph.node(bundle.endNodeId);
    wireBundleWaypoints.set(bundle.id, [
      { x: start.x! + offset.x, y: start.y! + offset.y },
      { x: end.x! + offset.x, y: end.y! + offset.y },
    ]);
  }

  return { nodePositions, wireBundleWaypoints };
}

export function tidyNodeLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: LayoutOptions = {},
): Map<string, { x: number; y: number }> {
  return tidyGraphLayout(nodes, edges, [], options).nodePositions;
}
