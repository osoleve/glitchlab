import {
  Graph,
  layout,
  type EdgeLabel,
  type GraphLabel,
  type NodeLabel,
} from "@dagrejs/dagre";

export interface LayoutNode {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
}

export interface LayoutEdge {
  source: string;
  target: string;
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

export function tidyNodeLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: LayoutOptions = {},
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map();

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
  for (const node of [...nodes].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    graph.setNode(node.id, {
      width: Math.max(1, node.width),
      height: Math.max(1, node.height),
    });
  }

  const includedEdges = edges
    .filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
    )
    .sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.target.localeCompare(right.target),
    );
  includedEdges.forEach((edge, index) => {
    graph.setEdge(edge.source, edge.target, {}, `edge-${index}`);
  });

  layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const result = graph.node(node.id);
    positions.set(node.id, {
      x: result.x! - node.width / 2,
      y: result.y! - node.height / 2,
    });
  }

  const originalPositions = new Map(
    nodes.map((node) => [node.id, node.position]),
  );
  const originalCenter = centerOfBounds(nodes, originalPositions);
  const layoutCenter = centerOfBounds(nodes, positions);
  const offset = {
    x: originalCenter.x - layoutCenter.x,
    y: originalCenter.y - layoutCenter.y,
  };
  for (const [nodeId, position] of positions) {
    positions.set(nodeId, {
      x: position.x + offset.x,
      y: position.y + offset.y,
    });
  }

  return positions;
}
