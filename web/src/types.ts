import type { Edge, Node } from "@xyflow/react";
import type { components } from "./generated/api";

type ApiSchemas = components["schemas"];

export type ValueType = ApiSchemas["PortDefinition"]["type"];
export type PortDefinition = ApiSchemas["PortDefinition"];
export type FieldOption = ApiSchemas["FieldOption"];
export type FieldDefinition = ApiSchemas["FieldDefinition"];
export type ControlPortMode = NonNullable<ApiSchemas["GraphNode"]["control_ports"]>[string];
export type NodeDefinition = ApiSchemas["NodeDefinition"];
export type LoomRunReference = ApiSchemas["LoomRunReference"];
export type LoomEntry = ApiSchemas["LoomEntry"];
export type LoomState = ApiSchemas["LoomState"];
export type GlitchlingParameter = ApiSchemas["GlitchlingParameter"];
export type GlitchlingDescriptor = ApiSchemas["GlitchlingDescriptor"];
export type PluginStatus = Omit<ApiSchemas["PluginStatus"], "path"> & {
  path?: string;
};
export type CatalogResponse = Omit<ApiSchemas["CatalogResponse"], "plugin"> & {
  plugin: PluginStatus;
};

export type NodeRunStatus = "idle" | "running" | "completed" | "failed";

export interface WorkflowNodeData extends Record<string, unknown> {
  kind: string;
  title: string;
  definition: NodeDefinition;
  config: Record<string, unknown>;
  controlPorts: Record<string, ControlPortMode>;
  state?: LoomState;
  runStatus: NodeRunStatus;
  canvasPreviewVisible?: boolean;
  canvasPreviewValue?: unknown;
  canvasPreviewLabels?: string[];
  canvasPreviewStale?: boolean;
  executionScopeRole?: "target" | "required" | "unrelated";
  wireHover?: { direction: "input" | "output"; portName: string };
  onUpdateField?: (field: string, value: unknown) => void;
  onUpdateState?: (state: LoomState) => void;
  onOpenEditor?: () => void;
  onToggleCanvasPreview?: () => void;
}

export type WorkflowNode = Node<WorkflowNodeData, "workflowNode">;
export type FrameColor = "violet" | "teal" | "amber" | "rose" | "slate";
export type NoteColor = FrameColor;
export type EdgeRouting = "smoothstep" | "bezier";
export type FlowPosition = { x: number; y: number };
export type SelectionKind = "node" | "wire" | "bundle";
export type WireColor = "slate" | "amber" | "cyan" | "teal" | "violet" | "coral" | "blue" | "rose";

export interface WirePresentation {
  edgeId: string;
  color?: WireColor;
}

export interface WireBundle {
  id: string;
  edgeIds: string[];
  ties: [FlowPosition, FlowPosition];
}

export interface WireBundleMembership {
  bundle: WireBundle;
  edgeIndex: number;
  edgeCount: number;
  ownsHandles: boolean;
}

export interface WireEdgeData extends Record<string, unknown> {
  valueType?: ValueType;
  wireColor?: WireColor;
  wireColorValue?: string;
  routing?: EdgeRouting;
  bundles?: WireBundleMembership[];
  presentationProxy?: boolean;
  semanticEdgeIds?: string[];
}

export type WorkflowEdge = Edge<WireEdgeData>;

export interface WorkflowFrameData extends Record<string, unknown> {
  title: string;
  color: FrameColor;
  collapsed: boolean;
  aggregateStatus?: "active" | "completed" | "failed" | "partial" | "target";
  aggregateCompletedCount?: number;
  aggregateTotalCount?: number;
  activeChildTitle?: string;
  onToggleCollapsed?: () => void;
  onUpdate?: (update: Partial<Pick<WorkflowFrameData, "title" | "color">>) => void;
}

export type WorkflowFrame = Node<WorkflowFrameData, "workflowFrame">;

export interface WorkflowNoteData extends Record<string, unknown> {
  text: string;
  color: NoteColor;
  onUpdate?: (update: Partial<Pick<WorkflowNoteData, "text" | "color">>) => void;
  onRemove?: () => void;
}

export type WorkflowNote = Node<WorkflowNoteData, "workflowNote">;
export type CanvasNode = WorkflowFrame | WorkflowNode | WorkflowNote;

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
  wires: Array<{ edge_id: string; color?: WireColor | null }>;
  wire_bundles: Array<{
    id: string;
    edge_ids: string[];
    ties: [FlowPosition, FlowPosition];
  }>;
  node_previews: Array<{ node_id: string; visible: boolean }>;
  notes: Array<{
    id: string;
    text: string;
    color: NoteColor;
    position: FlowPosition;
    width: number;
    height: number;
  }>;
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
export type GraphNodeSpec = Omit<
  GeneratedGraphNode,
  "config" | "control_ports" | "position" | "state"
> & {
  config: NonNullable<GeneratedGraphNode["config"]>;
  control_ports: NonNullable<GeneratedGraphNode["control_ports"]>;
  position: NonNullable<GeneratedGraphNode["position"]>;
  state?: LoomState;
};
export type GraphEdgeSpec = ApiSchemas["GraphEdge"];
export type GraphSpec = Omit<ApiSchemas["GraphSpec"], "nodes" | "presentation"> & {
  nodes: GraphNodeSpec[];
  presentation?: GraphPresentation;
};
export type GraphDocumentDraft = Omit<ApiSchemas["GraphDocumentDraft"], "graph"> & {
  graph: GraphSpec;
};
export type GraphDocument = Omit<ApiSchemas["GraphDocument"], "graph"> & {
  graph: GraphSpec;
};
export type GraphDocumentSummary = ApiSchemas["GraphDocumentSummary"];
export type GraphTemplateSummary = ApiSchemas["GraphTemplateSummary"];
export type LoadGraphDocumentResponse = Omit<ApiSchemas["LoadGraphDocumentResponse"], "graph"> & {
  graph: GraphDocument;
};
export type LoadGraphTemplateResponse = Omit<
  ApiSchemas["LoadGraphTemplateResponse"],
  "template"
> & {
  template: Omit<ApiSchemas["GraphTemplate"], "graph"> & {
    graph: GraphSpec;
  };
};
export type DeleteGraphDocumentResponse = ApiSchemas["DeleteGraphDocumentResponse"];
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
