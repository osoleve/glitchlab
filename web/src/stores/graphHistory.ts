import { useStore } from "zustand";
import { serializeGraph } from "../graph";
import { semanticExecutionFingerprint } from "../graphTraversal";
import type { LoomNode, NodeRunStatus } from "../types";
import { type GraphHistoryState, useGraphDocumentStore } from "./graphDocumentStore";
import { useRunControllerStore } from "./runControllerStore";

type HistoryDirection = "undo" | "redo";

function executionFingerprint(state: GraphHistoryState): string {
  return semanticExecutionFingerprint(serializeGraph(state.loomName, state.nodes, state.edges));
}

function runStatuses(nodes: LoomNode[]): Map<string, NodeRunStatus> {
  return new Map(nodes.map((node) => [node.id, node.data.runStatus]));
}

function applyHistory(direction: HistoryDirection): boolean {
  const temporal = useGraphDocumentStore.temporal.getState();
  const available =
    direction === "undo" ? temporal.pastStates.length : temporal.futureStates.length;
  if (available === 0) return false;

  const before = useGraphDocumentStore.getState();
  const beforeFingerprint = executionFingerprint(before);
  const statuses = runStatuses(before.nodes);
  temporal[direction]();

  const after = useGraphDocumentStore.getState();
  const semantic = beforeFingerprint !== executionFingerprint(after);
  if (semantic) {
    useRunControllerStore.getState().markSemanticEdit();
  } else {
    after.setNodes((nodes) =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          runStatus: statuses.get(node.id) ?? "idle",
        },
      })),
    );
  }
  useGraphDocumentStore.getState().clearSelection();
  return true;
}

export function undoGraphDocument(): boolean {
  return applyHistory("undo");
}

export function redoGraphDocument(): boolean {
  return applyHistory("redo");
}

export function clearGraphHistory(): void {
  useGraphDocumentStore.temporal.getState().clear();
}

export function pauseGraphHistory(): void {
  useGraphDocumentStore.temporal.getState().pause();
}

export function resumeGraphHistory(): void {
  useGraphDocumentStore.temporal.getState().resume();
}

export function withoutGraphHistory(action: () => void): void {
  const temporal = useGraphDocumentStore.temporal.getState();
  const wasTracking = temporal.isTracking;
  if (wasTracking) temporal.pause();
  try {
    action();
  } finally {
    if (wasTracking) temporal.resume();
  }
}

export function useCanUndoGraph(): boolean {
  return useStore(useGraphDocumentStore.temporal, (state) => state.pastStates.length > 0);
}

export function useCanRedoGraph(): boolean {
  return useStore(useGraphDocumentStore.temporal, (state) => state.futureStates.length > 0);
}
