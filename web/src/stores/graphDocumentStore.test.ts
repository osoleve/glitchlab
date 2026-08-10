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
      notes: [],
      edgeRouting: "smoothstep",
      wires: [],
      wireBundles: [],
      selectionKind: "node",
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

  it("normalizes external node-selection changes and moves the inspector anchor", () => {
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

  it("adds, edits, resizes, duplicates, and removes notes without invalidating runs", () => {
    const noteId = useGraphDocumentStore.getState().addNote({ x: 80, y: 120 }, () => "fixed-id");
    useGraphDocumentStore
      .getState()
      .updateNote(noteId, { text: "  exact  spacing\nkept  ", color: "teal" });
    useGraphDocumentStore.getState().applyNoteChanges([
      { id: noteId, type: "position", position: { x: 140, y: 180 }, dragging: false },
      {
        id: noteId,
        type: "dimensions",
        dimensions: { width: 360, height: 240 },
        resizing: false,
      },
    ]);
    const duplicateIds = useGraphDocumentStore.getState().duplicateNotes([noteId], () => "copy-id");

    let state = useGraphDocumentStore.getState();
    expect(noteId).toBe("note-fixed-id");
    expect(duplicateIds).toEqual(["note-copy-id"]);
    expect(state.notes[0]).toMatchObject({
      position: { x: 140, y: 180 },
      measured: { width: 360, height: 240 },
      data: { text: "  exact  spacing\nkept  ", color: "teal" },
    });
    expect(state.notes[1]?.position).toEqual({ x: 172, y: 212 });
    expect(state.nodes[0]?.data.runStatus).toBe("completed");
    expect(state.isDirty).toBe(true);

    useGraphDocumentStore.getState().removeNotes([noteId]);
    state = useGraphDocumentStore.getState();
    expect(state.notes.map((note) => note.id)).toEqual(["note-copy-id"]);
    expect(state.nodes[0]?.data.runStatus).toBe("completed");
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

  it("duplicates incoming wires while leaving outgoing wires attached only to the source", () => {
    useGraphDocumentStore.setState({
      nodes: [node("source"), { ...node("selected"), selected: true }, node("downstream")],
      edges: [
        { id: "incoming", source: "source", target: "selected" },
        { id: "outgoing", source: "selected", target: "downstream" },
      ],
      wires: [{ edgeId: "incoming", color: "rose" }],
      wireBundles: [
        {
          id: "bundle-a",
          edgeIds: ["incoming", "outgoing"],
          ties: [
            { x: 100, y: 100 },
            { x: 200, y: 100 },
          ],
        },
      ],
    });

    const duplicatedIds = useGraphDocumentStore
      .getState()
      .duplicateNodes(undefined, () => "copy-value");

    const state = useGraphDocumentStore.getState();
    expect(duplicatedIds).toEqual(["test-copy-v"]);
    expect(state.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "copy-value",
          source: "source",
          target: "test-copy-v",
        }),
      ]),
    );
    expect(state.edges.filter((edge) => edge.target === "downstream")).toHaveLength(1);
    expect(state.wires).toContainEqual({ edgeId: "copy-value", color: "rose" });
    expect(state.wireBundles[0]?.edgeIds).toEqual(["incoming", "outgoing", "copy-value"]);
  });

  it("creates and moves wire bundles without invalidating completed runs", () => {
    useGraphDocumentStore.setState({
      edges: [
        { id: "edge-a", source: "one", target: "two" },
        { id: "edge-b", source: "one", target: "two" },
        { id: "edge-c", source: "one", target: "two" },
      ],
    });

    const bundleId = useGraphDocumentStore
      .getState()
      .bundleEdges(
        ["edge-a", "edge-b", "edge-c"],
        { x: 100, y: 120 },
        { x: 280, y: 160 },
        () => "fixed-id",
      );
    useGraphDocumentStore.getState().moveWireBundleTie(bundleId!, 0, { x: 132, y: 144 });

    const state = useGraphDocumentStore.getState();
    expect(bundleId).toBe("bundle-fixed-id");
    expect(state.wireBundles).toEqual([
      {
        id: "bundle-fixed-id",
        edgeIds: ["edge-a", "edge-b", "edge-c"],
        ties: [
          { x: 132, y: 144 },
          { x: 280, y: 160 },
        ],
      },
    ]);
    expect(state.selectionKind).toBe("bundle");
    expect(state.selectedWireBundleId).toBe("bundle-fixed-id");
    expect(state.nodes[0]?.data.runStatus).toBe("completed");
    expect(state.isDirty).toBe(true);
  });

  it("prunes a tie pair as its wires are removed or pulled out", () => {
    useGraphDocumentStore.setState({
      edges: [
        { id: "edge-a", source: "one", target: "two" },
        { id: "edge-b", source: "one", target: "two" },
        { id: "edge-c", source: "one", target: "two" },
      ],
      wireBundles: [
        {
          id: "bundle-a",
          edgeIds: ["edge-a", "edge-b", "edge-c"],
          ties: [
            { x: 10, y: 20 },
            { x: 30, y: 40 },
          ],
        },
      ],
    });

    useGraphDocumentStore.getState().removeEdge("edge-a");
    expect(useGraphDocumentStore.getState().wireBundles[0]?.edgeIds).toEqual(["edge-b", "edge-c"]);

    useGraphDocumentStore.getState().removeEdgesFromBundle("bundle-a", ["edge-b"]);
    expect(useGraphDocumentStore.getState().wireBundles).toEqual([]);
  });

  it("lets a wire pass through overlapping tie pairs without dissolving earlier ones", () => {
    useGraphDocumentStore.setState({
      edges: [
        { id: "edge-a", source: "one", target: "two" },
        { id: "edge-b", source: "one", target: "two" },
        { id: "edge-c", source: "one", target: "two" },
      ],
      wireBundles: [
        {
          id: "bundle-a",
          edgeIds: ["edge-a", "edge-b"],
          ties: [
            { x: 10, y: 20 },
            { x: 30, y: 40 },
          ],
        },
      ],
    });

    const createdId = useGraphDocumentStore
      .getState()
      .bundleEdges(["edge-a", "edge-c"], { x: 200, y: 20 }, { x: 260, y: 40 }, () => "second");

    const state = useGraphDocumentStore.getState();
    expect(createdId).toBe("bundle-second");
    expect(state.wireBundles.map((bundle) => bundle.edgeIds)).toEqual([
      ["edge-a", "edge-b"],
      ["edge-a", "edge-c"],
    ]);

    useGraphDocumentStore.getState().snipWireBundle("bundle-second");
    expect(useGraphDocumentStore.getState().wireBundles.map((bundle) => bundle.id)).toEqual([
      "bundle-a",
    ]);
    expect(useGraphDocumentStore.getState().selectionKind).toBeUndefined();
  });

  it("adds wires to an existing bundle and stores optional color overrides", () => {
    useGraphDocumentStore.setState({
      edges: [
        { id: "edge-a", source: "one", target: "two" },
        { id: "edge-b", source: "one", target: "two" },
        { id: "edge-c", source: "one", target: "two" },
      ],
      wireBundles: [
        {
          id: "bundle-a",
          edgeIds: ["edge-a", "edge-b"],
          ties: [
            { x: 10, y: 20 },
            { x: 30, y: 40 },
          ],
        },
      ],
    });

    useGraphDocumentStore.getState().addEdgesToBundle("bundle-a", ["edge-c"]);
    useGraphDocumentStore.getState().setWireColor(["edge-a", "edge-c"], "rose");
    expect(useGraphDocumentStore.getState().wireBundles[0]?.edgeIds).toEqual([
      "edge-a",
      "edge-b",
      "edge-c",
    ]);
    expect(useGraphDocumentStore.getState().wires).toEqual([
      { edgeId: "edge-a", color: "rose" },
      { edgeId: "edge-c", color: "rose" },
    ]);
  });

  it("keeps node and wire selections mutually exclusive", () => {
    useGraphDocumentStore.setState({
      nodes: [node("one"), node("two")],
      edges: [{ id: "edge-a", source: "one", target: "two" }],
    });

    useGraphDocumentStore.getState().selectEdges(["edge-a"]);
    expect(useGraphDocumentStore.getState().selectionKind).toBe("wire");
    expect(useGraphDocumentStore.getState().nodes.every((item) => !item.selected)).toBe(true);

    useGraphDocumentStore.getState().selectNodes(["one"]);
    expect(useGraphDocumentStore.getState().selectionKind).toBe("node");
    expect(useGraphDocumentStore.getState().edges[0]?.selected).toBe(false);
  });
});
