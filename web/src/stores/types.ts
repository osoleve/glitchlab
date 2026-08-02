import type {
  EdgeRouting,
  LoomEdge,
  LoomFrame,
  LoomNode,
  LoomSpec,
  RunResponse,
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
  nodes: LoomNode[];
  edges: LoomEdge[];
  frames?: LoomFrame[];
  edgeRouting?: EdgeRouting;
  run?: RunResponse;
  runError?: string;
  selectedId?: string;
  loomName: string;
  isDirty: boolean;
  executionScope?: ExecutionScopeState;
}

export interface GraphTab {
  id: string;
  type: "loom" | "workflow";
  loom?: LoomSpec;
  sourceTemplateId?: string;
  workflow?: WorkflowSpec;
  snapshot: GraphSnapshot;
}
