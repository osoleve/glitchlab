import type { ValueType, WireColor, WirePresentation, WorkflowEdge, WorkflowNode } from "./types";

export const WIRE_COLOR_VALUES: Record<WireColor, string> = {
  slate: "#8f8796",
  amber: "#d9aa63",
  cyan: "#62bfd1",
  teal: "#5fc1aa",
  violet: "#ae91e6",
  coral: "#e47f79",
  blue: "#6f9fe1",
  rose: "#d986ae",
};

export const WIRE_COLOR_OPTIONS: Array<{ value: WireColor; label: string }> = [
  { value: "slate", label: "Slate" },
  { value: "amber", label: "Amber" },
  { value: "cyan", label: "Cyan" },
  { value: "teal", label: "Teal" },
  { value: "violet", label: "Violet" },
  { value: "coral", label: "Coral" },
  { value: "blue", label: "Blue" },
  { value: "rose", label: "Rose" },
];

export function wireColorForValueType(valueType: ValueType): WireColor {
  switch (valueType) {
    case "text":
    case "template":
      return "amber";
    case "number":
    case "boolean":
      return "cyan";
    case "collection":
    case "dataset":
      return "teal";
    case "endpoint":
    case "model":
    case "completion":
      return "violet";
    case "glitchling":
    case "gaggle":
    case "corruption":
      return "coral";
    case "file":
      return "blue";
    default:
      return "slate";
  }
}

export function wireValueType(edge: WorkflowEdge, nodes: readonly WorkflowNode[]): ValueType {
  const source = nodes.find((node) => node.id === edge.source);
  const sourcePort = source?.data.definition.outputs.find(
    (port) => port.name === edge.sourceHandle,
  );
  if (sourcePort) return sourcePort.type;
  const target = nodes.find((node) => node.id === edge.target);
  return (
    target?.data.definition.inputs.find((port) => port.name === edge.targetHandle)?.type ?? "any"
  );
}

export function wireAppearance(
  edge: WorkflowEdge,
  nodes: readonly WorkflowNode[],
  wires: readonly WirePresentation[],
): { valueType: ValueType; colorName: WireColor; color: string } {
  const valueType = wireValueType(edge, nodes);
  const colorName =
    wires.find((wire) => wire.edgeId === edge.id)?.color ?? wireColorForValueType(valueType);
  return { valueType, colorName, color: WIRE_COLOR_VALUES[colorName] };
}
