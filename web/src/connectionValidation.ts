import type { Connection, Edge } from "@xyflow/react";
import type { WorkflowEdge, WorkflowNode } from "./types";

type CandidateConnection = Connection | Edge;

function wouldCreateCycle(
  source: string,
  target: string,
  edges: readonly WorkflowEdge[],
  ignoredEdgeId?: string,
): boolean {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.id === ignoredEdgeId) continue;
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
  }

  const pending = [target];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop() as string;
    if (nodeId === source) return true;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    pending.push(...(outgoing.get(nodeId) ?? []));
  }
  return false;
}

export function isGraphConnectionValid(
  connection: CandidateConnection,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): boolean {
  const { source, target, sourceHandle: sourcePortName, targetHandle: targetPortName } = connection;
  if (!source || !target || !sourcePortName || !targetPortName || source === target) {
    return false;
  }

  const sourceNode = nodes.find((node) => node.id === source);
  const targetNode = nodes.find((node) => node.id === target);
  const sourcePort = sourceNode?.data.definition.outputs.find(
    (port) => port.name === sourcePortName,
  );
  const targetPort = targetNode?.data.definition.inputs.find(
    (port) => port.name === targetPortName,
  );
  if (!sourcePort || !targetPort) return false;

  if (
    sourcePort.type !== "any" &&
    targetPort.type !== "any" &&
    sourcePort.type !== targetPort.type
  ) {
    return false;
  }

  const ignoredEdgeId = "id" in connection ? connection.id : undefined;
  if (
    !targetPort.multiple &&
    edges.some(
      (edge) =>
        edge.id !== ignoredEdgeId && edge.target === target && edge.targetHandle === targetPortName,
    )
  ) {
    return false;
  }

  return !wouldCreateCycle(source, target, edges, ignoredEdgeId);
}
