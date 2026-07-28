import type { Edge, Node } from "@xyflow/react";

export type ValueType =
  | "any"
  | "text"
  | "template"
  | "collection"
  | "endpoint"
  | "model"
  | "completion"
  | "glitchling"
  | "gaggle"
  | "corruption"
  | "file";

export interface PortDefinition {
  name: string;
  label: string;
  type: ValueType;
  required: boolean;
  multiple: boolean;
}

export interface FieldOption {
  label: string;
  value: string;
}

export interface FieldDefinition {
  name: string;
  label: string;
  control:
    | "text"
    | "textarea"
    | "number"
    | "number_optional"
    | "checkbox"
    | "select"
    | "json";
  default: unknown;
  help: string;
  options: FieldOption[];
  placeholder: string;
}

export interface NodeDefinition {
  kind: string;
  label: string;
  category: string;
  description: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  fields: FieldDefinition[];
}

export interface GlitchlingParameter {
  name: string;
  required: boolean;
  default: unknown;
  annotation: string | null;
  choices: unknown[];
}

export interface GlitchlingDescriptor {
  name: string;
  label: string;
  class: string;
  parameters: GlitchlingParameter[];
}

export interface PluginStatus {
  available: boolean;
  version: string | null;
  path?: string;
  error?: string | null;
}

export interface CatalogResponse {
  nodes: NodeDefinition[];
  glitchlings: GlitchlingDescriptor[];
  plugin: PluginStatus;
}

export type NodeRunStatus = "idle" | "running" | "completed" | "failed";

export interface LoomNodeData extends Record<string, unknown> {
  kind: string;
  title: string;
  definition: NodeDefinition;
  config: Record<string, unknown>;
  runStatus: NodeRunStatus;
}

export type LoomNode = Node<LoomNodeData, "loomNode">;
export type LoomEdge = Edge;

export interface NodeRunResult {
  node_id: string;
  kind: string;
  status: "completed" | "failed";
  duration_ms: number;
  outputs: Record<string, unknown>;
  error?: string;
}

export interface RunResponse {
  status: string;
  manifest: {
    run_id: string;
    graph_name: string;
    graph_digest: string;
    engine_version: string;
    started_at: string;
    finished_at: string;
    glitchlings_version: string | null;
  };
  nodes: NodeRunResult[];
  terminal_outputs: Record<string, Record<string, unknown>>;
}

export interface RunErrorDetail {
  message: string;
  node_id?: string;
  nodes?: NodeRunResult[];
}
