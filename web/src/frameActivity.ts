import type { LoomNode } from "./types";

export interface FrameAggregate {
  status?: "active" | "completed" | "failed" | "partial" | "target";
  completedCount: number;
  totalCount: number;
  activeChildTitle?: string;
}

export function frameAggregate(
  children: LoomNode[],
  scopedNodeIds: ReadonlySet<string>,
  targetNodeIds: ReadonlySet<string>,
  activeNodeId?: string,
): FrameAggregate {
  const activeChild = children.find((node) => node.id === activeNodeId);
  const completedCount = children.filter((node) => node.data.runStatus === "completed").length;
  const scopedCount = children.filter((node) => scopedNodeIds.has(node.id)).length;
  const failed = children.some((node) => node.data.runStatus === "failed");
  const targeted = children.some((node) => targetNodeIds.has(node.id));
  const status = activeChild
    ? ("active" as const)
    : failed
      ? ("failed" as const)
      : children.length > 0 && completedCount === children.length && scopedCount === children.length
        ? ("completed" as const)
        : completedCount > 0
          ? ("partial" as const)
          : targeted
            ? ("target" as const)
            : undefined;
  return {
    status,
    completedCount,
    totalCount: children.length,
    activeChildTitle: activeChild?.data.title,
  };
}
