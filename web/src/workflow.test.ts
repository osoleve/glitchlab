import { describe, expect, it } from "vitest";
import type { LoomFrame, LoomNode, NodeDefinition } from "./types";
import { inferWorkflowDraft } from "./workflow";

const definition = {
  kind: "value",
  label: "Value",
  description: "Value",
  category: "Values",
  inputs: [],
  outputs: [{ name: "value", label: "Value", type: "text" }],
  fields: [],
} as unknown as NodeDefinition;

const makeNode = (id: string, x: number, parentId?: string) =>
  ({
    id,
    type: "loomNode",
    parentId,
    position: { x, y: 20 },
    selected: true,
    data: {
      kind: "value",
      title: id,
      definition,
      config: {},
      controlPorts: {},
      runStatus: "idle",
    },
  }) as LoomNode;

describe("workflow graph positions", () => {
  it("normalizes grouped children from absolute semantic positions", () => {
    const frame = {
      id: "frame",
      type: "loomFrame",
      position: { x: 100, y: 50 },
      width: 300,
      height: 200,
      data: { title: "Frame", color: "violet", collapsed: false },
    } as LoomFrame;

    const draft = inferWorkflowDraft(
      "Grouped",
      "",
      [makeNode("inside", 20, frame.id), makeNode("outside", 300)],
      [],
      [frame],
    );

    expect(draft.graph.nodes.map((node) => node.position.x)).toEqual([0, 180]);
  });
});
