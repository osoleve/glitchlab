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
  createLoom,
  deleteWorkflow,
  fetchCatalog,
  fetchLoom,
  fetchLooms,
  fetchLoomTemplate,
  fetchLoomTemplates,
  fetchWorkflow,
  runGraph,
  saveWorkflow,
  updateLoom,
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
import { hydrateGraph, serializeGraph } from "./graph";
import { tidyNodeLayout } from "./graphLayout";
import {
  downstreamClosure,
  inducedEdgeIds,
  semanticExecutionFingerprint,
  upstreamClosure,
} from "./graphTraversal";
import { Inspector } from "./Inspector";
import { moduleClassNames as cx } from "./moduleClassNames";
import { compatibleNodeInputs } from "./nodePicker";
import { talkieStarter } from "./starter";
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
  CatalogResponse,
  ControlPortMode,
  GraphSpec,
  LoomEdge,
  LoomNode,
  LoomSpec,
  LoomSummary,
  NodeDefinition,
  PortDefinition,
  RunScope,
  WorkflowDraft,
} from "./types";
import { inferWorkflowDraft, reviseWorkflowDraft } from "./workflow";

function workflowBindingKey(
  direction: "input" | "output",
  nodeId: string,
  nodePort: string,
): string {
  return `${direction}\u0000${nodeId}\u0000${nodePort}`;
}

function applyWorkflowBoundaryLabels(
  draft: WorkflowDraft,
  labels: Record<string, string>,
): WorkflowDraft {
  return {
    ...draft,
    inputs: draft.inputs.map((binding) => ({
      ...binding,
      label:
        labels[workflowBindingKey("input", binding.node_id, binding.node_port)] ?? binding.label,
    })),
    outputs: draft.outputs.map((binding) => ({
      ...binding,
      label:
        labels[workflowBindingKey("output", binding.node_id, binding.node_port)] ?? binding.label,
    })),
  };
}

function defaultConfig(definition: NodeDefinition): Record<string, unknown> {
  return Object.fromEntries(definition.fields.map((field) => [field.name, field.default]));
}

