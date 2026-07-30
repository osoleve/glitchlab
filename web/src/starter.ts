import type { LoomEdge, LoomNode, NodeDefinition } from "./types";

function makeNode(
  id: string,
  kind: string,
  title: string,
  position: { x: number; y: number },
  definitions: Map<string, NodeDefinition>,
  overrides: Record<string, unknown> = {},
): LoomNode {
  const definition = definitions.get(kind);
  if (!definition) {
    throw new Error(`Starter graph refers to missing node kind ${kind}.`);
  }
  const config = Object.fromEntries(
    definition.fields.map((field) => [field.name, field.default]),
  );
  return {
    id,
    type: "loomNode",
    position,
    data: {
      kind,
      title,
      definition,
      config: { ...config, ...overrides },
      controlPorts: {},
      runStatus: "idle",
    },
  };
}

export function talkieStarter(definitions: NodeDefinition[]): {
  nodes: LoomNode[];
  edges: LoomEdge[];
} {
  const byKind = new Map(definitions.map((definition) => [definition.kind, definition]));
  const completionConfig = {
    max_tokens: 16,
    temperature: 0.8,
    top_p: 0.95,
    seed: 151,
    extra_body: { top_k: 40, presence_penalty: 0 },
  };
  const nodes = [
    makeNode(
      "prompt",
      "text_input",
      "Seed prompt",
      { x: 0, y: 100 },
      byKind,
      { text: "The atomic age will bring" },
    ),
    makeNode(
      "typogre",
      "glitchling",
      "Surface noise",
      { x: 0, y: 520 },
      byKind,
      { name: "typogre", seed: 151, params: {} },
    ),
    makeNode(
      "corrupt",
      "corrupt",
      "Corrupt prompt",
      { x: 240, y: 520 },
      byKind,
    ),
    makeNode(
      "endpoint",
      "endpoint",
      "Elsie completion API",
      { x: 240, y: 0 },
      byKind,
      {
        base_url: "http://elsie-1:8790/v1",
        timeout_seconds: 180,
      },
    ),
    makeNode(
      "vintage_model",
      "model",
      "Vintage Talkie",
      { x: 240, y: 160 },
      byKind,
      { model_id: "talkie-1930-13b-base" },
    ),
    makeNode(
      "web_model",
      "model",
      "Web Talkie",
      { x: 240, y: 320 },
      byKind,
      { model_id: "talkie-web-13b-base" },
    ),
    makeNode(
      "original_vintage",
      "completion",
      "Vintage · original",
      { x: 490, y: 0 },
      byKind,
      completionConfig,
    ),
    makeNode(
      "original_web",
      "completion",
      "Web · original",
      { x: 490, y: 220 },
      byKind,
      completionConfig,
    ),
    makeNode(
      "corrupted_vintage",
      "completion",
      "Vintage · corrupted",
      { x: 490, y: 440 },
      byKind,
      completionConfig,
    ),
    makeNode(
      "corrupted_web",
      "completion",
      "Web · corrupted",
      { x: 490, y: 660 },
      byKind,
      completionConfig,
    ),
    makeNode(
      "collect",
      "collect",
      "Four completions",
      { x: 750, y: 330 },
      byKind,
      { flatten: false },
    ),
    makeNode(
      "preview",
      "preview",
      "Run inspector",
      { x: 1010, y: 330 },
      byKind,
    ),
  ];
  const edges: LoomEdge[] = [
    {
      id: "prompt-original-vintage",
      source: "prompt",
      sourceHandle: "text",
      target: "original_vintage",
      targetHandle: "prompt",
    },
    {
      id: "prompt-original-web",
      source: "prompt",
      sourceHandle: "text",
      target: "original_web",
      targetHandle: "prompt",
    },
    {
      id: "prompt-corrupt",
      source: "prompt",
      sourceHandle: "text",
      target: "corrupt",
      targetHandle: "text",
    },
    {
      id: "typogre-corrupt",
      source: "typogre",
      sourceHandle: "glitchling",
      target: "corrupt",
      targetHandle: "corruptor",
    },
    {
      id: "corrupt-vintage",
      source: "corrupt",
      sourceHandle: "result",
      target: "corrupted_vintage",
      targetHandle: "prompt",
    },
    {
      id: "corrupt-web",
      source: "corrupt",
      sourceHandle: "result",
      target: "corrupted_web",
      targetHandle: "prompt",
    },
    {
      id: "endpoint-original-vintage",
      source: "endpoint",
      sourceHandle: "endpoint",
      target: "original_vintage",
      targetHandle: "endpoint",
    },
    {
      id: "endpoint-original-web",
      source: "endpoint",
      sourceHandle: "endpoint",
      target: "original_web",
      targetHandle: "endpoint",
    },
    {
      id: "endpoint-corrupted-vintage",
      source: "endpoint",
      sourceHandle: "endpoint",
      target: "corrupted_vintage",
      targetHandle: "endpoint",
    },
    {
      id: "endpoint-corrupted-web",
      source: "endpoint",
      sourceHandle: "endpoint",
      target: "corrupted_web",
      targetHandle: "endpoint",
    },
    {
      id: "vintage-original-model",
      source: "vintage_model",
      sourceHandle: "model",
      target: "original_vintage",
      targetHandle: "model",
    },
    {
      id: "vintage-corrupted-model",
      source: "vintage_model",
      sourceHandle: "model",
      target: "corrupted_vintage",
      targetHandle: "model",
    },
    {
      id: "web-original-model",
      source: "web_model",
      sourceHandle: "model",
      target: "original_web",
      targetHandle: "model",
    },
    {
      id: "web-corrupted-model",
      source: "web_model",
      sourceHandle: "model",
      target: "corrupted_web",
      targetHandle: "model",
    },
    {
      id: "original-vintage-collect",
      source: "original_vintage",
      sourceHandle: "result",
      target: "collect",
      targetHandle: "item",
    },
    {
      id: "original-web-collect",
      source: "original_web",
      sourceHandle: "result",
      target: "collect",
      targetHandle: "item",
    },
    {
      id: "corrupted-vintage-collect",
      source: "corrupted_vintage",
      sourceHandle: "result",
      target: "collect",
      targetHandle: "item",
    },
    {
      id: "corrupted-web-collect",
      source: "corrupted_web",
      sourceHandle: "result",
      target: "collect",
      targetHandle: "item",
    },
    {
      id: "collect-preview",
      source: "collect",
      sourceHandle: "items",
      target: "preview",
      targetHandle: "value",
    },
  ];
  return { nodes, edges };
}
