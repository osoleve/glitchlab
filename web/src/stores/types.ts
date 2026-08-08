import type {
  EdgeRouting,
  GraphDocument,
  RunResponse,
  SelectionKind,
  WireBundle,
  WirePresentation,
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
  wires?: WirePresentation[];
  wireBundles?: WireBundle[];
  run?: RunResponse;
  runError?: string;
  selectedId?: string;
  selectionKind?: SelectionKind;
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
