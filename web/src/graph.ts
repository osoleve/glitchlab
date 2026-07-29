import { MarkerType } from "@xyflow/react";
import { withControlPorts } from "./controlPorts";
import type {
  GraphSpec,
  LoomEdge,
  LoomNode,
  NodeDefinition,
} from "./types";

export function serializeGraph(
  name: string,
  nodes: LoomNode[],
  edges: LoomEdge[],
): GraphSpec {
  return {
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
      source_port: edge.sourceHandle!,
      target: edge.target,
      target_port: edge.targetHandle!,
    })),
  };
}

export function hydrateGraph(
  graph: GraphSpec,
  catalogDefinitions: NodeDefinition[],
  exactDefinitions: NodeDefinition[] = [],
): { nodes: LoomNode[]; edges: LoomEdge[] } {
  const definitions = new Map(
    catalogDefinitions.map((definition) => [definition.kind, definition]),
  );
  for (const definition of exactDefinitions) {
    definitions.set(definition.kind, definition);
  }
  const nodes: LoomNode[] = graph.nodes.map((node) => {
    const definition = definitions.get(node.kind);
    if (!definition) {
      throw new Error(`No definition is available for ${node.kind}.`);
    }
    const controlPorts = node.control_ports ?? {};
    return {
      id: node.id,
      type: "loomNode",
      position: node.position,
      data: {
        kind: node.kind,
        title: node.title || definition.label,
        definition: withControlPorts(definition, controlPorts),
        config: node.config,
        controlPorts,
        runStatus: "idle",
      },
    };
  });
  const edges: LoomEdge[] = graph.edges.map((edge) => ({
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
  return { nodes, edges };
}
