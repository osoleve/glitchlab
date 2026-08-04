import { beforeEach, describe, expect, it } from "vitest";
import type { RunResponse, WorkflowNode } from "../types";
import { useGraphDocumentStore } from "./graphDocumentStore";
import { clearGraphHistory, redoGraphDocument, undoGraphDocument } from "./graphHistory";
import { useRunControllerStore } from "./runControllerStore";
import type { ExecutionScopeState } from "./types";

const node = (value = "before", runStatus: WorkflowNode["data"]["runStatus"] = "idle") =>
  ({
    id: "one",
    type: "workflowNode",
    position: { x: 0, y: 0 },
    data: {
      kind: "test",
      title: "Test",
      definition: {
        kind: "test",
        label: "Test",
        description: "Test node",
        category: "Tests",
        inputs: [],
        outputs: [],
        fields: [],
      },
      config: { value },
      controlPorts: {},
      runStatus,
    },
  }) as unknown as WorkflowNode;

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

function acceptRun(): void {
  useRunControllerStore.getState().beginRun(scope, "run-fingerprint");
  useRunControllerStore.getState().finishRun(response, scope, "run-fingerprint");
}

describe("graph document history", () => {
  beforeEach(() => {
    useGraphDocumentStore.temporal.getState().resume();
    useGraphDocumentStore.setState({
      nodes: [node()],
      edges: [],
      selectedId: undefined,
      graphName: "History test",
      isDirty: false,
    });
    clearGraphHistory();
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

  it("excludes selection and run decorations from history", () => {
    useGraphDocumentStore.getState().selectNode("one");
    useGraphDocumentStore
      .getState()
      .setNodes((nodes) =>
        nodes.map((item) => ({ ...item, data: { ...item.data, runStatus: "completed" } })),
      );

    expect(useGraphDocumentStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("undoes and redoes a semantic edit without reviving a current run", () => {
    acceptRun();
    useGraphDocumentStore.getState().updateNodeField("one", "value", "after");

    expect(useGraphDocumentStore.temporal.getState().pastStates).toHaveLength(1);
    expect(undoGraphDocument()).toBe(true);
    expect(useGraphDocumentStore.getState().nodes[0]?.data.config.value).toBe("before");
    expect(useGraphDocumentStore.getState().nodes[0]?.data.runStatus).toBe("idle");
    expect(useRunControllerStore.getState().run?.client?.stale).toBe(true);
    expect(useRunControllerStore.getState().executionScope).toBeUndefined();

    expect(redoGraphDocument()).toBe(true);
    expect(useGraphDocumentStore.getState().nodes[0]?.data.config.value).toBe("after");
    expect(useRunControllerStore.getState().run?.client?.stale).toBe(true);
  });

  it("preserves current run state for layout-only undo", () => {
    acceptRun();
    useGraphDocumentStore.setState({ nodes: [node("before", "completed")] });
    clearGraphHistory();
    useGraphDocumentStore.getState().updateDocument(
      ({ nodes }) => ({
        nodes: nodes.map((item) => ({ ...item, position: { x: 120, y: 80 } })),
      }),
      false,
    );

    expect(undoGraphDocument()).toBe(true);
    const state = useGraphDocumentStore.getState();
    expect(state.nodes[0]?.position).toEqual({ x: 0, y: 0 });
    expect(state.nodes[0]?.data.runStatus).toBe("completed");
    expect(useRunControllerStore.getState().run?.client?.stale).toBe(false);
    expect(useRunControllerStore.getState().executionScope?.status).toBe("completed");
  });

  it("records a multi-field document mutation as one history entry", () => {
    useGraphDocumentStore.getState().updateDocument(({ nodes, edges }) => ({
      nodes: [...nodes, { ...node("second"), id: "two" }],
      edges: [...edges, { id: "edge", source: "one", target: "two" }],
    }));

    expect(useGraphDocumentStore.temporal.getState().pastStates).toHaveLength(1);
    expect(undoGraphDocument()).toBe(true);
    expect(useGraphDocumentStore.getState().nodes.map((item) => item.id)).toEqual(["one"]);
    expect(useGraphDocumentStore.getState().edges).toEqual([]);
  });
});
