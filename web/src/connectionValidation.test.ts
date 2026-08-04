import { describe, expect, it } from "vitest";
import { isGraphConnectionValid } from "./connectionValidation";
import type { NodeDefinition, ValueType, WorkflowEdge, WorkflowNode } from "./types";

function definition(
  kind: string,
  inputs: { name: string; type: ValueType; multiple?: boolean }[],
  outputs: { name: string; type: ValueType }[],
): NodeDefinition {
  return {
    kind,
    label: kind,
    category: "Test",
    description: "",
    inputs: inputs.map((port) => ({
      label: port.name,
      required: true,
      multiple: port.multiple ?? false,
      ...port,
    })),
    outputs: outputs.map((port) => ({
      label: port.name,
      required: true,
      multiple: false,
      ...port,
    })),
    fields: [],
  };
}

function node(id: string, nodeDefinition: NodeDefinition): WorkflowNode {
  return {
    id,
    type: "workflowNode",
    position: { x: 0, y: 0 },
    data: {
      kind: nodeDefinition.kind,
      title: id,
      definition: nodeDefinition,
      config: {},
      controlPorts: {},
      runStatus: "idle",
    },
  };
}

const nodes = [
  node("text", definition("text", [], [{ name: "text", type: "text" }])),
  node("model", definition("model", [], [{ name: "model", type: "model" }])),
  node(
    "collect",
    definition(
      "collect",
      [{ name: "item", type: "any", multiple: true }],
      [{ name: "items", type: "collection" }],
    ),
  ),
  node(
    "preview",
    definition("preview", [{ name: "value", type: "any" }], [{ name: "value", type: "any" }]),
  ),
];

describe("isGraphConnectionValid", () => {
  it("accepts compatible exact and any-typed ports", () => {
    expect(
      isGraphConnectionValid(
        {
          source: "text",
          sourceHandle: "text",
          target: "collect",
          targetHandle: "item",
        },
        nodes,
        [],
      ),
    ).toBe(true);
    expect(
      isGraphConnectionValid(
        {
          source: "collect",
          sourceHandle: "items",
          target: "preview",
          targetHandle: "value",
        },
        nodes,
        [],
      ),
    ).toBe(true);
  });

  it("rejects mismatched, missing, and self-connected ports", () => {
    expect(
      isGraphConnectionValid(
        {
          source: "text",
          sourceHandle: "text",
          target: "model",
          targetHandle: "missing",
        },
        nodes,
        [],
      ),
    ).toBe(false);
    expect(
      isGraphConnectionValid(
        {
          source: "model",
          sourceHandle: "model",
          target: "text",
          targetHandle: "text",
        },
        nodes,
        [],
      ),
    ).toBe(false);
    expect(
      isGraphConnectionValid(
        {
          source: "preview",
          sourceHandle: "value",
          target: "preview",
          targetHandle: "value",
        },
        nodes,
        [],
      ),
    ).toBe(false);
  });

  it("enforces input multiplicity while allowing an edge to reconnect in place", () => {
    const existing: WorkflowEdge = {
      id: "edge-1",
      source: "collect",
      sourceHandle: "items",
      target: "preview",
      targetHandle: "value",
    };
    const candidate = {
      source: "text",
      sourceHandle: "text",
      target: "preview",
      targetHandle: "value",
    };

    expect(isGraphConnectionValid(candidate, nodes, [existing])).toBe(false);
    expect(
      isGraphConnectionValid({ ...existing, source: "text", sourceHandle: "text" }, nodes, [
        existing,
      ]),
    ).toBe(true);
  });

  it("rejects connections that would create a cycle", () => {
    const existing: WorkflowEdge[] = [
      {
        id: "edge-1",
        source: "collect",
        sourceHandle: "items",
        target: "preview",
        targetHandle: "value",
      },
    ];

    expect(
      isGraphConnectionValid(
        {
          source: "preview",
          sourceHandle: "value",
          target: "collect",
          targetHandle: "item",
        },
        nodes,
        existing,
      ),
    ).toBe(false);
  });
});
