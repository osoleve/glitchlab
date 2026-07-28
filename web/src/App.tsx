import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type Viewport,
  useNodesInitialized,
  useReactFlow,
} from "@xyflow/react";
import {
  AlertTriangle,
  Bug,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Play,
  Plus,
  RotateCcw,
  Search,
  Undo2,
  X,
} from "lucide-react";
import {
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { ApiError, fetchCatalog, runGraph } from "./api";
import { Inspector } from "./Inspector";
import { LoomNodeCard } from "./LoomNode";
import { talkieStarter } from "./starter";
import type {
  CatalogResponse,
  LoomEdge,
  LoomNode,
  NodeDefinition,
  RunResponse,
} from "./types";

const nodeTypes = { loomNode: LoomNodeCard };

interface GraphSnapshot {
  nodes: LoomNode[];
  edges: LoomEdge[];
  run?: RunResponse;
  runError?: string;
  selectedId?: string;
  loomName: string;
}

function defaultConfig(definition: NodeDefinition): Record<string, unknown> {
  return Object.fromEntries(
    definition.fields.map((field) => [field.name, field.default]),
  );
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
        Math.max(
          node.data.definition.inputs.length,
          node.data.definition.outputs.length,
          1,
        ) *
          28,
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
    (target.isContentEditable ||
      target.matches("input, textarea, select, [role='textbox']"))
  );
}

type ResizablePanel = "palette" | "inspector";

const PANEL_LIMITS = {
  palette: { minimum: 184, maximum: 400 },
  inspector: { minimum: 300, maximum: 640 },
} as const;
const MINIMUM_CANVAS_WIDTH = 420;

