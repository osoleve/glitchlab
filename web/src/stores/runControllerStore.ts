import { create } from "zustand";
import type { RunStreamEvent } from "../runStream";
import type { RunResponse } from "../types";
import type { ExecutionScopeState } from "./types";

interface ActiveRun {
  semanticRevision: number;
  fingerprint: string;
}

export interface RunActivity {
  runId: string;
  activeNodeId?: string;
  activeNodeTitle?: string;
  completedNodeIds: string[];
  failedNodeId?: string;
  recentEdgeIds: string[];
  edgePulses: Array<{ sequence: number; edgeIds: string[] }>;
}

export interface RunControllerState {
  running: boolean;
  run?: RunResponse;
  runError?: string;
  executionScope?: ExecutionScopeState;
  runElapsed: number;
  semanticRevision: number;
  activeRun?: ActiveRun;
  activity?: RunActivity;
  setRunning: (running: boolean) => void;
  setRun: (run?: RunResponse) => void;
  setRunError: (runError?: string) => void;
  setExecutionScope: (executionScope?: ExecutionScopeState) => void;
  setRunElapsed: (runElapsed: number) => void;
  markSemanticEdit: () => void;
  beginRun: (executionScope: ExecutionScopeState, fingerprint: string) => number;
  applyRunEvent: (event: RunStreamEvent, nodeTitle?: string) => void;
  clearEdgePulse: (runId: string, sequence: number) => void;
  finishRun: (
    run: RunResponse,
    executionScope: ExecutionScopeState,
    fingerprint: string,
  ) => boolean;
  failRun: (message: string, executionScope: ExecutionScopeState, fingerprint: string) => boolean;
}

export const useRunControllerStore = create<RunControllerState>((set, get) => ({
  running: false,
  runElapsed: 0,
  semanticRevision: 0,
  setRunning: (running) => set({ running }),
  setRun: (run) => set({ run, activity: undefined }),
  setRunError: (runError) => set({ runError }),
  setExecutionScope: (executionScope) => set({ executionScope }),
  setRunElapsed: (runElapsed) => set({ runElapsed }),
  markSemanticEdit: () =>
    set((state) => ({
      semanticRevision: state.semanticRevision + 1,
      executionScope: undefined,
      activity: undefined,
      run: state.run
        ? {
            ...state.run,
            client: {
              execution_fingerprint: state.run.client?.execution_fingerprint ?? "",
              stale: true,
            },
          }
        : state.run,
    })),
  beginRun: (executionScope, fingerprint) => {
    const semanticRevision = get().semanticRevision;
    set({
      activeRun: { semanticRevision, fingerprint },
      activity: undefined,
      executionScope,
      runError: undefined,
      runElapsed: 0,
      running: true,
    });
    return semanticRevision;
  },
  applyRunEvent: (event, nodeTitle) =>
    set((state) => {
      if (!state.activeRun || state.activeRun.semanticRevision !== state.semanticRevision) {
        return state;
      }
      const activity: RunActivity =
        state.activity?.runId === event.run_id
          ? state.activity
          : { runId: event.run_id, completedNodeIds: [], recentEdgeIds: [], edgePulses: [] };
      if (event.event === "run_planned") {
        return {
          activity,
          executionScope: {
            mode: event.plan.mode,
            targetNodeIds: event.plan.target_node_ids,
            nodeIds: event.plan.node_ids,
            edgeIds: event.plan.edge_ids,
            status: "running",
          },
        };
      }
      if (event.event === "node_started") {
        return {
          activity: {
            ...activity,
            activeNodeId: event.node_id,
            activeNodeTitle: nodeTitle,
            failedNodeId: undefined,
          },
        };
      }
      if (event.event === "edges_transferred") {
        const edgePulses = [
          ...activity.edgePulses,
          { sequence: event.sequence, edgeIds: event.edge_ids },
        ];
        return {
          activity: {
            ...activity,
            edgePulses,
            recentEdgeIds: [...new Set(edgePulses.flatMap((pulse) => pulse.edgeIds))],
          },
        };
      }
      if (event.event === "node_completed") {
        return {
          activity: {
            ...activity,
            activeNodeId:
              activity.activeNodeId === event.node_id ? undefined : activity.activeNodeId,
            activeNodeTitle:
              activity.activeNodeId === event.node_id ? undefined : activity.activeNodeTitle,
            completedNodeIds: [...new Set([...activity.completedNodeIds, event.node_id])],
          },
        };
      }
      if (event.event === "node_failed") {
        return {
          activity: {
            ...activity,
            activeNodeId: undefined,
            activeNodeTitle: undefined,
            failedNodeId: event.node_id,
          },
        };
      }
      if (event.event === "run_completed" || event.event === "run_failed") {
        return { activity: { ...activity, activeNodeId: undefined, activeNodeTitle: undefined } };
      }
      return { activity };
    }),
  clearEdgePulse: (runId, sequence) =>
    set((state) =>
      state.activity?.runId === runId
        ? (() => {
            const edgePulses = state.activity.edgePulses.filter(
              (pulse) => pulse.sequence !== sequence,
            );
            if (edgePulses.length === 0 && !state.running) return { activity: undefined };
            return {
              activity: {
                ...state.activity,
                edgePulses,
                recentEdgeIds: [...new Set(edgePulses.flatMap((pulse) => pulse.edgeIds))],
              },
            };
          })()
        : state,
    ),
  finishRun: (run, executionScope, fingerprint) => {
    const state = get();
    const activeRun = state.activeRun;
    const stale =
      !activeRun ||
      activeRun.semanticRevision !== state.semanticRevision ||
      activeRun.fingerprint !== fingerprint;
    set({
      run: { ...run, client: { execution_fingerprint: fingerprint, stale } },
      executionScope: { ...executionScope, status: stale ? "stale" : "completed" },
      running: false,
      activeRun: undefined,
      activity:
        state.activity && state.activity.recentEdgeIds.length > 0
          ? { ...state.activity, activeNodeId: undefined, activeNodeTitle: undefined }
          : undefined,
    });
    return stale;
  },
  failRun: (message, executionScope, fingerprint) => {
    const state = get();
    const activeRun = state.activeRun;
    const stale =
      !activeRun ||
      activeRun.semanticRevision !== state.semanticRevision ||
      activeRun.fingerprint !== fingerprint;
    set({
      runError: stale ? `Prior run stopped after the graph changed: ${message}` : message,
      executionScope: { ...executionScope, status: stale ? "stale" : "failed" },
      running: false,
      activeRun: undefined,
      activity: undefined,
    });
    return stale;
  },
}));
