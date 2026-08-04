import type {
  EdgeRouting,
  GraphDocument,
  RunResponse,
  WorkflowEdge,
  WorkflowFrame,
  WorkflowNode,
  WorkflowSpec,
} from "../types";

export interface ExecutionScopeState {
  mode: "full" | "targets";
  targetNodeIds: string[];
  nodeIds: string[];
  edgeIds: string[];
  status: "running" | "completed" | "failed" | "stale";
}

export interface GraphSnapshot {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  frames?: WorkflowFrame[];
  edgeRouting?: EdgeRouting;
  run?: RunResponse;
  runError?: string;
  selectedId?: string;
  graphName: string;
  isDirty: boolean;
  executionScope?: ExecutionScopeState;
}

export interface GraphTab {
  id: string;
  type: "graph" | "workflow";
  graph?: GraphDocument;
  sourceTemplateId?: string;
  workflow?: WorkflowSpec;
  snapshot: GraphSnapshot;
}
