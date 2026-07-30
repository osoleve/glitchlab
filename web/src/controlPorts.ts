import type { ControlPortMode, NodeDefinition, PortDefinition } from "./types";

export const CONTROL_PORT_PREFIX = "control:";

export function controlPortName(fieldName: string): string {
  return `${CONTROL_PORT_PREFIX}${fieldName}`;
}

export function withControlPorts(
  definition: NodeDefinition,
  controlPorts: Record<string, ControlPortMode>,
): NodeDefinition {
  const fields = new Map(definition.fields.map((field) => [field.name, field]));
  const inputs = definition.inputs.filter((port) => !port.control);
  const outputs = definition.outputs.filter((port) => !port.control);

  for (const [fieldName, mode] of Object.entries(controlPorts)) {
    const field = fields.get(fieldName);
    if (!field) continue;
    const port: PortDefinition = {
      name: controlPortName(fieldName),
      label: field.label,
      type: field.type,
      required: false,
      multiple: false,
      control: fieldName,
    };
    if (mode === "input" || mode === "passthrough") inputs.push({ ...port });
    if (mode === "output" || mode === "passthrough") outputs.push({ ...port });
  }

  return {
    ...definition,
    inputs,
    outputs,
  };
}
