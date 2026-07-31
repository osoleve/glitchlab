import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type EdgeChange,
  MarkerType,
  MiniMap,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  reconnectEdge,
  useNodesInitialized,
  useReactFlow,
  type Viewport,
} from "@xyflow/react";
import {
  AlertTriangle,
  Bug,
  Columns3,
  Copy,
  FilePlus2,
  Focus,
  FolderOpen,
  GitMerge,
  LayoutDashboard,
  LoaderCircle,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Rows3,
  Save,
  Search,
  Trash2,
  Undo2,
  Unplug,
  Workflow,
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
import { isGraphConnectionValid } from "./connectionValidation";
import { controlPortName, withControlPorts } from "./controlPorts";
import { hydrateGraph, serializeGraph } from "./graph";
import { tidyNodeLayout } from "./graphLayout";
import {
  downstreamClosure,
  inducedEdgeIds,
  semanticExecutionFingerprint,
  upstreamClosure,
} from "./graphTraversal";
import { Inspector } from "./Inspector";
import { LoomNodeCardWithBoundary } from "./LoomNode";
import { moduleClassNames as cx } from "./moduleClassNames";
import { compatibleNodeInputs } from "./nodePicker";
import { talkieStarter } from "./starter";
import type {
  CatalogResponse,
  ControlPortMode,
  GraphSpec,
  LoomEdge,
  LoomNode,
  LoomSpec,
  LoomSummary,
  LoomTemplateSummary,
  NodeDefinition,
  PortDefinition,
  RunResponse,
  RunScope,
  ValueType,
  WorkflowDraft,
  WorkflowSpec,
} from "./types";
import { inferWorkflowDraft, reviseWorkflowDraft } from "./workflow";

const nodeTypes = { loomNode: LoomNodeCardWithBoundary };

interface GraphSnapshot {
  nodes: LoomNode[];
  edges: LoomEdge[];
  run?: RunResponse;
  runError?: string;
  selectedId?: string;
  loomName: string;
  isDirty: boolean;
  executionScope?: ExecutionScopeState;
}

interface GraphTab {
  id: string;
  type: "loom" | "workflow";
  loom?: LoomSpec;
  sourceTemplateId?: string;
  workflow?: WorkflowSpec;
  snapshot: GraphSnapshot;
}

type ContextMenuState =
  | {
      x: number;
      y: number;
      scope: "node";
      nodeId: string;
      nodeIds: string[];
    }
  | { x: number; y: number; scope: "selection"; nodeIds: string[] }
  | {
      x: number;
      y: number;
      scope: "edge";
      edgeId: string;
      flowPosition: { x: number; y: number };
    }
  | {
      x: number;
      y: number;
      scope: "pane";
      flowPosition: { x: number; y: number };
      pendingConnection?: {
        sourceNodeId: string;
        sourceHandle: string;
        sourceType: ValueType;
      };
    };

interface WorkflowMenuState {
  x: number;
  y: number;
  definition: NodeDefinition;
}

interface QuickAddEntry {
  definition: NodeDefinition;
  input?: PortDefinition;
}

interface ExecutionScopeState {
  mode: "full" | "targets";
  targetNodeIds: string[];
  nodeIds: string[];
  edgeIds: string[];
  status: "running" | "completed" | "failed" | "stale";
}

const MAIN_TAB_ID = "main";

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

function categorySlug(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "-");
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

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s elapsed`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`;
}

function isEditableTarget(target: EventTarget | null): target is HTMLElement {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select, [role='textbox']"))
  );
}

