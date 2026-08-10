import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";

export interface LayoutNode {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  parentId?: string;
}

export interface LayoutFrame {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  collapsed: boolean;
}

export interface LayoutEdge {
  id?: string;
  source: string;
  target: string;
}

export interface LayoutWireBundle {
  id: string;
  edgeIds: readonly string[];
  ties: readonly [{ x: number; y: number }, { x: number; y: number }];
}

export interface TidyGraphLayoutResult {
  nodePositions: Map<string, { x: number; y: number }>;
  framePositions: Map<string, { x: number; y: number }>;
  frameSizes: Map<string, { width: number; height: number }>;
}

export interface LayoutOptions {
  nodeGap?: number;
  rankGap?: number;
}

interface LayoutBox {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
}

interface IncludedEdge {
  id?: string;
  source: string;
  target: string;
}

interface ActiveWireBundle {
  id: string;
  ties: readonly [{ x: number; y: number }, { x: number; y: number }];
  startNodeId: string;
  endNodeId: string;
  parentId?: string;
}

const FRAME_PADDING = { top: 62, right: 28, bottom: 28, left: 28 };
const COLLAPSED_FRAME_HEIGHT = 46;
const WIRE_BUNDLE_TIE_SIZE = 18;

let elkConstructorPromise: Promise<typeof import("elkjs/lib/elk.bundled.js").default> | undefined;

async function runElkLayout(graph: ElkNode): Promise<ElkNode> {
  elkConstructorPromise ??= import("elkjs/lib/elk.bundled.js").then((module) => module.default);
  const Elk = await elkConstructorPromise;
  return new Elk().layout(graph);
}

