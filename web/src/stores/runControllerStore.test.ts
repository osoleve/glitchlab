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
      activity: undefined,
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

  it("uses the backend plan and clears live activity after a semantic edit", () => {
    const store = useRunControllerStore.getState();
    store.beginRun(scope, "fingerprint-a");
    store.applyRunEvent({
      protocol_version: 1,
      sequence: 1,
      at: "2026-08-02T00:00:00Z",
      run_id: "run-a",
      event: "run_planned",
      plan: {
        mode: "targets",
        target_node_ids: ["two"],
        node_ids: ["one", "two"],
        edge_ids: ["edge"],
      },
    });
    store.applyRunEvent(
      {
        protocol_version: 1,
        sequence: 2,
        at: "2026-08-02T00:00:01Z",
        run_id: "run-a",
        event: "node_started",
        node_id: "one",
        kind: "test",
      },
      "First node",
    );

    expect(useRunControllerStore.getState()).toMatchObject({
      executionScope: {
        mode: "targets",
        targetNodeIds: ["two"],
        nodeIds: ["one", "two"],
        edgeIds: ["edge"],
      },
      activity: { activeNodeId: "one", activeNodeTitle: "First node" },
    });

    store.markSemanticEdit();
    store.applyRunEvent({
      protocol_version: 1,
      sequence: 3,
      at: "2026-08-02T00:00:02Z",
      run_id: "run-a",
      event: "node_completed",
      node_id: "one",
      kind: "test",
      duration_ms: 10,
    });
    expect(useRunControllerStore.getState().activity).toBeUndefined();
  });

  it("keeps rapid edge transfers visible until each pulse expires", () => {
    const store = useRunControllerStore.getState();
    store.beginRun(scope, "fingerprint-a");
    for (const [sequence, edgeId] of [
      [3, "edge-a"],
      [4, "edge-b"],
    ] as const) {
      store.applyRunEvent({
        protocol_version: 1,
        sequence,
        at: "2026-08-02T00:00:00Z",
        run_id: "run-a",
        event: "edges_transferred",
        node_id: "one",
        edge_ids: [edgeId],
      });
    }
    expect(useRunControllerStore.getState().activity?.recentEdgeIds).toEqual(["edge-a", "edge-b"]);

    store.clearEdgePulse("run-a", 3);
    expect(useRunControllerStore.getState().activity?.recentEdgeIds).toEqual(["edge-b"]);
  });
});
