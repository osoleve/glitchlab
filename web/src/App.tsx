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
  useNodesInitialized,
  useReactFlow,
} from "@xyflow/react";
import {
  Bug,
  ChevronDown,
  CircleStop,
  Info,
  Play,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import {
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
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

function defaultConfig(definition: NodeDefinition): Record<string, unknown> {
  return Object.fromEntries(
    definition.fields.map((field) => [field.name, field.default]),
  );
}

function categorySlug(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "-");
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
  const { screenToFlowPosition, fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();

  useEffect(() => {
    void fetchCatalog()
      .then((response) => {
        setCatalog(response);
        const starter = talkieStarter(response.nodes);
        setNodes(starter.nodes);
        setEdges(starter.edges);
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
        padding: 0.015,
        minZoom: 0.68,
        maxZoom: 0.96,
        duration: 350,
      });
      setNeedsFit(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitView, needsFit, nodes.length, nodesInitialized]);

  const selectedNode = nodes.find((node) => node.id === selectedId);
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
      setNodes((current) => applyNodeChanges(changes, current));
    },
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<LoomEdge>[]) => {
      setEdges((current) => applyEdgeChanges(changes, current));
    },
    [],
  );
  const onConnect = useCallback((connection: Connection) => {
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
  }, []);

  const addNode = useCallback(
    (definition: NodeDefinition, position?: { x: number; y: number }) => {
      const id = `${definition.kind}-${crypto.randomUUID().slice(0, 6)}`;
      setNodes((current) => [
        ...current,
        {
          id,
          type: "loomNode",
          position: position ?? screenToFlowPosition({ x: 430, y: 300 }),
          data: {
            kind: definition.kind,
            title: definition.label,
            definition,
            config: defaultConfig(definition),
            runStatus: "idle",
          },
        },
      ]);
      setSelectedId(id);
    },
    [screenToFlowPosition],
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
    setNodes((current) =>
      current.map((node) => (node.id === selectedId ? updater(node) : node)),
    );
  };
  const deleteSelected = () => {
    if (!selectedId) return;
    setNodes((current) => current.filter((node) => node.id !== selectedId));
    setEdges((current) =>
      current.filter(
        (edge) => edge.source !== selectedId && edge.target !== selectedId,
      ),
    );
    setSelectedId(undefined);
  };
  const resetStarter = () => {
    if (!catalog) return;
    const starter = talkieStarter(catalog.nodes);
    setNodes(starter.nodes);
    setEdges(starter.edges);
    setRun(undefined);
    setRunError(undefined);
    setSelectedId(undefined);
    setNeedsFit(true);
  };

  const execute = async () => {
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
      setSelectedId("preview");
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
      if (detail.node_id) setSelectedId(detail.node_id);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>Glitchloom</strong>
            <span>structured inference apparatus</span>
          </div>
        </div>
        <div className="loom-title">
          <span className="loom-title-label">loom</span>
          <input
            aria-label="Loom name"
            value={loomName}
            onChange={(event) => setLoomName(event.target.value)}
          />
          <ChevronDown size={14} aria-hidden="true" />
        </div>
        <div className="topbar-actions">
          <span
            className={`plugin-chip ${
              catalog?.plugin.available ? "is-ready" : "is-offline"
            }`}
            title={catalog?.plugin.error ?? catalog?.plugin.path}
          >
            <Bug size={13} />
            <span>{catalog?.plugin.available ? "Glitchlings ready" : "Plugin offline"}</span>
          </span>
          <button type="button" className="secondary-button" onClick={resetStarter}>
            <RotateCcw size={15} />
            Starter
          </button>
          <button
            type="button"
            className="run-button"
            onClick={() => void execute()}
            disabled={running || nodes.length === 0}
          >
            {running ? <CircleStop size={16} /> : <Play size={16} fill="currentColor" />}
            {running ? "Running…" : "Run loom"}
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="palette">
          <div className="palette-heading">
            <div>
              <span>Node library</span>
              <small>{catalog?.nodes.length ?? 0} instruments</small>
            </div>
            <Sparkles size={15} />
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
          <div className="palette-hint">
            <Info size={12} aria-hidden="true" />
            <span>Click to place or drag onto the loom.</span>
          </div>
          {catalogError && <p className="error-copy">{catalogError}</p>}
          {[...groupedCatalog.entries()].map(([category, definitions]) => (
            <section className="palette-group" key={category}>
              <h2>{category}</h2>
              {definitions.map((definition) => (
                <button
                  type="button"
                  draggable
                  className={`palette-node category-${categorySlug(category)}`}
                  key={definition.kind}
                  onDragStart={(event) => onPaletteDrag(event, definition)}
                  onClick={() => addNode(definition)}
                >
                  <span className="palette-thread" />
                  <span>
                    <strong>{definition.label}</strong>
                    <small>{definition.description}</small>
                  </span>
                  <Plus size={14} />
                </button>
              ))}
            </section>
          ))}
          {catalog && groupedCatalog.size === 0 && (
            <p className="empty-copy palette-empty">
              No instruments match “{paletteQuery}”.
            </p>
          )}
        </aside>

        <section
          className="canvas"
          onDrop={onDrop}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
        >
          <div className="canvas-readout" aria-hidden="true">
            <span>graph / live</span>
            <i />
            <span>{nodes.length} nodes · {edges.length} threads</span>
          </div>
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
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(undefined)}
            fitView
            fitViewOptions={{ padding: 0.015, minZoom: 0.68, maxZoom: 0.96 }}
            minZoom={0.38}
            maxZoom={1.7}
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
              <small>Model endpoints may lazily load weights on the first run</small>
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

        <Inspector
          selectedNode={selectedNode}
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
        />
      </main>
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