function nodeSize(node: LoomNode): { width: number; height: number } {
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
  nodes: LoomNode[],
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

export function GlitchloomWorkbench() {
  const [catalog, setCatalog] = useState<CatalogResponse>();
  const [catalogError, setCatalogError] = useState<string>();
  const {
    nodes,
    edges,
    selectedId,
    loomName,
    isDirty,
    setNodes,
    setSelectedId,
    setLoomName,
    setIsDirty,
    renameLoom,
    updateDocument,
    applyNodeChanges,
    applyEdgeChanges,
    connect: connectGraph,
    updateNodeField: updateGraphNodeField,
    updateControlPort: updateGraphControlPort,
    removeNodes,
    removeEdge,
    duplicateNodes,
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
    setRun,
    setRunError,
    setExecutionScope,
    setRunElapsed,
    markSemanticEdit,
    beginRun,
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
    looms,
    loomTemplates,
    setTabs,
    setActiveTabId,
    setPaletteOpen,
    setInspectorOpen,
    setLooms,
    setLoomTemplates,
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
  const [workflowError, setWorkflowError] = useState<string>();
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [workflowNotice, setWorkflowNotice] = useState<string>();
  const [loomLibraryOpen, setLoomLibraryOpen] = useState(false);
  const [loomLibraryError, setLoomLibraryError] = useState<string>();
  const [loadingDocumentId, setLoadingDocumentId] = useState<string>();
  const [loomSaveDialogOpen, setLoomSaveDialogOpen] = useState(false);
  const [loomSaveAs, setLoomSaveAs] = useState(false);
  const [loomSaveName, setLoomSaveName] = useState("");
  const [savingLoom, setSavingLoom] = useState(false);
  const [loomSaveError, setLoomSaveError] = useState<string>();
  const [loomNotice, setLoomNotice] = useState<string>();
  const [afterHours, setAfterHours] = useState(false);
  const [loadingWorkflowId, setLoadingWorkflowId] = useState<string>();
  const [deleteDefinition, setDeleteDefinition] = useState<NodeDefinition>();
  const [deletingWorkflow, setDeletingWorkflow] = useState(false);
  const [deleteWorkflowError, setDeleteWorkflowError] = useState<string>();
  const [closeTabId, setCloseTabId] = useState<string>();
  const runStartedAt = useRef(0);
  const nodeDragHistoryPaused = useRef(false);
  const reconnectSuccessful = useRef(false);
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
  const activeLoom = activeTab.type === "loom" ? activeTab.loom : undefined;
  const loadingGraph = Boolean(loadingWorkflowId || loadingDocumentId);
  const graphBusy = loadingGraph || savingLoom;
  const hasUnsavedTabs =
    isDirty || tabs.some((tab) => tab.id !== activeTabId && tab.snapshot.isDirty);

  const captureSnapshot = useCallback(
    (): GraphSnapshot => ({
      nodes,
      edges,
      run,
      runError,
      selectedId,
      loomName,
      isDirty,
      executionScope,
    }),
    [edges, executionScope, isDirty, loomName, nodes, run, runError, selectedId],
  );

  const applySnapshot = useCallback(
    (snapshot: GraphSnapshot) => {
      replaceGraph(snapshot.nodes, snapshot.edges, snapshot.loomName, snapshot.isDirty);
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
        const starter = talkieStarter(response.nodes);
        replaceGraph(starter.nodes, starter.edges, "Talkie perturbation pair", false);
        clearGraphHistory();
        setTabs((current) =>
          current.map((tab) =>
            tab.id === MAIN_TAB_ID
              ? {
                  ...tab,
                  snapshot: {
                    nodes: starter.nodes,
                    edges: starter.edges,
                    loomName: "Talkie perturbation pair",
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
    void Promise.all([fetchLooms(), fetchLoomTemplates()])
      .then(([savedLooms, templates]) => {
        setLooms(savedLooms);
        setLoomTemplates(templates);
      })
      .catch((error: unknown) => {
        setLoomLibraryError(error instanceof Error ? error.message : String(error));
      });
  }, [setLooms, setLoomTemplates]);

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
    if (!needsFit || !nodesInitialized || nodes.length === 0) return;
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
  }, [fitView, needsFit, nodes.length, nodesInitialized]);

  // Panel visibility changes intentionally retrigger the fit after CSS transitions.
  // biome-ignore lint/correctness/useExhaustiveDependencies(inspectorOpen): trigger-only dependency
  // biome-ignore lint/correctness/useExhaustiveDependencies(paletteOpen): trigger-only dependency
  useEffect(() => {
    if (!nodesInitialized || nodes.length === 0 || needsFit) return;
    const timer = window.setTimeout(() => {
      void fitView({
        padding: 0.03,
        minZoom: 0.52,
        maxZoom: 0.95,
        duration: 260,
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [fitView, inspectorOpen, needsFit, nodes.length, nodesInitialized, paletteOpen]);

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
    (changes: NodeChange<LoomNode>[]) => {
      const semantic = changes.some((change) => change.type === "add" || change.type === "remove");
      if (semantic) markSemanticDirty();
      applyNodeChanges(changes);
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
    [applyNodeChanges, markSemanticDirty],
  );
  const finishNodeDragHistory = useCallback(() => {
    if (!nodeDragHistoryPaused.current) return;
    resumeGraphHistory();
    nodeDragHistoryPaused.current = false;
  }, []);
  useEffect(
    () => () => {
      if (nodeDragHistoryPaused.current) resumeGraphHistory();
    },
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<LoomEdge>[]) => {
      if (changes.some((change) => change.type !== "select")) {
        markSemanticDirty();
      }
      applyEdgeChanges(changes);
    },
    [applyEdgeChanges, markSemanticDirty],
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      markSemanticDirty();
      connectGraph({
        ...connection,
        id: crypto.randomUUID(),
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      } as LoomEdge);
    },
    [connectGraph, markSemanticDirty],
  );
  const isValidConnection = useCallback(
    (connection: Connection | LoomEdge) => isGraphConnectionValid(connection, nodes, edges),
    [edges, nodes],
  );
  const onReconnect = useCallback(
    (oldEdge: LoomEdge, connection: Connection) => {
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
      edge: LoomEdge,
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
              type: "loomNode",
              position: nextPosition,
              data: {
                kind: definition.kind,
                title: definition.label,
                definition,
                config: {
                  ...defaultConfig(definition),
                  ...(definition.workflow ? { workflow_digest: definition.workflow.digest } : {}),
                },
                controlPorts: {},
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
    event.dataTransfer.setData("application/glitchloom-node", definition.kind);
    event.dataTransfer.effectAllowed = "move";
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData("application/glitchloom-node");
    const definition = catalog?.nodes.find((item) => item.kind === kind);
    if (!definition) return;
    addNode(definition, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };

  const updateSelected = (updater: (node: LoomNode) => LoomNode, semantic = true) => {
    if (!selectedId) return;
    if (semantic) markSemanticDirty();
    updateDocument(
      ({ nodes: current }) => ({
        nodes: current.map((node) => (node.id === selectedId ? updater(node) : node)),
      }),
      semantic,
    );
  };
  const updateNodeField = useCallback(
    (nodeId: string, field: string, value: unknown) => {
      markSemanticDirty();
      updateGraphNodeField(nodeId, field, value);
    },
    [markSemanticDirty, updateGraphNodeField],
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

  const tidyNodes = (nodeIds?: string[]) => {
    const included = nodeIds ? new Set(nodeIds) : undefined;
    const targets = included ? nodes.filter((node) => included.has(node.id)) : nodes;
    if (targets.length < 2) {
      setContextMenu(undefined);
      return;
    }
    const positions = tidyNodeLayout(
      targets.map((node) => ({
        id: node.id,
        position: node.position,
        ...nodeSize(node),
      })),
      edges,
    );
    const changed = targets.some((node) => {
      const position = positions.get(node.id);
      return (
        position !== undefined &&
        (Math.abs(position.x - node.position.x) > 0.01 ||
          Math.abs(position.y - node.position.y) > 0.01)
      );
    });
    if (changed) {
      updateDocument(
        ({ nodes: current }) => ({
          nodes: current.map((node) => {
            const position = positions.get(node.id);
            return position ? { ...node, position } : node;
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
    setContextMenu(undefined);
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
            type: "loomNode",
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
      const response = await fetchWorkflow(metadata.id, metadata.version);
      const hydrated = hydrateGraph(
        response.workflow.graph,
        catalog?.nodes ?? [],
        response.definitions,
      );
      const snapshot: GraphSnapshot = {
        nodes: hydrated.nodes,
        edges: hydrated.edges,
        loomName: response.workflow.name,
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

  const rememberLoom = (loom: LoomSpec) => {
    const summary: LoomSummary = {
      id: loom.id,
      name: loom.graph.name,
      revision: loom.revision,
      digest: loom.digest,
      created_at: loom.created_at,
      updated_at: loom.updated_at,
      node_count: loom.graph.nodes.length,
    };
    setLooms((current) =>
      [...current.filter((item) => item.id !== loom.id), summary].sort((left, right) =>
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
      loomName: graph.name,
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
        type: "loom",
        sourceTemplateId,
        snapshot,
      },
    ]);
    setActiveTabId(tabId);
    applySnapshot(snapshot);
    setLoomLibraryOpen(false);
  };

  const openSavedLoom = async (loomId: string, asCopy = false) => {
    const existing = !asCopy ? tabs.find((tab) => tab.loom?.id === loomId) : undefined;
    if (existing) {
      setLoomLibraryOpen(false);
      switchGraphTab(existing.id);
      return;
    }
    setLoadingDocumentId(`loom:${loomId}:${asCopy ? "copy" : "open"}`);
    setLoomLibraryError(undefined);
    try {
      const response = await fetchLoom(loomId);
      if (asCopy) {
        openHydratedDraft(
          {
            ...response.loom.graph,
            name: `${response.loom.graph.name} copy`,
          },
          response.definitions,
        );
        return;
      }
      const hydrated = hydrateGraph(
        response.loom.graph,
        catalog?.nodes ?? [],
        response.definitions,
      );
      hasOpenedGraph.current = true;
      const snapshot: GraphSnapshot = {
        nodes: hydrated.nodes,
        edges: hydrated.edges,
        loomName: response.loom.graph.name,
        isDirty: false,
      };
      const tabId = `loom:${response.loom.id}`;
      const currentSnapshot = captureSnapshot();
      setTabs((current) => [
        ...current.map((tab) =>
          tab.id === activeTabId ? { ...tab, snapshot: currentSnapshot } : tab,
        ),
        {
          id: tabId,
          type: "loom",
          loom: response.loom,
          snapshot,
        },
      ]);
      setActiveTabId(tabId);
      applySnapshot(snapshot);
      setLoomLibraryOpen(false);
    } catch (error) {
      setLoomLibraryError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingDocumentId(undefined);
    }
  };

  const openLoomTemplate = async (templateId: string) => {
    setLoadingDocumentId(`template:${templateId}`);
    setLoomLibraryError(undefined);
    try {
      const response = await fetchLoomTemplate(templateId);
      openHydratedDraft(response.template.graph, response.definitions, response.template.id);
    } catch (error) {
      setLoomLibraryError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingDocumentId(undefined);
    }
  };

  const openStarterCopy = () => {
    if (!catalog) return;
    const starter = talkieStarter(catalog.nodes);
    openHydratedDraft(
      serializeGraph("Talkie perturbation pair", starter.nodes, starter.edges),
      [],
      "starter",
    );
  };

  const persistCurrentLoom = async (name: string, options: { createNew: boolean }) => {
    if (activeWorkflow) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setLoomSaveError("Give this loom a name.");
      return;
    }
    setSavingLoom(true);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setContextMenu(undefined);
    setLoomSaveError(undefined);
    try {
      const graph = serializeGraph(trimmedName, nodes, edges);
      const saved =
        activeLoom && !options.createNew
          ? await updateLoom(activeLoom.id, activeLoom.revision, graph)
          : await createLoom({ graph });
      const nextSnapshot: GraphSnapshot = {
        ...captureSnapshot(),
        loomName: saved.graph.name,
        isDirty: false,
      };
      const nextTabId = activeTabId === MAIN_TAB_ID ? MAIN_TAB_ID : `loom:${saved.id}`;
      setTabs((current) =>
        current.map((tab) =>
          tab.id === activeTabId
            ? {
                ...tab,
                id: nextTabId,
                loom: saved,
                sourceTemplateId: undefined,
                snapshot: nextSnapshot,
              }
            : tab,
        ),
      );
      if (nextTabId !== activeTabId) setActiveTabId(nextTabId);
      withoutGraphHistory(() => {
        setLoomName(saved.graph.name);
        setIsDirty(false);
      });
      rememberLoom(saved);
      setLoomSaveDialogOpen(false);
      setLoomNotice(`${saved.graph.name} saved at revision ${saved.revision}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (loomSaveDialogOpen) setLoomSaveError(message);
      else setLoomNotice(message);
    } finally {
      setSavingLoom(false);
    }
  };

  const requestSaveLoom = (saveAs = false) => {
    if (activeWorkflow) return;
    if (activeLoom && !saveAs) {
      void persistCurrentLoom(loomName, { createNew: false });
      return;
    }
    setLoomSaveAs(saveAs);
    setLoomSaveName(loomName);
    setLoomSaveError(undefined);
    setLoomSaveDialogOpen(true);
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
    if (!definition.workflow) return;
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
    setWorkflowError(undefined);
    setSaveDialogPurpose("selection");
    setSaveDialogOpen(true);
    setContextMenu(undefined);
  };

  const openEditSaveDialog = () => {
    if (!activeWorkflow) return;
    setWorkflowName(loomName);
    setWorkflowDescription(activeWorkflow.description);
    setWorkflowBoundaryLabels({});
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
        );
      } else {
        inferred = inferWorkflowDraft(workflowName, workflowDescription, selectedNodes, edges);
      }
      return applyWorkflowBoundaryLabels(inferred, workflowBoundaryLabels);
    } catch {
      return undefined;
    }
  }, [
    edges,
    activeWorkflow,
    nodes,
    saveDialogOpen,
    saveDialogPurpose,
    selectedNodes,
    workflowBoundaryLabels,
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
        saveDialogPurpose === "edit" && activeWorkflow
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
                response.definition,
              ],
            }
          : current,
      );
      if (saveDialogPurpose === "edit") {
        const nextSnapshot: GraphSnapshot = {
          ...captureSnapshot(),
          loomName: response.workflow.name,
          isDirty: false,
        };
        setTabs((current) =>
          current.map((tab) =>
            tab.id === activeTabId
              ? {
                  ...tab,
                  workflow: response.workflow,
                  snapshot: nextSnapshot,
                }
              : tab,
          ),
        );
        withoutGraphHistory(() => {
          setLoomName(response.workflow.name);
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
    const starter = talkieStarter(catalog.nodes);
    const starterName = "Talkie perturbation pair";
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
              loom: undefined,
              sourceTemplateId: "starter",
              snapshot: {
                nodes: starter.nodes,
                edges: starter.edges,
                loomName: starterName,
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
    const graph = serializeGraph(loomName, nodes, edges);
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
    const scopedNodeIdSet = new Set(scopedNodeIds);
    const selectedBeforeRun = selectedId;
    runStartedAt.current = Date.now();
    beginRun(submittedScope, submittedFingerprint);
    setContextMenu(undefined);
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        data: {
          ...node.data,
          runStatus: scopedNodeIdSet.has(node.id) ? "running" : "idle",
        },
      })),
    );
    try {
      const response = await runGraph(graph, scope);
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
      const stale = failRun(detail.message, submittedScope, submittedFingerprint);
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
        } else if (loomLibraryOpen) {
          event.preventDefault();
          setLoomLibraryOpen(false);
        } else if (loomSaveDialogOpen && !savingLoom) {
          event.preventDefault();
          setLoomSaveDialogOpen(false);
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
        } else if (selectedId) {
          event.preventDefault();
          setNodes((current) =>
            current.map((node) => (node.selected ? { ...node, selected: false } : node)),
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
        !loomSaveDialogOpen &&
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
        !loomLibraryOpen &&
        !saveDialogOpen &&
        !loomSaveDialogOpen &&
        !savingLoom
      ) {
        event.preventDefault();
        requestSaveLoom(event.shiftKey);
        return;
      }
      if (
        commandKey &&
        event.key.toLowerCase() === "a" &&
        !editable &&
        !resetDialogOpen &&
        !saveDialogOpen &&
        !savingLoom
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
        !savingLoom &&
        selectedNodes.length > 0
      ) {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (commandKey && event.key === "Enter" && !running && !savingLoom && nodes.length > 0) {
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
  const flowNodes = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      onUpdateField: (field: string, value: unknown) => updateNodeField(node.id, field, value),
      executionScopeRole:
        executionScope?.mode !== "targets"
          ? undefined
          : targetNodeIdSet.has(node.id)
            ? ("target" as const)
            : scopedNodeIdSet.has(node.id)
              ? ("required" as const)
              : ("unrelated" as const),
    },
  }));
  const flowEdges = edges.map((edge) => {
    const inScope = !executionScope || scopedEdgeIdSet.has(edge.id);
    const className = executionScope
      ? inScope
        ? styles["execution-scope-edge"]
        : styles["execution-unrelated-edge"]
      : showSelectedPaths
        ? selectedPathEdgeIdSet.has(edge.id)
          ? styles["selection-path-edge"]
          : styles["selection-unrelated-edge"]
        : undefined;
    return {
      ...edge,
      type: "smoothstep",
      className,
      animated: running && inScope,
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
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
        activeLoom={activeLoom}
        activeTabId={activeTabId}
        activeWorkflow={activeWorkflow}
        afterHours={afterHours}
        catalog={catalog}
        graphBusy={graphBusy}
        isDirty={isDirty}
        loomName={loomName}
        nodeCount={nodes.length}
        running={running}
        savingLoom={savingLoom}
        savingWorkflow={savingWorkflow}
        canRedo={canRedo}
        canUndo={canUndo}
        onRedo={redoDocument}
        onUndo={undoDocument}
        onExecute={() => void execute()}
        onLoomNameChange={renameLoom}
        onOpenEditSaveDialog={openEditSaveDialog}
        onOpenLibrary={() => {
          setLoomLibraryError(undefined);
          setLoomLibraryOpen(true);
        }}
        onRequestSaveLoom={requestSaveLoom}
        onRequestStarterReset={requestStarterReset}
        onToggleAfterHours={() => setAfterHours((current) => !current)}
      />

      <GraphTabs
        activeLoom={activeLoom}
        activeTabId={activeTabId}
        activeWorkflow={activeWorkflow}
        canOpenGraph={Boolean(catalog)}
        graphBusy={graphBusy}
        isDirty={isDirty}
        loomName={loomName}
        running={running}
        tabs={tabs}
        onOpenLibrary={() => setLoomLibraryOpen(true)}
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
          executionScope={executionScope}
          nodes={flowNodes}
          runElapsed={runElapsed}
          runError={runError}
          running={running}
          savingLoom={savingLoom}
          isValidConnection={isValidConnection}
          onClearExecutionScope={() => setExecutionScope(undefined)}
          onConnect={onConnect}
          onDismissRunError={() => setRunError(undefined)}
          onDrop={onDrop}
          onEdgesChange={onEdgesChange}
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
              onAddQuickNode={addQuickNode}
              onArrangeSelection={arrangeSelection}
              onDeleteNodes={deleteSelected}
              onDeleteWorkflow={requestDeleteWorkflow}
              onDisconnectEdge={(edgeId) => {
                markSemanticDirty();
                removeEdge(edgeId);
                setContextMenu(undefined);
              }}
              onDismiss={() => setContextMenu(undefined)}
              onDuplicateNodes={duplicateSelected}
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
              onInsertPassthrough={insertPassthrough}
              onOpenSaveWorkflow={openSaveWorkflow}
              onOpenWorkflowEditor={(definition) => void openWorkflowEditor(definition)}
              onQuickAddIndexChange={setQuickAddIndex}
              onQuickAddQueryChange={setQuickAddQuery}
              onSelectAllNodes={selectAllNodes}
              onSelectRelated={selectRelated}
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
        {savingLoom && <div className={cx(styles, "edit-lock-overlay")} aria-hidden="true" />}
      </main>
      {workflowMenu && (
        <WorkflowDefinitionMenu
          menu={workflowMenu}
          loadingWorkflowId={loadingWorkflowId}
          onDelete={requestDeleteWorkflow}
          onEdit={(definition) => void openWorkflowEditor(definition)}
        />
      )}
      {loomLibraryOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismissal supplements explicit dialog controls
        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users use the dialog's Close control
        <div
          className={cx(styles, "dialog-backdrop")}
          onClick={() => !loadingDocumentId && setLoomLibraryOpen(false)}
        >
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: prevents inner clicks from dismissing the dialog */}
          <section
            className={cx(styles, "loom-library-dialog")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="loom-library-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={cx(styles, "workflow-dialog-heading")}>
              <span aria-hidden="true">
                <FolderOpen size={18} />
              </span>
              <div>
                <h2 id="loom-library-title">Open a loom</h2>
                <p>
                  Saved looms reopen as editable documents. Templates and copies always start in a
                  new unsaved tab.
                </p>
              </div>
            </div>
            <div className={cx(styles, "loom-library-scroll")}>
              <section className={cx(styles, "loom-library-section")}>
                <div className={cx(styles, "loom-library-section-heading")}>
                  <strong>Templates</strong>
                  <span>read-only starting points</span>
                </div>
                <div className={cx(styles, "loom-library-list")}>
                  <button
                    type="button"
                    className={cx(styles, "loom-library-item")}
                    onClick={openStarterCopy}
                    disabled={Boolean(loadingDocumentId) || !catalog}
                  >
                    <span>
                      <strong>Talkie perturbation pair</strong>
                      <small>Built-in starter · opens as a copy</small>
                    </span>
                    <FilePlus2 size={15} />
                  </button>
                  {loomTemplates.map((template) => (
                    <button
                      type="button"
                      className={cx(styles, "loom-library-item")}
                      key={template.id}
                      onClick={() => void openLoomTemplate(template.id)}
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
              <section className={cx(styles, "loom-library-section")}>
                <div className={cx(styles, "loom-library-section-heading")}>
                  <strong>Saved looms</strong>
                  <span>
                    {looms.length} local document{looms.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className={cx(styles, "loom-library-list")}>
                  {looms.map((loom) => (
                    <div className={cx(styles, "loom-library-item saved-loom-item")} key={loom.id}>
                      <button
                        type="button"
                        onClick={() => void openSavedLoom(loom.id)}
                        disabled={Boolean(loadingDocumentId)}
                      >
                        <strong>{loom.name}</strong>
                        <small>
                          r{loom.revision} · {loom.node_count} node
                          {loom.node_count === 1 ? "" : "s"} · updated{" "}
                          {new Date(loom.updated_at).toLocaleString()}
                        </small>
                      </button>
                      <button
                        type="button"
                        className={cx(styles, "loom-copy-button")}
                        onClick={() => void openSavedLoom(loom.id, true)}
                        disabled={Boolean(loadingDocumentId)}
                        title="Open as an unsaved copy"
                        aria-label={`Open ${loom.name} as a copy`}
                      >
                        {loadingDocumentId === `loom:${loom.id}:copy` ? (
                          <LoaderCircle className={cx(styles, "spin-icon")} size={14} />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                      {loadingDocumentId === `loom:${loom.id}:open` && (
                        <LoaderCircle
                          className={cx(styles, "spin-icon loom-open-spinner")}
                          size={14}
                        />
                      )}
                    </div>
                  ))}
                  {looms.length === 0 && (
                    <p className={cx(styles, "empty-copy")}>
                      No saved looms yet. Save the current tab to create one.
                    </p>
                  )}
                </div>
              </section>
            </div>
            {loomLibraryError && <p className={cx(styles, "workflow-error")}>{loomLibraryError}</p>}
            <div className={cx(styles, "workflow-dialog-actions")}>
              <button
                type="button"
                className={cx(styles, "secondary-button")}
                onClick={() => setLoomLibraryOpen(false)}
                disabled={Boolean(loadingDocumentId)}
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}
      {loomSaveDialogOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismissal supplements explicit dialog controls
        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users use the dialog's Cancel control
        <div
          className={cx(styles, "dialog-backdrop")}
          onClick={() => !savingLoom && setLoomSaveDialogOpen(false)}
        >
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: prevents inner clicks from dismissing the dialog */}
          <section
            className={cx(styles, "workflow-dialog loom-save-dialog")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="loom-save-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={cx(styles, "workflow-dialog-heading")}>
              <span aria-hidden="true">
                <Save size={18} />
              </span>
              <div>
                <h2 id="loom-save-title">
                  {loomSaveAs || activeLoom ? "Save as a new loom" : "Save loom"}
                </h2>
                <p>
                  {loomSaveAs
                    ? "This creates a separate document; the source loom and workflow definitions stay unchanged."
                    : "This tab will become a saved top-level document. Reusable workflows remain separately versioned."}
                </p>
              </div>
            </div>
            <label>
              <span>Name</span>
              <input
                value={loomSaveName}
                onChange={(event) => setLoomSaveName(event.target.value)}
                autoFocus
                disabled={savingLoom}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && loomSaveName.trim()) {
                    event.preventDefault();
                    void persistCurrentLoom(loomSaveName, { createNew: true });
                  }
                }}
              />
            </label>
            {loomSaveError && <p className={cx(styles, "workflow-error")}>{loomSaveError}</p>}
            <div className={cx(styles, "workflow-dialog-actions")}>
              <button
                type="button"
                className={cx(styles, "secondary-button")}
                onClick={() => setLoomSaveDialogOpen(false)}
                disabled={savingLoom}
              >
                Cancel
              </button>
              <button
                type="button"
                className={cx(styles, "run-button")}
                onClick={() => void persistCurrentLoom(loomSaveName, { createNew: true })}
                disabled={savingLoom || !loomSaveName.trim()}
              >
                {savingLoom ? (
                  <LoaderCircle className={cx(styles, "spin-icon")} size={15} />
                ) : (
                  <Save size={15} />
                )}
                {savingLoom ? "Saving…" : "Save loom"}
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
                    ? "Save workflow version"
                    : "Save reusable workflow"}
                </h2>
                <p>
                  {saveDialogPurpose === "edit"
                    ? `Your edits will become v${
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
                    ? "Save new version"
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
                  ? loomName
                  : tabs.find((tab) => tab.id === closeTabId)?.snapshot.loomName}
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
      {loomNotice && !loomSaveDialogOpen && (
        <div className={cx(styles, "workflow-toast loom-toast")} role="status">
          <div>
            <strong>Loom document</strong>
            <span>{loomNotice}</span>
          </div>
          <button
            type="button"
            className={cx(styles, "undo-dismiss")}
            onClick={() => setLoomNotice(undefined)}
            aria-label="Dismiss loom notice"
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
