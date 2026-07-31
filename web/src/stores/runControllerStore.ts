import { create } from "zustand";
import type { RunResponse } from "../types";
import type { ExecutionScopeState } from "./types";

interface ActiveRun {
  semanticRevision: number;
  fingerprint: string;
}

export interface RunControllerState {
  running: boolean;
  run?: RunResponse;
  runError?: string;
  executionScope?: ExecutionScopeState;
  runElapsed: number;
  semanticRevision: number;
  activeRun?: ActiveRun;
  setRunning: (running: boolean) => void;
  setRun: (run?: RunResponse) => void;
  setRunError: (runError?: string) => void;
  setExecutionScope: (executionScope?: ExecutionScopeState) => void;
  setRunElapsed: (runElapsed: number) => void;
  markSemanticEdit: () => void;
  beginRun: (executionScope: ExecutionScopeState, fingerprint: string) => number;
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
  setRun: (run) => set({ run }),
  setRunError: (runError) => set({ runError }),
  setExecutionScope: (executionScope) => set({ executionScope }),
  setRunElapsed: (runElapsed) => set({ runElapsed }),
  markSemanticEdit: () =>
    set((state) => ({
      semanticRevision: state.semanticRevision + 1,
      executionScope: undefined,
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
      executionScope,
      runError: undefined,
      runElapsed: 0,
      running: true,
    });
    return semanticRevision;
  },
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
    });
    return stale;
  },
}));
