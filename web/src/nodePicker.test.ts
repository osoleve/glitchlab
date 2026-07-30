import { describe, expect, it } from "vitest";
import { compatibleNodeInputs, valueTypesCompatible } from "./nodePicker";
import type { NodeDefinition, PortDefinition, ValueType } from "./types";

function port(name: string, type: ValueType): PortDefinition {
  return {
    name,
    label: name,
    type,
    required: true,
    multiple: false,
  };
}

function definition(kind: string, inputs: PortDefinition[]): NodeDefinition {
  return {
    kind,
    label: kind,
    category: "Test",
    description: "",
    inputs,
    outputs: [],
    fields: [],
  };
}

describe("valueTypesCompatible", () => {
  it("accepts exact types and either side of an any connection", () => {
    expect(valueTypesCompatible("text", "text")).toBe(true);
    expect(valueTypesCompatible("text", "any")).toBe(true);
    expect(valueTypesCompatible("any", "model")).toBe(true);
  });

  it("rejects unrelated concrete types", () => {
    expect(valueTypesCompatible("text", "model")).toBe(false);
    expect(valueTypesCompatible("number", "collection")).toBe(false);
  });
});

describe("compatibleNodeInputs", () => {
  it("returns the exact compatible target port for each node", () => {
    const definitions = [
      definition("consume-text", [port("text", "text")]),
      definition("consume-number", [port("value", "number")]),
      definition("preview", [port("value", "any")]),
    ];

    expect(
      compatibleNodeInputs(definitions, "text").map(
        ({ definition: item, input }) => `${item.kind}:${input.name}`,
      ),
    ).toEqual(["consume-text:text", "preview:value"]);
  });

  it("retains distinct compatible inputs on the same node", () => {
    const definitions = [definition("merge", [port("left", "text"), port("right", "any")])];

    expect(compatibleNodeInputs(definitions, "text").map(({ input }) => input.name)).toEqual([
      "left",
      "right",
    ]);
  });
});
