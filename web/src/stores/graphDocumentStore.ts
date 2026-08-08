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
  FlowPosition,
  FrameColor,
  LoomState,
  SelectionKind,
  WireBundle,
  WireColor,
  WirePresentation,
  WorkflowEdge,
  WorkflowFrame,
  WorkflowNode,
} from "../types";

type Updater<T> = T | ((current: T) => T);
type GraphDocumentFields = Pick<
  GraphDocumentState,
  "nodes" | "edges" | "frames" | "edgeRouting" | "wires" | "wireBundles" | "graphName" | "isDirty"
>;
type GraphDocumentUpdate = Partial<GraphDocumentFields>;

export interface GraphHistoryState extends GraphDocumentFields {}

export interface GraphDocumentState {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  frames: WorkflowFrame[];
  edgeRouting: EdgeRouting;
  wires: WirePresentation[];
  wireBundles: WireBundle[];
  selectionKind?: SelectionKind;
  selectedId?: string;
  graphName: string;
  isDirty: boolean;
  setNodes: (nodes: Updater<WorkflowNode[]>) => void;
  setEdges: (edges: Updater<WorkflowEdge[]>) => void;
  setFrames: (frames: Updater<WorkflowFrame[]>) => void;
  setEdgeRouting: (edgeRouting: EdgeRouting) => void;
  bundleEdges: (
    edgeIds: string[],
    start: FlowPosition,
    end: FlowPosition,
    createId?: () => string,
  ) => string | undefined;
  addEdgesToBundle: (bundleId: string, edgeIds: string[]) => void;
  moveWireBundleWaypoint: (bundleId: string, waypointIndex: number, position: FlowPosition) => void;
  translateWireBundle: (bundleId: string, delta: FlowPosition) => void;
  unbundleEdges: (edgeIds: string[]) => void;
  setWireColor: (edgeIds: string[], color?: WireColor) => void;
  setSelectedId: (selectedId?: string) => void;
  setGraphName: (graphName: string) => void;
  setIsDirty: (isDirty: boolean) => void;
  markDirty: () => void;
  markSemanticDirty: () => void;
  renameGraph: (graphName: string) => void;
  updateDocument: (
    updater: (document: GraphDocumentFields) => GraphDocumentUpdate,
    semantic?: boolean,
  ) => void;
  applyNodeChanges: (changes: NodeChange<WorkflowNode>[]) => void;
  applyFrameChanges: (changes: NodeChange<WorkflowFrame>[]) => void;
  applyEdgeChanges: (changes: EdgeChange<WorkflowEdge>[]) => void;
  connect: (connection: Connection | WorkflowEdge) => void;
  updateNodeField: (nodeId: string, field: string, value: unknown) => void;
  updateNodeState: (nodeId: string, state: LoomState) => void;
  updateControlPort: (nodeId: string, fieldName: string, mode?: ControlPortMode) => void;
  removeNodes: (nodeIds: string[]) => void;
  removeEdge: (edgeId: string) => void;
  removeEdges: (edgeIds: string[]) => void;
  selectNode: (nodeId: string, additive?: boolean) => string | undefined;
  selectNodes: (nodeIds: string[], anchorId?: string) => string | undefined;
  selectEdges: (edgeIds: string[], additive?: boolean) => void;
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
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    graphName: string,
    isDirty: boolean,
    frames?: WorkflowFrame[],
    edgeRouting?: EdgeRouting,
    wires?: WirePresentation[],
    wireBundles?: WireBundle[],
  ) => void;
}

function reconcileWireBundles(wireBundles: WireBundle[], edges: WorkflowEdge[]): WireBundle[] {
  const edgeIds = new Set(edges.map((edge) => edge.id));
  return wireBundles.flatMap((bundle) => {
    const retainedEdgeIds = bundle.edgeIds.filter((edgeId) => edgeIds.has(edgeId));
    return retainedEdgeIds.length >= 2 ? [{ ...bundle, edgeIds: retainedEdgeIds }] : [];
  });
}

