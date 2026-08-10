import {
  type Connection,
  type EdgeChange,
  MarkerType,
  type NodeChange,
  useNodesInitialized,
  useReactFlow,
  type Viewport,
} from "@xyflow/react";
import {
  AlertTriangle,
  Copy,
  FilePlus2,
  FolderOpen,
  LoaderCircle,
  Save,
  Trash2,
  X,
} from "lucide-react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./App.module.css";
import {
  ApiError,
  createGraph,
  deleteWorkflow,
  fetchCatalog,
  fetchGraph,
  fetchGraphs,
  fetchGraphTemplate,
  fetchGraphTemplates,
  fetchWorkflow,
  runGraphStreaming,
  saveWorkflow,
  updateGraph,
  updateWorkflow,
} from "./api";
import {
  CanvasContextMenu,
  type ContextMenuState,
  type QuickAddEntry,
} from "./components/CanvasContextMenu";
import { GraphCanvas } from "./components/GraphCanvas";
import { GraphTabs } from "./components/GraphTabs";
import { NodePalette } from "./components/NodePalette";
import { WorkbenchTopBar } from "./components/WorkbenchTopBar";
import {
  WorkflowDefinitionMenu,
  type WorkflowMenuState,
} from "./components/WorkflowDefinitionMenu";
import { isGraphConnectionValid } from "./connectionValidation";
import { frameAggregate } from "./frameActivity";
import { collapseFrameEdges } from "./frameEdges";
import { assertWirePresentationPreserved, hydrateGraph, serializeGraph } from "./graph";
import { tidyGraphLayout } from "./graphLayout";
import {
  downstreamClosure,
  inducedEdgeIds,
  semanticExecutionFingerprint,
  upstreamClosure,
} from "./graphTraversal";
import { Inspector } from "./Inspector";
import { LoomEditor } from "./LoomEditor";
import { createLoomState } from "./loom";
import { moduleClassNames as cx } from "./moduleClassNames";
import { compatibleNodeInputs } from "./nodePicker";
import { createStarterGraph } from "./starter";
import { useGraphDocumentStore } from "./stores/graphDocumentStore";
import {
  clearGraphHistory,
  pauseGraphHistory,
  redoGraphDocument,
  resumeGraphHistory,
  undoGraphDocument,
  useCanRedoGraph,
  useCanUndoGraph,
  withoutGraphHistory,
} from "./stores/graphHistory";
import { useRunControllerStore } from "./stores/runControllerStore";
import type { ExecutionScopeState, GraphSnapshot, GraphTab } from "./stores/types";
import { MAIN_TAB_ID, useWorkspaceStore } from "./stores/workspaceStore";
import type {
  CanvasNode,
  CatalogResponse,
  ControlPortMode,
  GraphDocument,
  GraphDocumentSummary,
  GraphSpec,
  LoomState,
  NodeDefinition,
  PortDefinition,
  RunScope,
  WorkflowDraft,
  WorkflowEdge,
  WorkflowFrame,
  WorkflowNode,
  WorkflowNote,
  WorkflowSpec,
} from "./types";
import { wireAppearance } from "./wireAppearance";
import { inferWorkflowDraft, reviseWorkflowDraft } from "./workflow";

const NODE_DRAG_MIME_TYPE = "application/glitchlab-node";

function workflowBindingKey(
  direction: "input" | "output",
  nodeId: string,
  nodePort: string,
): string {
  return `${direction}\u0000${nodeId}\u0000${nodePort}`;
}

function boundaryRole<T extends string>(
  roles: Record<string, string>,
  key: string,
  current: T | undefined,
): T | undefined {
  if (!(key in roles)) return current;
  return (roles[key] || undefined) as T | undefined;
}

function applyWorkflowBoundaryEdits(
  draft: WorkflowDraft,
  labels: Record<string, string>,
  roles: Record<string, string>,
): WorkflowDraft {
  return {
    ...draft,
    inputs: draft.inputs.map((binding) => ({
      ...binding,
      label:
        labels[workflowBindingKey("input", binding.node_id, binding.node_port)] ?? binding.label,
      fold_role: boundaryRole<"accumulator" | "item">(
        roles,
        workflowBindingKey("input", binding.node_id, binding.node_port),
        binding.fold_role ?? undefined,
      ),
    })),
    outputs: draft.outputs.map((binding) => ({
      ...binding,
      label:
        labels[workflowBindingKey("output", binding.node_id, binding.node_port)] ?? binding.label,
      fold_role: boundaryRole<"step">(
        roles,
        workflowBindingKey("output", binding.node_id, binding.node_port),
        binding.fold_role ?? undefined,
      ),
    })),
  };
}

function defaultConfig(definition: NodeDefinition): Record<string, unknown> {
  return Object.fromEntries(definition.fields.map((field) => [field.name, field.default]));
}

function nodeSize(node: WorkflowNode): { width: number; height: number } {
  return {
    width: node.measured?.width ?? 236,
    height:
      node.measured?.height ??
      102 +
        Math.max(node.data.definition.inputs.length, node.data.definition.outputs.length, 1) * 28,
  };
}

function nearestOpenPosition(
  preferred: { x: number; y: number },
  nodes: WorkflowNode[],
): { x: number; y: number } {
  const stepX = 260;
  const stepY = 220;
  const candidates: Array<{ x: number; y: number; distance: number }> = [];
  for (let row = -5; row <= 5; row += 1) {
    for (let column = -5; column <= 5; column += 1) {
      candidates.push({
        x: preferred.x + column * stepX,
        y: preferred.y + row * stepY,
        distance: column * column + row * row,
      });
    }
  }
  candidates.sort(
    (left, right) =>
      left.distance - right.distance ||
      Math.abs(left.y - preferred.y) - Math.abs(right.y - preferred.y) ||
      left.x - right.x,
  );

  return (
    candidates.find((candidate) =>
      nodes.every((node) => {
        const size = nodeSize(node);
        const margin = 24;
        return (
          candidate.x + 236 + margin <= node.position.x ||
          candidate.x >= node.position.x + size.width + margin ||
          candidate.y + 190 + margin <= node.position.y ||
          candidate.y >= node.position.y + size.height + margin
        );
      }),
    ) ?? preferred
  );
}

function isEditableTarget(target: EventTarget | null): target is HTMLElement {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select, [role='textbox']"))
  );
}

type ResizablePanel = "palette" | "inspector";

const PANEL_LIMITS = {
  palette: { minimum: 184, maximum: 400 },
  inspector: { minimum: 300, maximum: 640 },
} as const;
const MINIMUM_CANVAS_WIDTH = 420;

function clampPanelWidth(panel: ResizablePanel, width: number, otherPanelWidth: number): number {
  const limits = PANEL_LIMITS[panel];
  const maximum = Math.max(
    limits.minimum,
    Math.min(
      limits.maximum,
      window.innerWidth * 0.48,
      window.innerWidth - otherPanelWidth - MINIMUM_CANVAS_WIDTH,
    ),
  );
  return Math.min(maximum, Math.max(limits.minimum, width));
}

function responsivePanelDefault(panel: ResizablePanel): number {
  const compact = window.matchMedia("(max-width: 1400px)").matches;
  if (panel === "palette") return compact ? 214 : 232;
  return compact ? 348 : 380;
}

