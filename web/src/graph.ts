import { MarkerType } from "@xyflow/react";
import { withControlPorts } from "./controlPorts";
import type {
  EdgeRouting,
  GraphPresentation,
  GraphSpec,
  NodeDefinition,
  WorkflowEdge,
  WorkflowFrame,
  WorkflowNode,
} from "./types";

function frameSize(frame: WorkflowFrame): { width: number; height: number } {
  return {
    width: frame.measured?.width ?? frame.width ?? 420,
    height: frame.measured?.height ?? frame.height ?? 260,
  };
}

export function serializePresentation(
  nodes: WorkflowNode[],
  frames: WorkflowFrame[],
  edgeRouting: EdgeRouting,
): GraphPresentation {
  return {
    edge_routing: edgeRouting,
    frames: frames.map((frame) => ({
      id: frame.id,
      title: frame.data.title,
      color: frame.data.color,
      position: frame.position,
      ...frameSize(frame),
      collapsed: frame.data.collapsed,
      node_ids: nodes.filter((node) => node.parentId === frame.id).map((node) => node.id),
    })),
  };
}

export function serializeGraph(
  name: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  frames: WorkflowFrame[] = [],
  edgeRouting: EdgeRouting = "smoothstep",
): GraphSpec {
  const frameMap = new Map(frames.map((frame) => [frame.id, frame]));
  return {
    name,
    nodes: nodes.map((node) => ({
      id: node.id,
      kind: node.data.kind,
      title: node.data.title,
      config: node.data.config,
      control_ports: node.data.controlPorts,
      ...(node.data.state ? { state: node.data.state } : {}),
      position: node.parentId
        ? {
            x: node.position.x + (frameMap.get(node.parentId)?.position.x ?? 0),
            y: node.position.y + (frameMap.get(node.parentId)?.position.y ?? 0),
          }
        : node.position,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      source_port: edge.sourceHandle!,
      target: edge.target,
      target_port: edge.targetHandle!,
    })),
    presentation: serializePresentation(nodes, frames, edgeRouting),
  };
}

export function hydrateGraph(
  graph: GraphSpec,
  catalogDefinitions: NodeDefinition[],
  exactDefinitions: NodeDefinition[] = [],
): {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  frames: WorkflowFrame[];
  edgeRouting: EdgeRouting;
} {
  const definitions = new Map(
    catalogDefinitions.map((definition) => [definition.kind, definition]),
  );
  for (const definition of exactDefinitions) {
    definitions.set(definition.kind, definition);
  }
  const presentation = graph.presentation;
  const frames: WorkflowFrame[] = (presentation?.frames ?? []).map((frame) => ({
    id: frame.id,
    type: "workflowFrame",
    position: frame.position,
    width: frame.width,
    height: frame.height,
    data: {
      title: frame.title,
      color: frame.color,
      collapsed: frame.collapsed,
    },
  }));
  const memberships = new Map<string, WorkflowFrame>();
  for (const frame of frames) {
    const spec = presentation?.frames.find((item) => item.id === frame.id);
    for (const nodeId of spec?.node_ids ?? []) {
      if (!memberships.has(nodeId)) memberships.set(nodeId, frame);
    }
  }
  const nodes: WorkflowNode[] = graph.nodes.map((node) => {
    const definition = definitions.get(node.kind);
    if (!definition) {
      throw new Error(`No definition is available for ${node.kind}.`);
    }
    const controlPorts = node.control_ports ?? {};
    const parent = memberships.get(node.id);
    return {
      id: node.id,
      type: "workflowNode",
      position: parent
        ? { x: node.position.x - parent.position.x, y: node.position.y - parent.position.y }
        : node.position,
      parentId: parent?.id,
      extent: parent ? "parent" : undefined,
      expandParent: Boolean(parent),
      data: {
        kind: node.kind,
        title: node.title || definition.label,
        definition: withControlPorts(definition, controlPorts),
        config: node.config,
        controlPorts,
        ...(node.state ? { state: node.state } : {}),
        runStatus: "idle",
      },
    };
  });
  const edges: WorkflowEdge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.source_port,
    target: edge.target,
    targetHandle: edge.target_port,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 18,
      height: 18,
    },
  }));
  return {
    nodes,
    edges,
    frames,
    edgeRouting: presentation?.edge_routing ?? "smoothstep",
  };
}
