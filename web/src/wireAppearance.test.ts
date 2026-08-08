import { describe, expect, it } from "vitest";
import type { NodeDefinition, WorkflowEdge, WorkflowNode } from "./types";
import { wireAppearance, wireColorForValueType } from "./wireAppearance";

const definition = {
  kind: "source",
  label: "Source",
  category: "Inputs",
  description: "",
  inputs: [],
  outputs: [{ name: "value", label: "Value", type: "text", required: true, multiple: false }],
  fields: [],
} as NodeDefinition;

const node = {
  id: "source",
  type: "workflowNode",
  position: { x: 0, y: 0 },
  data: {
    kind: "source",
    title: "Source",
    definition,
    config: {},
    controlPorts: {},
    runStatus: "idle",
  },
} as WorkflowNode;

const edge = {
  id: "edge",
  source: "source",
  sourceHandle: "value",
  target: "target",
  targetHandle: "value",
} as WorkflowEdge;

describe("wire appearance", () => {
  it("groups value types into a stable semantic palette", () => {
    expect(wireColorForValueType("text")).toBe("amber");
    expect(wireColorForValueType("dataset")).toBe("teal");
    expect(wireColorForValueType("completion")).toBe("violet");
    expect(wireColorForValueType("any")).toBe("slate");
  });

  it("uses the source port type and permits a presentation override", () => {
    expect(wireAppearance(edge, [node], []).colorName).toBe("amber");
    expect(wireAppearance(edge, [node], [{ edgeId: "edge", color: "rose" }]).colorName).toBe(
      "rose",
    );
  });
});