function connectionEndClientPosition(
  event: MouseEvent | TouchEvent,
): { x: number; y: number } | undefined {
  if ("changedTouches" in event) {
    const touch = event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : undefined;
  }
  return { x: event.clientX, y: event.clientY };
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

function GlitchloomApp() {
  const [catalog, setCatalog] = useState<CatalogResponse>();
  const [catalogError, setCatalogError] = useState<string>();
  const [nodes, setNodes] = useState<LoomNode[]>([]);
  const [edges, setEdges] = useState<LoomEdge[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<RunResponse>();
  const [runError, setRunError] = useState<string>();
  const [executionScope, setExecutionScope] = useState<ExecutionScopeState>();
  const [loomName, setLoomName] = useState("Talkie perturbation pair");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [needsFit, setNeedsFit] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [tabs, setTabs] = useState<GraphTab[]>([
    {
      id: MAIN_TAB_ID,
      type: "loom",
      snapshot: {
        nodes: [],
        edges: [],
        loomName: "Talkie perturbation pair",
        isDirty: false,
      },
    },
  ]);
  const [activeTabId, setActiveTabId] = useState(MAIN_TAB_ID);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState<GraphSnapshot>();
  const [runElapsed, setRunElapsed] = useState(0);
  const [paletteWidth, setPaletteWidth] = useState<number>();
  const [inspectorWidth, setInspectorWidth] = useState<number>();
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
  const [looms, setLooms] = useState<LoomSummary[]>([]);
  const [loomTemplates, setLoomTemplates] = useState<LoomTemplateSummary[]>([]);
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
  const executionFingerprintRef = useRef("");
  const semanticRevisionRef = useRef(0);
  const reconnectSuccessful = useRef(false);
  const hasOpenedGraph = useRef(false);
  const canvasRef = useRef<HTMLElement>(null);
  const paletteRef = useRef<HTMLElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView, getViewport, setViewport } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const executionFingerprint = useMemo(
    () => semanticExecutionFingerprint(serializeGraph("Execution fingerprint", nodes, edges)),
    [edges, nodes],
  );
  executionFingerprintRef.current = executionFingerprint;
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

  const applySnapshot = useCallback((snapshot: GraphSnapshot) => {
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    setRun(snapshot.run);
    setRunError(snapshot.runError);
    setExecutionScope(snapshot.executionScope);
    setSelectedId(snapshot.selectedId);
    setLoomName(snapshot.loomName);
    setIsDirty(snapshot.isDirty);
    setInspectorOpen(Boolean(snapshot.selectedId));
    setUndoSnapshot(undefined);
    setContextMenu(undefined);
    setWorkflowMenu(undefined);
    setNeedsFit(true);
  }, []);

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
    [activeTabId, applySnapshot, captureSnapshot, graphBusy, running, tabs],
  );

  useEffect(() => {
    void fetchCatalog()
      .then((response) => {
        setCatalog(response);
        if (hasOpenedGraph.current) return;
        const starter = talkieStarter(response.nodes);
        setNodes(starter.nodes);
        setEdges(starter.edges);
        setIsDirty(false);
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
  }, []);

  useEffect(() => {
    void Promise.all([fetchLooms(), fetchLoomTemplates()])
      .then(([savedLooms, templates]) => {
        setLooms(savedLooms);
        setLoomTemplates(templates);
      })
      .catch((error: unknown) => {
        setLoomLibraryError(error instanceof Error ? error.message : String(error));
      });
  }, []);

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
  }, [running]);

  const markDirty = useCallback(() => {
    setIsDirty(true);
    setUndoSnapshot(undefined);
  }, []);
  const markSemanticDirty = useCallback(() => {
    semanticRevisionRef.current += 1;
    setIsDirty(true);
    setUndoSnapshot(undefined);
    setExecutionScope(undefined);
    setRun((current) =>
      current
        ? {
            ...current,
            client: {
              execution_fingerprint: current.client?.execution_fingerprint ?? "",
              stale: true,
            },
          }
        : current,
    );
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        data: { ...node.data, runStatus: "idle" },
      })),
    );
  }, []);

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
  }, [selectedId, selectedNode, selectedNodes]);

  useEffect(() => {
    if (!contextMenu && !workflowMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".context-menu")) {
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
      const layout = changes.some(
        (change) =>
          change.type === "position" || (change.type === "dimensions" && Boolean(change.resizing)),
      );
      if (semantic) markSemanticDirty();
      else if (layout) markDirty();
      setNodes((current) => applyNodeChanges(changes, current));
    },
    [markDirty, markSemanticDirty],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<LoomEdge>[]) => {
      if (changes.some((change) => change.type !== "select")) {
        markSemanticDirty();
      }
      setEdges((current) => applyEdgeChanges(changes, current));
    },
    [markSemanticDirty],
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      markSemanticDirty();
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: crypto.randomUUID(),
            markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
          },
          current,
        ),
      );
    },
    [markSemanticDirty],
  );
  const isValidConnection = useCallback(
    (connection: Connection | LoomEdge) => isGraphConnectionValid(connection, nodes, edges),
    [edges, nodes],
  );
  const onReconnect = useCallback(
    (oldEdge: LoomEdge, connection: Connection) => {
      reconnectSuccessful.current = true;
      markSemanticDirty();
      setEdges((current) =>
        reconnectEdge(oldEdge, connection, current, { shouldReplaceId: false }),
      );
    },
    [markSemanticDirty],
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
        setEdges((current) => current.filter((item) => item.id !== edge.id));
      }
      reconnectSuccessful.current = false;
    },
    [markSemanticDirty],
  );

  const addNode = useCallback(
    (definition: NodeDefinition, position?: { x: number; y: number }) => {
      const id = `${definition.kind}-${crypto.randomUUID().slice(0, 6)}`;
      markSemanticDirty();
      setNodes((current) => {
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
        return [
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
        ];
      });
      setSelectedId(id);
      setInspectorOpen(true);
      return id;
    },
    [markSemanticDirty, screenToFlowPosition],
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
    else markDirty();
    setNodes((current) => current.map((node) => (node.id === selectedId ? updater(node) : node)));
  };
  const updateNodeField = useCallback(
    (nodeId: string, field: string, value: unknown) => {
      markSemanticDirty();
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  config: { ...node.data.config, [field]: value },
                  runStatus: "idle",
                },
              }
            : node,
        ),
      );
    },
    [markSemanticDirty],
  );
  const updateControlPort = (fieldName: string, mode?: ControlPortMode) => {
    if (!selectedId || !selectedNode) return;
    const previousMode = selectedNode.data.controlPorts[fieldName];
    if (previousMode === mode) return;
    markSemanticDirty();
    const handle = controlPortName(fieldName);
    const hadInput = previousMode === "input" || previousMode === "passthrough";
    const hadOutput = previousMode === "output" || previousMode === "passthrough";
    const keepsInput = mode === "input" || mode === "passthrough";
    const keepsOutput = mode === "output" || mode === "passthrough";
    setEdges((current) =>
      current.filter(
        (edge) =>
          !(
            (hadOutput &&
              !keepsOutput &&
              edge.source === selectedId &&
              edge.sourceHandle === handle) ||
            (hadInput && !keepsInput && edge.target === selectedId && edge.targetHandle === handle)
          ),
      ),
    );
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== selectedId) return node;
        const controlPorts = { ...node.data.controlPorts };
        if (mode) controlPorts[fieldName] = mode;
        else delete controlPorts[fieldName];
        return {
          ...node,
          data: {
            ...node.data,
            definition: withControlPorts(node.data.definition, controlPorts),
            controlPorts,
            runStatus: "idle",
          },
        };
      }),
    );
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
    setNodes((current) => current.filter((node) => !ids.has(node.id)));
    setEdges((current) => current.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)));
    setSelectedId(undefined);
    setInspectorOpen(false);
  };
  const duplicateSelected = (explicitIds?: string[]) => {
    const explicit = explicitIds ? new Set(explicitIds) : undefined;
    const sourceNodes = explicit
      ? nodes.filter((node) => explicit.has(node.id))
      : selectedNodes.length > 0
        ? selectedNodes
        : selectedNode
          ? [selectedNode]
          : [];
    if (sourceNodes.length === 0) return;
    const sourceIds = new Set(sourceNodes.map((node) => node.id));
    const replacements = new Map(
      sourceNodes.map((node) => [node.id, `${node.data.kind}-${crypto.randomUUID().slice(0, 6)}`]),
    );
    const copies = sourceNodes.map((node) => ({
      ...node,
      id: replacements.get(node.id)!,
      position: { x: node.position.x + 36, y: node.position.y + 36 },
      selected: true,
      data: {
        ...node.data,
        config: structuredClone(node.data.config),
        controlPorts: { ...node.data.controlPorts },
        runStatus: "idle" as const,
      },
    }));
    const copiedEdges = edges
      .filter((edge) => sourceIds.has(edge.source) && sourceIds.has(edge.target))
      .map((edge) => ({
        ...edge,
        id: crypto.randomUUID(),
        source: replacements.get(edge.source)!,
        target: replacements.get(edge.target)!,
        selected: false,
      }));
    markSemanticDirty();
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...copies]);
    setEdges((current) => [...current, ...copiedEdges]);
    setSelectedId(copies[0].id);
    setInspectorOpen(true);
    setContextMenu(undefined);
  };

  const selectRelated = (startIds: string[], direction: "upstream" | "downstream") => {
    const nodeIds = nodes.map((node) => node.id);
    const reachable = new Set(
      direction === "upstream"
        ? upstreamClosure(nodeIds, edges, startIds)
        : downstreamClosure(nodeIds, edges, startIds),
    );
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        selected: reachable.has(node.id),
      })),
    );
    const anchor = startIds.at(-1);
    setSelectedId(anchor);
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
    markDirty();
    setNodes((current) =>
      current.map((node) => {
        const position = positions.get(node.id);
        return position ? { ...node, position } : node;
      }),
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
      markDirty();
      setNodes((current) =>
        current.map((node) => {
          const position = positions.get(node.id);
          return position ? { ...node, position } : node;
        }),
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
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
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
    ]);
    setEdges((current) =>
      current.flatMap((candidate) =>
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
      setLoomName(saved.graph.name);
      setIsDirty(false);
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
        setLoomName(response.workflow.name);
        setIsDirty(false);
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
    setNodes((current) => current.map((node) => ({ ...node, selected: true })));
    setSelectedId(nodes.at(-1)?.id);
    setInspectorOpen(nodes.length > 0);
    setContextMenu(undefined);
  };
  const addQuickNode = (definition: NodeDefinition, targetInput?: PortDefinition) => {
    if (contextMenu?.scope !== "pane") return;
    const nodeId = addNode(definition, {
      x: contextMenu.flowPosition.x - 118,
      y: contextMenu.flowPosition.y - 72,
    });
    if (contextMenu.pendingConnection && targetInput) {
      const connection = contextMenu.pendingConnection;
      setEdges((current) =>
        addEdge(
          {
            id: crypto.randomUUID(),
            source: connection.sourceNodeId,
            sourceHandle: connection.sourceHandle,
            target: nodeId,
            targetHandle: targetInput.name,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 18,
              height: 18,
            },
          },
          current,
        ),
      );
    }
    setContextMenu(undefined);
    setQuickAddQuery("");
    setQuickAddIndex(0);
  };
  const applyStarter = () => {
    if (!catalog) return;
    const starter = talkieStarter(catalog.nodes);
    const starterName = "Talkie perturbation pair";
    setNodes(starter.nodes);
    setEdges(starter.edges);
    setRun(undefined);
    setRunError(undefined);
    setExecutionScope(undefined);
    setSelectedId(undefined);
    setInspectorOpen(false);
    setLoomName(starterName);
    setIsDirty(false);
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
    setUndoSnapshot({
      nodes,
      edges,
      run,
      runError,
      selectedId,
      loomName,
      isDirty,
      executionScope,
    });
    setResetDialogOpen(false);
    applyStarter();
  };

  const undoStarterReset = () => {
    if (!undoSnapshot) return;
    setNodes(undoSnapshot.nodes);
    setEdges(undoSnapshot.edges);
    setRun(undoSnapshot.run);
    setRunError(undoSnapshot.runError);
    setExecutionScope(undoSnapshot.executionScope);
    setSelectedId(undoSnapshot.selectedId);
    setLoomName(undoSnapshot.loomName);
    setInspectorOpen(Boolean(undoSnapshot.selectedId));
    setIsDirty(true);
    setUndoSnapshot(undefined);
    setNeedsFit(true);
  };

  const execute = async (requestedTargetIds: string[] = []) => {
    const graph = serializeGraph(loomName, nodes, edges);
    const submittedFingerprint = semanticExecutionFingerprint(graph);
    const submittedSemanticRevision = semanticRevisionRef.current;
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
    setRunElapsed(0);
    setRunning(true);
    setRunError(undefined);
    setExecutionScope(submittedScope);
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
      const stale =
        semanticRevisionRef.current !== submittedSemanticRevision ||
        executionFingerprintRef.current !== submittedFingerprint;
      setRun({
        ...response,
        client: {
          execution_fingerprint: submittedFingerprint,
          stale,
        },
      });
      const completedNodeIds = response.manifest.scope.executed_node_ids;
      const completed = new Set(completedNodeIds);
      setExecutionScope({
        mode: response.manifest.scope.mode,
        targetNodeIds: response.manifest.scope.target_node_ids,
        nodeIds: completedNodeIds,
        edgeIds: inducedEdgeIds(edges, completedNodeIds),
        status: stale ? "stale" : "completed",
      });
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
      const stale =
        semanticRevisionRef.current !== submittedSemanticRevision ||
        executionFingerprintRef.current !== submittedFingerprint;
      setRunError(
        stale ? `Prior run stopped after the graph changed: ${detail.message}` : detail.message,
      );
      setExecutionScope({
        ...submittedScope,
        status: stale ? "stale" : "failed",
      });
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
    } finally {
      setRunning(false);
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

      if (
        commandKey &&
        event.key.toLowerCase() === "z" &&
        !editable &&
        !savingLoom &&
        undoSnapshot
      ) {
        event.preventDefault();
        undoStarterReset();
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
      <header className={cx(styles, "topbar")}>
        <button
          type="button"
          className={cx(styles, "brand")}
          aria-label="Toggle after-hours weave"
          aria-pressed={afterHours}
          title="Wake the loom"
          onClick={() => setAfterHours((current) => !current)}
        >
          <div className={cx(styles, "brand-mark")} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span className={cx(styles, "brand-copy")}>
            <strong>Glitchloom</strong>
            <small>{afterHours ? "the loom hums back" : "after hours"}</small>
          </span>
        </button>
        <div className={cx(styles, "loom-title")}>
          <span className={cx(styles, "loom-title-label")}>
            {activeWorkflow
              ? "workflow"
              : activeLoom
                ? `saved loom · r${activeLoom.revision}`
                : "loom draft"}
          </span>
          <input
            aria-label={activeWorkflow ? "Workflow name" : "Loom name"}
            value={loomName}
            disabled={savingLoom || running}
            onChange={(event) => {
              setLoomName(event.target.value);
              markDirty();
            }}
          />
          {isDirty && (
            <span
              role="img"
              className={cx(styles, "dirty-indicator")}
              aria-label="Unsaved graph changes"
              title="Unsaved graph changes"
            />
          )}
        </div>
        <div className={cx(styles, "topbar-actions")}>
          <span
            role="img"
            className={cx(
              styles,
              "plugin-chip",
              catalog?.plugin.available ? "is-ready" : "is-offline",
            )}
            title={catalog?.plugin.error ?? catalog?.plugin.path}
            aria-label={
              catalog?.plugin.available ? "Glitchlings available" : "Glitchlings unavailable"
            }
          >
            <Bug size={13} />
          </span>
          <button
            type="button"
            className={cx(styles, "secondary-button")}
            onClick={() => {
              setLoomLibraryError(undefined);
              setLoomLibraryOpen(true);
            }}
            disabled={running || graphBusy || !catalog}
            title="Open a saved loom or template"
          >
            <FolderOpen size={15} />
            Open
          </button>
          {activeWorkflow ? (
            <button
              type="button"
              className={cx(styles, "secondary-button workflow-save-button")}
              onClick={openEditSaveDialog}
              disabled={savingWorkflow}
              title="Save edits as a new immutable workflow version"
            >
              <Save size={15} />
              Save version
            </button>
          ) : (
            <>
              <button
                type="button"
                className={cx(styles, "secondary-button")}
                onClick={() => requestSaveLoom(false)}
                disabled={savingLoom || running || !catalog}
                title="Save loom (Ctrl+S)"
              >
                {savingLoom ? (
                  <LoaderCircle className={cx(styles, "spin-icon")} size={15} />
                ) : (
                  <Save size={15} />
                )}
                Save
              </button>
              <button
                type="button"
                className={cx(styles, "secondary-button compact-action-button")}
                onClick={() => requestSaveLoom(true)}
                disabled={savingLoom || running || !catalog}
                title="Save as a new loom (Ctrl+Shift+S)"
                aria-label="Save as a new loom"
              >
                <FilePlus2 size={15} />
              </button>
              {activeTabId === MAIN_TAB_ID && !activeLoom && (
                <button
                  type="button"
                  className={cx(styles, "secondary-button compact-action-button")}
                  onClick={requestStarterReset}
                  disabled={savingLoom || running || !catalog}
                  title="Reset to the starter graph"
                  aria-label="Reset to starter graph"
                >
                  <RotateCcw size={15} />
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className={cx(styles, "run-button")}
            onClick={() => void execute()}
            disabled={running || savingLoom || nodes.length === 0}
            title="Run loom (Ctrl+Enter)"
          >
            {running ? (
              <LoaderCircle className={cx(styles, "spin-icon")} size={16} />
            ) : (
              <Play size={16} fill="currentColor" />
            )}
            {running ? "Running…" : "Run loom"}
          </button>
        </div>
      </header>

      <div className={cx(styles, "graph-tabs")} role="tablist" aria-label="Open graphs">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const dirty = active ? isDirty : tab.snapshot.isDirty;
          const title = active ? loomName : tab.snapshot.loomName;
          const version = active ? activeWorkflow?.version : tab.workflow?.version;
          const revision = active ? activeLoom?.revision : tab.loom?.revision;
          return (
            <div className={cx(styles, "graph-tab", active && "is-active")} key={tab.id}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => switchGraphTab(tab.id)}
                disabled={running || graphBusy}
                title={title}
              >
                {tab.type === "workflow" ? <Workflow size={13} /> : <LayoutDashboard size={13} />}
                <span>{title}</span>
                {version && <em>v{version}</em>}
                {revision && <em>r{revision}</em>}
                {dirty && <i role="img" aria-label="Unsaved changes" title="Unsaved changes" />}
              </button>
              {tab.id !== MAIN_TAB_ID && (
                <button
                  type="button"
                  className={cx(styles, "graph-tab-close")}
                  onClick={() => requestCloseTab(tab)}
                  disabled={running || graphBusy}
                  aria-label={`Close ${title}`}
                  title="Close tab"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className={cx(styles, "graph-tab-add")}
          onClick={() => setLoomLibraryOpen(true)}
          disabled={running || graphBusy || !catalog}
          aria-label="Open loom or template"
          title="Open loom or template"
        >
          <Plus size={14} />
        </button>
      </div>

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
        <aside ref={paletteRef} className={cx(styles, "palette")}>
          <div className={cx(styles, "palette-heading")}>
            <span>Node library</span>
            <button
              type="button"
              className={cx(styles, "panel-close-button")}
              onClick={() => setPaletteOpen(false)}
              aria-label="Close node library"
              title="Close node library"
            >
              <PanelLeftClose size={15} />
            </button>
          </div>
          <label className={cx(styles, "palette-search")}>
            <Search size={13} aria-hidden="true" />
            <input
              type="search"
              value={paletteQuery}
              onChange={(event) => setPaletteQuery(event.target.value)}
              placeholder="Filter nodes"
              aria-label="Filter nodes"
            />
            {paletteQuery && (
              <button
                type="button"
                aria-label="Clear node filter"
                onClick={() => setPaletteQuery("")}
              >
                <X size={12} />
              </button>
            )}
          </label>
          {catalogError && <p className={cx(styles, "error-copy")}>{catalogError}</p>}
          {[...groupedCatalog.entries()].map(([category, definitions]) => (
            <details className={cx(styles, "palette-group")} key={category} open>
              <summary>{category}</summary>
              <div>
                {definitions.map((definition) => (
                  <div className={cx(styles, "palette-node-shell")} key={definition.kind}>
                    <button
                      type="button"
                      draggable
                      className={cx(styles, "palette-node", `category-${categorySlug(category)}`)}
                      onDragStart={(event) => onPaletteDrag(event, definition)}
                      onClick={() => addNode(definition)}
                      onContextMenu={(event) => {
                        if (!definition.workflow) return;
                        event.preventDefault();
                        setWorkflowMenu({
                          x: event.clientX,
                          y: event.clientY,
                          definition,
                        });
                      }}
                      title={definition.description}
                    >
                      <span className={cx(styles, "palette-thread")} />
                      <span>
                        <strong>{definition.label}</strong>
                        <small>{definition.description}</small>
                      </span>
                      {!definition.workflow && <Plus size={14} />}
                    </button>
                    {definition.workflow && (
                      <button
                        type="button"
                        className={cx(styles, "palette-node-manage")}
                        onClick={(event) => {
                          const bounds = event.currentTarget.getBoundingClientRect();
                          setWorkflowMenu({
                            x: bounds.right,
                            y: bounds.bottom,
                            definition,
                          });
                        }}
                        aria-label={`Manage ${definition.label}`}
                        title="Edit or delete workflow"
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </details>
          ))}
          {catalog && groupedCatalog.size === 0 && (
            <p className={cx(styles, "empty-copy palette-empty")}>
              No instruments match “{paletteQuery}”.
            </p>
          )}
        </aside>
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
        {/* biome-ignore lint/a11y/noStaticElementInteractions: React Flow canvas is a native drop target */}
        <section
          ref={canvasRef}
          className={cx(styles, "canvas")}
          onDrop={onDrop}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
        >
          <div className={cx(styles, "after-hours-weave")} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className={cx(styles, "after-hours-note")} role="status">
            after hours · weave alive
          </div>
          {(!paletteOpen || !inspectorOpen) && (
            <div className={cx(styles, "canvas-panel-controls")}>
              {!paletteOpen && (
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  aria-label="Open node library"
                >
                  <PanelLeftOpen size={15} />
                  Nodes
                </button>
              )}
              {!inspectorOpen && (
                <button
                  type="button"
                  onClick={() => setInspectorOpen(true)}
                  aria-label="Open inspector"
                >
                  <PanelRightOpen size={15} />
                  Inspector
                </button>
              )}
            </div>
          )}
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onConnectEnd={(event, connectionState) => {
              if (
                connectionState.isValid === true ||
                connectionState.toNode ||
                connectionState.toHandle ||
                connectionState.fromHandle?.type !== "source" ||
                !connectionState.fromNode ||
                !connectionState.fromHandle.id
              ) {
                return;
              }
              const point = connectionEndClientPosition(event);
              const canvasBounds = canvasRef.current?.getBoundingClientRect();
              if (
                !point ||
                !canvasBounds ||
                point.x < canvasBounds.left ||
                point.x > canvasBounds.right ||
                point.y < canvasBounds.top ||
                point.y > canvasBounds.bottom
              ) {
                return;
              }
              const sourceNode = nodes.find((node) => node.id === connectionState.fromNode?.id);
              const sourceHandle = connectionState.fromHandle.id;
              const sourcePort = sourceNode?.data.definition.outputs.find(
                (port) => port.name === sourceHandle,
              );
              if (!sourceNode || !sourcePort) return;
              setQuickAddQuery("");
              setQuickAddIndex(0);
              setContextMenu({
                x: point.x,
                y: point.y,
                scope: "pane",
                flowPosition: screenToFlowPosition(point),
                pendingConnection: {
                  sourceNodeId: sourceNode.id,
                  sourceHandle,
                  sourceType: sourcePort.type,
                },
              });
            }}
            onReconnect={onReconnect}
            onReconnectStart={() => {
              reconnectSuccessful.current = false;
            }}
            onReconnectEnd={onReconnectEnd}
            edgesReconnectable
            reconnectRadius={18}
            multiSelectionKeyCode={["Control", "Meta"]}
            onNodeClick={(event, node) => {
              const additive = event.ctrlKey || event.metaKey;
              if (additive) {
                const previouslySelected = new Set(selectedNodes.map((item) => item.id));
                const willSelect = !previouslySelected.has(node.id);
                setNodes((current) =>
                  current.map((item) => ({
                    ...item,
                    selected: item.id === node.id ? willSelect : previouslySelected.has(item.id),
                  })),
                );
                if (willSelect) {
                  setSelectedId(node.id);
                  setInspectorOpen(true);
                } else if (selectedId === node.id) {
                  const fallback = selectedNodes.filter((item) => item.id !== node.id).at(-1);
                  setSelectedId(fallback?.id);
                  setInspectorOpen(Boolean(fallback));
                }
              } else {
                setSelectedId(node.id);
                setInspectorOpen(true);
                setNodes((current) =>
                  current.map((item) => ({
                    ...item,
                    selected: item.id === node.id,
                  })),
                );
              }
              setContextMenu(undefined);
            }}
            onPaneClick={() => {
              setSelectedId(undefined);
              setInspectorOpen(false);
              setContextMenu(undefined);
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              const nodeIds =
                node.selected && selectedNodes.length > 0
                  ? selectedNodes.map((item) => item.id)
                  : [node.id];
              if (!node.selected) {
                setNodes((current) =>
                  current.map((item) => ({
                    ...item,
                    selected: item.id === node.id,
                  })),
                );
              }
              setSelectedId(node.id);
              setInspectorOpen(true);
              setContextMenu({
                x: event.clientX,
                y: event.clientY,
                scope: "node",
                nodeId: node.id,
                nodeIds,
              });
            }}
            onSelectionContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({
                x: event.clientX,
                y: event.clientY,
                scope: "selection",
                nodeIds: selectedNodes.map((node) => node.id),
              });
            }}
            onEdgeContextMenu={(event, edge) => {
              event.preventDefault();
              setContextMenu({
                x: event.clientX,
                y: event.clientY,
                scope: "edge",
                edgeId: edge.id,
                flowPosition: screenToFlowPosition({
                  x: event.clientX,
                  y: event.clientY,
                }),
              });
            }}
            onPaneContextMenu={(event) => {
              event.preventDefault();
              setQuickAddQuery("");
              setQuickAddIndex(0);
              setContextMenu({
                x: event.clientX,
                y: event.clientY,
                scope: "pane",
                flowPosition: screenToFlowPosition({
                  x: event.clientX,
                  y: event.clientY,
                }),
              });
            }}
            fitView
            fitViewOptions={{ padding: 0.03, minZoom: 0.52, maxZoom: 0.95 }}
            minZoom={0.32}
            maxZoom={1.7}
            deleteKeyCode={savingLoom ? null : ["Backspace", "Delete"]}
            colorMode="dark"
            connectionLineStyle={{ stroke: "#b8a4e6", strokeWidth: 2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Lines} gap={32} size={0.7} color="#292633" />
            <MiniMap
              nodeColor={(node) => {
                const category = (node.data as LoomNode["data"]).definition.category;
                return category === "Glitchlings"
                  ? "#e2767f"
                  : category === "Models"
                    ? "#a98bf4"
                    : "#5aa9a2";
              }}
              maskColor="rgba(10, 9, 13, 0.78)"
              pannable
              zoomable
            />
            <Controls showInteractive={false} />
          </ReactFlow>
          {executionScope && (
            <div
              className={cx(styles, "execution-scope-bar", `status-${executionScope.status}`)}
              role="status"
            >
              <span className={cx(styles, "execution-scope-mark")} aria-hidden="true" />
              <div>
                <strong>
                  {executionScope.mode === "targets"
                    ? executionScope.targetNodeIds.length === 1
                      ? "Run to target"
                      : `Run to ${executionScope.targetNodeIds.length} targets`
                    : "Full loom run"}
                </strong>
                <small>
                  {executionScope.nodeIds.length} node
                  {executionScope.nodeIds.length === 1 ? "" : "s"} ·{" "}
                  {executionScope.status === "running"
                    ? "running"
                    : executionScope.status === "completed"
                      ? "completed"
                      : executionScope.status === "failed"
                        ? "stopped on error"
                        : "prior result is stale"}
                </small>
              </div>
              <button
                type="button"
                onClick={fitExecutionScope}
                title="Fit execution scope"
                aria-label="Fit execution scope"
              >
                <Focus size={14} />
              </button>
              <button
                type="button"
                onClick={() => setExecutionScope(undefined)}
                disabled={running}
                title="Clear execution focus"
                aria-label="Clear execution focus"
              >
                <X size={14} />
              </button>
            </div>
          )}
          {running && (
            <div className={cx(styles, "run-overlay")}>
              <span className={cx(styles, "shuttle")} />
              <strong>Throwing the shuttle</strong>
              <small>{formatElapsed(runElapsed)} · model endpoints may lazily load weights</small>
            </div>
          )}
          {runError && !running && (
            <div className={cx(styles, "run-error-banner")}>
              <strong>Run stopped</strong>
              <span>{runError}</span>
              <button type="button" onClick={() => setRunError(undefined)}>
                Dismiss
              </button>
            </div>
          )}
          {contextMenu && (
            <div
              className={cx(
                styles,
                "context-menu",
                contextMenu.scope === "pane" && "quick-add-menu",
                contextMenu.scope === "pane" &&
                  Boolean(contextMenu.pendingConnection) &&
                  "is-connection-picker",
              )}
              role="menu"
              style={{
                left: Math.max(
                  8,
                  Math.min(
                    contextMenu.x,
                    window.innerWidth - (contextMenu.scope === "pane" ? 294 : 226),
                  ),
                ),
                top: Math.max(
                  8,
                  Math.min(
                    contextMenu.y,
                    window.innerHeight -
                      (contextMenu.scope === "pane"
                        ? 470
                        : contextMenu.scope === "node" || contextMenu.scope === "selection"
                          ? 520
                          : 220),
                  ),
                ),
              }}
              onContextMenu={(event) => event.preventDefault()}
            >
              {(contextMenu.scope === "node" || contextMenu.scope === "selection") && (
                <>
                  {contextualWorkflowDefinition && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void openWorkflowEditor(contextualWorkflowDefinition)}
                      >
                        <Pencil size={14} />
                        Edit saved workflow
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={cx(styles, "is-danger")}
                        onClick={() => requestDeleteWorkflow(contextualWorkflowDefinition)}
                      >
                        <Trash2 size={14} />
                        Delete saved workflow
                      </button>
                      <span className={cx(styles, "context-menu-separator")} />
                    </>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={running}
                    onClick={() =>
                      void execute(
                        contextMenu.scope === "node" ? [contextMenu.nodeId] : contextMenu.nodeIds,
                      )
                    }
                  >
                    <Play size={14} fill="currentColor" />
                    {contextMenu.scope === "node" ? "Run to here" : "Run to selection"}
                  </button>
                  {contextMenu.scope === "node" && contextMenu.nodeIds.length > 1 && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={running}
                      onClick={() => void execute(contextMenu.nodeIds)}
                    >
                      <Play size={14} />
                      Run to selection
                    </button>
                  )}
                  <span className={cx(styles, "context-menu-separator")} />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => duplicateSelected(contextSelectionIds)}
                  >
                    <Copy size={14} />
                    Duplicate
                    <kbd>Ctrl+D</kbd>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => selectRelated(contextMenu.nodeIds, "upstream")}
                  >
                    <GitMerge size={14} />
                    Select upstream
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => selectRelated(contextMenu.nodeIds, "downstream")}
                  >
                    <Columns3 size={14} />
                    Select downstream
                  </button>
                  <button type="button" role="menuitem" onClick={openSaveWorkflow}>
                    <Save size={14} />
                    Save as workflow
                  </button>
                  {contextSelectionIds.length >= 2 && (
                    <>
                      <span className={cx(styles, "context-menu-separator")} />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => tidyNodes(contextSelectionIds)}
                      >
                        <Network size={14} />
                        Tidy selection
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => arrangeSelection(contextSelectionIds, "align-left")}
                      >
                        <Columns3 size={14} />
                        Align left
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => arrangeSelection(contextSelectionIds, "align-top")}
                      >
                        <Rows3 size={14} />
                        Align top
                      </button>
                      {contextSelectionIds.length >= 3 && (
                        <>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => arrangeSelection(contextSelectionIds, "distribute-x")}
                          >
                            <Columns3 size={14} />
                            Distribute horizontally
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => arrangeSelection(contextSelectionIds, "distribute-y")}
                          >
                            <Rows3 size={14} />
                            Distribute vertically
                          </button>
                        </>
                      )}
                    </>
                  )}
                  <span className={cx(styles, "context-menu-separator")} />
                  <button
                    type="button"
                    role="menuitem"
                    className={cx(styles, "is-danger")}
                    onClick={() => {
                      deleteSelected(contextSelectionIds);
                      setContextMenu(undefined);
                    }}
                  >
                    <Trash2 size={14} />
                    Delete {contextSelectionIds.length > 1 ? "selection" : "node"}
                    <kbd>Del</kbd>
                  </button>
                </>
              )}
              {contextMenu.scope === "edge" && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => insertPassthrough(contextMenu.edgeId, contextMenu.flowPosition)}
                  >
                    <Plus size={14} />
                    Insert passthrough
                  </button>
                  <span className={cx(styles, "context-menu-separator")} />
                  <button
                    type="button"
                    role="menuitem"
                    className={cx(styles, "is-danger")}
                    onClick={() => {
                      markSemanticDirty();
                      setEdges((current) =>
                        current.filter((edge) => edge.id !== contextMenu.edgeId),
                      );
                      setContextMenu(undefined);
                    }}
                  >
                    <Unplug size={14} />
                    Disconnect wire
                  </button>
                </>
              )}
              {contextMenu.scope === "pane" && (
                <>
                  {contextMenu.pendingConnection && (
                    <div className={cx(styles, "connection-picker-heading")}>
                      <span>Connect output</span>
                      <strong>
                        <i aria-hidden="true" />
                        {contextMenu.pendingConnection.sourceType}
                      </strong>
                      <small>Choose a compatible input port</small>
                    </div>
                  )}
                  <label className={cx(styles, "quick-add-search")}>
                    <Search size={14} aria-hidden="true" />
                    <input
                      type="search"
                      value={quickAddQuery}
                      onChange={(event) => {
                        setQuickAddQuery(event.target.value);
                        setQuickAddIndex(0);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          setQuickAddIndex((current) =>
                            Math.min(current + 1, Math.max(0, quickAddEntries.length - 1)),
                          );
                        } else if (event.key === "ArrowUp") {
                          event.preventDefault();
                          setQuickAddIndex((current) => Math.max(0, current - 1));
                        } else if (event.key === "Enter") {
                          event.preventDefault();
                          const entry = quickAddEntries[quickAddIndex];
                          if (entry) {
                            addQuickNode(entry.definition, entry.input);
                          }
                        }
                      }}
                      placeholder={
                        contextMenu.pendingConnection
                          ? `Connect ${contextMenu.pendingConnection.sourceType} to…`
                          : "Add a node…"
                      }
                      aria-label={
                        contextMenu.pendingConnection
                          ? "Find a compatible node input"
                          : "Find a node to add"
                      }
                      autoFocus
                    />
                  </label>
                  <div className={cx(styles, "quick-add-results")} role="listbox">
                    {quickAddEntries.map(({ definition, input }, index) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === quickAddIndex}
                        className={cx(styles, index === quickAddIndex && "is-active")}
                        key={`${definition.kind}:${input?.name ?? ""}`}
                        onMouseEnter={() => setQuickAddIndex(index)}
                        onClick={() => addQuickNode(definition, input)}
                      >
                        <Plus size={13} />
                        <span>
                          <strong>{definition.label}</strong>
                          <small>
                            {definition.category}
                            {input && (
                              <>
                                {" "}
                                · into {input.label} <em>{input.type}</em>
                              </>
                            )}
                          </small>
                        </span>
                      </button>
                    ))}
                    {quickAddEntries.length === 0 && (
                      <p>
                        {contextMenu.pendingConnection
                          ? "No compatible node inputs match"
                          : "No matching nodes"}
                      </p>
                    )}
                  </div>
                  {!contextMenu.pendingConnection && (
                    <>
                      <span className={cx(styles, "context-menu-separator")} />
                      <button type="button" role="menuitem" onClick={selectAllNodes}>
                        <Focus size={14} />
                        Select all nodes
                        <kbd>Ctrl+A</kbd>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={nodes.length < 2}
                        onClick={() => tidyNodes()}
                      >
                        <Network size={14} />
                        Tidy graph
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          void fitView({
                            padding: 0.08,
                            minZoom: 0.4,
                            maxZoom: 1,
                            duration: 300,
                          });
                          setContextMenu(undefined);
                        }}
                      >
                        <Focus size={14} />
                        Fit graph in view
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </section>
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
        <div
          className={cx(styles, "context-menu workflow-library-menu")}
          role="menu"
          style={{
            left: Math.min(workflowMenu.x, window.innerWidth - 226),
            top: Math.min(workflowMenu.y, window.innerHeight - 150),
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => void openWorkflowEditor(workflowMenu.definition)}
            disabled={loadingWorkflowId === workflowMenu.definition.workflow?.id}
          >
            {loadingWorkflowId === workflowMenu.definition.workflow?.id ? (
              <LoaderCircle className={cx(styles, "spin-icon")} size={14} />
            ) : (
              <Pencil size={14} />
            )}
            Edit in new tab
          </button>
          <button
            type="button"
            role="menuitem"
            className={cx(styles, "is-danger")}
            onClick={() => requestDeleteWorkflow(workflowMenu.definition)}
          >
            <Trash2 size={14} />
            Delete saved workflow
          </button>
        </div>
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
      {undoSnapshot && !resetDialogOpen && (
        <div className={cx(styles, "undo-toast")} role="status">
          <div>
            <strong>Starter graph restored</strong>
            <span>Your previous graph is still recoverable.</span>
          </div>
          <button type="button" onClick={undoStarterReset}>
            <Undo2 size={14} />
            Undo
          </button>
          <button
            type="button"
            className={cx(styles, "undo-dismiss")}
            onClick={() => setUndoSnapshot(undefined)}
            aria-label="Dismiss undo"
          >
            <X size={13} />
          </button>
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

export default function App() {
  return (
    <ReactFlowProvider>
      <GlitchloomApp />
    </ReactFlowProvider>
  );
}
