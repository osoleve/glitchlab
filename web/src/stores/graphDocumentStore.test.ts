import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowNode } from "../types";
import { useGraphDocumentStore } from "./graphDocumentStore";

const node = (id: string, value = "before") =>
  ({
    id,
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
        fields: [
          {
            name: "value",
            label: "Value",
            type: "text",
            control: "text",
            default: "",
            help: "",
          },
        ],
      },
      config: { value },
      controlPorts: {},
      runStatus: "completed",
    },
  }) as unknown as WorkflowNode;

describe("graph document store", () => {
  beforeEach(() => {
    useGraphDocumentStore.setState({
      nodes: [node("one")],
      edges: [],
      frames: [],
      edgeRouting: "smoothstep",
      selectedId: "one",
      graphName: "Test graph",
      isDirty: false,
    });
    useGraphDocumentStore.temporal.getState().resume();
    useGraphDocumentStore.temporal.getState().clear();
  });

  it("updates node fields without mounting the app", () => {
    useGraphDocumentStore.getState().updateNodeField("one", "value", "after");

    const state = useGraphDocumentStore.getState();
    expect(state.nodes[0]?.data.config.value).toBe("after");
    expect(state.nodes[0]?.data.runStatus).toBe("idle");
    expect(state.isDirty).toBe(true);
  });

  it("keeps native React Flow selection and moves only the inspector anchor", () => {
    useGraphDocumentStore.setState({
      nodes: [
        { ...node("one"), selected: true },
        { ...node("two"), selected: false },
      ],
      selectedId: "one",
    });

    useGraphDocumentStore
      .getState()
      .applyNodeChanges([{ id: "two", type: "select", selected: true }]);

    expect(
      useGraphDocumentStore
        .getState()
        .nodes.filter((item) => item.selected)
        .map((item) => item.id),
    ).toEqual(["one", "two"]);
    expect(useGraphDocumentStore.getState().setSelectionAnchor("two")).toBe("two");
    expect(useGraphDocumentStore.getState().selectedId).toBe("two");

    useGraphDocumentStore
      .getState()
      .applyNodeChanges([{ id: "two", type: "select", selected: false }]);
    expect(useGraphDocumentStore.getState().selectedId).toBe("one");
  });

  it("groups nodes in a presentation-only parent without changing run status", () => {
    useGraphDocumentStore.setState({
      nodes: [
        { ...node("one"), position: { x: 100, y: 140 }, measured: { width: 220, height: 120 } },
        { ...node("two"), position: { x: 440, y: 260 }, measured: { width: 240, height: 150 } },
      ],
    });

    const frameId = useGraphDocumentStore.getState().groupNodes(["one", "two"], () => "fixed-id");
    const state = useGraphDocumentStore.getState();

    expect(frameId).toBe("frame-fixed-id");
    expect(state.frames).toHaveLength(1);
    expect(state.frames[0]?.position).toEqual({ x: 72, y: 78 });
    expect(state.nodes.map((item) => item.parentId)).toEqual([frameId, frameId]);
    expect(state.nodes.map((item) => item.data.runStatus)).toEqual(["completed", "completed"]);
    expect(state.isDirty).toBe(true);
  });

  it("removing a frame preserves child absolute positions", () => {
    useGraphDocumentStore.setState({
      nodes: [
        {
          ...node("one"),
          parentId: "frame-one",
          extent: "parent",
          position: { x: 32, y: 74 },
        },
      ],
      frames: [
        {
          id: "frame-one",
          type: "workflowFrame",
          position: { x: 100, y: 200 },
          width: 400,
          height: 260,
          data: { title: "Section", color: "teal", collapsed: false },
        },
      ],
    });

    useGraphDocumentStore.getState().removeFrames(["frame-one"]);

    expect(useGraphDocumentStore.getState().nodes[0]).toMatchObject({
      parentId: undefined,
      position: { x: 132, y: 274 },
    });
  });

  it("updates a field and clears all prior run statuses atomically", () => {
    useGraphDocumentStore.setState({ nodes: [node("one"), node("two")] });
    let updates = 0;
    const unsubscribe = useGraphDocumentStore.subscribe(() => {
      updates += 1;
    });

    useGraphDocumentStore.getState().updateNodeField("one", "value", "after");
    unsubscribe();

    const state = useGraphDocumentStore.getState();
    expect(updates).toBe(1);
    expect(state.nodes.map((item) => item.data.runStatus)).toEqual(["idle", "idle"]);
    expect(state.nodes[0]?.data.config.value).toBe("after");
  });

  it("removes nodes and their incident edges as one mutation", () => {
    useGraphDocumentStore.setState({
      nodes: [node("one"), node("two")],
      edges: [
        {
          id: "edge",
          source: "one",
          sourceHandle: "out",
          target: "two",
          targetHandle: "in",
        },
      ],
    });

    useGraphDocumentStore.getState().removeNodes(["one"]);

    const state = useGraphDocumentStore.getState();
    expect(state.nodes.map((item) => item.id)).toEqual(["two"]);
    expect(state.edges).toEqual([]);
    expect(state.selectedId).toBeUndefined();
  });

  it("marks semantic edits dirty and clears prior run decorations", () => {
    useGraphDocumentStore.getState().markSemanticDirty();

    const state = useGraphDocumentStore.getState();
    expect(state.isDirty).toBe(true);
    expect(state.nodes[0]?.data.runStatus).toBe("idle");
  });

  it("owns additive and exclusive selection transitions", () => {
    useGraphDocumentStore.setState({ nodes: [node("one"), node("two")] });

    useGraphDocumentStore.getState().selectNode("one");
    useGraphDocumentStore.getState().selectNode("two", true);
    expect(useGraphDocumentStore.getState().nodes.filter((item) => item.selected)).toHaveLength(2);

    useGraphDocumentStore.getState().selectNode("one", true);
    const state = useGraphDocumentStore.getState();
    expect(state.nodes.filter((item) => item.selected).map((item) => item.id)).toEqual(["two"]);
    expect(state.selectedId).toBe("two");
  });

  it("selects a related graph closure without rendering", () => {
    useGraphDocumentStore.setState({
      nodes: [node("one"), node("two"), node("three")],
      edges: [
        { id: "one-two", source: "one", target: "two" },
        { id: "two-three", source: "two", target: "three" },
      ],
    });

    useGraphDocumentStore.getState().selectRelatedNodes(["two"], "upstream");

    const state = useGraphDocumentStore.getState();
    expect(state.nodes.filter((item) => item.selected).map((item) => item.id)).toEqual([
      "one",
      "two",
    ]);
    expect(state.selectedId).toBe("two");
  });

  it("duplicates selected nodes and their internal edges atomically", () => {
    useGraphDocumentStore.setState({
      nodes: [
        { ...node("one"), selected: true },
        { ...node("two"), selected: true },
        node("three"),
      ],
      edges: [
        { id: "internal", source: "one", target: "two" },
        { id: "external", source: "two", target: "three" },
      ],
    });
    const ids = ["copy-one", "copy-two", "copy-edge"];

    const duplicatedIds = useGraphDocumentStore
      .getState()
      .duplicateNodes(undefined, () => ids.shift() ?? "unexpected");

    const state = useGraphDocumentStore.getState();
    expect(duplicatedIds).toEqual(["test-copy-o", "test-copy-t"]);
    expect(state.nodes.filter((item) => item.selected).map((item) => item.id)).toEqual(
      duplicatedIds,
    );
    expect(state.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "copy-edge",
          source: "test-copy-o",
          target: "test-copy-t",
        }),
      ]),
    );
    expect(state.edges).toHaveLength(3);
    expect(state.isDirty).toBe(true);
  });
});
