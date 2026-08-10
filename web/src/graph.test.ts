import { describe, expect, it } from "vitest";
import { assertWirePresentationPreserved, hydrateGraph, serializeGraph } from "./graph";
import type {
  NodeDefinition,
  WireBundle,
  WorkflowFrame,
  WorkflowNode,
  WorkflowNote,
} from "./types";

const definition = {
  kind: "test",
  label: "Test",
  description: "Test node",
  category: "Tests",
  inputs: [],
  outputs: [],
  fields: [],
} as unknown as NodeDefinition;

const frame: WorkflowFrame = {
  id: "frame-a",
  type: "workflowFrame",
  position: { x: 80, y: 120 },
  width: 520,
  height: 320,
  data: { title: "Inputs", color: "amber", collapsed: true },
};

const node: WorkflowNode = {
  id: "node-a",
  type: "workflowNode",
  parentId: frame.id,
  extent: "parent",
  position: { x: 36, y: 72 },
  data: {
    kind: "test",
    title: "Node",
    definition,
    config: {},
    controlPorts: {},
    runStatus: "completed",
  },
};

const note: WorkflowNote = {
  id: "note-a",
  type: "workflowNote",
  position: { x: 640, y: 80 },
  width: 280,
  height: 160,
  data: { text: "  Preserve this note exactly.  ", color: "teal" },
};

