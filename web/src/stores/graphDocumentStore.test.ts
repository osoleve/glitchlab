import { beforeEach, describe, expect, it } from "vitest";
import type { LoomNode } from "../types";
import { useGraphDocumentStore } from "./graphDocumentStore";

const node = (id: string, value = "before") =>
  ({
    id,
    type: "loomNode",
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
  }) as unknown as LoomNode;

describe("graph document store", () => {
  beforeEach(() => {
    useGraphDocumentStore.setState({
      nodes: [node("one")],
      edges: [],
      selectedId: "one",
      loomName: "Test graph",
      isDirty: false,
    });
  });

  it("updates node fields without mounting the app", () => {
    useGraphDocumentStore.getState().updateNodeField("one", "value", "after");

    const state = useGraphDocumentStore.getState();
    expect(state.nodes[0]?.data.config.value).toBe("after");
    expect(state.nodes[0]?.data.runStatus).toBe("idle");
    expect(state.isDirty).toBe(true);
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
