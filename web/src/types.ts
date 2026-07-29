import type { Edge, Node } from "@xyflow/react";

export type ValueType =
  | "any"
  | "boolean"
  | "number"
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
  control?: string;
}

export interface FieldOption {
  label: string;
  value: string;
}

export interface FieldDefinition {
  name: string;
  label: string;
  type: ValueType;
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

export type ControlPortMode = "input" | "output" | "passthrough";

export interface NodeDefinition {
  kind: string;
  label: string;
  category: string;
  description: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  fields: FieldDefinition[];
  workflow?: {
    id: string;
    version: number;
    digest: string;
  };
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
  controlPorts: Record<string, ControlPortMode>;
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

export interface GraphNodeSpec {
  id: string;
  kind: string;
  title?: string | null;
  config: Record<string, unknown>;
  control_ports: Record<string, ControlPortMode>;
  position: { x: number; y: number };
}

export interface GraphEdgeSpec {
  id: string;
  source: string;
  source_port: string;
  target: string;
  target_port: string;
}

export interface GraphSpec {
  name: string;
  nodes: GraphNodeSpec[];
  edges: GraphEdgeSpec[];
}

export interface LoomDraft {
  graph: GraphSpec;
}

export interface LoomSpec extends LoomDraft {
  id: string;
  revision: number;
  digest: string;
  created_at: string;
  updated_at: string;
}

export interface LoomSummary {
  id: string;
  name: string;
  revision: number;
  digest: string;
  created_at: string;
  updated_at: string;
  node_count: number;
}

export interface LoomTemplateSummary {
  id: string;
  name: string;
  node_count: number;
}

export interface LoadLoomResponse {
  loom: LoomSpec;
  definitions: NodeDefinition[];
}

export interface LoadLoomTemplateResponse {
  template: {
    id: string;
    graph: GraphSpec;
  };
  definitions: NodeDefinition[];
}

export interface DeleteLoomResponse {
  deleted: {
    id: string;
    name: string;
    revision: number;
    recoverable_path: string;
  };
}

export interface WorkflowInput extends PortDefinition {
  node_id: string;
  node_port: string;
}

export interface WorkflowOutput {
  name: string;
  label: string;
  type: ValueType;
  node_id: string;
  node_port: string;
}

export interface WorkflowDraft {
  name: string;
  description: string;
  graph: GraphSpec;
  inputs: WorkflowInput[];
  outputs: WorkflowOutput[];
}

export interface WorkflowSpec extends WorkflowDraft {
  id: string;
  version: number;
  digest: string;
  created_at: string;
}

export interface SaveWorkflowResponse {
  workflow: WorkflowSpec;
  definition: NodeDefinition;
}

export interface LoadWorkflowResponse {
  workflow: WorkflowSpec;
  definitions: NodeDefinition[];
}

export interface DeleteWorkflowResponse {
  deleted: {
    id: string;
    name: string;
    versions: number;
    dependents: string[];
    recoverable_path: string;
  };
}
