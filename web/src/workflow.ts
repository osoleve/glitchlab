import type {
  LoomEdge,
  LoomNode,
  PortDefinition,
  WorkflowDraft,
  WorkflowInput,
  WorkflowOutput,
  WorkflowSpec,
} from "./types";
import { serializeGraph } from "./graph";

function portKey(nodeId: string, portName: string): string {
  return `${nodeId}\u0000${portName}`;
}

function uniqueName(
  port: PortDefinition,
  node: LoomNode,
  used: Set<string>,
): string {
  const clean = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");
  const portName = clean(port.control ?? port.name) || "value";
  let candidate = portName;
  if (used.has(candidate)) {
    candidate = `${clean(node.data.title) || clean(node.id)}_${portName}`;
  }
  const base = candidate;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

export function selectedGraphNodes(nodes: LoomNode[]): LoomNode[] {
  const selected = nodes.filter((node) => node.selected);
  return selected.length > 0 ? selected : [];
}

export function inferWorkflowDraft(
  name: string,
  description: string,
  selectedNodes: LoomNode[],
  edges: LoomEdge[],
): WorkflowDraft {
  if (selectedNodes.length === 0) {
    throw new Error("Select at least one node to save a workflow.");
  }

  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const internalEdges = edges.filter(
    (edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target),
  );
  const incomingBoundary = edges.filter(
    (edge) => !selectedIds.has(edge.source) && selectedIds.has(edge.target),
  );
  const outgoingBoundary = edges.filter(
    (edge) => selectedIds.has(edge.source) && !selectedIds.has(edge.target),
  );
  const internalTargets = new Set(
    internalEdges
      .filter((edge) => edge.targetHandle)
      .map((edge) => portKey(edge.target, edge.targetHandle!)),
  );
  const externalTargets = new Set(
    incomingBoundary
      .filter((edge) => edge.targetHandle)
      .map((edge) => portKey(edge.target, edge.targetHandle!)),
  );
  const externalSources = new Set(
    outgoingBoundary
      .filter((edge) => edge.sourceHandle)
      .map((edge) => portKey(edge.source, edge.sourceHandle!)),
  );
  const internalSources = new Set(
    internalEdges
      .filter((edge) => edge.sourceHandle)
      .map((edge) => portKey(edge.source, edge.sourceHandle!)),
  );

  const inputNames = new Set<string>();
  const inputs: WorkflowInput[] = [];
  for (const node of selectedNodes) {
    for (const port of node.data.definition.inputs) {
      const key = portKey(node.id, port.name);
      const shouldExpose =
        externalTargets.has(key) ||
        (!internalTargets.has(key) &&
          (port.required || port.control !== undefined));
      if (!shouldExpose) continue;
      inputs.push({
        ...port,
        name: uniqueName(port, node, inputNames),
        label: port.label,
        node_id: node.id,
        node_port: port.name,
      });
    }
  }

  const outputNames = new Set<string>();
  const outputs: WorkflowOutput[] = [];
  for (const node of selectedNodes) {
    for (const port of node.data.definition.outputs) {
      const key = portKey(node.id, port.name);
      const shouldExpose =
        port.control !== undefined ||
        (externalSources.size > 0
          ? externalSources.has(key)
          : !internalSources.has(key));
      if (!shouldExpose) continue;
      outputs.push({
        name: uniqueName(port, node, outputNames),
        label: port.label,
        type: port.type,
        node_id: node.id,
        node_port: port.name,
      });
    }
  }
  if (outputs.length === 0) {
    throw new Error(
      "The selected graph has no exposed output. Include a terminal node or a wire leaving the selection.",
    );
  }

  const minimumX = Math.min(...selectedNodes.map((node) => node.position.x));
  const minimumY = Math.min(...selectedNodes.map((node) => node.position.y));
  const normalizedNodes = selectedNodes.map((node) => ({
    ...node,
    position: {
      x: node.position.x - minimumX,
      y: node.position.y - minimumY,
    },
  }));
  return {
    name: name.trim(),
    description: description.trim(),
    graph: serializeGraph(name.trim(), normalizedNodes, internalEdges),
    inputs,
    outputs,
  };
}

function uniqueBindingName(name: string, used: Set<string>): string {
  let candidate = name;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${name}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function conciseLegacyLabel(
  label: string,
  node: LoomNode,
  port: PortDefinition,
): string {
  const legacyLabel = `${node.data.title} · ${port.label}`;
  return label === legacyLabel ? port.label : label;
}

export function reviseWorkflowDraft(
  name: string,
  description: string,
  nodes: LoomNode[],
  edges: LoomEdge[],
  original: WorkflowSpec,
): WorkflowDraft {
  const inferred = inferWorkflowDraft(name, description, nodes, edges);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const internallyConnected = new Set(
    edges
      .filter((edge) => edge.targetHandle)
      .map((edge) => portKey(edge.target, edge.targetHandle!)),
  );

  const preservedInputs = original.inputs.flatMap((binding) => {
    const node = nodeMap.get(binding.node_id);
    const port = node?.data.definition.inputs.find(
      (item) => item.name === binding.node_port,
    );
    if (
      !node ||
      !port ||
      (!port.multiple &&
        internallyConnected.has(
          portKey(binding.node_id, binding.node_port),
        ))
    ) {
      return [];
    }
    return [
      {
        ...binding,
        label: conciseLegacyLabel(binding.label, node, port),
        type: port.type,
        required: port.required,
        multiple: port.multiple,
      },
    ];
  });
  const inputTargets = new Set(
    preservedInputs.map((binding) =>
      portKey(binding.node_id, binding.node_port),
    ),
  );
  const inputNames = new Set(preservedInputs.map((binding) => binding.name));
  const inputs = [
    ...preservedInputs,
    ...inferred.inputs
      .filter(
        (binding) =>
          !inputTargets.has(portKey(binding.node_id, binding.node_port)),
      )
      .map((binding) => ({
        ...binding,
        name: uniqueBindingName(binding.name, inputNames),
      })),
  ];

  const preservedOutputs = original.outputs.flatMap((binding) => {
    const node = nodeMap.get(binding.node_id);
    const port = node?.data.definition.outputs.find(
      (item) => item.name === binding.node_port,
    );
    if (!node || !port) return [];
    return [
      {
        ...binding,
        label: conciseLegacyLabel(binding.label, node, port),
        type: port.type,
      },
    ];
  });
  const outputSources = new Set(
    preservedOutputs.map((binding) =>
      portKey(binding.node_id, binding.node_port),
    ),
  );
  const outputNames = new Set(preservedOutputs.map((binding) => binding.name));
  const outputs = [
    ...preservedOutputs,
    ...inferred.outputs
      .filter(
        (binding) =>
          !outputSources.has(portKey(binding.node_id, binding.node_port)),
      )
      .map((binding) => ({
        ...binding,
        name: uniqueBindingName(binding.name, outputNames),
      })),
  ];

  return {
    ...inferred,
    inputs,
    outputs,
  };
}
