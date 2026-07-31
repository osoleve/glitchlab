import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type EdgeChange,
  MiniMap,
  type NodeChange,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import { Focus, PanelLeftOpen, PanelRightOpen, X } from "lucide-react";
import type { DragEvent, ReactNode, RefObject } from "react";
import styles from "../App.module.css";
import { LoomNodeCardWithBoundary } from "../LoomNode";
import { moduleClassNames as cx } from "../moduleClassNames";
import { useGraphDocumentStore } from "../stores/graphDocumentStore";
import type { ExecutionScopeState } from "../stores/types";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { LoomEdge, LoomNode } from "../types";
import type { ContextMenuState } from "./CanvasContextMenu";

const nodeTypes = { loomNode: LoomNodeCardWithBoundary };

interface GraphCanvasProps {
  canvasRef: RefObject<HTMLElement | null>;
  children?: ReactNode;
  edges: LoomEdge[];
  executionScope?: ExecutionScopeState;
  nodes: LoomNode[];
  runElapsed: number;
  runError?: string;
  running: boolean;
  savingLoom: boolean;
  onClearExecutionScope: () => void;
  onConnect: (connection: Connection) => void;
  onDismissRunError: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onEdgesChange: (changes: EdgeChange<LoomEdge>[]) => void;
  onFitExecutionScope: () => void;
  onNodesChange: (changes: NodeChange<LoomNode>[]) => void;
  onOpenContextMenu: (contextMenu?: ContextMenuState) => void;
  onReconnect: (edge: LoomEdge, connection: Connection) => void;
  onReconnectEnd: (
    event: MouseEvent | TouchEvent,
    edge: LoomEdge,
    handleType: "source" | "target",
    connectionState: { isValid: boolean | null },
  ) => void;
  onReconnectStart: () => void;
  onResetQuickAdd: () => void;
  isValidConnection: (connection: Connection | LoomEdge) => boolean;
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

export function GraphCanvas({
  canvasRef,
  children,
  edges,
  executionScope,
  nodes,
  runElapsed,
  runError,
  running,
  savingLoom,
  onClearExecutionScope,
  onConnect,
  onDismissRunError,
  onDrop,
  onEdgesChange,
  onFitExecutionScope,
  onNodesChange,
  onOpenContextMenu,
  onReconnect,
  onReconnectEnd,
  onReconnectStart,
  onResetQuickAdd,
  isValidConnection,
}: GraphCanvasProps) {
  const { screenToFlowPosition } = useReactFlow();
  const documentNodes = useGraphDocumentStore((state) => state.nodes);
  const clearSelection = useGraphDocumentStore((state) => state.clearSelection);
  const selectNode = useGraphDocumentStore((state) => state.selectNode);
  const selectNodes = useGraphDocumentStore((state) => state.selectNodes);
  const paletteOpen = useWorkspaceStore((state) => state.paletteOpen);
  const inspectorOpen = useWorkspaceStore((state) => state.inspectorOpen);
  const setPaletteOpen = useWorkspaceStore((state) => state.setPaletteOpen);
  const setInspectorOpen = useWorkspaceStore((state) => state.setInspectorOpen);
  const selectedNodes = documentNodes.filter((node) => node.selected);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: React Flow canvas is a native drop target
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
        nodes={nodes}
        edges={edges}
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
        edgesReconnectable
        reconnectRadius={18}
        multiSelectionKeyCode={["Control", "Meta"]}
        onNodeClick={(event, node) => {
          const anchor = selectNode(node.id, event.ctrlKey || event.metaKey);
          setInspectorOpen(Boolean(anchor));
          onOpenContextMenu(undefined);
        }}
        onPaneClick={() => {
          clearSelection();
          setInspectorOpen(false);
          onOpenContextMenu(undefined);
        }}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
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
          <button type="button" onClick={onDismissRunError}>
            Dismiss
          </button>
        </div>
      )}
      {children}
    </section>
  );
}