function centerOfBounds(boxes: readonly LayoutBox[]): { x: number; y: number } {
  if (boxes.length === 0) return { x: 0, y: 0 };
  const left = Math.min(...boxes.map((box) => box.position.x));
  const top = Math.min(...boxes.map((box) => box.position.y));
  const right = Math.max(...boxes.map((box) => box.position.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.position.y + box.height));
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

function wireBundleNodeId(
  bundleId: string,
  end: "start" | "end",
  occupiedNodeIds: Set<string>,
): string {
  const base = `__glitchlab_wire_bundle__${bundleId}__${end}`;
  let candidate = base;
  let suffix = 1;
  while (occupiedNodeIds.has(candidate)) {
    candidate = `${base}__${suffix}`;
    suffix += 1;
  }
  occupiedNodeIds.add(candidate);
  return candidate;
}

function elkLeaf(node: LayoutNode, seedPositions: boolean): ElkNode {
  return {
    id: node.id,
    width: Math.max(1, node.width),
    height: Math.max(1, node.height),
    ...(seedPositions ? { x: node.position.x, y: node.position.y } : {}),
  };
}

function sharedTargetParentId(
  edges: readonly IncludedEdge[],
  nodesById: ReadonlyMap<string, LayoutNode>,
): string | undefined {
  const parentIds = new Set(edges.map((edge) => nodesById.get(edge.target)?.parentId));
  return parentIds.size === 1 ? [...parentIds][0] : undefined;
}

function tieMidpoint(bundle: { ties: LayoutWireBundle["ties"] }): { x: number; y: number } {
  return {
    x: (bundle.ties[0].x + bundle.ties[1].x) / 2,
    y: (bundle.ties[0].y + bundle.ties[1].y) / 2,
  };
}

export async function tidyGraphLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  wireBundles: readonly LayoutWireBundle[] = [],
  frames: readonly LayoutFrame[] = [],
  options: LayoutOptions = {},
): Promise<TidyGraphLayoutResult> {
  const emptyResult = (): TidyGraphLayoutResult => ({
    nodePositions: new Map(),
    framePositions: new Map(),
    frameSizes: new Map(),
  });
  if (nodes.length === 0 && frames.length === 0) return emptyResult();

  const frameById = new Map(frames.map((frame) => [frame.id, frame]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const collapsedFrameIds = new Set(
    frames.filter((frame) => frame.collapsed).map((frame) => frame.id),
  );
  const endpointId = (nodeId: string): string => {
    const parentId = nodeById.get(nodeId)?.parentId;
    return parentId && collapsedFrameIds.has(parentId) ? parentId : nodeId;
  };
  const visibleNodes = nodes.filter(
    (node) => !node.parentId || !collapsedFrameIds.has(node.parentId),
  );
  const visibleShapeIds = new Set([...visibleNodes.map((node) => node.id), ...frameById.keys()]);
  const includedEdges = edges
    .filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))
    .map((edge) => ({ ...edge, source: endpointId(edge.source), target: endpointId(edge.target) }))
    .filter(
      (edge) =>
        edge.source !== edge.target &&
        visibleShapeIds.has(edge.source) &&
        visibleShapeIds.has(edge.target),
    )
    .sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.target.localeCompare(right.target) ||
        (left.id ?? "").localeCompare(right.id ?? ""),
    );
  const includedEdgesById = new Map(
    includedEdges.flatMap((edge) => (edge.id ? [[edge.id, edge] as const] : [])),
  );

  const occupiedNodeIds = new Set(visibleShapeIds);
  const activeWireBundles: ActiveWireBundle[] = [];
  const activeBundlesByEdge = new Map<string, ActiveWireBundle[]>();
  const syntheticNodes: LayoutNode[] = [];
  const visibleNodesById = new Map(visibleNodes.map((node) => [node.id, node]));
  for (const frame of frames) {
    visibleNodesById.set(frame.id, {
      id: frame.id,
      position: frame.position,
      width: frame.width,
      height: frame.collapsed ? COLLAPSED_FRAME_HEIGHT : frame.height,
    });
  }
  const absoluteShapeCenter = (shapeId: string): { x: number; y: number } | undefined => {
    const shape = visibleNodesById.get(shapeId);
    if (!shape) return undefined;
    const parent = shape.parentId ? frameById.get(shape.parentId) : undefined;
    return {
      x: (parent?.position.x ?? 0) + shape.position.x + shape.width / 2,
      y: (parent?.position.y ?? 0) + shape.position.y + shape.height / 2,
    };
  };

  for (const bundle of [...wireBundles].sort((left, right) => left.id.localeCompare(right.id))) {
    const memberEdges = [...new Set(bundle.edgeIds)]
      .sort()
      .flatMap((edgeId) => {
        const edge = includedEdgesById.get(edgeId);
        return edge ? [edge] : [];
      });
    if (memberEdges.length === 0) continue;
    const candidateParentId = sharedTargetParentId(memberEdges, visibleNodesById);
    const parentId =
      candidateParentId && frameById.has(candidateParentId) ? candidateParentId : undefined;
    const parentPosition = parentId ? frameById.get(parentId)!.position : { x: 0, y: 0 };
    const startNodeId = wireBundleNodeId(bundle.id, "start", occupiedNodeIds);
    const endNodeId = wireBundleNodeId(bundle.id, "end", occupiedNodeIds);
    bundle.ties.forEach((tie, index) => {
      syntheticNodes.push({
        id: index === 0 ? startNodeId : endNodeId,
        position: {
          x: tie.x - parentPosition.x - WIRE_BUNDLE_TIE_SIZE / 2,
          y: tie.y - parentPosition.y - WIRE_BUNDLE_TIE_SIZE / 2,
        },
        width: WIRE_BUNDLE_TIE_SIZE,
        height: WIRE_BUNDLE_TIE_SIZE,
        parentId,
      });
    });
    const active: ActiveWireBundle = {
      id: bundle.id,
      ties: bundle.ties,
      startNodeId,
      endNodeId,
      parentId,
    };
    activeWireBundles.push(active);
    for (const edge of memberEdges) {
      const chain = activeBundlesByEdge.get(edge.id!) ?? [];
      chain.push(active);
      activeBundlesByEdge.set(edge.id!, chain);
    }
  }
  for (const [edgeId, chain] of activeBundlesByEdge) {
    const edge = includedEdgesById.get(edgeId)!;
    const source = absoluteShapeCenter(edge.source);
    const target = absoluteShapeCenter(edge.target);
    chain.sort((left, right) => {
      if (source && target) {
        const direction = { x: target.x - source.x, y: target.y - source.y };
        const along = (bundle: ActiveWireBundle) => {
          const mid = tieMidpoint(bundle);
          return (mid.x - source.x) * direction.x + (mid.y - source.y) * direction.y;
        };
        const difference = along(left) - along(right);
        if (difference !== 0) return difference;
      }
      return left.id.localeCompare(right.id);
    });
  }

  const seedPositions = activeWireBundles.length > 0;
  const workingNodes = [...visibleNodes, ...syntheticNodes];
  const frameChildren = new Map<string, LayoutNode[]>();
  for (const node of workingNodes) {
    if (!node.parentId || !frameById.has(node.parentId)) continue;
    const siblings = frameChildren.get(node.parentId) ?? [];
    siblings.push(node);
    frameChildren.set(node.parentId, siblings);
  }
  const rootNodes = workingNodes.filter((node) => !node.parentId || !frameById.has(node.parentId));
  const elkChildren: ElkNode[] = [
    ...rootNodes.map((node) => elkLeaf(node, seedPositions)),
    ...frames.map((frame): ElkNode => {
      const seed = seedPositions ? { x: frame.position.x, y: frame.position.y } : {};
      const children = [...(frameChildren.get(frame.id) ?? [])].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
      if (frame.collapsed || children.length === 0) {
        return {
          id: frame.id,
          width: Math.max(1, frame.width),
          height: Math.max(1, frame.collapsed ? COLLAPSED_FRAME_HEIGHT : frame.height),
          ...seed,
        };
      }
      return {
        id: frame.id,
        children: children.map((node) => elkLeaf(node, seedPositions)),
        layoutOptions: {
          "elk.padding": `[top=${FRAME_PADDING.top},left=${FRAME_PADDING.left},bottom=${FRAME_PADDING.bottom},right=${FRAME_PADDING.right}]`,
          // INCLUDE_CHILDREN requires nested compound nodes to run the same
          // crossing-minimization processor as the root.
          ...(seedPositions
            ? {
                "elk.layered.cycleBreaking.strategy": "INTERACTIVE",
                "elk.layered.layering.strategy": "INTERACTIVE",
                "elk.layered.crossingMinimization.strategy": "INTERACTIVE",
              }
            : {}),
        },
        ...seed,
      };
    }),
  ].sort((left, right) => left.id.localeCompare(right.id));

  const tiedEdgeIds = new Set(activeBundlesByEdge.keys());
  const layoutEdges: IncludedEdge[] = includedEdges
    .filter((edge) => !edge.id || !tiedEdgeIds.has(edge.id))
    .map((edge) => ({ ...edge }));
  for (const [edgeId, chain] of [...activeBundlesByEdge].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const edge = includedEdgesById.get(edgeId)!;
    layoutEdges.push({
      source: edge.source,
      target: chain[0].startNodeId,
      id: `bundle:${chain[0].id}:in:${edgeId}`,
    });
    chain.slice(1).forEach((bundle, index) => {
      layoutEdges.push({
        source: chain[index].endNodeId,
        target: bundle.startNodeId,
        id: `bundle-link:${chain[index].id}:${bundle.id}:${edgeId}`,
      });
    });
    layoutEdges.push({
      source: chain.at(-1)!.endNodeId,
      target: edge.target,
      id: `bundle:${chain.at(-1)!.id}:out:${edgeId}`,
    });
  }
  for (const bundle of activeWireBundles) {
    layoutEdges.push({
      source: bundle.startNodeId,
      target: bundle.endNodeId,
      id: `bundle:${bundle.id}:trunk`,
    });
  }
  const elkEdges: ElkExtendedEdge[] = layoutEdges
    .sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.target.localeCompare(right.target) ||
        (left.id ?? "").localeCompare(right.id ?? ""),
    )
    .map((edge, index) => ({
      id: `layout-edge-${index}`,
      sources: [edge.source],
      targets: [edge.target],
    }));

  const result = await runElkLayout({
    id: "root",
    children: elkChildren,
    edges: elkEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      // Placed cable ties act as layout constraints: seed every shape with its
      // current position and let the interactive strategies preserve the
      // arrangement the ties encode instead of relayouting from scratch.
      "elk.layered.cycleBreaking.strategy": seedPositions ? "INTERACTIVE" : "GREEDY",
      "elk.layered.layering.strategy": seedPositions ? "INTERACTIVE" : "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": seedPositions ? "INTERACTIVE" : "LAYER_SWEEP",
      "elk.spacing.nodeNode": String(options.nodeGap ?? 72),
      "elk.spacing.edgeEdge": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": String(options.rankGap ?? 112),
      "elk.padding": "[top=0,left=0,bottom=0,right=0]",
      "elk.randomSeed": "1",
    },
  });

  const resultChildren = result.children ?? [];
  const syntheticNodeIds = new Set(syntheticNodes.map((node) => node.id));
  const actualNodeIds = new Set(nodes.map((node) => node.id));

  const rawSyntheticCenters: Array<{ x: number; y: number }> = [];
  for (const child of resultChildren) {
    if (syntheticNodeIds.has(child.id)) {
      rawSyntheticCenters.push({
        x: (child.x ?? 0) + WIRE_BUNDLE_TIE_SIZE / 2,
        y: (child.y ?? 0) + WIRE_BUNDLE_TIE_SIZE / 2,
      });
    }
    for (const nested of child.children ?? []) {
      if (syntheticNodeIds.has(nested.id)) {
        rawSyntheticCenters.push({
          x: (child.x ?? 0) + (nested.x ?? 0) + WIRE_BUNDLE_TIE_SIZE / 2,
          y: (child.y ?? 0) + (nested.y ?? 0) + WIRE_BUNDLE_TIE_SIZE / 2,
        });
      }
    }
  }

  let offset: { x: number; y: number };
  if (rawSyntheticCenters.length > 0) {
    // The ties themselves do not move, so anchor the layout onto them: shift
    // the whole result so the laid-out tie stand-ins line up with the placed
    // ties on average.
    const tieCenters = activeWireBundles.flatMap((bundle) => [...bundle.ties]);
    const average = (points: ReadonlyArray<{ x: number; y: number }>) => ({
      x: points.reduce((sum, position) => sum + position.x, 0) / points.length,
      y: points.reduce((sum, position) => sum + position.y, 0) / points.length,
    });
    const actual = average(tieCenters);
    const raw = average(rawSyntheticCenters);
    offset = { x: actual.x - raw.x, y: actual.y - raw.y };
  } else {
    const originalTopLevelBoxes: LayoutBox[] = [
      ...nodes
        .filter((node) => !node.parentId || !frameById.has(node.parentId))
        .map((node) => ({ ...node })),
      ...frames.map((frame) => ({
        ...frame,
        height: frame.collapsed ? COLLAPSED_FRAME_HEIGHT : frame.height,
      })),
    ];
    const layoutTopLevelBoxes: LayoutBox[] = resultChildren.map((node) => ({
      id: node.id,
      position: { x: node.x ?? 0, y: node.y ?? 0 },
      width: node.width ?? 1,
      height: node.height ?? 1,
    }));
    const originalCenter = centerOfBounds(originalTopLevelBoxes);
    const layoutCenter = centerOfBounds(layoutTopLevelBoxes);
    offset = { x: originalCenter.x - layoutCenter.x, y: originalCenter.y - layoutCenter.y };
  }

  const nodePositions = new Map<string, { x: number; y: number }>();
  const framePositions = new Map<string, { x: number; y: number }>();
  const frameSizes = new Map<string, { width: number; height: number }>();

  for (const child of resultChildren) {
    const rootPosition = { x: (child.x ?? 0) + offset.x, y: (child.y ?? 0) + offset.y };
    const frame = frameById.get(child.id);
    if (!frame) {
      if (actualNodeIds.has(child.id)) nodePositions.set(child.id, rootPosition);
      continue;
    }
    framePositions.set(frame.id, rootPosition);
    if (!frame.collapsed && child.children && child.children.length > 0) {
      frameSizes.set(frame.id, {
        width: Math.max(280, child.width ?? frame.width),
        height: Math.max(160, child.height ?? frame.height),
      });
    }
    for (const nested of child.children ?? []) {
      if (actualNodeIds.has(nested.id)) {
        nodePositions.set(nested.id, { x: nested.x ?? 0, y: nested.y ?? 0 });
      }
    }
  }

  return { nodePositions, framePositions, frameSizes };
}

export async function tidyNodeLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: LayoutOptions = {},
): Promise<Map<string, { x: number; y: number }>> {
  return (await tidyGraphLayout(nodes, edges, [], [], options)).nodePositions;
}
