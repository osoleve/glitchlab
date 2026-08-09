import {
  Background,
  BackgroundVariant,
  type Connection,
  type ConnectionLineType,
  Controls,
  type EdgeChange,
  MiniMap,
  type NodeChange,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import { Focus, PanelLeftOpen, PanelRightOpen, X } from "lucide-react";
import {
  type DragEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "../App.module.css";
import { CanvasNote } from "../CanvasNote";
import { WorkflowFrameNode } from "../FrameNode";
import { moduleClassNames as cx } from "../moduleClassNames";
import {
  pathPoints,
  polylineIntersectsRect,
  rectsIntersect,
  selectionRect,
} from "../selectionGeometry";
import { useGraphDocumentStore } from "../stores/graphDocumentStore";
import type { RunActivity } from "../stores/runControllerStore";
import type { ExecutionScopeState } from "../stores/types";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type {
  CanvasNode,
  EdgeRouting,
  FlowPosition,
  SelectionKind,
  WireBundle,
  WireColor,
  WirePresentation,
  WorkflowEdge,
  WorkflowNode,
} from "../types";
import { SelectedWiresToolbar, WireEdge } from "../WireEdge";
import { WorkflowNodeCardWithBoundary } from "../WorkflowNode";
import type { ContextMenuState } from "./CanvasContextMenu";

const nodeTypes = {
  workflowNode: WorkflowNodeCardWithBoundary,
  workflowFrame: WorkflowFrameNode,
  workflowNote: CanvasNote,
};
const edgeTypes = { wire: WireEdge };

interface GraphCanvasProps {
  canvasRef: RefObject<HTMLElement | null>;
  children?: ReactNode;
  edges: WorkflowEdge[];
  edgeRouting: EdgeRouting;
  wires: WirePresentation[];
  wireBundles: WireBundle[];
  executionScope?: ExecutionScopeState;
  nodes: CanvasNode[];
  runElapsed: number;
  runActivity?: RunActivity;
  runError?: string;
  running: boolean;
  savingGraph: boolean;
  onClearExecutionScope: () => void;
  onConnect: (connection: Connection) => void;
  onDismissRunError: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => void;
  onRemoveEdges: (edgeIds: string[]) => void;
  onBundleEdges: (edgeIds: string[], start: FlowPosition, end: FlowPosition) => void;
  onAddEdgesToBundle: (bundleId: string, edgeIds: string[]) => void;
  onUnbundleEdges: (edgeIds: string[]) => void;
  onSetWireColor: (edgeIds: string[], color?: WireColor) => void;
  onFitExecutionScope: () => void;
  onNodeDragStop: () => void;
  onNodesChange: (changes: NodeChange<CanvasNode>[]) => void;
  onOpenContextMenu: (contextMenu?: ContextMenuState) => void;
  onReconnect: (edge: WorkflowEdge, connection: Connection) => void;
  onReconnectEnd: (
    event: MouseEvent | TouchEvent,
    edge: WorkflowEdge,
    handleType: "source" | "target",
    connectionState: { isValid: boolean | null },
  ) => void;
  onReconnectStart: () => void;
  onResetQuickAdd: () => void;
  isValidConnection: (connection: Connection | WorkflowEdge) => boolean;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s elapsed`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`;
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

type MarqueeMode = "replace" | "add" | "remove";

interface MarqueeState {
  pointerId: number;
  start: FlowPosition;
  current: FlowPosition;
  kind?: SelectionKind;
  baselineIds: string[];
  mode: MarqueeMode;
  moved: boolean;
  hitCount: number;
  hitIds: string[];
  nodeGeometry: { id: string; rect: ReturnType<typeof selectionRect> }[];
  wireGeometry: { id: string; points: FlowPosition[] }[];
}

function combineMarqueeIds(
  baselineIds: readonly string[],
  hitIds: readonly string[],
  mode: MarqueeMode,
): string[] {
  if (mode === "replace") return [...hitIds];
  const selected = new Set(baselineIds);
  for (const id of hitIds) {
    if (mode === "add") selected.add(id);
    else selected.delete(id);
  }
  return [...selected];
}

function elementRect(element: Element): ReturnType<typeof selectionRect> {
  const bounds = element.getBoundingClientRect();
  return {
    left: bounds.left,
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
  };
}

function squaredDistance(left: FlowPosition, right: FlowPosition): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

export function GraphCanvas({
  canvasRef,
  children,
  edges,
  edgeRouting,
  wires,
  wireBundles,
  executionScope,
  nodes,
  runElapsed,
  runActivity,
  runError,
  running,
  savingGraph,
  onClearExecutionScope,
  onConnect,
  onDismissRunError,
  onDrop,
  onEdgesChange,
  onRemoveEdges,
  onBundleEdges,
  onAddEdgesToBundle,
  onUnbundleEdges,
  onSetWireColor,
  onFitExecutionScope,
  onNodeDragStop,
  onNodesChange,
  onOpenContextMenu,
  onReconnect,
  onReconnectEnd,
  onReconnectStart,
  onResetQuickAdd,
  isValidConnection,
}: GraphCanvasProps) {
  const { flowToScreenPosition, screenToFlowPosition } = useReactFlow();
  const documentNodes = useGraphDocumentStore((state) => state.nodes);
  const documentEdges = useGraphDocumentStore((state) => state.edges);
  const selectionKind = useGraphDocumentStore((state) => state.selectionKind);
  const clearSelection = useGraphDocumentStore((state) => state.clearSelection);
  const setFrames = useGraphDocumentStore((state) => state.setFrames);
  const setNotes = useGraphDocumentStore((state) => state.setNotes);
  const selectNode = useGraphDocumentStore((state) => state.selectNode);
  const selectNodes = useGraphDocumentStore((state) => state.selectNodes);
  const selectEdges = useGraphDocumentStore((state) => state.selectEdges);
  const paletteOpen = useWorkspaceStore((state) => state.paletteOpen);
  const inspectorOpen = useWorkspaceStore((state) => state.inspectorOpen);
  const setPaletteOpen = useWorkspaceStore((state) => state.setPaletteOpen);
  const setInspectorOpen = useWorkspaceStore((state) => state.setInspectorOpen);
  const selectedNodes = documentNodes.filter((node) => node.selected);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string>();
  const [marquee, setMarquee] = useState<MarqueeState>();
  const marqueeRef = useRef<MarqueeState | undefined>(undefined);
  const ignoreNextPaneClick = useRef(false);

  const hoveredEdge = edges.find((edge) => edge.id === hoveredEdgeId);
  const hoveredEdgeIds = useMemo(
    () => new Set(hoveredEdge?.data?.bundle?.edgeIds ?? (hoveredEdge ? [hoveredEdge.id] : [])),
    [hoveredEdge],
  );
  const displayEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        className: [
          edge.className,
          hoveredEdgeIds.size > 0
            ? hoveredEdgeIds.has(edge.id)
              ? styles["wire-hovered"]
              : styles["wire-hover-dimmed"]
            : undefined,
        ]
          .filter(Boolean)
          .join(" "),
      })),
    [edges, hoveredEdgeIds],
  );
  const hoveredSemanticEdge = documentEdges.find((edge) => hoveredEdgeIds.has(edge.id));
  const displayNodes = useMemo(
    () =>
      nodes.map((node) => {
        if (node.type !== "workflowNode" || !hoveredSemanticEdge) return node;
        const wireHover =
          node.id === hoveredSemanticEdge.source
            ? { direction: "output" as const, portName: hoveredSemanticEdge.sourceHandle ?? "" }
            : node.id === hoveredSemanticEdge.target
              ? { direction: "input" as const, portName: hoveredSemanticEdge.targetHandle ?? "" }
              : undefined;
        return { ...node, data: { ...node.data, wireHover } };
      }),
    [hoveredSemanticEdge, nodes],
  );

  const startMarquee = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (
      !target.closest(".react-flow__pane") ||
      target.closest(
        ".react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap, button, input, select, textarea",
      )
    ) {
      return;
    }
    const kind = selectionKind;
    const baselineIds =
      kind === "wire"
        ? documentEdges.filter((edge) => edge.selected).map((edge) => edge.id)
        : kind === "node"
          ? documentNodes.filter((node) => node.selected).map((node) => node.id)
          : [];
    const next: MarqueeState = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      current: { x: event.clientX, y: event.clientY },
      kind,
      baselineIds,
      mode: event.altKey ? "remove" : event.ctrlKey || event.metaKey ? "add" : "replace",
      moved: false,
      hitCount: 0,
      hitIds: [],
      nodeGeometry: documentNodes.flatMap((node) => {
        const element = document.querySelector(
          `.react-flow__node[data-id="${CSS.escape(node.id)}"]`,
        );
        return element ? [{ id: node.id, rect: elementRect(element) }] : [];
      }),
      wireGeometry: edges.flatMap((edge) => {
        if (edge.data?.presentationProxy) return [];
        const group = [...document.querySelectorAll<SVGGElement>(".react-flow__edge")].find(
          (element) => element.dataset.id === edge.id,
        );
        const path = group?.querySelector<SVGPathElement>(".react-flow__edge-path");
        return path
          ? [{ id: edge.id, points: pathPoints(path).map((point) => flowToScreenPosition(point)) }]
          : [];
      }),
    };
    marqueeRef.current = next;
    setMarquee(next);

    const move = (pointerEvent: PointerEvent) => {
      const current = marqueeRef.current;
      if (!current || current.pointerId !== pointerEvent.pointerId) return;
      const nextPoint = { x: pointerEvent.clientX, y: pointerEvent.clientY };
      const moved = current.moved || squaredDistance(current.start, nextPoint) >= 16;
      const rect = selectionRect(current.start, nextPoint);
      const nodeHits = current.nodeGeometry.flatMap((node) =>
        rectsIntersect(rect, node.rect) ? [node.id] : [],
      );
      const wireHitDetails = current.wireGeometry.flatMap((wire) => {
        if (!polylineIntersectsRect(wire.points, rect)) return [];
        return [
          {
            id: wire.id,
            distance: Math.min(
              ...wire.points.map((point) => squaredDistance(current.start, point)),
            ),
          },
        ];
      });
      let kind = current.kind;
      if (!kind && (nodeHits.length > 0 || wireHitDetails.length > 0)) {
        if (nodeHits.length === 0) kind = "wire";
        else if (wireHitDetails.length === 0) kind = "node";
        else {
          const nodeDistance = Math.min(
            ...nodeHits.map((nodeId) => {
              const bounds = current.nodeGeometry.find((node) => node.id === nodeId)!.rect;
              return squaredDistance(current.start, {
                x: (bounds.left + bounds.right) / 2,
                y: (bounds.top + bounds.bottom) / 2,
              });
            }),
          );
          const wireDistance = Math.min(...wireHitDetails.map((hit) => hit.distance));
          kind = wireDistance < nodeDistance ? "wire" : "node";
        }
      }
      const currentHitIds =
        kind === "node" ? nodeHits : kind === "wire" ? wireHitDetails.map((hit) => hit.id) : [];
      const hitIds = [...new Set([...current.hitIds, ...currentHitIds])];
      const updated = {
        ...current,
        current: nextPoint,
        kind,
        moved,
        hitCount: hitIds.length,
        hitIds,
      };
      marqueeRef.current = updated;
      setMarquee(updated);
      if (!moved || !kind) return;
      if (kind === "node") {
        const ids = combineMarqueeIds(current.baselineIds, hitIds, current.mode);
        selectNodes(ids, ids.at(-1));
        setInspectorOpen(ids.length > 0);
      } else {
        const ids = combineMarqueeIds(current.baselineIds, hitIds, current.mode);
        selectEdges(ids);
        setInspectorOpen(false);
      }
      onOpenContextMenu(undefined);
    };
    const finish = (pointerEvent: PointerEvent) => {
      const current = marqueeRef.current;
      if (!current || current.pointerId !== pointerEvent.pointerId) return;
      ignoreNextPaneClick.current = current.moved;
      marqueeRef.current = undefined;
      setMarquee(undefined);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.setTimeout(() => {
        ignoreNextPaneClick.current = false;
      }, 100);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: React Flow canvas is a native drop target
    <section
      ref={canvasRef}
      className={cx(styles, "canvas")}
      onPointerDownCapture={startMarquee}
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
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
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
          const sourceNode = documentNodes.find((node) => node.id === connectionState.fromNode?.id);
          const sourceHandle = connectionState.fromHandle.id;
          const sourcePort = sourceNode?.data.definition.outputs.find(
            (port) => port.name === sourceHandle,
          );
          if (!sourceNode || !sourcePort) return;
          onResetQuickAdd();
          onOpenContextMenu({
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
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
        elementsSelectable={false}
        edgesReconnectable
        reconnectRadius={28}
        connectionRadius={32}
        selectionKeyCode={null}
        selectionOnDrag={false}
        panOnDrag={[1]}
        multiSelectionKeyCode={null}
        onNodeClick={(event, node) => {
          if (node.type === "workflowFrame") {
            setInspectorOpen(false);
            onOpenContextMenu(undefined);
            return;
          }
          if (node.type === "workflowNote") {
            clearSelection();
            setFrames((current) => current.map((frame) => ({ ...frame, selected: false })));
            setNotes((current) =>
              current.map((note) => ({ ...note, selected: note.id === node.id })),
            );
            setInspectorOpen(false);
            onOpenContextMenu(undefined);
            return;
          }
          const anchor = selectNode(node.id, event.ctrlKey || event.metaKey);
          setInspectorOpen(Boolean(anchor));
          onOpenContextMenu(undefined);
        }}
        onEdgeClick={(event, edge) => {
          if (edge.data?.presentationProxy) return;
          selectEdges([edge.id], event.ctrlKey || event.metaKey);
          setInspectorOpen(false);
          onOpenContextMenu(undefined);
        }}
        onEdgeMouseEnter={(_event, edge) => setHoveredEdgeId(edge.id)}
        onEdgeMouseLeave={(_event, edge) => {
          setHoveredEdgeId((current) => (current === edge.id ? undefined : current));
        }}
        onPaneClick={() => {
          if (ignoreNextPaneClick.current) return;
          clearSelection();
          setFrames((current) => current.map((frame) => ({ ...frame, selected: false })));
          setInspectorOpen(false);
          onOpenContextMenu(undefined);
        }}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          if (node.type === "workflowFrame") {
            clearSelection();
            setFrames((current) =>
              current.map((frame) => ({ ...frame, selected: frame.id === node.id })),
            );
            setInspectorOpen(false);
            onOpenContextMenu({
              x: event.clientX,
              y: event.clientY,
              scope: "frame",
              frameId: node.id,
            });
            return;
          }
          if (node.type === "workflowNote") {
            clearSelection();
            setFrames((current) => current.map((frame) => ({ ...frame, selected: false })));
            setNotes((current) =>
              current.map((note) => ({ ...note, selected: note.id === node.id })),
            );
            setInspectorOpen(false);
            onOpenContextMenu({
              x: event.clientX,
              y: event.clientY,
              scope: "note",
              noteId: node.id,
            });
            return;
          }
          const nodeIds =
            node.selected && selectedNodes.length > 0
              ? selectedNodes.map((item) => item.id)
              : [node.id];
          selectNodes(nodeIds, node.id);
          setInspectorOpen(true);
          onOpenContextMenu({
            x: event.clientX,
            y: event.clientY,
            scope: "node",
            nodeId: node.id,
            nodeIds,
          });
        }}
        onSelectionContextMenu={(event) => {
          event.preventDefault();
          onOpenContextMenu({
            x: event.clientX,
            y: event.clientY,
            scope: "selection",
            nodeIds: selectedNodes.map((node) => node.id),
          });
        }}
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault();
          if (edge.data?.presentationProxy) return;
          if (!edge.selected) selectEdges([edge.id]);
          setInspectorOpen(false);
          onOpenContextMenu({
            x: event.clientX,
            y: event.clientY,
            scope: "edge",
            edgeId: edge.id,
            flowPosition: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
          });
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          onResetQuickAdd();
          onOpenContextMenu({
            x: event.clientX,
            y: event.clientY,
            scope: "pane",
            flowPosition: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
          });
        }}
        fitView
        fitViewOptions={{ padding: 0.03, minZoom: 0.52, maxZoom: 0.95 }}
        minZoom={0.32}
        maxZoom={1.7}
        deleteKeyCode={savingGraph ? null : ["Backspace", "Delete"]}
        colorMode="dark"
        connectionLineStyle={{ stroke: "#b8a4e6", strokeWidth: 2 }}
        connectionLineType={edgeRouting as ConnectionLineType}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Lines} gap={32} size={0.7} color="#292633" />
        <MiniMap
          nodeColor={(node) => {
            if (node.type === "workflowFrame") return "rgba(169, 139, 244, 0.24)";
            if (node.type === "workflowNote") return "#e2aa5f";
            const category = (node.data as WorkflowNode["data"]).definition.category;
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
        <SelectedWiresToolbar
          edges={edges}
          wires={wires}
          wireBundles={wireBundles}
          disabled={savingGraph || running}
          onBundle={onBundleEdges}
          onAddToBundle={onAddEdgesToBundle}
          onUnbundle={onUnbundleEdges}
          onSetColor={onSetWireColor}
          onRemove={onRemoveEdges}
        />
      </ReactFlow>
      {marquee?.moved && (
        <div
          className={cx(styles, "selection-marquee", marquee.kind && `kind-${marquee.kind}`)}
          style={(() => {
            const bounds = canvasRef.current?.getBoundingClientRect();
            const rect = selectionRect(marquee.start, marquee.current);
            return {
              left: rect.left - (bounds?.left ?? 0),
              top: rect.top - (bounds?.top ?? 0),
              width: rect.right - rect.left,
              height: rect.bottom - rect.top,
            };
          })()}
        >
          <span>
            {marquee.kind
              ? `Selecting ${marquee.kind === "wire" ? "wires" : "nodes"} · ${marquee.hitCount}`
              : "Select"}
          </span>
        </div>
      )}
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
                : "Full graph run"}
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
            onClick={onFitExecutionScope}
            title="Fit execution scope"
            aria-label="Fit execution scope"
          >
            <Focus size={14} />
          </button>
          <button
            type="button"
            onClick={onClearExecutionScope}
            disabled={running}
            title="Clear execution focus"
            aria-label="Clear execution focus"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {running && (
        <div className={cx(styles, "run-overlay")} role="status" aria-live="polite">
          <span className={cx(styles, "shuttle")} />
          <strong>
            {runActivity?.activeNodeTitle
              ? `Running ${runActivity.activeNodeTitle}`
              : executionScope?.nodeIds.length
                ? "Preparing next node"
                : "Planning workflow"}
          </strong>
          <small>
            {runActivity?.completedNodeIds.length ?? 0}/{executionScope?.nodeIds.length ?? "?"}{" "}
            nodes complete · {formatElapsed(runElapsed)}
          </small>
        </div>
      )}
      {runError && !running && (
        <div className={cx(styles, "run-error-banner")}>
          <strong>Run stopped</strong>
          <span>{runError}</span>
          <button type="button" onClick={onDismissRunError}>
            Dismiss
          </button>
        </div>
      )}
      {children}
    </section>
  );
}
