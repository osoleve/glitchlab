import type { Edge, Node } from "@xyflow/react";
import type { components } from "./generated/api";

type ApiSchemas = components["schemas"];

export type ValueType = ApiSchemas["PortDefinition"]["type"];
export type PortDefinition = ApiSchemas["PortDefinition"];
export type FieldOption = ApiSchemas["FieldOption"];
export type FieldDefinition = ApiSchemas["FieldDefinition"];
export type ControlPortMode = NonNullable<ApiSchemas["GraphNode"]["control_ports"]>[string];
export type NodeDefinition = ApiSchemas["NodeDefinition"];
export type GlitchlingParameter = ApiSchemas["GlitchlingParameter"];
export type GlitchlingDescriptor = ApiSchemas["GlitchlingDescriptor"];
export type PluginStatus = Omit<ApiSchemas["PluginStatus"], "path"> & {
  path?: string;
};
export type CatalogResponse = Omit<ApiSchemas["CatalogResponse"], "plugin"> & {
  plugin: PluginStatus;
};

export type NodeRunStatus = "idle" | "running" | "completed" | "failed";

export interface LoomNodeData extends Record<string, unknown> {
  kind: string;
  title: string;
  definition: NodeDefinition;
  config: Record<string, unknown>;
  controlPorts: Record<string, ControlPortMode>;
  runStatus: NodeRunStatus;
  executionScopeRole?: "target" | "required" | "unrelated";
  onUpdateField?: (field: string, value: unknown) => void;
}

export type LoomNode = Node<LoomNodeData, "loomNode">;
export type LoomEdge = Edge;

export type FrameColor = "violet" | "teal" | "amber" | "rose" | "slate";
export type EdgeRouting = "smoothstep" | "bezier";

export interface LoomFrameData extends Record<string, unknown> {
  title: string;
  color: FrameColor;
  collapsed: boolean;
  aggregateStatus?: "active" | "completed" | "failed" | "partial" | "target";
  aggregateCompletedCount?: number;
  aggregateTotalCount?: number;
  activeChildTitle?: string;
  onToggleCollapsed?: () => void;
  onUpdate?: (update: Partial<Pick<LoomFrameData, "title" | "color">>) => void;
}

export type LoomFrame = Node<LoomFrameData, "loomFrame">;
export type CanvasNode = LoomFrame | LoomNode;

export interface GraphFrameSpec {
  id: string;
  title: string;
  color: FrameColor;
  position: { x: number; y: number };
  width: number;
  height: number;
  collapsed: boolean;
  node_ids: string[];
}

export interface GraphPresentation {
  edge_routing: EdgeRouting;
  frames: GraphFrameSpec[];
}

export type NodeRunResult = Omit<ApiSchemas["NodeRunResult"], "outputs"> & {
  outputs: NonNullable<ApiSchemas["NodeRunResult"]["outputs"]>;
};

type BackendRunManifest = ApiSchemas["RunManifest"];
type BackendRunScope = ApiSchemas["RunManifestScope"];
type RunManifest = Omit<BackendRunManifest, "scope" | "graph" | "python_version" | "workspace"> & {
  scope: Omit<BackendRunScope, "target_node_ids" | "executed_node_ids"> & {
    target_node_ids: string[];
    executed_node_ids: string[];
  };
};

export type RunResponse = Omit<ApiSchemas["RunResponse"], "manifest" | "nodes"> & {
  manifest: RunManifest;
  nodes: NodeRunResult[];
  client?: {
    execution_fingerprint: string;
    stale: boolean;
  };
};

export type RunScope = Omit<ApiSchemas["RunScope"], "target_node_ids"> & {
  target_node_ids: string[];
};

export type RunErrorDetail = Omit<ApiSchemas["RunErrorDetail"], "node_id" | "nodes"> & {
  node_id?: string;
  nodes?: NodeRunResult[];
};

type GeneratedGraphNode = ApiSchemas["GraphNode"];
export type GraphNodeSpec = Omit<GeneratedGraphNode, "config" | "control_ports" | "position"> & {
  config: NonNullable<GeneratedGraphNode["config"]>;
  control_ports: NonNullable<GeneratedGraphNode["control_ports"]>;
  position: NonNullable<GeneratedGraphNode["position"]>;
};
export type GraphEdgeSpec = ApiSchemas["GraphEdge"];
export type GraphSpec = Omit<ApiSchemas["GraphSpec"], "nodes" | "presentation"> & {
  nodes: GraphNodeSpec[];
  presentation?: GraphPresentation;
};
export type LoomDraft = Omit<ApiSchemas["LoomDraft"], "graph"> & {
  graph: GraphSpec;
};
export type LoomSpec = Omit<ApiSchemas["LoomSpec"], "graph"> & {
  graph: GraphSpec;
};
export type LoomSummary = ApiSchemas["LoomSummary"];
export type LoomTemplateSummary = ApiSchemas["LoomTemplateSummary"];
export type LoadLoomResponse = Omit<ApiSchemas["LoadLoomResponse"], "loom"> & {
  loom: LoomSpec;
};
export type LoadLoomTemplateResponse = Omit<ApiSchemas["LoadLoomTemplateResponse"], "template"> & {
  template: Omit<ApiSchemas["LoomTemplate"], "graph"> & {
    graph: GraphSpec;
  };
};
export type DeleteLoomResponse = ApiSchemas["DeleteLoomResponse"];
export type WorkflowInput = ApiSchemas["WorkflowInput"];
export type WorkflowOutput = ApiSchemas["WorkflowOutput"];
type GeneratedWorkflowDraft = ApiSchemas["WorkflowDraft"];
export type WorkflowDraft = Omit<GeneratedWorkflowDraft, "graph" | "inputs" | "outputs"> & {
  graph: GraphSpec;
  inputs: WorkflowInput[];
  outputs: WorkflowOutput[];
};
export type WorkflowSpec = Omit<ApiSchemas["WorkflowSpec"], "graph" | "inputs" | "outputs"> &
  WorkflowDraft;
export type SaveWorkflowResponse = Omit<ApiSchemas["SaveWorkflowResponse"], "workflow"> & {
  workflow: WorkflowSpec;
};
export type LoadWorkflowResponse = Omit<ApiSchemas["LoadWorkflowResponse"], "workflow"> & {
  workflow: WorkflowSpec;
};
export type DeleteWorkflowResponse = ApiSchemas["DeleteWorkflowResponse"];
