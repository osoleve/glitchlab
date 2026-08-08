import { createLoomState } from "./loom";
import type { NodeDefinition, WorkflowEdge, WorkflowNode } from "./types";

function makeNode(
  id: string,
  kind: string,
  title: string,
  position: { x: number; y: number },
  definitions: Map<string, NodeDefinition>,
  overrides: Record<string, unknown> = {},
): WorkflowNode {
  const definition = definitions.get(kind);
  if (!definition) {
    throw new Error(`Starter graph refers to missing node kind ${kind}.`);
  }
  const config = Object.fromEntries(definition.fields.map((field) => [field.name, field.default]));
  const state = definition.editor === "loom" ? createLoomState() : undefined;
  return {
    id,
    type: "workflowNode",
    position,
    data: {
      kind,
      title,
      definition,
      config: { ...config, ...overrides },
      controlPorts: {},
      ...(state ? { state } : {}),
      runStatus: "idle",
    },
  };
}

function starterLoomState() {
  const state = createLoomState();
  return {
    ...state,
    entries: state.entries.map((entry) => ({ ...entry, text: "The atomic age will bring" })),
  };
}

export function createStarterGraph(definitions: NodeDefinition[]): {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
} {
  const byKind = new Map(definitions.map((definition) => [definition.kind, definition]));
  const loom = makeNode("loom", "loom", "Branching draft", { x: 360, y: 70 }, byKind, {
    max_tokens: 48,
    temperature: 0.8,
    top_p: 0.95,
    seed: 151,
    extra_body: { top_k: 40, presence_penalty: 0 },
  });
  loom.data.state = starterLoomState();
  const nodes = [
    makeNode("endpoint", "endpoint", "Local completion API", { x: 0, y: 0 }, byKind, {
      base_url: "http://127.0.0.1:8790/v1",
      timeout_seconds: 180,
    }),
    makeNode("model", "model", "Vintage Talkie", { x: 0, y: 220 }, byKind, {
      model_id: "talkie-1930-13b-base",
    }),
    loom,
    makeNode("preview", "preview", "Selected text", { x: 720, y: 70 }, byKind),
  ];
  const edges: WorkflowEdge[] = [
    {
      id: "endpoint-loom",
      source: "endpoint",
      sourceHandle: "endpoint",
      target: "loom",
      targetHandle: "endpoint",
    },
    {
      id: "model-loom",
      source: "model",
      sourceHandle: "model",
      target: "loom",
      targetHandle: "model",
    },
    {
      id: "loom-preview",
      source: "loom",
      sourceHandle: "text",
      target: "preview",
      targetHandle: "value",
    },
  ];
  return { nodes, edges };
}