function clampPanelWidth(
  panel: ResizablePanel,
  width: number,
  otherPanelWidth: number,
): number {
  const limits = PANEL_LIMITS[panel];
  const maximum = Math.max(
    limits.minimum,
    Math.min(
      limits.maximum,
      window.innerWidth * 0.48,
      window.innerWidth - otherPanelWidth - MINIMUM_CANVAS_WIDTH,
    ),
  );
  return Math.min(
    maximum,
    Math.max(limits.minimum, width),
  );
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
  const [loomName, setLoomName] = useState("Talkie perturbation pair");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [needsFit, setNeedsFit] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState<GraphSnapshot>();
  const [runElapsed, setRunElapsed] = useState(0);
  const [paletteWidth, setPaletteWidth] = useState<number>();
  const [inspectorWidth, setInspectorWidth] = useState<number>();
  const [resizingPanel, setResizingPanel] = useState<ResizablePanel>();
  const runStartedAt = useRef(0);
  const canvasRef = useRef<HTMLElement>(null);
  const paletteRef = useRef<HTMLElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView, getViewport, setViewport } =
    useReactFlow();
  const nodesInitialized = useNodesInitialized();

  useEffect(() => {
    void fetchCatalog()
      .then((response) => {
        setCatalog(response);
        const starter = talkieStarter(response.nodes);
        setNodes(starter.nodes);
        setEdges(starter.edges);
        setIsDirty(false);
        setNeedsFit(true);
      })
      .catch((error: unknown) => {
        setCatalogError(error instanceof Error ? error.message : String(error));
      });
  }, [fitView]);

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
  }, [
    fitView,
    inspectorOpen,
    needsFit,
    nodes.length,
    nodesInitialized,
    paletteOpen,
  ]);

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

  const selectedNode = nodes.find((node) => node.id === selectedId);
  useEffect(() => {
    if (selectedId && !selectedNode) {
      setSelectedId(undefined);
      setInspectorOpen(false);
    }
  }, [selectedId, selectedNode]);

  useEffect(() => {
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        const selected = node.id === selectedId;
        if (Boolean(node.selected) === selected) return node;
        changed = true;
        return { ...node, selected };
      });
      return changed ? next : current;
    });
  }, [selectedId]);

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

  const onNodesChange = useCallback(
    (changes: NodeChange<LoomNode>[]) => {
      if (
        changes.some(
          (change) =>
            change.type === "position" ||
            (change.type === "dimensions" && Boolean(change.resizing)) ||
            change.type === "add" ||
            change.type === "remove",
        )
      ) {
        markDirty();
      }
      setNodes((current) => applyNodeChanges(changes, current));
    },
    [markDirty],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<LoomEdge>[]) => {
      if (changes.some((change) => change.type !== "select")) markDirty();
      setEdges((current) => applyEdgeChanges(changes, current));
    },
    [markDirty],
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      markDirty();
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
    [markDirty],
  );

  const addNode = useCallback(
    (definition: NodeDefinition, position?: { x: number; y: number }) => {
      const id = `${definition.kind}-${crypto.randomUUID().slice(0, 6)}`;
      markDirty();
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
          ...current,
          {
            id,
            type: "loomNode",
            position: nextPosition,
            data: {
              kind: definition.kind,
              title: definition.label,
              definition,
              config: defaultConfig(definition),
              runStatus: "idle",
            },
          },
        ];
      });
      setSelectedId(id);
      setInspectorOpen(true);
    },
    [markDirty, screenToFlowPosition],
  );

  const onPaletteDrag = (
    event: DragEvent<HTMLButtonElement>,
    definition: NodeDefinition,
  ) => {
    event.dataTransfer.setData("application/glitchloom-node", definition.kind);
    event.dataTransfer.effectAllowed = "move";
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData("application/glitchloom-node");
    const definition = catalog?.nodes.find((item) => item.kind === kind);
    if (!definition) return;
    addNode(
      definition,
      screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    );
  };

  const updateSelected = (updater: (node: LoomNode) => LoomNode) => {
    if (!selectedId) return;
    markDirty();
    setNodes((current) =>
      current.map((node) => (node.id === selectedId ? updater(node) : node)),
    );
  };
  const deleteSelected = () => {
    if (!selectedId) return;
    markDirty();
    setNodes((current) => current.filter((node) => node.id !== selectedId));
    setEdges((current) =>
      current.filter(
        (edge) => edge.source !== selectedId && edge.target !== selectedId,
      ),
    );
    setSelectedId(undefined);
    setInspectorOpen(false);
  };
  const applyStarter = () => {
    if (!catalog) return;
    const starter = talkieStarter(catalog.nodes);
    setNodes(starter.nodes);
    setEdges(starter.edges);
    setRun(undefined);
    setRunError(undefined);
    setSelectedId(undefined);
    setInspectorOpen(false);
    setIsDirty(false);
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
    setSelectedId(undoSnapshot.selectedId);
    setLoomName(undoSnapshot.loomName);
    setInspectorOpen(Boolean(undoSnapshot.selectedId));
    setIsDirty(true);
    setUndoSnapshot(undefined);
    setNeedsFit(true);
  };

  const execute = async () => {
    const selectedBeforeRun = selectedId;
    runStartedAt.current = Date.now();
    setRunElapsed(0);
    setRunning(true);
    setRunError(undefined);
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        data: { ...node.data, runStatus: "running" },
      })),
    );
    try {
      const response = await runGraph(loomName, nodes, edges);
      setRun(response);
      const complete = new Set(response.nodes.map((result) => result.node_id));
      setNodes((current) =>
        current.map((node) => ({
          ...node,
          data: {
            ...node.data,
            runStatus: complete.has(node.id) ? "completed" : "idle",
          },
        })),
      );
      if (!selectedBeforeRun && nodes.some((node) => node.id === "preview")) {
        setSelectedId("preview");
        setInspectorOpen(true);
      }
    } catch (error) {
      const detail =
        error instanceof ApiError
          ? error.detail
          : { message: error instanceof Error ? error.message : String(error) };
      setRunError(detail.message);
      setNodes((current) =>
        current.map((node) => ({
          ...node,
          data: {
            ...node.data,
            runStatus:
              node.id === detail.node_id
                ? "failed"
                : detail.nodes?.some((result) => result.node_id === node.id)
                  ? "completed"
                  : "idle",
          },
        })),
      );
      if (detail.node_id) {
        setSelectedId(detail.node_id);
        setInspectorOpen(true);
      }
    } finally {
      setRunning(false);
    }
  };

  const preserveVisibleCanvas = (
    previousBounds: DOMRect,
    previousViewport: Viewport,
  ) => {
    window.requestAnimationFrame(() => {
      const nextBounds = canvasRef.current?.getBoundingClientRect();
      if (!nextBounds || nextBounds.width >= previousBounds.width - 0.5) return;

      const widthRatio = nextBounds.width / previousBounds.width;
      const nextZoom = Math.max(0.32, previousViewport.zoom * widthRatio);
      const worldCenterX =
        (previousBounds.width / 2 - previousViewport.x) /
        previousViewport.zoom;
      const worldCenterY =
        (previousBounds.height / 2 - previousViewport.y) /
        previousViewport.zoom;
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

  const beginPanelResize = (
    panel: ResizablePanel,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    const panelElement =
      panel === "palette" ? paletteRef.current : inspectorRef.current;
    if (!panelElement) return;
    const otherPanelElement =
      panel === "palette" ? inspectorRef.current : paletteRef.current;

    const startX = event.clientX;
    const startWidth = panelElement.getBoundingClientRect().width;
    const previousCanvasBounds = canvasRef.current?.getBoundingClientRect();
    const previousViewport = getViewport();
    const otherPanelWidth =
      otherPanelElement?.getBoundingClientRect().width ?? 0;
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
    const panelElement =
      panel === "palette" ? paletteRef.current : inspectorRef.current;
    if (!panelElement) return;
    const previousCanvasBounds = canvasRef.current?.getBoundingClientRect();
    const previousViewport = getViewport();
    const otherPanelElement =
      panel === "palette" ? inspectorRef.current : paletteRef.current;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const width = clampPanelWidth(
      panel,
      panelElement.getBoundingClientRect().width +
        direction * (panel === "palette" ? 12 : -12),
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
        if (resetDialogOpen) {
          event.preventDefault();
          setResetDialogOpen(false);
        } else if (editable) {
          event.target.blur();
        } else if (selectedId) {
          event.preventDefault();
          setSelectedId(undefined);
          setInspectorOpen(false);
        }
        return;
      }

      const commandKey = event.ctrlKey || event.metaKey;
      if (commandKey && event.key === "Enter" && !running && nodes.length > 0) {
        event.preventDefault();
        void execute();
        return;
      }

      if (
        commandKey &&
        event.key.toLowerCase() === "z" &&
        !editable &&
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <strong>Glitchloom</strong>
        </div>
        <div className="loom-title">
          <span className="loom-title-label">loom</span>
          <input
            aria-label="Loom name"
            value={loomName}
            onChange={(event) => {
              setLoomName(event.target.value);
              markDirty();
            }}
          />
          {isDirty && (
            <span
              className="dirty-indicator"
              aria-label="Unsaved graph changes"
              title="Unsaved graph changes"
            />
          )}
        </div>
        <div className="topbar-actions">
          <span
            className={`plugin-chip ${
              catalog?.plugin.available ? "is-ready" : "is-offline"
            }`}
            title={catalog?.plugin.error ?? catalog?.plugin.path}
            aria-label={
              catalog?.plugin.available
                ? "Glitchlings available"
                : "Glitchlings unavailable"
            }
          >
            <Bug size={13} />
          </span>
          <button
            type="button"
            className="secondary-button"
            onClick={requestStarterReset}
            title="Reset to the starter graph"
          >
            <RotateCcw size={15} />
            Reset starter
          </button>
          <button
            type="button"
            className="run-button"
            onClick={() => void execute()}
            disabled={running || nodes.length === 0}
            title="Run loom (Ctrl+Enter)"
          >
            {running ? (
              <LoaderCircle className="spin-icon" size={16} />
            ) : (
              <Play size={16} fill="currentColor" />
            )}
            {running ? "Running…" : "Run loom"}
          </button>
        </div>
      </header>

      <main
        className={`workspace ${paletteOpen ? "" : "palette-closed"} ${
          inspectorOpen ? "" : "inspector-closed"
        } ${resizingPanel ? "is-panel-resizing" : ""}`}
        style={workspaceStyle}
      >
        <aside ref={paletteRef} className="palette">
          <div className="palette-heading">
            <span>Node library</span>
            <button
              type="button"
              className="panel-close-button"
              onClick={() => setPaletteOpen(false)}
              aria-label="Close node library"
              title="Close node library"
            >
              <PanelLeftClose size={15} />
            </button>
          </div>
          <label className="palette-search">
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
          {catalogError && <p className="error-copy">{catalogError}</p>}
          {[...groupedCatalog.entries()].map(([category, definitions]) => (
            <details className="palette-group" key={category} open>
              <summary>{category}</summary>
              <div>
                {definitions.map((definition) => (
                  <button
                    type="button"
                    draggable
                    className={`palette-node category-${categorySlug(category)}`}
                    key={definition.kind}
                    onDragStart={(event) => onPaletteDrag(event, definition)}
                    onClick={() => addNode(definition)}
                    title={definition.description}
                  >
                    <span className="palette-thread" />
                    <span>
                      <strong>{definition.label}</strong>
                      <small>{definition.description}</small>
                    </span>
                    <Plus size={14} />
                  </button>
                ))}
              </div>
            </details>
          ))}
          {catalog && groupedCatalog.size === 0 && (
            <p className="empty-copy palette-empty">
              No instruments match “{paletteQuery}”.
            </p>
          )}
        </aside>
        {paletteOpen && (
          <div
            className="panel-resizer palette-resizer"
            role="separator"
            aria-label="Resize node library"
            aria-orientation="vertical"
            aria-valuemin={PANEL_LIMITS.palette.minimum}
            aria-valuemax={PANEL_LIMITS.palette.maximum}
            aria-valuenow={Math.round(
              paletteWidth ?? responsivePanelDefault("palette"),
            )}
            tabIndex={0}
            title="Drag to resize · double-click to reset"
            onPointerDown={(event) => beginPanelResize("palette", event)}
            onKeyDown={(event) => resizePanelFromKeyboard("palette", event)}
            onDoubleClick={() => resetPanelWidth("palette")}
          />
        )}

        <section
          ref={canvasRef}
          className="canvas"
          onDrop={onDrop}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
        >
          {(!paletteOpen || !inspectorOpen) && (
            <div className="canvas-panel-controls">
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
            nodes={nodes}
            edges={edges.map((edge) => ({
              ...edge,
              animated: running,
              markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
            }))}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => {
              setSelectedId(node.id);
              setInspectorOpen(true);
            }}
            onPaneClick={() => {
              setSelectedId(undefined);
              setInspectorOpen(false);
            }}
            fitView
            fitViewOptions={{ padding: 0.03, minZoom: 0.52, maxZoom: 0.95 }}
            minZoom={0.32}
            maxZoom={1.7}
            deleteKeyCode={["Backspace", "Delete"]}
            colorMode="dark"
            connectionLineStyle={{ stroke: "#b8a4e6", strokeWidth: 2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Lines}
              gap={32}
              size={0.7}
              color="#292633"
            />
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
          {running && (
            <div className="run-overlay">
              <span className="shuttle" />
              <strong>Throwing the shuttle</strong>
              <small>
                {formatElapsed(runElapsed)} · model endpoints may lazily load weights
              </small>
            </div>
          )}
          {runError && !running && (
            <div className="run-error-banner">
              <strong>Run stopped</strong>
              <span>{runError}</span>
              <button type="button" onClick={() => setRunError(undefined)}>
                Dismiss
              </button>
            </div>
          )}
        </section>

        <div ref={inspectorRef} className="inspector-shell">
          <Inspector
            selectedNode={selectedNode}
            nodes={nodes}
            edges={edges}
            glitchlings={catalog?.glitchlings ?? []}
            run={run}
            error={runError}
            onUpdateTitle={(title) =>
              updateSelected((node) => ({
                ...node,
                data: { ...node.data, title },
              }))
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
            onDelete={deleteSelected}
            onClose={() => setInspectorOpen(false)}
          />
        </div>
        {inspectorOpen && (
          <div
            className="panel-resizer inspector-resizer"
            role="separator"
            aria-label="Resize inspector"
            aria-orientation="vertical"
            aria-valuemin={PANEL_LIMITS.inspector.minimum}
            aria-valuemax={PANEL_LIMITS.inspector.maximum}
            aria-valuenow={Math.round(
              inspectorWidth ?? responsivePanelDefault("inspector"),
            )}
            tabIndex={0}
            title="Drag to resize · double-click to reset"
            onPointerDown={(event) => beginPanelResize("inspector", event)}
            onKeyDown={(event) => resizePanelFromKeyboard("inspector", event)}
            onDoubleClick={() => resetPanelWidth("inspector")}
          />
        )}
      </main>
      {resetDialogOpen && (
        <div
          className="dialog-backdrop"
          onClick={() => setResetDialogOpen(false)}
        >
          <section
            className="reset-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="reset-dialog-icon" aria-hidden="true">
              <AlertTriangle size={18} />
            </span>
            <div>
              <h2 id="reset-dialog-title">Reset to the starter graph?</h2>
              <p>
                Your current nodes, connections, configuration, and run output will be
                replaced. You can undo immediately after resetting.
              </p>
            </div>
            <div className="reset-dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setResetDialogOpen(false)}
                autoFocus
              >
                Keep working
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={confirmStarterReset}
              >
                Reset graph
              </button>
            </div>
          </section>
        </div>
      )}
      {undoSnapshot && !resetDialogOpen && (
        <div className="undo-toast" role="status">
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
            className="undo-dismiss"
            onClick={() => setUndoSnapshot(undefined)}
            aria-label="Dismiss undo"
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
