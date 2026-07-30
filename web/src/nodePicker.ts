import type { NodeDefinition, PortDefinition, ValueType } from "./types";

export interface CompatibleNodeInput {
  definition: NodeDefinition;
  input: PortDefinition;
}

export function valueTypesCompatible(sourceType: ValueType, targetType: ValueType): boolean {
  return sourceType === "any" || targetType === "any" || sourceType === targetType;
}

export function compatibleNodeInputs(
  definitions: NodeDefinition[],
  sourceType: ValueType,
): CompatibleNodeInput[] {
  return definitions.flatMap((definition) =>
    definition.inputs
      .filter((input) => valueTypesCompatible(sourceType, input.type))
      .map((input) => ({ definition, input })),
  );
}
