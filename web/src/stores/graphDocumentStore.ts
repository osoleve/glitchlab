import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { temporal } from "zundo";
import { create, type StateCreator } from "zustand";
import { withControlPorts } from "../controlPorts";
import { downstreamClosure, upstreamClosure } from "../graphTraversal";
import type { ControlPortMode, LoomEdge, LoomNode } from "../types";

type Updater<T> = T | ((current: T) => T);
type GraphDocumentFields = Pick<GraphDocumentState, "nodes" | "edges" | "loomName" | "isDirty">;
type GraphDocumentUpdate = Partial<GraphDocumentFields>;

export interface GraphHistoryState extends GraphDocumentFields {}

export interface GraphDocumentState {
  nodes: LoomNode[];
  edges: LoomEdge[];
  selectedId?: string;
  loomName: string;
  isDirty: boolean;
  setNodes: (nodes: Updater<LoomNode[]>) => void;
  setEdges: (edges: Updater<LoomEdge[]>) => void;
  setSelectedId: (selectedId?: string) => void;
  setLoomName: (loomName: string) => void;
  setIsDirty: (isDirty: boolean) => void;
  markDirty: () => void;
  markSemanticDirty: () => void;
  renameLoom: (loomName: string) => void;
  updateDocument: (
    updater: (document: GraphDocumentFields) => GraphDocumentUpdate,
    semantic?: boolean,
  ) => void;
  applyNodeChanges: (changes: NodeChange<LoomNode>[]) => void;
  applyEdgeChanges: (changes: EdgeChange<LoomEdge>[]) => void;
  connect: (connection: Connection | LoomEdge) => void;
  updateNodeField: (nodeId: string, field: string, value: unknown) => void;
  updateControlPort: (nodeId: string, fieldName: string, mode?: ControlPortMode) => void;
  removeNodes: (nodeIds: string[]) => void;
  removeEdge: (edgeId: string) => void;
  selectNode: (nodeId: string, additive?: boolean) => string | undefined;
  selectNodes: (nodeIds: string[], anchorId?: string) => string | undefined;
  selectAllNodes: () => string | undefined;
  selectRelatedNodes: (
    startIds: string[],
    direction: "upstream" | "downstream",
  ) => string | undefined;
  clearSelection: () => void;
  duplicateNodes: (nodeIds?: string[], createId?: () => string) => string[];
  replaceGraph: (nodes: LoomNode[], edges: LoomEdge[], loomName: string, isDirty: boolean) => void;
}

function resetRunStatuses(nodes: LoomNode[]): LoomNode[] {
  return nodes.map((node) => ({
    ...node,
    data: { ...node.data, runStatus: "idle" as const },
  }));
}

function historyNode(node: LoomNode): LoomNode {
  return {
    ...node,
    measured: undefined,
    selected: false,
    dragging: false,
    resizing: false,
    data: {
      ...node.data,
      runStatus: "idle",
      executionScopeRole: undefined,
      onUpdateField: undefined,
    },
  };
}

function historyEdge(edge: LoomEdge): LoomEdge {
  return {
    ...edge,
    selected: false,
    animated: false,
  };
}

function graphHistoryState(state: GraphDocumentState): GraphHistoryState {
  return {
    nodes: state.nodes.map(historyNode),
    edges: state.edges.map(historyEdge),
    loomName: state.loomName,
    isDirty: state.isDirty,
  };
}

