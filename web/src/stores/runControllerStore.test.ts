import { beforeEach, describe, expect, it } from "vitest";
import type { RunResponse } from "../types";
import { useRunControllerStore } from "./runControllerStore";
import type { ExecutionScopeState } from "./types";

const scope: ExecutionScopeState = {
  mode: "full",
  targetNodeIds: [],
  nodeIds: ["one"],
  edgeIds: [],
  status: "running",
};

const response = {
  manifest: {
    scope: {
      mode: "full",
      target_node_ids: [],
      executed_node_ids: ["one"],
    },
  },
  nodes: [],
} as unknown as RunResponse;

describe("run controller store", () => {
  beforeEach(() => {
    useRunControllerStore.setState({
      running: false,
      run: undefined,
      runError: undefined,
      executionScope: undefined,
      runElapsed: 0,
      semanticRevision: 0,
      activeRun: undefined,
    });
  });

  it("marks an in-flight result stale after a semantic edit", () => {
    useRunControllerStore.getState().beginRun(scope, "fingerprint-a");
    useRunControllerStore.getState().markSemanticEdit();

    const stale = useRunControllerStore.getState().finishRun(response, scope, "fingerprint-a");
    const state = useRunControllerStore.getState();

    expect(stale).toBe(true);
    expect(state.running).toBe(false);
    expect(state.run?.client?.stale).toBe(true);
    expect(state.executionScope?.status).toBe("stale");
  });

  it("accepts a result when the graph revision and fingerprint are unchanged", () => {
    useRunControllerStore.getState().beginRun(scope, "fingerprint-a");

    const stale = useRunControllerStore.getState().finishRun(response, scope, "fingerprint-a");
    const state = useRunControllerStore.getState();

    expect(stale).toBe(false);
    expect(state.run?.client?.stale).toBe(false);
    expect(state.executionScope?.status).toBe("completed");
  });
});
