import type { WorkflowEdge, WorkflowNode } from "./types";

export function collapseFrameEdges(
  edges: WorkflowEdge[],
  nodes: WorkflowNode[],
  collapsedFrameIds: ReadonlySet<string>,
): WorkflowEdge[] {
  const parentIds = new Map(nodes.map((node) => [node.id, node.parentId]));
  return edges.flatMap((edge) => {
    const sourceParent = parentIds.get(edge.source);
    const targetParent = parentIds.get(edge.target);
    const sourceFrame =
      sourceParent && collapsedFrameIds.has(sourceParent) ? sourceParent : undefined;
    const targetFrame =
      targetParent && collapsedFrameIds.has(targetParent) ? targetParent : undefined;
    if (!sourceFrame && !targetFrame) return [edge];
    if (sourceFrame && sourceFrame === targetFrame) return [];
    return [
      {
        ...edge,
        id: `proxy:${edge.id}`,
        source: sourceFrame ?? edge.source,
        sourceHandle: sourceFrame ? "proxy-output" : edge.sourceHandle,
        target: targetFrame ?? edge.target,
        targetHandle: targetFrame ? "proxy-input" : edge.targetHandle,
        reconnectable: false,
        deletable: false,
        selectable: false,
        data: { ...edge.data, semanticEdgeIds: [edge.id], presentationProxy: true },
      },
    ];
  });
}
