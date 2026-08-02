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
import type {
  ControlPortMode,
  EdgeRouting,
  FrameColor,
  LoomEdge,
  LoomFrame,
  LoomNode,
} from "../types";

type Updater<T> = T | ((current: T) => T);
type GraphDocumentFields = Pick<
  GraphDocumentState,
  "nodes" | "edges" | "frames" | "edgeRouting" | "loomName" | "isDirty"
>;
type GraphDocumentUpdate = Partial<GraphDocumentFields>;

export interface GraphHistoryState extends GraphDocumentFields {}

export interface GraphDocumentState {
  nodes: LoomNode[];
  edges: LoomEdge[];
  frames: LoomFrame[];
  edgeRouting: EdgeRouting;
  selectedId?: string;
  loomName: string;
  isDirty: boolean;
  setNodes: (nodes: Updater<LoomNode[]>) => void;
  setEdges: (edges: Updater<LoomEdge[]>) => void;
  setFrames: (frames: Updater<LoomFrame[]>) => void;
  setEdgeRouting: (edgeRouting: EdgeRouting) => void;
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
  applyFrameChanges: (changes: NodeChange<LoomFrame>[]) => void;
  applyEdgeChanges: (changes: EdgeChange<LoomEdge>[]) => void;
  connect: (connection: Connection | LoomEdge) => void;
  updateNodeField: (nodeId: string, field: string, value: unknown) => void;
  updateControlPort: (nodeId: string, fieldName: string, mode?: ControlPortMode) => void;
  removeNodes: (nodeIds: string[]) => void;
  removeEdge: (edgeId: string) => void;
  selectNode: (nodeId: string, additive?: boolean) => string | undefined;
  selectNodes: (nodeIds: string[], anchorId?: string) => string | undefined;
  setSelectionAnchor: (preferredId?: string) => string | undefined;
  selectAllNodes: () => string | undefined;
  selectRelatedNodes: (
    startIds: string[],
    direction: "upstream" | "downstream",
  ) => string | undefined;
  clearSelection: () => void;
  duplicateNodes: (nodeIds?: string[], createId?: () => string) => string[];
  groupNodes: (nodeIds: string[], createId?: () => string) => string | undefined;
  addFrame: (position: { x: number; y: number }, createId?: () => string) => string;
  updateFrame: (
    frameId: string,
    update: Partial<{ title: string; color: FrameColor; collapsed: boolean }>,
  ) => void;
  removeFrames: (frameIds: string[]) => void;
  replaceGraph: (
    nodes: LoomNode[],
    edges: LoomEdge[],
    loomName: string,
    isDirty: boolean,
    frames?: LoomFrame[],
    edgeRouting?: EdgeRouting,
  ) => void;
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

function historyFrame(frame: LoomFrame): LoomFrame {
  return {
    ...frame,
    measured: undefined,
    selected: false,
    dragging: false,
    resizing: false,
    data: {
      ...frame.data,
      onToggleCollapsed: undefined,
      onUpdate: undefined,
    },
  };
}

function graphHistoryState(state: GraphDocumentState): GraphHistoryState {
  return {
    nodes: state.nodes.map(historyNode),
    edges: state.edges.map(historyEdge),
    frames: state.frames.map(historyFrame),
    edgeRouting: state.edgeRouting,
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
  frames: [],
  edgeRouting: "smoothstep",
  loomName: "Talkie perturbation pair",
  isDirty: false,
  setNodes: (nodes) =>
    set((state) => ({ nodes: typeof nodes === "function" ? nodes(state.nodes) : nodes })),
  setEdges: (edges) =>
    set((state) => ({ edges: typeof edges === "function" ? edges(state.edges) : edges })),
  setFrames: (frames) =>
    set((state) => ({ frames: typeof frames === "function" ? frames(state.frames) : frames })),
  setEdgeRouting: (edgeRouting) => set({ edgeRouting, isDirty: true }),
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
        frames: state.frames,
        edgeRouting: state.edgeRouting,
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
      const selectionChanged = changes.some((change) => change.type === "select");
      const selectedIds = selectionChanged
        ? nodes.filter((node) => node.selected).map((node) => node.id)
        : [];
      const selectedId = selectionChanged
        ? state.selectedId && selectedIds.includes(state.selectedId)
          ? state.selectedId
          : selectedIds.at(-1)
        : state.selectedId;
      return {
        nodes: semantic ? resetRunStatuses(nodes) : nodes,
        selectedId,
        isDirty: state.isDirty || semantic || layout,
      };
    }),
  applyFrameChanges: (changes) =>
    set((state) => {
      const removedIds = new Set(
        changes.filter((change) => change.type === "remove").map((change) => change.id),
      );
      const removedFrames = new Map(
        state.frames.filter((frame) => removedIds.has(frame.id)).map((frame) => [frame.id, frame]),
      );
      const nodes = state.nodes.map((node) => {
        if (!node.parentId || !removedFrames.has(node.parentId)) return node;
        const parent = removedFrames.get(node.parentId)!;
        return {
          ...node,
          parentId: undefined,
          extent: undefined,
          expandParent: undefined,
          position: {
            x: parent.position.x + node.position.x,
            y: parent.position.y + node.position.y,
          },
        };
      });
      const layout = changes.some(
        (change) =>
          change.type === "position" || change.type === "remove" || change.type === "dimensions",
      );
      return {
        nodes,
        frames: applyNodeChanges(changes, state.frames),
        isDirty: state.isDirty || layout,
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
  setSelectionAnchor: (preferredId) => {
    let selectedId: string | undefined;
    set((state) => {
      const selectedIds = state.nodes.filter((node) => node.selected).map((node) => node.id);
      selectedId =
        preferredId && selectedIds.includes(preferredId)
          ? preferredId
          : state.selectedId && selectedIds.includes(state.selectedId)
            ? state.selectedId
            : selectedIds.at(-1);
      return { selectedId };
    });
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
  groupNodes: (nodeIds, createId = () => crypto.randomUUID()) => {
    let createdId: string | undefined;
    set((state) => {
      const ids = new Set(nodeIds);
      const targets = state.nodes.filter((node) => ids.has(node.id));
      if (targets.length < 2) return state;
      const frameMap = new Map(state.frames.map((frame) => [frame.id, frame]));
      const absolute = targets.map((node) => {
        const parent = node.parentId ? frameMap.get(node.parentId) : undefined;
        return {
          node,
          x: node.position.x + (parent?.position.x ?? 0),
          y: node.position.y + (parent?.position.y ?? 0),
          width: node.measured?.width ?? node.width ?? 236,
          height: node.measured?.height ?? node.height ?? 180,
        };
      });
      const left = Math.min(...absolute.map((item) => item.x));
      const top = Math.min(...absolute.map((item) => item.y));
      const right = Math.max(...absolute.map((item) => item.x + item.width));
      const bottom = Math.max(...absolute.map((item) => item.y + item.height));
      createdId = `frame-${createId().slice(0, 8)}`;
      const framePosition = { x: left - 28, y: top - 62 };
      const frame: LoomFrame = {
        id: createdId,
        type: "loomFrame",
        position: framePosition,
        width: Math.max(320, right - left + 56),
        height: Math.max(190, bottom - top + 90),
        selected: true,
        data: { title: "Workflow section", color: "violet", collapsed: false },
      };
      const positions = new Map(absolute.map((item) => [item.node.id, item]));
      return {
        frames: [...state.frames.map((item) => ({ ...item, selected: false })), frame],
        nodes: state.nodes.map((node) => {
          const item = positions.get(node.id);
          if (!item) return { ...node, selected: false };
          return {
            ...node,
            parentId: createdId,
            extent: "parent" as const,
            expandParent: true,
            selected: false,
            position: { x: item.x - framePosition.x, y: item.y - framePosition.y },
          };
        }),
        selectedId: undefined,
        isDirty: true,
      };
    });
    return createdId;
  },
  addFrame: (position, createId = () => crypto.randomUUID()) => {
    const id = `frame-${createId().slice(0, 8)}`;
    set((state) => ({
      frames: [
        ...state.frames.map((frame) => ({ ...frame, selected: false })),
        {
          id,
          type: "loomFrame" as const,
          position,
          width: 420,
          height: 260,
          selected: true,
          data: { title: "Workflow section", color: "teal" as const, collapsed: false },
        },
      ],
      nodes: state.nodes.map((node) => ({ ...node, selected: false })),
      selectedId: undefined,
      isDirty: true,
    }));
    return id;
  },
  updateFrame: (frameId, update) =>
    set((state) => ({
      frames: state.frames.map((frame) =>
        frame.id === frameId ? { ...frame, data: { ...frame.data, ...update } } : frame,
      ),
      isDirty: true,
    })),
  removeFrames: (frameIds) =>
    set((state) => {
      const ids = new Set(frameIds);
      const removed = new Map(
        state.frames.filter((frame) => ids.has(frame.id)).map((frame) => [frame.id, frame]),
      );
      return {
        frames: state.frames.filter((frame) => !ids.has(frame.id)),
        nodes: state.nodes.map((node) => {
          const parent = node.parentId ? removed.get(node.parentId) : undefined;
          if (!parent) return node;
          return {
            ...node,
            parentId: undefined,
            extent: undefined,
            expandParent: undefined,
            position: {
              x: parent.position.x + node.position.x,
              y: parent.position.y + node.position.y,
            },
          };
        }),
        isDirty: true,
      };
    }),
  replaceGraph: (nodes, edges, loomName, isDirty, frames = [], edgeRouting = "smoothstep") =>
    set({ nodes, edges, frames, edgeRouting, selectedId: undefined, loomName, isDirty }),
});

export const useGraphDocumentStore = create<GraphDocumentState>()(
  temporal<GraphDocumentState, [], [], GraphHistoryState>(graphDocumentState, {
    partialize: graphHistoryState,
    equality: graphHistoryEqual,
    limit: 100,
  }),
);
