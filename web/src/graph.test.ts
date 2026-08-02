import { describe, expect, it } from "vitest";
import { hydrateGraph, serializeGraph } from "./graph";
import type { LoomFrame, LoomNode, NodeDefinition } from "./types";

const definition = {
  kind: "test",
  label: "Test",
  description: "Test node",
  category: "Tests",
  inputs: [],
  outputs: [],
  fields: [],
} as unknown as NodeDefinition;

const frame: LoomFrame = {
  id: "frame-a",
  type: "loomFrame",
  position: { x: 80, y: 120 },
  width: 520,
  height: 320,
  data: { title: "Inputs", color: "amber", collapsed: true },
};

const node: LoomNode = {
  id: "node-a",
  type: "loomNode",
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

describe("graph presentation", () => {
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
  });
});