function graphHistoryEqual(left: GraphHistoryState, right: GraphHistoryState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

const graphDocumentState: StateCreator<GraphDocumentState> = (set) => ({
  nodes: [],
  edges: [],
  loomName: "Talkie perturbation pair",
  isDirty: false,
  setNodes: (nodes) =>
    set((state) => ({ nodes: typeof nodes === "function" ? nodes(state.nodes) : nodes })),
  setEdges: (edges) =>
    set((state) => ({ edges: typeof edges === "function" ? edges(state.edges) : edges })),
  setSelectedId: (selectedId) => set({ selectedId }),
  setLoomName: (loomName) => set({ loomName }),
  setIsDirty: (isDirty) => set({ isDirty }),
  markDirty: () => set({ isDirty: true }),
  markSemanticDirty: () =>
    set((state) => ({
      isDirty: true,
      nodes: resetRunStatuses(state.nodes),
    })),
  renameLoom: (loomName) => set({ loomName, isDirty: true }),
  updateDocument: (updater, semantic = true) =>
    set((state) => {
      const update = updater({
        nodes: state.nodes,
        edges: state.edges,
        loomName: state.loomName,
        isDirty: state.isDirty,
      });
      const nodes = update.nodes ?? state.nodes;
      return {
        ...update,
        nodes: semantic ? resetRunStatuses(nodes) : nodes,
        isDirty: update.isDirty ?? true,
      };
    }),
  applyNodeChanges: (changes) =>
    set((state) => {
      const semantic = changes.some((change) => change.type === "add" || change.type === "remove");
      const layout = changes.some(
        (change) =>
          change.type === "position" || (change.type === "dimensions" && Boolean(change.resizing)),
      );
      const nodes = applyNodeChanges(changes, state.nodes);
      return {
        nodes: semantic ? resetRunStatuses(nodes) : nodes,
        isDirty: state.isDirty || semantic || layout,
      };
    }),
  applyEdgeChanges: (changes) =>
    set((state) => {
      const semantic = changes.some((change) => change.type !== "select");
      return {
        edges: applyEdgeChanges(changes, state.edges),
        nodes: semantic ? resetRunStatuses(state.nodes) : state.nodes,
        isDirty: state.isDirty || semantic,
      };
    }),
  connect: (connection) =>
    set((state) => ({
      edges: addEdge(connection, state.edges),
      isDirty: true,
      nodes: resetRunStatuses(state.nodes),
    })),
  updateNodeField: (nodeId, field, value) =>
    set((state) => {
      const nodes = state.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                config: { ...node.data.config, [field]: value },
              },
            }
          : node,
      );
      return {
        isDirty: true,
        nodes: resetRunStatuses(nodes),
      };
    }),
  updateControlPort: (nodeId, fieldName, mode) =>
    set((state) => {
      const selectedNode = state.nodes.find((node) => node.id === nodeId);
      if (!selectedNode || selectedNode.data.controlPorts[fieldName] === mode) return state;
      const previousMode = selectedNode.data.controlPorts[fieldName];
      const handle = `control:${fieldName}`;
      const hadInput = previousMode === "input" || previousMode === "passthrough";
      const hadOutput = previousMode === "output" || previousMode === "passthrough";
      const keepsInput = mode === "input" || mode === "passthrough";
      const keepsOutput = mode === "output" || mode === "passthrough";
      const edges = state.edges.filter(
        (edge) =>
          !(
            (hadOutput && !keepsOutput && edge.source === nodeId && edge.sourceHandle === handle) ||
            (hadInput && !keepsInput && edge.target === nodeId && edge.targetHandle === handle)
          ),
      );
      const nodes = state.nodes.map((node) => {
        if (node.id !== nodeId) return node;
        const controlPorts = { ...node.data.controlPorts };
        if (mode) controlPorts[fieldName] = mode;
        else delete controlPorts[fieldName];
        return {
          ...node,
          data: {
            ...node.data,
            definition: withControlPorts(node.data.definition, controlPorts),
            controlPorts,
            runStatus: "idle" as const,
          },
        };
      });
      return { edges, nodes, isDirty: true };
    }),
  removeNodes: (nodeIds) =>
    set((state) => {
      const ids = new Set(nodeIds);
      return {
        nodes: resetRunStatuses(state.nodes.filter((node) => !ids.has(node.id))),
        edges: state.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)),
        selectedId: undefined,
        isDirty: true,
      };
    }),
  removeEdge: (edgeId) =>
    set((state) => ({
      edges: state.edges.filter((edge) => edge.id !== edgeId),
      isDirty: true,
      nodes: resetRunStatuses(state.nodes),
    })),
  selectNode: (nodeId, additive = false) => {
    let selectedId: string | undefined;
    set((state) => {
      const selectedIds = new Set(
        state.nodes.filter((node) => node.selected).map((node) => node.id),
      );
      if (additive) {
        if (selectedIds.has(nodeId)) selectedIds.delete(nodeId);
        else selectedIds.add(nodeId);
      } else {
        selectedIds.clear();
        selectedIds.add(nodeId);
      }
      selectedId = selectedIds.has(nodeId) ? nodeId : [...selectedIds].at(-1);
      return {
        selectedId,
        nodes: state.nodes.map((node) => ({ ...node, selected: selectedIds.has(node.id) })),
      };
    });
    return selectedId;
  },
  selectNodes: (nodeIds, anchorId) => {
    const selectedIds = new Set(nodeIds);
    const selectedId = anchorId && selectedIds.has(anchorId) ? anchorId : nodeIds.at(-1);
    set((state) => ({
      selectedId,
      nodes: state.nodes.map((node) => ({ ...node, selected: selectedIds.has(node.id) })),
    }));
    return selectedId;
  },
  selectAllNodes: () => {
    let selectedId: string | undefined;
    set((state) => {
      selectedId = state.nodes.at(-1)?.id;
      return {
        selectedId,
        nodes: state.nodes.map((node) => ({ ...node, selected: true })),
      };
    });
    return selectedId;
  },
  selectRelatedNodes: (startIds, direction) => {
    let selectedId: string | undefined;
    set((state) => {
      const nodeIds = state.nodes.map((node) => node.id);
      const selectedIds = new Set(
        direction === "upstream"
          ? upstreamClosure(nodeIds, state.edges, startIds)
          : downstreamClosure(nodeIds, state.edges, startIds),
      );
      selectedId = startIds.at(-1);
      return {
        selectedId,
        nodes: state.nodes.map((node) => ({ ...node, selected: selectedIds.has(node.id) })),
      };
    });
    return selectedId;
  },
  clearSelection: () =>
    set((state) => ({
      selectedId: undefined,
      nodes: state.nodes.map((node) => ({ ...node, selected: false })),
    })),
  duplicateNodes: (nodeIds, createId = () => crypto.randomUUID()) => {
    const duplicatedIds: string[] = [];
    set((state) => {
      const requestedIds = nodeIds ? new Set(nodeIds) : undefined;
      const sourceNodes = requestedIds
        ? state.nodes.filter((node) => requestedIds.has(node.id))
        : state.nodes.filter((node) => node.selected);
      if (sourceNodes.length === 0) return state;

      const sourceIds = new Set(sourceNodes.map((node) => node.id));
      const replacements = new Map(
        sourceNodes.map((node) => [node.id, `${node.data.kind}-${createId().slice(0, 6)}`]),
      );
      const copies = sourceNodes.map((node) => {
        const id = replacements.get(node.id)!;
        duplicatedIds.push(id);
        return {
          ...node,
          id,
          position: { x: node.position.x + 36, y: node.position.y + 36 },
          selected: true,
          data: {
            ...node.data,
            config: structuredClone(node.data.config),
            controlPorts: { ...node.data.controlPorts },
            runStatus: "idle" as const,
          },
        };
      });
      const copiedEdges = state.edges
        .filter((edge) => sourceIds.has(edge.source) && sourceIds.has(edge.target))
        .map((edge) => ({
          ...edge,
          id: createId(),
          source: replacements.get(edge.source)!,
          target: replacements.get(edge.target)!,
          selected: false,
        }));

      return {
        nodes: [
          ...state.nodes.map((node) => ({
            ...node,
            selected: false,
            data: { ...node.data, runStatus: "idle" as const },
          })),
          ...copies,
        ],
        edges: [...state.edges, ...copiedEdges],
        selectedId: duplicatedIds[0],
        isDirty: true,
      };
    });
    return duplicatedIds;
  },
  replaceGraph: (nodes, edges, loomName, isDirty) =>
    set({ nodes, edges, selectedId: undefined, loomName, isDirty }),
});

export const useGraphDocumentStore = create<GraphDocumentState>()(
  temporal<GraphDocumentState, [], [], GraphHistoryState>(graphDocumentState, {
    partialize: graphHistoryState,
    equality: graphHistoryEqual,
    limit: 100,
  }),
);