describe("graph presentation", () => {
  it("rejects a save response that silently drops wire presentation", () => {
    const requested = serializeGraph(
      "Guarded",
      [],
      [],
      [],
      "bezier",
      [{ edgeId: "edge-a", color: "rose" }],
      [
        {
          id: "bundle-a",
          edgeIds: ["edge-a", "edge-b"],
          ties: [
            { x: 12, y: 24 },
            { x: 64, y: 24 },
          ],
        },
      ],
    );
    const dropped = {
      ...requested,
      presentation: {
        ...requested.presentation!,
        wires: [],
        wire_bundles: [],
      },
    };

    expect(() => assertWirePresentationPreserved(requested, requested)).not.toThrow();
    expect(() => assertWirePresentationPreserved(requested, dropped)).toThrow(
      "The server did not preserve canvas presentation data",
    );
  });

  it("serializes semantic positions as absolute and round-trips frame presentation", () => {
    const graph = serializeGraph("Grouped", [node], [], [frame], "bezier");

    expect(graph.nodes[0]?.position).toEqual({ x: 116, y: 192 });
    expect(graph.presentation).toEqual({
      edge_routing: "bezier",
      frames: [
        {
          id: "frame-a",
          title: "Inputs",
          color: "amber",
          position: { x: 80, y: 120 },
          width: 520,
          height: 320,
          collapsed: true,
          node_ids: ["node-a"],
        },
      ],
      wires: [],
      wire_bundles: [],
      node_previews: [],
      notes: [],
    });

    const hydrated = hydrateGraph(graph, [definition]);
    expect(hydrated.edgeRouting).toBe("bezier");
    expect(hydrated.frames[0]?.data).toMatchObject({
      title: "Inputs",
      color: "amber",
      collapsed: true,
    });
    expect(hydrated.nodes[0]).toMatchObject({
      parentId: "frame-a",
      extent: "parent",
      position: { x: 36, y: 72 },
    });
  });

  it("uses legacy presentation defaults", () => {
    const legacy = serializeGraph("Legacy", [{ ...node, parentId: undefined }], []);
    delete legacy.presentation;

    const hydrated = hydrateGraph(legacy, [definition]);
    expect(hydrated.frames).toEqual([]);
    expect(hydrated.edgeRouting).toBe("smoothstep");
    expect(hydrated.wires).toEqual([]);
    expect(hydrated.wireBundles).toEqual([]);
    expect(hydrated.notes).toEqual([]);
  });

  it("round-trips wire styles and movable bundles as presentation-only metadata", () => {
    const edges = [
      {
        id: "edge-a",
        source: "node-a",
        sourceHandle: "out-a",
        target: "node-b",
        targetHandle: "in-a",
      },
      {
        id: "edge-b",
        source: "node-a",
        sourceHandle: "out-b",
        target: "node-b",
        targetHandle: "in-b",
      },
    ];
    const wires = [{ edgeId: "edge-a", color: "rose" as const }];
    const wireBundles: WireBundle[] = [
      {
        id: "bundle-a",
        edgeIds: ["edge-a", "edge-b"],
        ties: [
          { x: 180, y: 120 },
          { x: 320, y: 180 },
        ],
      },
      {
        id: "bundle-b",
        edgeIds: ["edge-a", "edge-b"],
        ties: [
          { x: 420, y: 160 },
          { x: 520, y: 160 },
        ],
      },
    ];

    const graph = serializeGraph("Bundled", [node], edges, [], "smoothstep", wires, wireBundles);
    expect(graph.presentation?.wires).toEqual([{ edge_id: "edge-a", color: "rose" }]);
    expect(graph.presentation?.wire_bundles).toEqual([
      {
        id: "bundle-a",
        edge_ids: ["edge-a", "edge-b"],
        ties: [
          { x: 180, y: 120 },
          { x: 320, y: 180 },
        ],
      },
      {
        id: "bundle-b",
        edge_ids: ["edge-a", "edge-b"],
        ties: [
          { x: 420, y: 160 },
          { x: 520, y: 160 },
        ],
      },
    ]);
    const hydrated = hydrateGraph(graph, [definition]);
    expect(hydrated.wires).toEqual(wires);
    expect(hydrated.wireBundles).toEqual(wireBundles);
  });

  it("persists hidden canvas previews as presentation-only state", () => {
    const previewDefinition = { ...definition, kind: "preview", label: "Preview" };
    const previewNode: WorkflowNode = {
      ...node,
      id: "preview-a",
      parentId: undefined,
      data: {
        ...node.data,
        kind: "preview",
        definition: previewDefinition,
        canvasPreviewVisible: false,
      },
    };

    const graph = serializeGraph("Preview", [previewNode], []);
    expect(graph.presentation?.node_previews).toEqual([{ node_id: "preview-a", visible: false }]);
    expect(hydrateGraph(graph, [previewDefinition]).nodes[0]?.data.canvasPreviewVisible).toBe(
      false,
    );
  });

  it("round-trips editable notes as presentation-only state", () => {
    const graph = serializeGraph("Annotated", [node], [], [], "smoothstep", [], [], [note]);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.presentation?.notes).toEqual([
      {
        id: "note-a",
        text: "  Preserve this note exactly.  ",
        color: "teal",
        position: { x: 640, y: 80 },
        width: 280,
        height: 160,
      },
    ]);
    expect(hydrateGraph(graph, [definition]).notes[0]).toMatchObject({
      id: "note-a",
      type: "workflowNote",
      position: { x: 640, y: 80 },
      width: 280,
      height: 160,
      data: { text: "  Preserve this note exactly.  ", color: "teal" },
    });
  });
});

describe("Loom graph state", () => {
  it("round-trips the selected branch as semantic node state", () => {
    const loomDefinition: NodeDefinition = {
      ...definition,
      kind: "loom",
      label: "Loom",
      editor: "loom",
    };
    const loomNode: WorkflowNode = {
      ...node,
      id: "loom-a",
      parentId: undefined,
      extent: undefined,
      data: {
        ...node.data,
        kind: "loom",
        definition: loomDefinition,
        state: {
          kind: "loom",
          version: 1,
          selected_id: "child",
          entries: [
            { id: "root", text: "root", source: "human", created_at: "2026-08-03T00:00:00Z" },
            {
              id: "child",
              parent_id: "root",
              text: "  selected  ",
              source: "model",
              created_at: "2026-08-03T00:00:01Z",
            },
          ],
        },
      },
    };

    const graph = serializeGraph("Loom", [loomNode], []);
    expect(graph.nodes[0]?.state?.selected_id).toBe("child");
    const hydrated = hydrateGraph(graph, [loomDefinition]);
    expect(hydrated.nodes[0]?.data.state?.entries[1]?.text).toBe("  selected  ");
  });
});