export function GlitchlabWorkbench() {
  const [catalog, setCatalog] = useState<CatalogResponse>();
  const [catalogError, setCatalogError] = useState<string>();
  const {
    nodes,
    edges,
    frames,
    notes,
    edgeRouting,
    wires,
    wireBundles,
    selectionKind,
    selectedId,
    graphName,
    isDirty,
    setNodes,
    setNotes,
    setEdgeRouting,
    bundleEdges,
    addEdgesToBundle,
    unbundleEdges,
    setWireColor,
    setSelectedId,
    setGraphName,
    setIsDirty,
    renameGraph,
    updateDocument,
    applyNodeChanges,
    applyFrameChanges,
    applyNoteChanges,
    applyEdgeChanges,
    connect: connectGraph,
    updateNodeField: updateGraphNodeField,
    updateNodeState: updateGraphNodeState,
    updateControlPort: updateGraphControlPort,
    removeNodes,
    removeEdge,
    removeEdges,
    duplicateNodes,
    groupNodes,
    addFrame,
    updateFrame,
    removeFrames,
    addNote,
    updateNote,
    duplicateNotes,
    removeNotes,
    selectAllNodes: selectAllGraphNodes,
    selectRelatedNodes,
    replaceGraph,
  } = useGraphDocumentStore();
  const {
    running,
    run,
    runError,
    executionScope,
    runElapsed,
    activity,
    setRun,
    setRunError,
    setExecutionScope,
    setRunElapsed,
    markSemanticEdit,
    beginRun,
    applyRunEvent,
    clearEdgePulse,
    finishRun,
    failRun,
  } = useRunControllerStore();
  const {
    tabs,
    activeTabId,
    paletteOpen,
    inspectorOpen,
    paletteWidth,
    inspectorWidth,
    graphs,
    graphTemplates,
    setTabs,
    setActiveTabId,
    setPaletteOpen,
    setInspectorOpen,
    setGraphs,
    setGraphTemplates,
    setPaletteWidth,
    setInspectorWidth,
  } = useWorkspaceStore();
  const [paletteQuery, setPaletteQuery] = useState("");
  const [needsFit, setNeedsFit] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resizingPanel, setResizingPanel] = useState<ResizablePanel>();
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [quickAddQuery, setQuickAddQuery] = useState("");
  const [quickAddIndex, setQuickAddIndex] = useState(0);
  const [workflowMenu, setWorkflowMenu] = useState<WorkflowMenuState>();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveDialogPurpose, setSaveDialogPurpose] = useState<"selection" | "edit">("selection");
  const [workflowName, setWorkflowName] = useState("");
  const [workflowDescription, setWorkflowDescription] = useState("");
  const [workflowBoundaryLabels, setWorkflowBoundaryLabels] = useState<Record<string, string>>({});
  const [workflowBoundaryRoles, setWorkflowBoundaryRoles] = useState<Record<string, string>>({});
  const [workflowError, setWorkflowError] = useState<string>();
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [workflowNotice, setWorkflowNotice] = useState<string>();
  const [graphLibraryOpen, setGraphLibraryOpen] = useState(false);
  const [graphLibraryError, setGraphLibraryError] = useState<string>();
  const [loadingDocumentId, setLoadingDocumentId] = useState<string>();
  const [graphSaveDialogOpen, setGraphSaveDialogOpen] = useState(false);
  const [graphSaveAs, setGraphSaveAs] = useState(false);
  const [graphSaveName, setGraphSaveName] = useState("");
  const [savingGraph, setSavingGraph] = useState(false);
  const [graphSaveError, setGraphSaveError] = useState<string>();
  const [graphNotice, setGraphNotice] = useState<string>();
  const [afterHours, setAfterHours] = useState(false);
  const [openLoomNodeId, setOpenLoomNodeId] = useState<string>();
  const [loadingWorkflowId, setLoadingWorkflowId] = useState<string>();
  const [deleteDefinition, setDeleteDefinition] = useState<NodeDefinition>();
  const [deletingWorkflow, setDeletingWorkflow] = useState(false);
  const [deleteWorkflowError, setDeleteWorkflowError] = useState<string>();
  const [closeTabId, setCloseTabId] = useState<string>();
  const runStartedAt = useRef(0);
  const nodeDragHistoryPaused = useRef(false);
  const reconnectSuccessful = useRef(false);
  const edgePulseTimers = useRef(new Map<number, number>());
  const hasOpenedGraph = useRef(false);
  const canvasRef = useRef<HTMLElement>(null);
  const paletteRef = useRef<HTMLElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView, getViewport, setViewport } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const canUndo = useCanUndoGraph();
  const canRedo = useCanRedoGraph();
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const activeWorkflow = activeTab.type === "workflow" ? activeTab.workflow : undefined;
  const activeGraph = activeTab.type === "graph" ? activeTab.graph : undefined;
  const loadingGraph = Boolean(loadingWorkflowId || loadingDocumentId);
  const graphBusy = loadingGraph || savingGraph;
  const hasUnsavedTabs =
    isDirty || tabs.some((tab) => tab.id !== activeTabId && tab.snapshot.isDirty);

  const captureSnapshot = useCallback(
    (): GraphSnapshot => ({
      nodes,
      edges,
      frames,
      notes,
      edgeRouting,
      wires,
      wireBundles,
      run,
      runError,
      selectionKind,
      selectedId,
      graphName,
      isDirty,
      executionScope,
    }),
    [
      edgeRouting,
      wires,
      wireBundles,
      edges,
      executionScope,
      frames,
      notes,
      isDirty,
      graphName,
      nodes,
      run,
      runError,
      selectionKind,
      selectedId,
    ],
  );

  const applySnapshot = useCallback(
    (snapshot: GraphSnapshot) => {
      replaceGraph(
        snapshot.nodes,
        snapshot.edges,
        snapshot.graphName,
        snapshot.isDirty,
        snapshot.frames,
        snapshot.edgeRouting,
        snapshot.wires,
        snapshot.wireBundles,
        snapshot.notes,
      );
      setRun(snapshot.run);
      setRunError(snapshot.runError);
      setExecutionScope(snapshot.executionScope);
      setSelectedId(snapshot.selectedId);
      setInspectorOpen(Boolean(snapshot.selectedId));
      setContextMenu(undefined);
      setWorkflowMenu(undefined);
      setNeedsFit(true);
      clearGraphHistory();
    },
    [setExecutionScope, setInspectorOpen, replaceGraph, setRun, setRunError, setSelectedId],
  );

  const switchGraphTab = useCallback(
    (tabId: string) => {
      if (tabId === activeTabId || running || graphBusy) return;
      const target = tabs.find((tab) => tab.id === tabId);
      if (!target) return;
      const currentSnapshot = captureSnapshot();
      setTabs((current) =>
        current.map((tab) =>
          tab.id === activeTabId ? { ...tab, snapshot: currentSnapshot } : tab,
        ),
      );
      setActiveTabId(tabId);
      applySnapshot(target.snapshot);
    },
    [
      activeTabId,
      applySnapshot,
      captureSnapshot,
      graphBusy,
      running,
      setActiveTabId,
      setTabs,
      tabs,
    ],
  );

  useEffect(() => {
    void fetchCatalog()
      .then((response) => {
        setCatalog(response);
        if (hasOpenedGraph.current) return;
        const starter = createStarterGraph(response.nodes);
        replaceGraph(starter.nodes, starter.edges, "Loom workshop", false);
        clearGraphHistory();
        setTabs((current) =>
          current.map((tab) =>
            tab.id === MAIN_TAB_ID
              ? {
                  ...tab,
                  snapshot: {
                    nodes: starter.nodes,
                    edges: starter.edges,
                    graphName: "Loom workshop",
                    isDirty: false,
                  },
                }
              : tab,
          ),
        );
        setNeedsFit(true);
      })
      .catch((error: unknown) => {
        setCatalogError(error instanceof Error ? error.message : String(error));
      });
  }, [replaceGraph, setTabs]);

  useEffect(() => {
    void Promise.all([fetchGraphs(), fetchGraphTemplates()])
      .then(([savedGraphs, templates]) => {
        setGraphs(savedGraphs);
        setGraphTemplates(templates);
      })
      .catch((error: unknown) => {
        setGraphLibraryError(error instanceof Error ? error.message : String(error));
      });
  }, [setGraphs, setGraphTemplates]);

  useEffect(() => {
    if (!hasUnsavedTabs) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedTabs]);

  useEffect(() => {
    if (!needsFit || !nodesInitialized || nodes.length + notes.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      void fitView({
        padding: 0.03,
        minZoom: 0.52,
        maxZoom: 0.95,
        duration: 350,
      });
      setNeedsFit(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitView, needsFit, nodes.length, nodesInitialized, notes.length]);

  // Panel visibility changes intentionally retrigger the fit after CSS transitions.
  // biome-ignore lint/correctness/useExhaustiveDependencies(inspectorOpen): trigger-only dependency
  // biome-ignore lint/correctness/useExhaustiveDependencies(paletteOpen): trigger-only dependency
  useEffect(() => {
    if (!nodesInitialized || nodes.length + notes.length === 0 || needsFit) return;
    const timer = window.setTimeout(() => {
      void fitView({
        padding: 0.03,
        minZoom: 0.52,
        maxZoom: 0.95,
        duration: 260,
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [fitView, inspectorOpen, needsFit, nodes.length, nodesInitialized, notes.length, paletteOpen]);

  useEffect(() => {
    if (!running) return;
    const updateElapsed = () => {
      setRunElapsed(Math.floor((Date.now() - runStartedAt.current) / 1000));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [running, setRunElapsed]);

  const markSemanticDirty = useCallback(() => {
    markSemanticEdit();
  }, [markSemanticEdit]);

  const selectedNode = nodes.find((node) => node.id === selectedId);
  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected), [nodes]);
  const selectedNotes = useMemo(() => notes.filter((note) => note.selected), [notes]);
  const contextualWorkflowDefinition =
    selectedNodes.length <= 1
      ? selectedNode?.data.definition.workflow
        ? selectedNode.data.definition
        : undefined
      : undefined;
  const workflowReferenceCount = useMemo(() => {
    const workflowId = deleteDefinition?.workflow?.id;
    if (!workflowId) return 0;
    return tabs.reduce((total, tab) => {
      const tabNodes = tab.id === activeTabId ? nodes : tab.snapshot.nodes;
      return (
        total + tabNodes.filter((node) => node.data.definition.workflow?.id === workflowId).length
      );
    }, 0);
  }, [activeTabId, deleteDefinition, nodes, tabs]);
  useEffect(() => {
    if (
      selectedId &&
      (!selectedNode || (!selectedNode.selected && selectedNodes.some((node) => node.selected)))
    ) {
      const fallback = selectedNodes.at(-1);
      setSelectedId(fallback?.id);
      if (!fallback) setInspectorOpen(false);
    }
  }, [selectedId, selectedNode, selectedNodes, setInspectorOpen, setSelectedId]);

  useEffect(() => {
    if (!contextMenu && !workflowMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-context-menu]")) {
        return;
      }
      setContextMenu(undefined);
      setWorkflowMenu(undefined);
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [contextMenu, workflowMenu]);

  const groupedCatalog = useMemo(() => {
    const groups = new Map<string, NodeDefinition[]>();
    const query = paletteQuery.trim().toLowerCase();
    for (const definition of catalog?.nodes ?? []) {
      if (
        query &&
        !`${definition.label} ${definition.description} ${definition.category} ${definition.kind}`
          .toLowerCase()
          .includes(query)
      ) {
        continue;
      }
      const entries = groups.get(definition.category) ?? [];
      entries.push(definition);
      groups.set(definition.category, entries);
    }
    return groups;
  }, [catalog, paletteQuery]);
  const pendingConnection =
    contextMenu?.scope === "pane" ? contextMenu.pendingConnection : undefined;
  const quickAddEntries = useMemo(() => {
    const query = quickAddQuery.trim().toLowerCase();
    const entries: QuickAddEntry[] = pendingConnection
      ? compatibleNodeInputs(catalog?.nodes ?? [], pendingConnection.sourceType)
      : (catalog?.nodes ?? []).map((definition) => ({ definition }));
    return entries
      .filter(({ definition, input }) => {
        const searchable =
          `${definition.label} ${definition.description} ${definition.category} ` +
          `${definition.kind} ${input?.label ?? ""} ${input?.type ?? ""}`;
        return !query || searchable.toLowerCase().includes(query);
      })
      .sort((left, right) => {
        const leftStarts = left.definition.label.toLowerCase().startsWith(query);
        const rightStarts = right.definition.label.toLowerCase().startsWith(query);
        if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
        if (pendingConnection) {
          const leftExact =
            left.input?.type === pendingConnection.sourceType && left.input.type !== "any";
          const rightExact =
            right.input?.type === pendingConnection.sourceType && right.input.type !== "any";
          if (leftExact !== rightExact) return leftExact ? -1 : 1;
        }
        return (
          left.definition.label.localeCompare(right.definition.label) ||
          (left.input?.label ?? "").localeCompare(right.input?.label ?? "")
        );
      })
      .slice(0, pendingConnection ? 12 : 9);
  }, [catalog, pendingConnection, quickAddQuery]);

  useEffect(() => {
    setQuickAddIndex((current) => Math.min(current, Math.max(0, quickAddEntries.length - 1)));
  }, [quickAddEntries.length]);

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const frameIds = new Set(frames.map((frame) => frame.id));
      const noteIds = new Set(notes.map((note) => note.id));
      const isFrameChange = (change: NodeChange<CanvasNode>) => {
        if (change.type === "add" || change.type === "replace") {
          return change.item.type === "workflowFrame";
        }
        return frameIds.has(change.id);
      };
      const isNoteChange = (change: NodeChange<CanvasNode>) => {
        if (change.type === "add" || change.type === "replace") {
          return change.item.type === "workflowNote";
        }
        return noteIds.has(change.id);
      };
      const collapsedIds = new Set(
        frames.filter((frame) => frame.data.collapsed).map((frame) => frame.id),
      );
      const frameChanges = changes.filter(
        (change) =>
          isFrameChange(change) && !(change.type === "dimensions" && collapsedIds.has(change.id)),
      ) as NodeChange<WorkflowFrame>[];
      const nodeChanges = changes.filter(
        (change) => !isFrameChange(change) && !isNoteChange(change),
      ) as NodeChange<WorkflowNode>[];
      const noteChanges = changes.filter(isNoteChange) as NodeChange<WorkflowNote>[];
      const semantic = nodeChanges.some(
        (change) => change.type === "add" || change.type === "remove",
      );
      if (semantic) markSemanticDirty();
      if (nodeChanges.length > 0) applyNodeChanges(nodeChanges);
      if (frameChanges.length > 0) applyFrameChanges(frameChanges);
      if (noteChanges.length > 0) applyNoteChanges(noteChanges);
      const dragging = changes.some(
        (change) => change.type === "position" && change.dragging === true,
      );
      const dragEnded = changes.some(
        (change) => change.type === "position" && change.dragging === false,
      );
      if (dragging && !nodeDragHistoryPaused.current) {
        pauseGraphHistory();
        nodeDragHistoryPaused.current = true;
      }
      if (dragEnded && nodeDragHistoryPaused.current) {
        resumeGraphHistory();
        nodeDragHistoryPaused.current = false;
      }
    },
    [applyFrameChanges, applyNodeChanges, applyNoteChanges, frames, markSemanticDirty, notes],
  );
  const finishNodeDragHistory = useCallback(() => {
    if (!nodeDragHistoryPaused.current) return;
    resumeGraphHistory();
    nodeDragHistoryPaused.current = false;
  }, []);
  useEffect(
    () => () => {
      if (nodeDragHistoryPaused.current) resumeGraphHistory();
      for (const timer of edgePulseTimers.current.values()) window.clearTimeout(timer);
      edgePulseTimers.current.clear();
    },
    [],
  );
  useEffect(() => {
    if (activity !== undefined) return;
    for (const timer of edgePulseTimers.current.values()) window.clearTimeout(timer);
    edgePulseTimers.current.clear();
  }, [activity]);
  const onEdgesChange = useCallback(
    (changes: EdgeChange<WorkflowEdge>[]) => {
      const semanticIds = new Set(edges.map((edge) => edge.id));
      const semanticChanges = changes.filter((change) =>
        semanticIds.has(
          change.type === "add" || change.type === "replace" ? change.item.id : change.id,
        ),
      );
      if (semanticChanges.some((change) => change.type !== "select")) {
        markSemanticDirty();
      }
      if (semanticChanges.length > 0) applyEdgeChanges(semanticChanges);
    },
    [applyEdgeChanges, edges, markSemanticDirty],
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      markSemanticDirty();
      connectGraph({
        ...connection,
        id: crypto.randomUUID(),
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      } as WorkflowEdge);
    },
    [connectGraph, markSemanticDirty],
  );
  const isValidConnection = useCallback(
    (connection: Connection | WorkflowEdge) => isGraphConnectionValid(connection, nodes, edges),
    [edges, nodes],
  );
  const onReconnect = useCallback(
    (oldEdge: WorkflowEdge, connection: Connection) => {
      reconnectSuccessful.current = true;
      markSemanticDirty();
      updateDocument(
        ({ edges: current }) => ({
          edges: current.map((edge) =>
            edge.id === oldEdge.id
              ? {
                  ...edge,
                  source: connection.source ?? edge.source,
                  sourceHandle: connection.sourceHandle ?? edge.sourceHandle,
                  target: connection.target ?? edge.target,
                  targetHandle: connection.targetHandle ?? edge.targetHandle,
                }
              : edge,
          ),
        }),
        true,
      );
    },
    [markSemanticDirty, updateDocument],
  );
  const onReconnectEnd = useCallback(
    (
      _event: MouseEvent | TouchEvent,
      edge: WorkflowEdge,
      _handleType: "source" | "target",
      connectionState: { isValid: boolean | null },
    ) => {
      if (!reconnectSuccessful.current && connectionState.isValid !== true) {
        markSemanticDirty();
        removeEdge(edge.id);
      }
      reconnectSuccessful.current = false;
    },
    [markSemanticDirty, removeEdge],
  );

  const addNode = useCallback(
    (
      definition: NodeDefinition,
      position?: { x: number; y: number },
      incoming?: {
        sourceNodeId: string;
        sourceHandle: string;
        targetHandle: string;
      },
    ) => {
      const id = `${definition.kind}-${crypto.randomUUID().slice(0, 6)}`;
      markSemanticDirty();
      updateDocument(({ nodes: current, edges: currentEdges }) => {
        let nextPosition = position;
        if (!nextPosition) {
          const canvasBounds = canvasRef.current?.getBoundingClientRect();
          const screenCenter = canvasBounds
            ? {
                x: canvasBounds.left + canvasBounds.width / 2,
                y: canvasBounds.top + canvasBounds.height / 2,
              }
            : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
          const flowCenter = screenToFlowPosition(screenCenter);
          nextPosition = nearestOpenPosition(
            { x: flowCenter.x - 118, y: flowCenter.y - 95 },
            current,
          );
        }
        return {
          nodes: [
            ...current.map((node) => ({ ...node, selected: false })),
            {
              id,
              type: "workflowNode",
              position: nextPosition,
              data: {
                kind: definition.kind,
                title: definition.label,
                definition,
                config: {
                  ...defaultConfig(definition),
                  ...(definition.workflow ? { workflow_digest: definition.workflow.digest } : {}),
                  ...(definition.workflow_snapshot
                    ? { workflow_snapshot: structuredClone(definition.workflow_snapshot) }
                    : {}),
                },
                controlPorts: {},
                ...(definition.editor === "loom" ? { state: createLoomState() } : {}),
                runStatus: "idle",
              },
              selected: true,
            },
          ],
          edges: incoming
            ? [
                ...currentEdges,
                {
                  id: crypto.randomUUID(),
                  source: incoming.sourceNodeId,
                  sourceHandle: incoming.sourceHandle,
                  target: id,
                  targetHandle: incoming.targetHandle,
                  markerEnd: {
                    type: MarkerType.ArrowClosed,
                    width: 18,
                    height: 18,
                  },
                },
              ]
            : currentEdges,
        };
      }, true);
      setSelectedId(id);
      setInspectorOpen(true);
      return id;
    },
    [markSemanticDirty, screenToFlowPosition, setInspectorOpen, setSelectedId, updateDocument],
  );

  const onPaletteDrag = (event: DragEvent<HTMLButtonElement>, definition: NodeDefinition) => {
    event.dataTransfer.setData(NODE_DRAG_MIME_TYPE, definition.kind);
    event.dataTransfer.effectAllowed = "move";
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData(NODE_DRAG_MIME_TYPE);
    const definition = catalog?.nodes.find((item) => item.kind === kind);
    if (!definition) return;
    addNode(definition, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };

  const updateSelected = (updater: (node: WorkflowNode) => WorkflowNode, semantic = true) => {
    if (!selectedId) return;
    updateDocument(
      ({ nodes: current }) => ({
        nodes: current.map((node) => (node.id === selectedId ? updater(node) : node)),
      }),
      semantic,
    );
    if (semantic) markSemanticDirty();
  };
  const updateNodeField = useCallback(
    (nodeId: string, field: string, value: unknown) => {
      updateGraphNodeField(nodeId, field, value);
      markSemanticDirty();
    },
    [markSemanticDirty, updateGraphNodeField],
  );
  const updateLoomState = useCallback(
    (nodeId: string, state: LoomState) => {
      updateGraphNodeState(nodeId, state);
      markSemanticDirty();
    },
    [markSemanticDirty, updateGraphNodeState],
  );
  const updateControlPort = (fieldName: string, mode?: ControlPortMode) => {
    if (!selectedId || !selectedNode) return;
    const previousMode = selectedNode.data.controlPorts[fieldName];
    if (previousMode === mode) return;
    markSemanticDirty();
    updateGraphControlPort(selectedId, fieldName, mode);
  };
  const deleteSelected = (explicitIds?: string[]) => {
    const ids = new Set(
      explicitIds ??
        (selectedNodes.length > 0
          ? selectedNodes.map((node) => node.id)
          : selectedId
            ? [selectedId]
            : []),
    );
    if (ids.size === 0) return;
    markSemanticDirty();
    removeNodes([...ids]);
    setInspectorOpen(false);
  };
  const duplicateSelected = (explicitIds?: string[]) => {
    const sourceIds =
      explicitIds ??
      (selectedNodes.length > 0
        ? selectedNodes.map((node) => node.id)
        : selectedNode?.id
          ? [selectedNode.id]
          : []);
    if (sourceIds.length === 0) return;
    markSemanticEdit();
    const duplicatedIds = duplicateNodes(sourceIds);
    if (duplicatedIds.length === 0) return;
    setInspectorOpen(true);
    setContextMenu(undefined);
  };

  const selectRelated = (startIds: string[], direction: "upstream" | "downstream") => {
    const anchor = selectRelatedNodes(startIds, direction);
    setInspectorOpen(Boolean(anchor));
    setContextMenu(undefined);
  };

  const arrangeSelection = (
    nodeIds: string[],
    action: "align-left" | "align-top" | "distribute-x" | "distribute-y",
  ) => {
    const selectedSet = new Set(nodeIds);
    const targets = nodes.filter((node) => selectedSet.has(node.id));
    if (targets.length < 2) return;
    if (new Set(targets.map((node) => node.parentId ?? "")).size > 1) {
      setContextMenu(undefined);
      return;
    }
    const positions = new Map<string, { x: number; y: number }>();
    if (action === "align-left") {
      const left = Math.min(...targets.map((node) => node.position.x));
      for (const node of targets) positions.set(node.id, { ...node.position, x: left });
    } else if (action === "align-top") {
      const top = Math.min(...targets.map((node) => node.position.y));
      for (const node of targets) positions.set(node.id, { ...node.position, y: top });
    } else {
      if (targets.length < 3) return;
      const horizontal = action === "distribute-x";
      const ordered = [...targets].sort((left, right) => {
        const leftSize = nodeSize(left);
        const rightSize = nodeSize(right);
        const leftCenter = horizontal
          ? left.position.x + leftSize.width / 2
          : left.position.y + leftSize.height / 2;
        const rightCenter = horizontal
          ? right.position.x + rightSize.width / 2
          : right.position.y + rightSize.height / 2;
        return leftCenter - rightCenter || left.id.localeCompare(right.id);
      });
      const first = ordered[0];
      const last = ordered.at(-1)!;
      const firstSize = nodeSize(first);
      const lastSize = nodeSize(last);
      const firstCenter = horizontal
        ? first.position.x + firstSize.width / 2
        : first.position.y + firstSize.height / 2;
      const lastCenter = horizontal
        ? last.position.x + lastSize.width / 2
        : last.position.y + lastSize.height / 2;
      const step = (lastCenter - firstCenter) / (ordered.length - 1);
      ordered.forEach((node, index) => {
        const size = nodeSize(node);
        const center = firstCenter + step * index;
        positions.set(node.id, {
          x: horizontal ? center - size.width / 2 : node.position.x,
          y: horizontal ? node.position.y : center - size.height / 2,
        });
      });
    }
    updateDocument(
      ({ nodes: current }) => ({
        nodes: current.map((node) => {
          const position = positions.get(node.id);
          return position ? { ...node, position } : node;
        }),
      }),
      false,
    );
    setContextMenu(undefined);
  };

  const tidyNodes = async (nodeIds?: string[]) => {
    const included = nodeIds ? new Set(nodeIds) : undefined;
    const targets = included ? nodes.filter((node) => included.has(node.id)) : nodes;
    setContextMenu(undefined);
    if (
      (included && targets.length < 2) ||
      (!included && targets.length === 0 && frames.length === 0)
    ) {
      return;
    }
    if (included && new Set(targets.map((node) => node.parentId ?? "")).size > 1) {
      return;
    }
    try {
      const layout = await tidyGraphLayout(
        targets.map((node) => ({
          id: node.id,
          position: node.position,
          ...nodeSize(node),
          ...(!included && node.parentId ? { parentId: node.parentId } : {}),
        })),
        edges,
        wireBundles,
        included
          ? []
          : frames.map((frame) => ({
              id: frame.id,
              position: frame.position,
              width: frame.measured?.width ?? frame.width ?? 420,
              height: frame.measured?.height ?? frame.height ?? 260,
              collapsed: frame.data.collapsed,
            })),
      );
      const positions = layout.nodePositions;
      const parentId = included ? targets[0]?.parentId : undefined;
      const parentPosition = parentId
        ? (frames.find((frame) => frame.id === parentId)?.position ?? { x: 0, y: 0 })
        : { x: 0, y: 0 };
      const positionedWireBundles = new Map(
        [...layout.wireBundleWaypoints].map(([bundleId, waypoints]) => [
          bundleId,
          waypoints.map((waypoint) => ({
            x: waypoint.x + parentPosition.x,
            y: waypoint.y + parentPosition.y,
          })),
        ]),
      );
      const changed =
        targets.some((node) => {
          const position = positions.get(node.id);
          return (
            position !== undefined &&
            (Math.abs(position.x - node.position.x) > 0.01 ||
              Math.abs(position.y - node.position.y) > 0.01)
          );
        }) ||
        (!included &&
          frames.some((frame) => {
            const position = layout.framePositions.get(frame.id);
            const size = layout.frameSizes.get(frame.id);
            return Boolean(
              (position &&
                (Math.abs(position.x - frame.position.x) > 0.01 ||
                  Math.abs(position.y - frame.position.y) > 0.01)) ||
                (size &&
                  (Math.abs(size.width - (frame.measured?.width ?? frame.width ?? 420)) > 0.01 ||
                    Math.abs(size.height - (frame.measured?.height ?? frame.height ?? 260)) >
                      0.01)),
            );
          })) ||
        wireBundles.some((wireBundle) => {
          const waypoints = positionedWireBundles.get(wireBundle.id);
          return Boolean(
            waypoints?.some((waypoint, index) => {
              const current = wireBundle.waypoints[index];
              return (
                !current ||
                Math.abs(waypoint.x - current.x) > 0.01 ||
                Math.abs(waypoint.y - current.y) > 0.01
              );
            }),
          );
        });
      if (changed) {
        updateDocument(
          ({ nodes: current, frames: currentFrames, wireBundles: currentWireBundles }) => ({
            nodes: current.map((node) => {
              const position = positions.get(node.id);
              return position ? { ...node, position } : node;
            }),
            frames: currentFrames.map((frame) => {
              const position = layout.framePositions.get(frame.id);
              const size = layout.frameSizes.get(frame.id);
              if (!position && !size) return frame;
              return {
                ...frame,
                ...(position ? { position } : {}),
                ...(size ? { width: size.width, height: size.height, measured: undefined } : {}),
              };
            }),
            wireBundles: currentWireBundles.map((wireBundle) => {
              const waypoints = positionedWireBundles.get(wireBundle.id);
              return waypoints ? { ...wireBundle, waypoints } : wireBundle;
            }),
          }),
          false,
        );
        if (!included) {
          window.setTimeout(() => {
            void fitView({
              padding: 0.08,
              minZoom: 0.25,
              maxZoom: 1,
              duration: 300,
            });
          }, 0);
        }
      }
    } catch (error) {
      setGraphNotice(`Layout failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const insertPassthrough = (edgeId: string, flowPosition: { x: number; y: number }) => {
    const edge = edges.find((candidate) => candidate.id === edgeId);
    const definition = catalog?.nodes.find((candidate) => candidate.kind === "passthrough");
    if (!edge || !definition || !edge.sourceHandle || !edge.targetHandle) return;
    const nodeId = `passthrough-${crypto.randomUUID().slice(0, 6)}`;
    const position = {
      x: flowPosition.x - 118,
      y: flowPosition.y - 72,
    };
    const markerEnd = {
      type: MarkerType.ArrowClosed,
      width: 18,
      height: 18,
    };
    markSemanticDirty();
    updateDocument(
      ({ nodes: currentNodes, edges: currentEdges }) => ({
        nodes: [
          ...currentNodes.map((node) => ({ ...node, selected: false })),
          {
            id: nodeId,
            type: "workflowNode",
            position,
            selected: true,
            data: {
              kind: definition.kind,
              title: definition.label,
              definition,
              config: defaultConfig(definition),
              controlPorts: {},
              runStatus: "idle",
            },
          },
        ],
        edges: currentEdges.flatMap((candidate) =>
          candidate.id === edgeId
            ? [
                {
                  id: crypto.randomUUID(),
                  source: candidate.source,
                  sourceHandle: candidate.sourceHandle,
                  target: nodeId,
                  targetHandle: "value",
                  markerEnd,
                },
                {
                  id: crypto.randomUUID(),
                  source: nodeId,
                  sourceHandle: "value",
                  target: candidate.target,
                  targetHandle: candidate.targetHandle,
                  markerEnd,
                },
              ]
            : [candidate],
        ),
      }),
      true,
    );
    setSelectedId(nodeId);
    setInspectorOpen(true);
    setContextMenu(undefined);
  };

  const openWorkflowEditor = async (definition: NodeDefinition) => {
    const latestDefinition =
      catalog?.nodes.find(
        (item) =>
          item.workflow?.id === definition.workflow?.id &&
          (item.workflow?.version ?? 0) >= (definition.workflow?.version ?? 0),
      ) ?? definition;
    const metadata = latestDefinition.workflow;
    if (!metadata) return;
    const tabId = `workflow:${metadata.id}`;
    const existing = tabs.find((tab) => tab.id === tabId);
    setWorkflowMenu(undefined);
    setContextMenu(undefined);
    if (existing) {
      switchGraphTab(tabId);
      return;
    }

    setLoadingWorkflowId(metadata.id);
    try {
      const embeddedWorkflow =
        latestDefinition.workflow_persisted === false && latestDefinition.workflow_snapshot
          ? (latestDefinition.workflow_snapshot as unknown as WorkflowSpec)
          : undefined;
      const response = embeddedWorkflow
        ? { workflow: embeddedWorkflow, definitions: [] }
        : await fetchWorkflow(metadata.id, metadata.version);
      const hydrated = hydrateGraph(
        response.workflow.graph,
        catalog?.nodes ?? [],
        response.definitions,
      );
      const snapshot: GraphSnapshot = {
        nodes: hydrated.nodes,
        edges: hydrated.edges,
        frames: hydrated.frames,
        edgeRouting: hydrated.edgeRouting,
        wires: hydrated.wires,
        wireBundles: hydrated.wireBundles,
        notes: hydrated.notes,
        graphName: response.workflow.name,
        isDirty: false,
      };
      const currentSnapshot = captureSnapshot();
      setTabs((current) => [
        ...current.map((tab) =>
          tab.id === activeTabId ? { ...tab, snapshot: currentSnapshot } : tab,
        ),
        {
          id: tabId,
          type: "workflow",
          workflow: response.workflow,
          workflowPersisted: !embeddedWorkflow,
          snapshot,
        },
      ]);
      setActiveTabId(tabId);
      applySnapshot(snapshot);
    } catch (error) {
      setWorkflowNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingWorkflowId(undefined);
    }
  };

  const rememberGraph = (graph: GraphDocument) => {
    const summary: GraphDocumentSummary = {
      id: graph.id,
      name: graph.graph.name,
      revision: graph.revision,
      digest: graph.digest,
      created_at: graph.created_at,
      updated_at: graph.updated_at,
      node_count: graph.graph.nodes.length,
    };
    setGraphs((current) =>
      [...current.filter((item) => item.id !== graph.id), summary].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    );
  };

  const openHydratedDraft = (
    graph: GraphSpec,
    exactDefinitions: NodeDefinition[] = [],
    sourceTemplateId?: string,
  ) => {
    hasOpenedGraph.current = true;
    const hydrated = hydrateGraph(graph, catalog?.nodes ?? [], exactDefinitions);
    const snapshot: GraphSnapshot = {
      nodes: hydrated.nodes,
      edges: hydrated.edges,
      frames: hydrated.frames,
      edgeRouting: hydrated.edgeRouting,
      wires: hydrated.wires,
      wireBundles: hydrated.wireBundles,
      notes: hydrated.notes,
      graphName: graph.name,
      isDirty: true,
    };
    const tabId = `draft:${crypto.randomUUID()}`;
    const currentSnapshot = captureSnapshot();
    setTabs((current) => [
      ...current.map((tab) =>
        tab.id === activeTabId ? { ...tab, snapshot: currentSnapshot } : tab,
      ),
      {
        id: tabId,
        type: "graph",
        sourceTemplateId,
        snapshot,
      },
    ]);
    setActiveTabId(tabId);
    applySnapshot(snapshot);
    setGraphLibraryOpen(false);
  };

  const openSavedGraph = async (graphId: string, asCopy = false) => {
    const existing = !asCopy ? tabs.find((tab) => tab.graph?.id === graphId) : undefined;
    if (existing) {
      setGraphLibraryOpen(false);
      switchGraphTab(existing.id);
      return;
    }
    setLoadingDocumentId(`graph:${graphId}:${asCopy ? "copy" : "open"}`);
    setGraphLibraryError(undefined);
    try {
      const response = await fetchGraph(graphId);
      if (asCopy) {
        openHydratedDraft(
          {
            ...response.graph.graph,
            name: `${response.graph.graph.name} copy`,
          },
          response.definitions,
        );
        return;
      }
      const hydrated = hydrateGraph(
        response.graph.graph,
        catalog?.nodes ?? [],
        response.definitions,
      );
      hasOpenedGraph.current = true;
      const snapshot: GraphSnapshot = {
        nodes: hydrated.nodes,
        edges: hydrated.edges,
        frames: hydrated.frames,
        edgeRouting: hydrated.edgeRouting,
        wires: hydrated.wires,
        wireBundles: hydrated.wireBundles,
        notes: hydrated.notes,
        graphName: response.graph.graph.name,
        isDirty: false,
      };
      const tabId = `graph:${response.graph.id}`;
      const currentSnapshot = captureSnapshot();
      setTabs((current) => [
        ...current.map((tab) =>
          tab.id === activeTabId ? { ...tab, snapshot: currentSnapshot } : tab,
        ),
        {
          id: tabId,
          type: "graph",
          graph: response.graph,
          snapshot,
        },
      ]);
      setActiveTabId(tabId);
      applySnapshot(snapshot);
      setGraphLibraryOpen(false);
    } catch (error) {
      setGraphLibraryError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingDocumentId(undefined);
    }
  };

  const openGraphTemplate = async (templateId: string) => {
    setLoadingDocumentId(`template:${templateId}`);
    setGraphLibraryError(undefined);
    try {
      const response = await fetchGraphTemplate(templateId);
      openHydratedDraft(response.template.graph, response.definitions, response.template.id);
    } catch (error) {
      setGraphLibraryError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingDocumentId(undefined);
    }
  };

  const openStarterCopy = () => {
    if (!catalog) return;
    const starter = createStarterGraph(catalog.nodes);
    openHydratedDraft(serializeGraph("Loom workshop", starter.nodes, starter.edges), [], "starter");
  };

  const persistCurrentGraph = async (name: string, options: { createNew: boolean }) => {
    if (activeWorkflow) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setGraphSaveError("Give this graph a name.");
      return;
    }
    setSavingGraph(true);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setContextMenu(undefined);
    setGraphSaveError(undefined);
    try {
      const graph = serializeGraph(
        trimmedName,
        nodes,
        edges,
        frames,
        edgeRouting,
        wires,
        wireBundles,
        notes,
      );
      const saved =
        activeGraph && !options.createNew
          ? await updateGraph(activeGraph.id, activeGraph.revision, graph)
          : await createGraph({ graph });
      assertWirePresentationPreserved(graph, saved.graph);
      const nextSnapshot: GraphSnapshot = {
        ...captureSnapshot(),
        graphName: saved.graph.name,
        isDirty: false,
      };
      const nextTabId = activeTabId === MAIN_TAB_ID ? MAIN_TAB_ID : `graph:${saved.id}`;
      setTabs((current) =>
        current.map((tab) =>
          tab.id === activeTabId
            ? {
                ...tab,
                id: nextTabId,
                graph: saved,
                sourceTemplateId: undefined,
                snapshot: nextSnapshot,
              }
            : tab,
        ),
      );
      if (nextTabId !== activeTabId) setActiveTabId(nextTabId);
      withoutGraphHistory(() => {
        setGraphName(saved.graph.name);
        setIsDirty(false);
      });
      rememberGraph(saved);
      setGraphSaveDialogOpen(false);
      setGraphNotice(`${saved.graph.name} saved at revision ${saved.revision}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (graphSaveDialogOpen) setGraphSaveError(message);
      else setGraphNotice(message);
    } finally {
      setSavingGraph(false);
    }
  };

  const requestSaveGraph = (saveAs = false) => {
    if (activeWorkflow) return;
    if (activeGraph && !saveAs) {
      void persistCurrentGraph(graphName, { createNew: false });
      return;
    }
    setGraphSaveAs(saveAs);
    setGraphSaveName(graphName);
    setGraphSaveError(undefined);
    setGraphSaveDialogOpen(true);
  };

  const performCloseTab = (tabId: string) => {
    const closingIndex = tabs.findIndex((tab) => tab.id === tabId);
    if (closingIndex < 0 || tabId === MAIN_TAB_ID) return;
    const remaining = tabs.filter((tab) => tab.id !== tabId);
    if (activeTabId === tabId) {
      const target =
        remaining[Math.max(0, closingIndex - 1)] ?? remaining.find((tab) => tab.id === MAIN_TAB_ID);
      if (target) {
        setActiveTabId(target.id);
        applySnapshot(target.snapshot);
      }
    }
    setTabs(remaining);
    setCloseTabId(undefined);
  };

  const requestCloseTab = (tab: GraphTab) => {
    const dirty = tab.id === activeTabId ? isDirty : tab.snapshot.isDirty;
    if (dirty) {
      setCloseTabId(tab.id);
      return;
    }
    performCloseTab(tab.id);
  };

  const requestDeleteWorkflow = (definition: NodeDefinition) => {
    if (!definition.workflow || definition.workflow_persisted === false) return;
    const latestDefinition =
      catalog?.nodes.find(
        (item) =>
          item.workflow?.id === definition.workflow?.id &&
          (item.workflow?.version ?? 0) >= definition.workflow!.version,
      ) ?? definition;
    setDeleteDefinition(latestDefinition);
    setDeleteWorkflowError(undefined);
    setWorkflowMenu(undefined);
    setContextMenu(undefined);
  };

  const confirmDeleteWorkflow = async () => {
    const metadata = deleteDefinition?.workflow;
    if (!metadata) return;
    setDeletingWorkflow(true);
    setDeleteWorkflowError(undefined);
    try {
      const response = await deleteWorkflow(metadata.id);
      setCatalog((current) =>
        current
          ? {
              ...current,
              nodes: current.nodes.filter((definition) => definition.workflow?.id !== metadata.id),
            }
          : current,
      );
      const deletedTab = tabs.find((tab) => tab.workflow?.id === metadata.id);
      if (deletedTab) performCloseTab(deletedTab.id);
      setTabs((current) => current.filter((tab) => tab.workflow?.id !== metadata.id));
      setDeleteDefinition(undefined);
      setWorkflowNotice(`${response.deleted.name} moved to ${response.deleted.recoverable_path}.`);
    } catch (error) {
      setDeleteWorkflowError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingWorkflow(false);
    }
  };

  const openSaveWorkflow = () => {
    const count = selectedNodes.length;
    if (count === 0) return;
    setWorkflowName(count === 1 ? `${selectedNodes[0].data.title} workflow` : "New workflow");
    setWorkflowDescription("");
    setWorkflowBoundaryLabels({});
    setWorkflowBoundaryRoles({});
    setWorkflowError(undefined);
    setSaveDialogPurpose("selection");
    setSaveDialogOpen(true);
    setContextMenu(undefined);
  };

  const openEditSaveDialog = () => {
    if (!activeWorkflow) return;
    setWorkflowName(graphName);
    setWorkflowDescription(activeWorkflow.description);
    setWorkflowBoundaryLabels({});
    setWorkflowBoundaryRoles({});
    setWorkflowError(undefined);
    setSaveDialogPurpose("edit");
    setSaveDialogOpen(true);
  };

  const workflowDraft = useMemo<WorkflowDraft | undefined>(() => {
    if (!saveDialogOpen) return undefined;
    try {
      let inferred: WorkflowDraft;
      if (saveDialogPurpose === "edit" && activeWorkflow) {
        inferred = reviseWorkflowDraft(
          workflowName,
          workflowDescription,
          nodes,
          edges,
          activeWorkflow,
          frames,
        );
      } else {
        inferred = inferWorkflowDraft(
          workflowName,
          workflowDescription,
          selectedNodes,
          edges,
          frames,
        );
      }
      return applyWorkflowBoundaryEdits(inferred, workflowBoundaryLabels, workflowBoundaryRoles);
    } catch {
      return undefined;
    }
  }, [
    edges,
    activeWorkflow,
    frames,
    nodes,
    saveDialogOpen,
    saveDialogPurpose,
    selectedNodes,
    workflowBoundaryLabels,
    workflowBoundaryRoles,
    workflowDescription,
    workflowName,
  ]);

  const confirmSaveWorkflow = async () => {
    if (!workflowName.trim()) {
      setWorkflowError("Give this workflow a name.");
      return;
    }
    if (!workflowDraft) {
      setWorkflowError("The selected graph does not have a valid workflow boundary.");
      return;
    }
    const unnamedBinding = [...workflowDraft.inputs, ...workflowDraft.outputs].find(
      (binding) => !binding.label.trim(),
    );
    if (unnamedBinding) {
      setWorkflowError("Every public socket needs a name.");
      return;
    }
    const duplicateInputRole = (["accumulator", "item"] as const).find(
      (role) => workflowDraft.inputs.filter((binding) => binding.fold_role === role).length > 1,
    );
    const stepCount = workflowDraft.outputs.filter(
      (binding) => binding.fold_role === "step",
    ).length;
    if (duplicateInputRole || stepCount > 1) {
      setWorkflowError("A fold role can be assigned to only one public socket.");
      return;
    }
    if (workflowDraft.inputs.some((binding) => binding.fold_role) && stepCount === 0) {
      setWorkflowError("Accumulator or item roles require one output marked Fold step.");
      return;
    }
    const draft: WorkflowDraft = {
      ...workflowDraft,
      inputs: workflowDraft.inputs.map((binding) => ({
        ...binding,
        label: binding.label.trim(),
      })),
      outputs: workflowDraft.outputs.map((binding) => ({
        ...binding,
        label: binding.label.trim(),
      })),
    };
    setSavingWorkflow(true);
    setWorkflowError(undefined);
    try {
      const response =
        saveDialogPurpose === "edit" && activeWorkflow && activeTab.workflowPersisted !== false
          ? await updateWorkflow(activeWorkflow.id, draft)
          : await saveWorkflow(draft);
      setCatalog((current) =>
        current
          ? {
              ...current,
              nodes: [
                ...current.nodes.filter(
                  (definition) => definition.workflow?.id !== response.workflow.id,
                ),
                ...response.definitions,
              ],
            }
          : current,
      );
      if (saveDialogPurpose === "edit") {
        const nextSnapshot: GraphSnapshot = {
          ...captureSnapshot(),
          graphName: response.workflow.name,
          isDirty: false,
        };
        setTabs((current) =>
          current.map((tab) =>
            tab.id === activeTabId
              ? {
                  ...tab,
                  workflow: response.workflow,
                  workflowPersisted: true,
                  snapshot: nextSnapshot,
                }
              : tab,
          ),
        );
        withoutGraphHistory(() => {
          setGraphName(response.workflow.name);
          setIsDirty(false);
        });
      }
      setSaveDialogOpen(false);
      setWorkflowNotice(
        `${response.workflow.name} v${response.workflow.version} saved to the node library.`,
      );
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingWorkflow(false);
    }
  };

  const selectAllNodes = () => {
    const anchor = selectAllGraphNodes();
    setInspectorOpen(Boolean(anchor));
    setContextMenu(undefined);
  };
  const addQuickNode = (definition: NodeDefinition, targetInput?: PortDefinition) => {
    if (contextMenu?.scope !== "pane") return;
    const connection = contextMenu.pendingConnection;
    addNode(
      definition,
      {
        x: contextMenu.flowPosition.x - 118,
        y: contextMenu.flowPosition.y - 72,
      },
      connection && targetInput
        ? {
            sourceNodeId: connection.sourceNodeId,
            sourceHandle: connection.sourceHandle,
            targetHandle: targetInput.name,
          }
        : undefined,
    );
    setContextMenu(undefined);
    setQuickAddQuery("");
    setQuickAddIndex(0);
  };
  const applyStarter = () => {
    if (!catalog) return;
    const starter = createStarterGraph(catalog.nodes);
    const starterName = "Loom workshop";
    markSemanticDirty();
    replaceGraph(starter.nodes, starter.edges, starterName, false);
    setRun(undefined);
    setRunError(undefined);
    setExecutionScope(undefined);
    setInspectorOpen(false);
    setTabs((current) =>
      current.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              graph: undefined,
              sourceTemplateId: "starter",
              snapshot: {
                nodes: starter.nodes,
                edges: starter.edges,
                graphName: starterName,
                isDirty: false,
              },
            }
          : tab,
      ),
    );
    setNeedsFit(true);
  };

  const requestStarterReset = () => {
    if (isDirty || run) {
      setResetDialogOpen(true);
      return;
    }
    applyStarter();
  };

  const confirmStarterReset = () => {
    setResetDialogOpen(false);
    applyStarter();
  };

  const undoDocument = () => {
    if (!undoGraphDocument()) return;
    setInspectorOpen(false);
    setContextMenu(undefined);
    setWorkflowMenu(undefined);
  };

  const redoDocument = () => {
    if (!redoGraphDocument()) return;
    setInspectorOpen(false);
    setContextMenu(undefined);
    setWorkflowMenu(undefined);
  };

  const execute = async (requestedTargetIds: string[] = []) => {
    const graph = serializeGraph(
      graphName,
      nodes,
      edges,
      frames,
      edgeRouting,
      wires,
      wireBundles,
      notes,
    );
    const submittedFingerprint = semanticExecutionFingerprint(graph);
    const targetNodeIds = [
      ...new Set(requestedTargetIds.filter((nodeId) => nodes.some((node) => node.id === nodeId))),
    ];
    const scope: RunScope =
      targetNodeIds.length > 0
        ? { mode: "targets", target_node_ids: targetNodeIds }
        : { mode: "full", target_node_ids: [] };
    const scopedNodeIds =
      scope.mode === "targets"
        ? upstreamClosure(
            nodes.map((node) => node.id),
            edges,
            targetNodeIds,
          )
        : nodes.map((node) => node.id);
    const submittedScope: ExecutionScopeState = {
      mode: scope.mode,
      targetNodeIds,
      nodeIds: scopedNodeIds,
      edgeIds: inducedEdgeIds(edges, scopedNodeIds),
      status: "running",
    };
    const selectedBeforeRun = selectedId;
    let authoritativeScope = submittedScope;
    runStartedAt.current = Date.now();
    for (const timer of edgePulseTimers.current.values()) window.clearTimeout(timer);
    edgePulseTimers.current.clear();
    beginRun(submittedScope, submittedFingerprint);
    setContextMenu(undefined);
    setNodes((current) =>
      current.map((node) => ({ ...node, data: { ...node.data, runStatus: "idle" } })),
    );
    try {
      const response = await runGraphStreaming(graph, scope, (event) => {
        const controller = useRunControllerStore.getState();
        if (controller.activeRun?.semanticRevision !== controller.semanticRevision) return;
        const eventNodeId = "node_id" in event ? event.node_id : undefined;
        const eventNode = eventNodeId ? nodes.find((node) => node.id === eventNodeId) : undefined;
        applyRunEvent(event, eventNode?.data.title);
        if (event.event === "run_planned") {
          authoritativeScope = {
            mode: event.plan.mode,
            targetNodeIds: event.plan.target_node_ids,
            nodeIds: event.plan.node_ids,
            edgeIds: event.plan.edge_ids,
            status: "running",
          };
        } else if (event.event === "node_started") {
          setNodes((current) =>
            current.map((node) => ({
              ...node,
              data: {
                ...node.data,
                runStatus:
                  node.id === event.node_id
                    ? "running"
                    : node.data.runStatus === "running"
                      ? "idle"
                      : node.data.runStatus,
              },
            })),
          );
        } else if (event.event === "node_completed") {
          setNodes((current) =>
            current.map((node) =>
              node.id === event.node_id
                ? { ...node, data: { ...node.data, runStatus: "completed" } }
                : node,
            ),
          );
        } else if (event.event === "node_failed") {
          setNodes((current) =>
            current.map((node) =>
              node.id === event.node_id
                ? { ...node, data: { ...node.data, runStatus: "failed" } }
                : node,
            ),
          );
        } else if (event.event === "edges_transferred") {
          const sequence = event.sequence;
          const runId = event.run_id;
          const timer = window.setTimeout(() => {
            clearEdgePulse(runId, sequence);
            edgePulseTimers.current.delete(sequence);
          }, 600);
          edgePulseTimers.current.set(sequence, timer);
        }
      });
      const completedNodeIds = response.manifest.scope.executed_node_ids;
      const completed = new Set(completedNodeIds);
      const stale = finishRun(
        response,
        {
          mode: response.manifest.scope.mode,
          targetNodeIds: response.manifest.scope.target_node_ids,
          nodeIds: completedNodeIds,
          edgeIds: inducedEdgeIds(edges, completedNodeIds),
          status: "completed",
        },
        submittedFingerprint,
      );
      setNodes((current) =>
        current.map((node) => ({
          ...node,
          data: {
            ...node.data,
            runStatus: !stale && completed.has(node.id) ? "completed" : "idle",
          },
        })),
      );
      if (
        !stale &&
        !selectedBeforeRun &&
        scope.mode === "full" &&
        nodes.some((node) => node.id === "preview")
      ) {
        setSelectedId("preview");
        setInspectorOpen(true);
      }
    } catch (error) {
      const detail =
        error instanceof ApiError
          ? error.detail
          : { message: error instanceof Error ? error.message : String(error) };
      const stale = failRun(detail.message, authoritativeScope, submittedFingerprint);
      setNodes((current) =>
        current.map((node) => ({
          ...node,
          data: {
            ...node.data,
            runStatus: stale
              ? "idle"
              : node.id === detail.node_id
                ? "failed"
                : detail.nodes?.some((result) => result.node_id === node.id)
                  ? "completed"
                  : "idle",
          },
        })),
      );
      if (!stale && detail.node_id) {
        setSelectedId(detail.node_id);
        setInspectorOpen(true);
      }
    }
  };

  const preserveVisibleCanvas = (previousBounds: DOMRect, previousViewport: Viewport) => {
    window.requestAnimationFrame(() => {
      const nextBounds = canvasRef.current?.getBoundingClientRect();
      if (!nextBounds || nextBounds.width >= previousBounds.width - 0.5) return;

      const widthRatio = nextBounds.width / previousBounds.width;
      const nextZoom = Math.max(0.32, previousViewport.zoom * widthRatio);
      const worldCenterX = (previousBounds.width / 2 - previousViewport.x) / previousViewport.zoom;
      const worldCenterY = (previousBounds.height / 2 - previousViewport.y) / previousViewport.zoom;
      void setViewport(
        {
          x: nextBounds.width / 2 - worldCenterX * nextZoom,
          y: nextBounds.height / 2 - worldCenterY * nextZoom,
          zoom: nextZoom,
        },
        { duration: 160 },
      );
    });
  };

  const beginPanelResize = (panel: ResizablePanel, event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const panelElement = panel === "palette" ? paletteRef.current : inspectorRef.current;
    if (!panelElement) return;
    const otherPanelElement = panel === "palette" ? inspectorRef.current : paletteRef.current;

    const startX = event.clientX;
    const startWidth = panelElement.getBoundingClientRect().width;
    const previousCanvasBounds = canvasRef.current?.getBoundingClientRect();
    const previousViewport = getViewport();
    const otherPanelWidth = otherPanelElement?.getBoundingClientRect().width ?? 0;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setResizingPanel(panel);

    const update = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const width = clampPanelWidth(
        panel,
        startWidth + (panel === "palette" ? delta : -delta),
        otherPanelWidth,
      );
      if (panel === "palette") setPaletteWidth(width);
      else setInspectorWidth(width);
    };
    const finish = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setResizingPanel(undefined);
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (previousCanvasBounds) {
        preserveVisibleCanvas(previousCanvasBounds, previousViewport);
      }
    };

    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const resizePanelFromKeyboard = (
    panel: ResizablePanel,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const panelElement = panel === "palette" ? paletteRef.current : inspectorRef.current;
    if (!panelElement) return;
    const previousCanvasBounds = canvasRef.current?.getBoundingClientRect();
    const previousViewport = getViewport();
    const otherPanelElement = panel === "palette" ? inspectorRef.current : paletteRef.current;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const width = clampPanelWidth(
      panel,
      panelElement.getBoundingClientRect().width + direction * (panel === "palette" ? 12 : -12),
      otherPanelElement?.getBoundingClientRect().width ?? 0,
    );
    if (panel === "palette") setPaletteWidth(width);
    else setInspectorWidth(width);
    if (previousCanvasBounds) {
      preserveVisibleCanvas(previousCanvasBounds, previousViewport);
    }
  };

  const resetPanelWidth = (panel: ResizablePanel) => {
    const previousCanvasBounds = canvasRef.current?.getBoundingClientRect();
    const previousViewport = getViewport();
    if (panel === "palette") setPaletteWidth(undefined);
    else setInspectorWidth(undefined);
    if (previousCanvasBounds) {
      preserveVisibleCanvas(previousCanvasBounds, previousViewport);
    }
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const editable = isEditableTarget(event.target);

      if (event.key === "Escape") {
        if (contextMenu || workflowMenu) {
          event.preventDefault();
          setContextMenu(undefined);
          setWorkflowMenu(undefined);
        } else if (graphLibraryOpen) {
          event.preventDefault();
          setGraphLibraryOpen(false);
        } else if (graphSaveDialogOpen && !savingGraph) {
          event.preventDefault();
          setGraphSaveDialogOpen(false);
        } else if (deleteDefinition && !deletingWorkflow) {
          event.preventDefault();
          setDeleteDefinition(undefined);
          setDeleteWorkflowError(undefined);
        } else if (closeTabId) {
          event.preventDefault();
          setCloseTabId(undefined);
        } else if (saveDialogOpen) {
          event.preventDefault();
          setSaveDialogOpen(false);
        } else if (resetDialogOpen) {
          event.preventDefault();
          setResetDialogOpen(false);
        } else if (editable) {
          event.target.blur();
        } else if (selectedId || selectedNotes.length > 0) {
          event.preventDefault();
          setNodes((current) =>
            current.map((node) => (node.selected ? { ...node, selected: false } : node)),
          );
          setNotes((current) =>
            current.map((note) => (note.selected ? { ...note, selected: false } : note)),
          );
          setSelectedId(undefined);
          setInspectorOpen(false);
        }
        return;
      }

      const commandKey = event.ctrlKey || event.metaKey;
      const historyShortcut =
        commandKey &&
        !editable &&
        !running &&
        !graphBusy &&
        !saveDialogOpen &&
        !graphSaveDialogOpen &&
        !resetDialogOpen;
      if (
        historyShortcut &&
        ((event.key.toLowerCase() === "z" && event.shiftKey) ||
          (event.key.toLowerCase() === "y" && !event.shiftKey))
      ) {
        event.preventDefault();
        redoDocument();
        return;
      }
      if (historyShortcut && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undoDocument();
        return;
      }
      if (
        commandKey &&
        event.key.toLowerCase() === "s" &&
        !activeWorkflow &&
        !running &&
        !loadingGraph &&
        !graphLibraryOpen &&
        !saveDialogOpen &&
        !graphSaveDialogOpen &&
        !savingGraph
      ) {
        event.preventDefault();
        requestSaveGraph(event.shiftKey);
        return;
      }
      if (
        commandKey &&
        event.key.toLowerCase() === "a" &&
        !editable &&
        !resetDialogOpen &&
        !saveDialogOpen &&
        !savingGraph
      ) {
        event.preventDefault();
        selectAllNodes();
        return;
      }
      if (
        commandKey &&
        event.key.toLowerCase() === "d" &&
        !editable &&
        !resetDialogOpen &&
        !saveDialogOpen &&
        !savingGraph &&
        (selectedNodes.length > 0 || selectedNotes.length > 0)
      ) {
        event.preventDefault();
        if (selectedNotes.length > 0) {
          duplicateNotes(selectedNotes.map((note) => note.id));
        } else {
          duplicateSelected();
        }
        return;
      }
      if (commandKey && event.key === "Enter" && !running && !savingGraph && nodes.length > 0) {
        event.preventDefault();
        void execute();
        return;
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  const workspaceStyle = {
    "--palette-width": paletteOpen
      ? paletteWidth === undefined
        ? undefined
        : `${paletteWidth}px`
      : "0px",
    "--inspector-width": inspectorOpen
      ? inspectorWidth === undefined
        ? undefined
        : `${inspectorWidth}px`
      : "0px",
  } as CSSProperties;
  const contextSelectionIds =
    contextMenu?.scope === "node" || contextMenu?.scope === "selection" ? contextMenu.nodeIds : [];
  const scopedNodeIdSet = new Set(executionScope?.nodeIds ?? []);
  const targetNodeIdSet = new Set(executionScope?.targetNodeIds ?? []);
  const scopedEdgeIdSet = new Set(executionScope?.edgeIds ?? []);
  const selectedNodeIds = nodes.filter((node) => node.selected).map((node) => node.id);
  const selectedUpstreamIds = upstreamClosure(
    nodes.map((node) => node.id),
    edges,
    selectedNodeIds,
  );
  const selectedDownstreamIds = downstreamClosure(
    nodes.map((node) => node.id),
    edges,
    selectedNodeIds,
  );
  const selectedPathEdgeIdSet = new Set([
    ...inducedEdgeIds(edges, selectedUpstreamIds),
    ...inducedEdgeIds(edges, selectedDownstreamIds),
  ]);
  const showSelectedPaths = executionScope === undefined && selectedNodeIds.length > 0;
  const collapsedFrameIds = new Set(
    frames.filter((frame) => frame.data.collapsed).map((frame) => frame.id),
  );
  const runOutputsByNode = new Map(
    (run?.nodes ?? []).map((result) => [result.node_id, result.outputs] as const),
  );
  for (const [nodeId, outputs] of Object.entries(run?.terminal_outputs ?? {})) {
    if (!runOutputsByNode.has(nodeId)) runOutputsByNode.set(nodeId, outputs);
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const canvasPreviewLabels = (node: WorkflowNode): string[] | undefined => {
    if (node.data.kind === "compare_preview") {
      const labels = edges
        .filter(
          (edge) =>
            edge.target === node.id &&
            (edge.targetHandle === "series" || edge.targetHandle === undefined),
        )
        .map((edge) => nodeById.get(edge.source)?.data.title)
        .filter((label): label is string => Boolean(label));
      return labels.length > 0 ? labels : undefined;
    }
    if (node.data.kind !== "preview") return undefined;
    const sourceEdge = edges.find(
      (edge) =>
        edge.target === node.id &&
        (edge.targetHandle === "value" || edge.targetHandle === undefined),
    );
    const source = sourceEdge ? nodeById.get(sourceEdge.source) : undefined;
    if (source?.data.kind !== "collect") return undefined;
    const labels = edges
      .filter(
        (edge) =>
          edge.target === source.id &&
          (edge.targetHandle === "item" || edge.targetHandle === undefined),
      )
      .map((edge) => nodeById.get(edge.source)?.data.title)
      .filter((label): label is string => Boolean(label));
    return labels.length > 0 ? labels : undefined;
  };
  const flowNodes: CanvasNode[] = [
    ...frames.map((frame) => {
      const children = nodes.filter((node) => node.parentId === frame.id);
      const aggregate = frameAggregate(
        children,
        scopedNodeIdSet,
        targetNodeIdSet,
        activity?.activeNodeId,
      );
      return {
        ...frame,
        height: frame.data.collapsed ? 46 : frame.height,
        style: frame.data.collapsed ? { ...frame.style, height: 46 } : frame.style,
        data: {
          ...frame.data,
          aggregateStatus: aggregate.status,
          aggregateCompletedCount: aggregate.completedCount,
          aggregateTotalCount: aggregate.totalCount,
          activeChildTitle: aggregate.activeChildTitle,
          onToggleCollapsed: () => updateFrame(frame.id, { collapsed: !frame.data.collapsed }),
          onUpdate: (update: Partial<Pick<WorkflowFrame["data"], "title" | "color">>) =>
            updateFrame(frame.id, update),
        },
      };
    }),
    ...nodes.map((node) => ({
      ...node,
      hidden: Boolean(node.parentId && collapsedFrameIds.has(node.parentId)),
      data: {
        ...node.data,
        onUpdateField: (field: string, value: unknown) => updateNodeField(node.id, field, value),
        onUpdateState: (state: LoomState) => updateLoomState(node.id, state),
        onOpenEditor: () => setOpenLoomNodeId(node.id),
        ...((node.data.kind === "preview" || node.data.kind === "compare_preview") && {
          canvasPreviewValue: runOutputsByNode.get(node.id),
          canvasPreviewLabels: canvasPreviewLabels(node),
          canvasPreviewStale: Boolean(run?.client?.stale),
          onToggleCanvasPreview: () =>
            updateDocument(
              (document) => ({
                nodes: document.nodes.map((candidate) =>
                  candidate.id === node.id
                    ? {
                        ...candidate,
                        data: {
                          ...candidate.data,
                          canvasPreviewVisible: candidate.data.canvasPreviewVisible === false,
                        },
                      }
                    : candidate,
                ),
              }),
              false,
            ),
        }),
        executionScopeRole:
          executionScope?.mode !== "targets"
            ? undefined
            : targetNodeIdSet.has(node.id)
              ? ("target" as const)
              : scopedNodeIdSet.has(node.id)
                ? ("required" as const)
                : ("unrelated" as const),
      },
    })),
    ...notes.map((note) => ({
      ...note,
      data: {
        ...note.data,
        onUpdate: (update: Partial<Pick<WorkflowNote["data"], "text" | "color">>) =>
          updateNote(note.id, update),
        onRemove: () => removeNotes([note.id]),
      },
    })),
  ];
  const presentationEdges = collapseFrameEdges(edges, nodes, collapsedFrameIds);
  const flowEdges = presentationEdges.map((edge) => {
    const semanticIds = edge.data?.presentationProxy
      ? ((edge.data.semanticEdgeIds as string[] | undefined) ?? [edge.id])
      : [edge.id];
    const inScope = !executionScope || semanticIds.some((id) => scopedEdgeIdSet.has(id));
    const scopeClassName = executionScope
      ? inScope
        ? styles["execution-scope-edge"]
        : styles["execution-unrelated-edge"]
      : showSelectedPaths
        ? semanticIds.some((id) => selectedPathEdgeIdSet.has(id))
          ? styles["selection-path-edge"]
          : styles["selection-unrelated-edge"]
        : undefined;
    const transferring = activity?.recentEdgeIds.some((id) => semanticIds.includes(id)) ?? false;
    const semanticEdge = edges.find((candidate) => candidate.id === semanticIds[0]) ?? edge;
    const appearance = wireAppearance(semanticEdge, nodes, wires);
    const wireBundle = edge.data?.presentationProxy
      ? undefined
      : wireBundles.find((candidate) => candidate.edgeIds.includes(edge.id));
    const wireIndex = wireBundle?.edgeIds.indexOf(edge.id) ?? -1;
    return {
      ...edge,
      type: "wire",
      reconnectable: !wireBundle,
      data: {
        ...edge.data,
        routing: edgeRouting,
        valueType: appearance.valueType,
        wireColor: appearance.colorName,
        wireColorValue: appearance.color,
        ...(wireBundle
          ? {
              bundle: {
                ...wireBundle,
                edgeIndex: wireIndex,
                edgeCount: wireBundle.edgeIds.length,
                ownsHandles: wireIndex === 0,
              },
            }
          : {}),
      },
      className: [scopeClassName, transferring ? styles["edge-transfer-pulse"] : undefined]
        .filter(Boolean)
        .join(" "),
      animated: transferring,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: appearance.color,
      },
    };
  });
  const fitExecutionScope = () => {
    if (!executionScope) return;
    const fitNodes = nodes.filter((node) => scopedNodeIdSet.has(node.id));
    if (fitNodes.length === 0) return;
    void fitView({
      nodes: fitNodes,
      padding: 0.12,
      minZoom: 0.4,
      maxZoom: 1.1,
      duration: 300,
    });
  };

  return (
    <div className={cx(styles, "app-shell", afterHours && "is-after-hours")}>
      <WorkbenchTopBar
        activeGraph={activeGraph}
        activeTabId={activeTabId}
        activeWorkflow={activeWorkflow}
        afterHours={afterHours}
        catalog={catalog}
        graphBusy={graphBusy}
        isDirty={isDirty}
        graphName={graphName}
        nodeCount={nodes.length}
        running={running}
        savingGraph={savingGraph}
        savingWorkflow={savingWorkflow}
        canRedo={canRedo}
        canUndo={canUndo}
        onRedo={redoDocument}
        onUndo={undoDocument}
        onExecute={() => void execute()}
        onGraphNameChange={renameGraph}
        onOpenEditSaveDialog={openEditSaveDialog}
        onOpenLibrary={() => {
          setGraphLibraryError(undefined);
          setGraphLibraryOpen(true);
        }}
        onRequestSaveGraph={requestSaveGraph}
        onRequestStarterReset={requestStarterReset}
        onToggleAfterHours={() => setAfterHours((current) => !current)}
      />

      <GraphTabs
        activeGraph={activeGraph}
        activeTabId={activeTabId}
        activeWorkflow={activeWorkflow}
        canOpenGraph={Boolean(catalog)}
        graphBusy={graphBusy}
        isDirty={isDirty}
        graphName={graphName}
        running={running}
        tabs={tabs}
        onOpenLibrary={() => setGraphLibraryOpen(true)}
        onRequestCloseTab={requestCloseTab}
        onSwitchTab={switchGraphTab}
      />

      <main
        className={cx(
          styles,
          "workspace",
          !paletteOpen && "palette-closed",
          !inspectorOpen && "inspector-closed",
          resizingPanel && "is-panel-resizing",
        )}
        style={workspaceStyle}
      >
        <NodePalette
          catalog={catalog}
          catalogError={catalogError}
          groupedCatalog={groupedCatalog}
          paletteQuery={paletteQuery}
          paletteRef={paletteRef}
          onAddNode={addNode}
          onClose={() => setPaletteOpen(false)}
          onDragStart={onPaletteDrag}
          onManageWorkflow={(definition, x, y) => setWorkflowMenu({ x, y, definition })}
          onQueryChange={setPaletteQuery}
        />
        {paletteOpen && (
          // This is an interactive drag handle; div preserves pointer sizing and keyboard support.
          // biome-ignore lint/a11y/useSemanticElements: native hr cannot implement this resizer
          <div
            className={cx(styles, "panel-resizer palette-resizer")}
            role="separator"
            aria-label="Resize node library"
            aria-orientation="vertical"
            aria-valuemin={PANEL_LIMITS.palette.minimum}
            aria-valuemax={PANEL_LIMITS.palette.maximum}
            aria-valuenow={Math.round(paletteWidth ?? responsivePanelDefault("palette"))}
            tabIndex={0}
            title="Drag to resize · double-click to reset"
            onPointerDown={(event) => beginPanelResize("palette", event)}
            onKeyDown={(event) => resizePanelFromKeyboard("palette", event)}
            onDoubleClick={() => resetPanelWidth("palette")}
          />
        )}
        <GraphCanvas
          canvasRef={canvasRef}
          edges={flowEdges}
          edgeRouting={edgeRouting}
          wires={wires}
          wireBundles={wireBundles}
          executionScope={executionScope}
          nodes={flowNodes}
          runElapsed={runElapsed}
          runActivity={activity}
          runError={runError}
          running={running}
          savingGraph={savingGraph}
          isValidConnection={isValidConnection}
          onClearExecutionScope={() => setExecutionScope(undefined)}
          onConnect={onConnect}
          onDismissRunError={() => setRunError(undefined)}
          onDrop={onDrop}
          onEdgesChange={onEdgesChange}
          onRemoveEdges={(edgeIds) => {
            markSemanticDirty();
            removeEdges(edgeIds);
          }}
          onBundleEdges={(edgeIds, start, end) => bundleEdges(edgeIds, start, end)}
          onAddEdgesToBundle={addEdgesToBundle}
          onUnbundleEdges={unbundleEdges}
          onSetWireColor={setWireColor}
          onFitExecutionScope={fitExecutionScope}
          onNodeDragStop={finishNodeDragHistory}
          onNodesChange={onNodesChange}
          onOpenContextMenu={setContextMenu}
          onReconnect={onReconnect}
          onReconnectEnd={onReconnectEnd}
          onReconnectStart={() => {
            reconnectSuccessful.current = false;
          }}
          onResetQuickAdd={() => {
            setQuickAddQuery("");
            setQuickAddIndex(0);
          }}
        >
          {contextMenu && (
            <CanvasContextMenu
              contextMenu={contextMenu}
              contextualWorkflowDefinition={contextualWorkflowDefinition}
              contextSelectionIds={contextSelectionIds}
              nodeCount={nodes.length}
              quickAddEntries={quickAddEntries}
              quickAddIndex={quickAddIndex}
              quickAddQuery={quickAddQuery}
              running={running}
              edgeRouting={edgeRouting}
              onAddQuickNode={addQuickNode}
              onAddFrame={(position) => {
                addFrame(position);
                setContextMenu(undefined);
              }}
              onAddNote={(position) => {
                addNote(position);
                setContextMenu(undefined);
              }}
              onArrangeSelection={arrangeSelection}
              onDeleteNodes={deleteSelected}
              onDeleteFrame={(frameId) => {
                removeFrames([frameId]);
                setContextMenu(undefined);
              }}
              onDeleteNote={(noteId) => {
                removeNotes([noteId]);
                setContextMenu(undefined);
              }}
              onDeleteWorkflow={requestDeleteWorkflow}
              onDisconnectEdge={(edgeId) => {
                markSemanticDirty();
                removeEdge(edgeId);
                setContextMenu(undefined);
              }}
              onDismiss={() => setContextMenu(undefined)}
              onDuplicateNodes={duplicateSelected}
              onDuplicateNote={(noteId) => {
                duplicateNotes([noteId]);
                setContextMenu(undefined);
              }}
              onExecute={(nodeIds) => void execute(nodeIds)}
              onFitGraph={() => {
                void fitView({
                  padding: 0.08,
                  minZoom: 0.4,
                  maxZoom: 1,
                  duration: 300,
                });
                setContextMenu(undefined);
              }}
              onGroupNodes={(nodeIds) => {
                groupNodes(nodeIds);
                setInspectorOpen(false);
                setContextMenu(undefined);
              }}
              onInsertPassthrough={insertPassthrough}
              onOpenSaveWorkflow={openSaveWorkflow}
              onOpenWorkflowEditor={(definition) => void openWorkflowEditor(definition)}
              onQuickAddIndexChange={setQuickAddIndex}
              onQuickAddQueryChange={setQuickAddQuery}
              onSelectAllNodes={selectAllNodes}
              onSelectRelated={selectRelated}
              onEdgeRoutingChange={(routing) => {
                setEdgeRouting(routing);
                setContextMenu(undefined);
              }}
              onTidyNodes={tidyNodes}
            />
          )}
        </GraphCanvas>
        <div ref={inspectorRef} className={cx(styles, "inspector-shell")}>
          <Inspector
            selectedNode={selectedNode}
            nodes={nodes}
            edges={edges}
            glitchlings={catalog?.glitchlings ?? []}
            run={run}
            error={runError}
            onUpdateTitle={(title) =>
              updateSelected(
                (node) => ({
                  ...node,
                  data: { ...node.data, title },
                }),
                false,
              )
            }
            onUpdateField={(field, value) =>
              updateSelected((node) => ({
                ...node,
                data: {
                  ...node.data,
                  config: { ...node.data.config, [field]: value },
                  runStatus: "idle",
                },
              }))
            }
            onUpdateControlPort={updateControlPort}
            onOpenNodeEditor={() => {
              if (selectedNode?.data.definition.editor === "loom") {
                setOpenLoomNodeId(selectedNode.id);
              }
            }}
            onDelete={() => deleteSelected()}
            onClose={() => setInspectorOpen(false)}
          />
        </div>
        {inspectorOpen && (
          // This is an interactive drag handle; div preserves pointer sizing and keyboard support.
          // biome-ignore lint/a11y/useSemanticElements: native hr cannot implement this resizer
          <div
            className={cx(styles, "panel-resizer inspector-resizer")}
            role="separator"
            aria-label="Resize inspector"
            aria-orientation="vertical"
            aria-valuemin={PANEL_LIMITS.inspector.minimum}
            aria-valuemax={PANEL_LIMITS.inspector.maximum}
            aria-valuenow={Math.round(inspectorWidth ?? responsivePanelDefault("inspector"))}
            tabIndex={0}
            title="Drag to resize · double-click to reset"
            onPointerDown={(event) => beginPanelResize("inspector", event)}
            onKeyDown={(event) => resizePanelFromKeyboard("inspector", event)}
            onDoubleClick={() => resetPanelWidth("inspector")}
          />
        )}
        {savingGraph && <div className={cx(styles, "edit-lock-overlay")} aria-hidden="true" />}
      </main>
      {workflowMenu && (
        <WorkflowDefinitionMenu
          menu={workflowMenu}
          loadingWorkflowId={loadingWorkflowId}
          onDelete={requestDeleteWorkflow}
          onEdit={(definition) => void openWorkflowEditor(definition)}
        />
      )}
      {graphLibraryOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismissal supplements explicit dialog controls
        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users use the dialog's Close control
        <div
          className={cx(styles, "dialog-backdrop")}
          onClick={() => !loadingDocumentId && setGraphLibraryOpen(false)}
        >
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: prevents inner clicks from dismissing the dialog */}
          <section
            className={cx(styles, "graph-library-dialog")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="graph-library-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={cx(styles, "workflow-dialog-heading")}>
              <span aria-hidden="true">
                <FolderOpen size={18} />
              </span>
              <div>
                <h2 id="graph-library-title">Open a graph</h2>
                <p>
                  Saved graphs reopen as editable documents. Templates and copies always start in a
                  new unsaved tab.
                </p>
              </div>
            </div>
            <div className={cx(styles, "graph-library-scroll")}>
              <section className={cx(styles, "graph-library-section")}>
                <div className={cx(styles, "graph-library-section-heading")}>
                  <strong>Templates</strong>
                  <span>read-only starting points</span>
                </div>
                <div className={cx(styles, "graph-library-list")}>
                  <button
                    type="button"
                    className={cx(styles, "graph-library-item")}
                    onClick={openStarterCopy}
                    disabled={Boolean(loadingDocumentId) || !catalog}
                  >
                    <span>
                      <strong>Loom workshop</strong>
                      <small>Endpoint, model, Loom, and preview · opens as a copy</small>
                    </span>
                    <FilePlus2 size={15} />
                  </button>
                  {graphTemplates.map((template) => (
                    <button
                      type="button"
                      className={cx(styles, "graph-library-item")}
                      key={template.id}
                      onClick={() => void openGraphTemplate(template.id)}
                      disabled={Boolean(loadingDocumentId)}
                    >
                      <span>
                        <strong>{template.name}</strong>
                        <small>
                          {template.node_count} node
                          {template.node_count === 1 ? "" : "s"} · opens as a copy
                        </small>
                      </span>
                      {loadingDocumentId === `template:${template.id}` ? (
                        <LoaderCircle className={cx(styles, "spin-icon")} size={15} />
                      ) : (
                        <FilePlus2 size={15} />
                      )}
                    </button>
                  ))}
                </div>
              </section>
              <section className={cx(styles, "graph-library-section")}>
                <div className={cx(styles, "graph-library-section-heading")}>
                  <strong>Saved graphs</strong>
                  <span>
                    {graphs.length} local document{graphs.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className={cx(styles, "graph-library-list")}>
                  {graphs.map((graph) => (
                    <div
                      className={cx(styles, "graph-library-item saved-graph-item")}
                      key={graph.id}
                    >
                      <button
                        type="button"
                        onClick={() => void openSavedGraph(graph.id)}
                        disabled={Boolean(loadingDocumentId)}
                      >
                        <strong>{graph.name}</strong>
                        <small>
                          r{graph.revision} · {graph.node_count} node
                          {graph.node_count === 1 ? "" : "s"} · updated{" "}
                          {new Date(graph.updated_at).toLocaleString()}
                        </small>
                      </button>
                      <button
                        type="button"
                        className={cx(styles, "graph-copy-button")}
                        onClick={() => void openSavedGraph(graph.id, true)}
                        disabled={Boolean(loadingDocumentId)}
                        title="Open as an unsaved copy"
                        aria-label={`Open ${graph.name} as a copy`}
                      >
                        {loadingDocumentId === `graph:${graph.id}:copy` ? (
                          <LoaderCircle className={cx(styles, "spin-icon")} size={14} />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                      {loadingDocumentId === `graph:${graph.id}:open` && (
                        <LoaderCircle
                          className={cx(styles, "spin-icon graph-open-spinner")}
                          size={14}
                        />
                      )}
                    </div>
                  ))}
                  {graphs.length === 0 && (
                    <p className={cx(styles, "empty-copy")}>
                      No saved graphs yet. Save the current tab to create one.
                    </p>
                  )}
                </div>
              </section>
            </div>
            {graphLibraryError && (
              <p className={cx(styles, "workflow-error")}>{graphLibraryError}</p>
            )}
            <div className={cx(styles, "workflow-dialog-actions")}>
              <button
                type="button"
                className={cx(styles, "secondary-button")}
                onClick={() => setGraphLibraryOpen(false)}
                disabled={Boolean(loadingDocumentId)}
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}
      {graphSaveDialogOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismissal supplements explicit dialog controls
        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users use the dialog's Cancel control
        <div
          className={cx(styles, "dialog-backdrop")}
          onClick={() => !savingGraph && setGraphSaveDialogOpen(false)}
        >
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: prevents inner clicks from dismissing the dialog */}
          <section
            className={cx(styles, "workflow-dialog graph-save-dialog")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="graph-save-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={cx(styles, "workflow-dialog-heading")}>
              <span aria-hidden="true">
                <Save size={18} />
              </span>
              <div>
                <h2 id="graph-save-title">
                  {graphSaveAs || activeGraph ? "Save as a new graph" : "Save graph"}
                </h2>
                <p>
                  {graphSaveAs
                    ? "This creates a separate document; the source graph and workflow definitions stay unchanged."
                    : "This tab will become a saved top-level document. Reusable workflows remain separately versioned."}
                </p>
              </div>
            </div>
            <label>
              <span>Name</span>
              <input
                value={graphSaveName}
                onChange={(event) => setGraphSaveName(event.target.value)}
                autoFocus
                disabled={savingGraph}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && graphSaveName.trim()) {
                    event.preventDefault();
                    void persistCurrentGraph(graphSaveName, { createNew: true });
                  }
                }}
              />
            </label>
            {graphSaveError && <p className={cx(styles, "workflow-error")}>{graphSaveError}</p>}
            <div className={cx(styles, "workflow-dialog-actions")}>
              <button
                type="button"
                className={cx(styles, "secondary-button")}
                onClick={() => setGraphSaveDialogOpen(false)}
                disabled={savingGraph}
              >
                Cancel
              </button>
              <button
                type="button"
                className={cx(styles, "run-button")}
                onClick={() => void persistCurrentGraph(graphSaveName, { createNew: true })}
                disabled={savingGraph || !graphSaveName.trim()}
              >
                {savingGraph ? (
                  <LoaderCircle className={cx(styles, "spin-icon")} size={15} />
                ) : (
                  <Save size={15} />
                )}
                {savingGraph ? "Saving…" : "Save graph"}
              </button>
            </div>
          </section>
        </div>
      )}
      {resetDialogOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismissal supplements explicit dialog controls
        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users use the dialog's Keep working control
        <div className={cx(styles, "dialog-backdrop")} onClick={() => setResetDialogOpen(false)}>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: prevents inner clicks from dismissing the dialog */}
          <section
            className={cx(styles, "reset-dialog")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <span className={cx(styles, "reset-dialog-icon")} aria-hidden="true">
              <AlertTriangle size={18} />
            </span>
            <div>
              <h2 id="reset-dialog-title">Reset to the starter graph?</h2>
              <p>
                Your current nodes, connections, configuration, and run output will be replaced. You
                can undo immediately after resetting.
              </p>
            </div>
            <div className={cx(styles, "reset-dialog-actions")}>
              <button
                type="button"
                className={cx(styles, "secondary-button")}
                onClick={() => setResetDialogOpen(false)}
                autoFocus
              >
                Keep working
              </button>
              <button
                type="button"
                className={cx(styles, "danger-button")}
                onClick={confirmStarterReset}
              >
                Reset graph
              </button>
            </div>
          </section>
        </div>
      )}
      {saveDialogOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismissal supplements explicit dialog controls
        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users use the dialog's Cancel control
        <div
          className={cx(styles, "dialog-backdrop")}
          onClick={() => !savingWorkflow && setSaveDialogOpen(false)}
        >
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: prevents inner clicks from dismissing the dialog */}
          <section
            className={cx(styles, "workflow-dialog")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="workflow-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={cx(styles, "workflow-dialog-heading")}>
              <span aria-hidden="true">
                <Save size={18} />
              </span>
              <div>
                <h2 id="workflow-dialog-title">
                  {saveDialogPurpose === "edit"
                    ? activeTab.workflowPersisted === false
                      ? "Save embedded workflow"
                      : "Save workflow version"
                    : "Save reusable workflow"}
                </h2>
                <p>
                  {saveDialogPurpose === "edit"
                    ? activeTab.workflowPersisted === false
                      ? "This portable snapshot will become a new saved workflow; the template keeps its embedded original."
                      : `Your edits will become v${
                          (activeWorkflow?.version ?? 0) + 1
                        }; existing nodes keep their exact older version.`
                    : "The selected nodes become one versioned node with an inferred typed boundary."}
                </p>
              </div>
            </div>
            <label>
              <span>Name</span>
              <input
                value={workflowName}
                onChange={(event) => setWorkflowName(event.target.value)}
                autoFocus
                disabled={savingWorkflow}
              />
            </label>
            <label>
              <span>Description</span>
              <textarea
                value={workflowDescription}
                onChange={(event) => setWorkflowDescription(event.target.value)}
                placeholder="What this workflow does"
                rows={2}
                disabled={savingWorkflow}
              />
            </label>
            <p className={cx(styles, "workflow-fold-help")}>
              Fold roles are optional. Mark one step output, then optionally expose the current
              accumulator and current item to generate a typed Fold companion node.
            </p>
            <div className={cx(styles, "workflow-boundary")}>
              <div>
                <strong>Inputs</strong>
                {workflowDraft?.inputs.length ? (
                  workflowDraft.inputs.map((input) => (
                    <label className={cx(styles, "workflow-boundary-port")} key={input.name}>
                      <input
                        aria-label={`Public input name for ${input.name}`}
                        value={input.label}
                        onChange={(event) =>
                          setWorkflowBoundaryLabels((current) => ({
                            ...current,
                            [workflowBindingKey("input", input.node_id, input.node_port)]:
                              event.target.value,
                          }))
                        }
                        disabled={savingWorkflow}
                      />
                      <select
                        aria-label={`Fold role for input ${input.name}`}
                        value={input.fold_role ?? ""}
                        onChange={(event) =>
                          setWorkflowBoundaryRoles((current) => ({
                            ...current,
                            [workflowBindingKey("input", input.node_id, input.node_port)]:
                              event.target.value,
                          }))
                        }
                        disabled={savingWorkflow}
                      >
                        <option value="">Fixed input</option>
                        <option value="accumulator">Current accumulator</option>
                        <option value="item">Current item</option>
                      </select>
                      <em>
                        {input.type}
                        {!input.required && " · default"}
                      </em>
                    </label>
                  ))
                ) : (
                  <small>No external inputs</small>
                )}
              </div>
              <div>
                <strong>Outputs</strong>
                {workflowDraft?.outputs.length ? (
                  workflowDraft.outputs.map((output) => (
                    <label className={cx(styles, "workflow-boundary-port")} key={output.name}>
                      <input
                        aria-label={`Public output name for ${output.name}`}
                        value={output.label}
                        onChange={(event) =>
                          setWorkflowBoundaryLabels((current) => ({
                            ...current,
                            [workflowBindingKey("output", output.node_id, output.node_port)]:
                              event.target.value,
                          }))
                        }
                        disabled={savingWorkflow}
                      />
                      <select
                        aria-label={`Fold role for output ${output.name}`}
                        value={output.fold_role ?? ""}
                        onChange={(event) =>
                          setWorkflowBoundaryRoles((current) => ({
                            ...current,
                            [workflowBindingKey("output", output.node_id, output.node_port)]:
                              event.target.value,
                          }))
                        }
                        disabled={savingWorkflow}
                      >
                        <option value="">Ordinary output</option>
                        <option value="step">Fold step</option>
                      </select>
                      <em>{output.type}</em>
                    </label>
                  ))
                ) : (
                  <small>No exposed outputs</small>
                )}
              </div>
            </div>
            {workflowError && <p className={cx(styles, "workflow-error")}>{workflowError}</p>}
            <div className={cx(styles, "workflow-dialog-actions")}>
              <button
                type="button"
                className={cx(styles, "secondary-button")}
                onClick={() => setSaveDialogOpen(false)}
                disabled={savingWorkflow}
              >
                Cancel
              </button>
              <button
                type="button"
                className={cx(styles, "run-button")}
                onClick={() => void confirmSaveWorkflow()}
                disabled={savingWorkflow || !workflowName.trim()}
              >
                {savingWorkflow ? (
                  <LoaderCircle className={cx(styles, "spin-icon")} size={15} />
                ) : (
                  <Save size={15} />
                )}
                {savingWorkflow
                  ? "Saving…"
                  : saveDialogPurpose === "edit"
                    ? activeTab.workflowPersisted === false
                      ? "Save as workflow"
                      : "Save new version"
                    : "Save workflow"}
              </button>
            </div>
          </section>
        </div>
      )}
      {deleteDefinition?.workflow && (
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismissal supplements explicit dialog controls
        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users use the dialog's Keep workflow control
        <div
          className={cx(styles, "dialog-backdrop")}
          onClick={() => {
            if (!deletingWorkflow) {
              setDeleteDefinition(undefined);
              setDeleteWorkflowError(undefined);
            }
          }}
        >
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: prevents inner clicks from dismissing the dialog */}
          <section
            className={cx(styles, "reset-dialog workflow-delete-dialog")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="workflow-delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            <span className={cx(styles, "reset-dialog-icon")} aria-hidden="true">
              <Trash2 size={18} />
            </span>
            <div>
              <h2 id="workflow-delete-title">Delete “{deleteDefinition.label}”?</h2>
              <p>
                All {deleteDefinition.workflow.version} saved version
                {deleteDefinition.workflow.version === 1 ? "" : "s"} will move to local workflow
                trash.
                {workflowReferenceCount > 0 &&
                  ` ${workflowReferenceCount} node${
                    workflowReferenceCount === 1 ? "" : "s"
                  } in open tabs will retain an unavailable reference.`}
              </p>
              {deleteWorkflowError && (
                <p className={cx(styles, "workflow-delete-error")}>{deleteWorkflowError}</p>
              )}
            </div>
            <div className={cx(styles, "reset-dialog-actions")}>
              <button
                type="button"
                className={cx(styles, "secondary-button")}
                onClick={() => {
                  setDeleteDefinition(undefined);
                  setDeleteWorkflowError(undefined);
                }}
                disabled={deletingWorkflow}
                autoFocus
              >
                Keep workflow
              </button>
              <button
                type="button"
                className={cx(styles, "danger-button")}
                onClick={() => void confirmDeleteWorkflow()}
                disabled={deletingWorkflow}
              >
                {deletingWorkflow ? (
                  <LoaderCircle className={cx(styles, "spin-icon")} size={14} />
                ) : (
                  <Trash2 size={14} />
                )}
                {deletingWorkflow ? "Moving…" : "Move to trash"}
              </button>
            </div>
          </section>
        </div>
      )}
      {closeTabId && (
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismissal supplements explicit dialog controls
        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users use the dialog's Keep editing control
        <div className={cx(styles, "dialog-backdrop")} onClick={() => setCloseTabId(undefined)}>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: prevents inner clicks from dismissing the dialog */}
          <section
            className={cx(styles, "reset-dialog")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-tab-title"
            onClick={(event) => event.stopPropagation()}
          >
            <span className={cx(styles, "reset-dialog-icon")} aria-hidden="true">
              <AlertTriangle size={18} />
            </span>
            <div>
              <h2 id="close-tab-title">Discard unsaved changes?</h2>
              <p>
                Closing “
                {closeTabId === activeTabId
                  ? graphName
                  : tabs.find((tab) => tab.id === closeTabId)?.snapshot.graphName}
                ” will discard changes made since it was opened or last saved.
              </p>
            </div>
            <div className={cx(styles, "reset-dialog-actions")}>
              <button
                type="button"
                className={cx(styles, "secondary-button")}
                onClick={() => setCloseTabId(undefined)}
                autoFocus
              >
                Keep editing
              </button>
              <button
                type="button"
                className={cx(styles, "danger-button")}
                onClick={() => performCloseTab(closeTabId)}
              >
                Discard and close
              </button>
            </div>
          </section>
        </div>
      )}
      {workflowNotice && !saveDialogOpen && (
        <div className={cx(styles, "workflow-toast")} role="status">
          <div>
            <strong>Workflow ready</strong>
            <span>{workflowNotice}</span>
          </div>
          <button
            type="button"
            className={cx(styles, "undo-dismiss")}
            onClick={() => setWorkflowNotice(undefined)}
            aria-label="Dismiss workflow notice"
          >
            <X size={13} />
          </button>
        </div>
      )}
      {graphNotice && !graphSaveDialogOpen && (
        <div className={cx(styles, "workflow-toast graph-toast")} role="status">
          <div>
            <strong>Graph document</strong>
            <span>{graphNotice}</span>
          </div>
          <button
            type="button"
            className={cx(styles, "undo-dismiss")}
            onClick={() => setGraphNotice(undefined)}
            aria-label="Dismiss graph notice"
          >
            <X size={13} />
          </button>
        </div>
      )}
      {openLoomNodeId && nodes.find((node) => node.id === openLoomNodeId)?.data.state && (
        <LoomEditor
          graph={serializeGraph(
            graphName,
            nodes,
            edges,
            frames,
            edgeRouting,
            wires,
            wireBundles,
            notes,
          )}
          node={nodes.find((node) => node.id === openLoomNodeId)!}
          onChange={(state) => updateLoomState(openLoomNodeId, state)}
          onClose={() => setOpenLoomNodeId(undefined)}
        />
      )}
    </div>
  );
}