function reconcileWires(wires: WirePresentation[], edges: WorkflowEdge[]): WirePresentation[] {
  const edgeIds = new Set(edges.map((edge) => edge.id));
  return wires.filter((wire) => edgeIds.has(wire.edgeId));
}

function resetRunStatuses(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map((node) => ({
    ...node,
    data: { ...node.data, runStatus: "idle" as const },
  }));
}

function historyNode(node: WorkflowNode): WorkflowNode {
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
      onUpdateState: undefined,
      onOpenEditor: undefined,
    },
  };
}

function historyEdge(edge: WorkflowEdge): WorkflowEdge {
  return {
    ...edge,
    selected: false,
    animated: false,
  };
}

function historyFrame(frame: WorkflowFrame): WorkflowFrame {
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
    wires: state.wires.map((wire) => ({ ...wire })),
    wireBundles: state.wireBundles.map((bundle) => ({
      ...bundle,
      edgeIds: [...bundle.edgeIds],
      waypoints: bundle.waypoints.map((waypoint) => ({ ...waypoint })),
    })),
    graphName: state.graphName,
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
  wires: [],
  wireBundles: [],
  graphName: "Loom workshop",
  isDirty: false,
  setNodes: (nodes) =>
    set((state) => ({ nodes: typeof nodes === "function" ? nodes(state.nodes) : nodes })),
  setEdges: (edges) =>
    set((state) => ({ edges: typeof edges === "function" ? edges(state.edges) : edges })),
  setFrames: (frames) =>
    set((state) => ({ frames: typeof frames === "function" ? frames(state.frames) : frames })),
  setEdgeRouting: (edgeRouting) => set({ edgeRouting, isDirty: true }),
  bundleEdges: (edgeIds, start, end, createId = () => crypto.randomUUID()) => {
    let createdId: string | undefined;
    set((state) => {
      const available = new Set(state.edges.map((edge) => edge.id));
      const uniqueEdgeIds = [...new Set(edgeIds)].filter((edgeId) => available.has(edgeId));
      if (uniqueEdgeIds.length < 2) return state;
      const selectedIds = new Set(uniqueEdgeIds);
      const retainedBundles = state.wireBundles.flatMap((bundle) => {
        const retainedEdgeIds = bundle.edgeIds.filter((edgeId) => !selectedIds.has(edgeId));
        return retainedEdgeIds.length >= 2 ? [{ ...bundle, edgeIds: retainedEdgeIds }] : [];
      });
      createdId = `bundle-${createId().slice(0, 8)}`;
      return {
        edges: state.edges.map((edge) => ({ ...edge, selected: false })),
        wireBundles: [
          ...retainedBundles,
          {
            id: createdId,
            edgeIds: uniqueEdgeIds,
            waypoints: [{ ...start }, { ...end }],
            collapsed: false,
          },
        ],
        selectionKind: undefined,
        isDirty: true,
      };
    });
    return createdId;
  },
  addEdgesToBundle: (bundleId, edgeIds) =>
    set((state) => {
      const available = new Set(state.edges.map((edge) => edge.id));
      const requested = new Set(edgeIds.filter((edgeId) => available.has(edgeId)));
      if (requested.size === 0) return state;
      return {
        wireBundles: state.wireBundles.flatMap((bundle) => {
          if (bundle.id === bundleId) {
            return [{ ...bundle, edgeIds: [...new Set([...bundle.edgeIds, ...requested])] }];
          }
          const retained = bundle.edgeIds.filter((edgeId) => !requested.has(edgeId));
          return retained.length >= 2 ? [{ ...bundle, edgeIds: retained }] : [];
        }),
        isDirty: true,
      };
    }),
  moveWireBundleWaypoint: (bundleId, waypointIndex, position) =>
    set((state) => ({
      wireBundles: state.wireBundles.map((bundle) =>
        bundle.id === bundleId
          ? {
              ...bundle,
              waypoints: bundle.waypoints.map((waypoint, index) =>
                index === waypointIndex ? { ...position } : waypoint,
              ),
            }
          : bundle,
      ),
      isDirty: true,
    })),
  translateWireBundle: (bundleId, delta) =>
    set((state) => ({
      wireBundles: state.wireBundles.map((bundle) =>
        bundle.id === bundleId
          ? {
              ...bundle,
              waypoints: bundle.waypoints.map((waypoint) => ({
                x: waypoint.x + delta.x,
                y: waypoint.y + delta.y,
              })),
            }
          : bundle,
      ),
      isDirty: true,
    })),
  unbundleEdges: (edgeIds) =>
    set((state) => {
      const selectedIds = new Set(edgeIds);
      return {
        wireBundles: state.wireBundles.flatMap((bundle) => {
          const retainedEdgeIds = bundle.edgeIds.filter((edgeId) => !selectedIds.has(edgeId));
          return retainedEdgeIds.length >= 2 ? [{ ...bundle, edgeIds: retainedEdgeIds }] : [];
        }),
        isDirty: true,
      };
    }),
  setWireColor: (edgeIds, color) =>
    set((state) => {
      const selectedIds = new Set(edgeIds);
      const retained = state.wires.filter((wire) => !selectedIds.has(wire.edgeId));
      return {
        wires: color
          ? [...retained, ...[...selectedIds].map((edgeId) => ({ edgeId, color }))]
          : retained,
        isDirty: true,
      };
    }),
  setSelectedId: (selectedId) => set({ selectedId }),
  setGraphName: (graphName) => set({ graphName }),
  setIsDirty: (isDirty) => set({ isDirty }),
  markDirty: () => set({ isDirty: true }),
  markSemanticDirty: () =>
    set((state) => ({
      isDirty: true,
      nodes: resetRunStatuses(state.nodes),
    })),
  renameGraph: (graphName) => set({ graphName, isDirty: true }),
  updateDocument: (updater, semantic = true) =>
    set((state) => {
      const update = updater({
        nodes: state.nodes,
        edges: state.edges,
        frames: state.frames,
        edgeRouting: state.edgeRouting,
        wires: state.wires,
        wireBundles: state.wireBundles,
        graphName: state.graphName,
        isDirty: state.isDirty,
      });
      const nodes = update.nodes ?? state.nodes;
      const edges = update.edges ?? state.edges;
      return {
        ...update,
        wires: reconcileWires(update.wires ?? state.wires, edges),
        wireBundles: reconcileWireBundles(update.wireBundles ?? state.wireBundles, edges),
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
      const hasSelectedNodes = selectedIds.length > 0;
      return {
        nodes: semantic ? resetRunStatuses(nodes) : nodes,
        edges:
          selectionChanged && hasSelectedNodes
            ? state.edges.map((edge) => ({ ...edge, selected: false }))
            : state.edges,
        selectionKind: selectionChanged
          ? hasSelectedNodes
            ? "node"
            : state.selectionKind === "node"
              ? undefined
              : state.selectionKind
          : state.selectionKind,
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
      const edges = applyEdgeChanges(changes, state.edges);
      const selectionChanged = changes.some((change) => change.type === "select");
      const hasSelectedEdges = edges.some((edge) => edge.selected);
      return {
        edges,
        selectionKind: selectionChanged
          ? hasSelectedEdges
            ? "wire"
            : state.selectionKind === "wire"
              ? undefined
              : state.selectionKind
          : state.selectionKind,
        selectedId: selectionChanged && hasSelectedEdges ? undefined : state.selectedId,
        wires: reconcileWires(state.wires, edges),
        wireBundles: reconcileWireBundles(state.wireBundles, edges),
        nodes:
          selectionChanged && hasSelectedEdges
            ? state.nodes.map((node) => ({ ...node, selected: false }))
            : semantic
              ? resetRunStatuses(state.nodes)
              : state.nodes,
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
  updateNodeState: (nodeId, loomState) =>
    set((state) => {
      const nodes = state.nodes.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, state: loomState } } : node,
      );
      return { isDirty: true, nodes: resetRunStatuses(nodes) };
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
      return {
        edges,
        wires: reconcileWires(state.wires, edges),
        wireBundles: reconcileWireBundles(state.wireBundles, edges),
        nodes,
        isDirty: true,
      };
    }),
  removeNodes: (nodeIds) =>
    set((state) => {
      const ids = new Set(nodeIds);
      const edges = state.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target));
      return {
        nodes: resetRunStatuses(state.nodes.filter((node) => !ids.has(node.id))),
        edges,
        wires: reconcileWires(state.wires, edges),
        wireBundles: reconcileWireBundles(state.wireBundles, edges),
        selectedId: undefined,
        selectionKind: undefined,
        isDirty: true,
      };
    }),
  removeEdge: (edgeId) =>
    set((state) => {
      const edges = state.edges.filter((edge) => edge.id !== edgeId);
      return {
        edges,
        wires: reconcileWires(state.wires, edges),
        wireBundles: reconcileWireBundles(state.wireBundles, edges),
        isDirty: true,
        nodes: resetRunStatuses(state.nodes),
      };
    }),
  removeEdges: (edgeIds) =>
    set((state) => {
      const ids = new Set(edgeIds);
      const edges = state.edges.filter((edge) => !ids.has(edge.id));
      if (edges.length === state.edges.length) return state;
      return {
        edges,
        wires: reconcileWires(state.wires, edges),
        wireBundles: reconcileWireBundles(state.wireBundles, edges),
        isDirty: true,
        nodes: resetRunStatuses(state.nodes),
      };
    }),
  selectNode: (nodeId, additive = false) => {
    let selectedId: string | undefined;
    set((state) => {
      const selectedIds = new Set(
        state.selectionKind === "node"
          ? state.nodes.filter((node) => node.selected).map((node) => node.id)
          : [],
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
        selectionKind: selectedIds.size > 0 ? "node" : undefined,
        nodes: state.nodes.map((node) => ({ ...node, selected: selectedIds.has(node.id) })),
        edges: state.edges.map((edge) => ({ ...edge, selected: false })),
      };
    });
    return selectedId;
  },
  selectNodes: (nodeIds, anchorId) => {
    const selectedIds = new Set(nodeIds);
    const selectedId = anchorId && selectedIds.has(anchorId) ? anchorId : nodeIds.at(-1);
    set((state) => ({
      selectedId,
      selectionKind: selectedIds.size > 0 ? "node" : undefined,
      nodes: state.nodes.map((node) => ({ ...node, selected: selectedIds.has(node.id) })),
      edges: state.edges.map((edge) => ({ ...edge, selected: false })),
    }));
    return selectedId;
  },
  selectEdges: (edgeIds, additive = false) =>
    set((state) => {
      const selectedIds = new Set(
        additive && state.selectionKind === "wire"
          ? state.edges.filter((edge) => edge.selected).map((edge) => edge.id)
          : [],
      );
      for (const edgeId of edgeIds) {
        if (additive && selectedIds.has(edgeId)) selectedIds.delete(edgeId);
        else selectedIds.add(edgeId);
      }
      return {
        selectionKind: selectedIds.size > 0 ? "wire" : undefined,
        selectedId: undefined,
        nodes: state.nodes.map((node) => ({ ...node, selected: false })),
        edges: state.edges.map((edge) => ({ ...edge, selected: selectedIds.has(edge.id) })),
      };
    }),
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
        selectionKind: "node",
        nodes: state.nodes.map((node) => ({ ...node, selected: true })),
        edges: state.edges.map((edge) => ({ ...edge, selected: false })),
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
        selectionKind: selectedIds.size > 0 ? "node" : undefined,
        nodes: state.nodes.map((node) => ({ ...node, selected: selectedIds.has(node.id) })),
        edges: state.edges.map((edge) => ({ ...edge, selected: false })),
      };
    });
    return selectedId;
  },
  clearSelection: () =>
    set((state) => ({
      selectionKind: undefined,
      selectedId: undefined,
      nodes: state.nodes.map((node) => ({ ...node, selected: false })),
      edges: state.edges.map((edge) => ({ ...edge, selected: false })),
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
            state: node.data.state ? structuredClone(node.data.state) : undefined,
            runStatus: "idle" as const,
          },
        };
      });
      const edgeReplacements = new Map<string, string>();
      const copiedEdges = state.edges
        .filter((edge) => sourceIds.has(edge.target))
        .map((edge) => {
          const id = createId();
          edgeReplacements.set(edge.id, id);
          return {
            ...edge,
            id,
            source: replacements.get(edge.source) ?? edge.source,
            target: replacements.get(edge.target)!,
            selected: false,
          };
        });
      const copiedWires = state.wires.flatMap((wire) => {
        const edgeId = edgeReplacements.get(wire.edgeId);
        return edgeId ? [{ ...wire, edgeId }] : [];
      });
      const copiedBundleEdges = new Map<string, string[]>();
      for (const bundle of state.wireBundles) {
        const edgeIds = bundle.edgeIds.flatMap((edgeId) => {
          const replacement = edgeReplacements.get(edgeId);
          return replacement ? [replacement] : [];
        });
        if (edgeIds.length > 0) copiedBundleEdges.set(bundle.id, edgeIds);
      }

      return {
        nodes: [
          ...state.nodes.map((node) => ({
            ...node,
            selected: false,
            data: { ...node.data, runStatus: "idle" as const },
          })),
          ...copies,
        ],
        edges: [...state.edges.map((edge) => ({ ...edge, selected: false })), ...copiedEdges],
        wires: [...state.wires, ...copiedWires],
        wireBundles: state.wireBundles.map((bundle) => ({
          ...bundle,
          edgeIds: [...bundle.edgeIds, ...(copiedBundleEdges.get(bundle.id) ?? [])],
        })),
        selectionKind: "node",
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
      const frame: WorkflowFrame = {
        id: createdId,
        type: "workflowFrame",
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
        edges: state.edges.map((edge) => ({ ...edge, selected: false })),
        selectionKind: undefined,
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
          type: "workflowFrame" as const,
          position,
          width: 420,
          height: 260,
          selected: true,
          data: { title: "Workflow section", color: "teal" as const, collapsed: false },
        },
      ],
      nodes: state.nodes.map((node) => ({ ...node, selected: false })),
      edges: state.edges.map((edge) => ({ ...edge, selected: false })),
      selectionKind: undefined,
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
  replaceGraph: (
    nodes,
    edges,
    graphName,
    isDirty,
    frames = [],
    edgeRouting = "smoothstep",
    wires = [],
    wireBundles = [],
  ) =>
    set({
      nodes,
      edges,
      frames,
      edgeRouting,
      wires: reconcileWires(wires, edges),
      wireBundles: reconcileWireBundles(wireBundles, edges),
      selectionKind: nodes.some((node) => node.selected)
        ? "node"
        : edges.some((edge) => edge.selected)
          ? "wire"
          : undefined,
      selectedId: undefined,
      graphName,
      isDirty,
    }),
});

export const useGraphDocumentStore = create<GraphDocumentState>()(
  temporal<GraphDocumentState, [], [], GraphHistoryState>(graphDocumentState, {
    partialize: graphHistoryState,
    equality: graphHistoryEqual,
    limit: 100,
  }),
);
