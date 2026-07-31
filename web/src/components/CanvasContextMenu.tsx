import {
  Columns3,
  Copy,
  Focus,
  GitMerge,
  Network,
  Pencil,
  Play,
  Plus,
  Rows3,
  Save,
  Search,
  Trash2,
  Unplug,
} from "lucide-react";
import styles from "../App.module.css";
import { moduleClassNames as cx } from "../moduleClassNames";
import type { NodeDefinition, PortDefinition, ValueType } from "../types";

export type ContextMenuState =
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

export interface QuickAddEntry {
  definition: NodeDefinition;
  input?: PortDefinition;
}

type Arrangement = "align-left" | "align-top" | "distribute-x" | "distribute-y";

interface CanvasContextMenuProps {
  contextMenu: ContextMenuState;
  contextualWorkflowDefinition?: NodeDefinition;
  contextSelectionIds: string[];
  nodeCount: number;
  quickAddEntries: QuickAddEntry[];
  quickAddIndex: number;
  quickAddQuery: string;
  running: boolean;
  onAddQuickNode: (definition: NodeDefinition, input?: PortDefinition) => void;
  onArrangeSelection: (nodeIds: string[], mode: Arrangement) => void;
  onDeleteNodes: (nodeIds: string[]) => void;
  onDeleteWorkflow: (definition: NodeDefinition) => void;
  onDisconnectEdge: (edgeId: string) => void;
  onDismiss: () => void;
  onDuplicateNodes: (nodeIds: string[]) => void;
  onExecute: (nodeIds: string[]) => void;
  onFitGraph: () => void;
  onInsertPassthrough: (edgeId: string, position: { x: number; y: number }) => void;
  onOpenSaveWorkflow: () => void;
  onOpenWorkflowEditor: (definition: NodeDefinition) => void;
  onQuickAddIndexChange: (index: number) => void;
  onQuickAddQueryChange: (query: string) => void;
  onSelectAllNodes: () => void;
  onSelectRelated: (nodeIds: string[], direction: "upstream" | "downstream") => void;
  onTidyNodes: (nodeIds?: string[]) => void;
}

export function CanvasContextMenu({
  contextMenu,
  contextualWorkflowDefinition,
  contextSelectionIds,
  nodeCount,
  quickAddEntries,
  quickAddIndex,
  quickAddQuery,
  running,
  onAddQuickNode,
  onArrangeSelection,
  onDeleteNodes,
  onDeleteWorkflow,
  onDisconnectEdge,
  onDismiss,
  onDuplicateNodes,
  onExecute,
  onFitGraph,
  onInsertPassthrough,
  onOpenSaveWorkflow,
  onOpenWorkflowEditor,
  onQuickAddIndexChange,
  onQuickAddQueryChange,
  onSelectAllNodes,
  onSelectRelated,
  onTidyNodes,
}: CanvasContextMenuProps) {
  return (
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
          Math.min(contextMenu.x, window.innerWidth - (contextMenu.scope === "pane" ? 294 : 226)),
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
                onClick={() => onOpenWorkflowEditor(contextualWorkflowDefinition)}
              >
                <Pencil size={14} />
                Edit saved workflow
              </button>
              <button
                type="button"
                role="menuitem"
                className={cx(styles, "is-danger")}
                onClick={() => onDeleteWorkflow(contextualWorkflowDefinition)}
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
              onExecute(contextMenu.scope === "node" ? [contextMenu.nodeId] : contextMenu.nodeIds)
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
              onClick={() => onExecute(contextMenu.nodeIds)}
            >
              <Play size={14} />
              Run to selection
            </button>
          )}
          <span className={cx(styles, "context-menu-separator")} />
          <button
            type="button"
            role="menuitem"
            onClick={() => onDuplicateNodes(contextSelectionIds)}
          >
            <Copy size={14} />
            Duplicate
            <kbd>Ctrl+D</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => onSelectRelated(contextMenu.nodeIds, "upstream")}
          >
            <GitMerge size={14} />
            Select upstream
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => onSelectRelated(contextMenu.nodeIds, "downstream")}
          >
            <Columns3 size={14} />
            Select downstream
          </button>
          <button type="button" role="menuitem" onClick={onOpenSaveWorkflow}>
            <Save size={14} />
            Save as workflow
          </button>
          {contextSelectionIds.length >= 2 && (
            <>
              <span className={cx(styles, "context-menu-separator")} />
              <button
                type="button"
                role="menuitem"
                onClick={() => onTidyNodes(contextSelectionIds)}
              >
                <Network size={14} />
                Tidy selection
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => onArrangeSelection(contextSelectionIds, "align-left")}
              >
                <Columns3 size={14} />
                Align left
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => onArrangeSelection(contextSelectionIds, "align-top")}
              >
                <Rows3 size={14} />
                Align top
              </button>
              {contextSelectionIds.length >= 3 && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => onArrangeSelection(contextSelectionIds, "distribute-x")}
                  >
                    <Columns3 size={14} />
                    Distribute horizontally
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => onArrangeSelection(contextSelectionIds, "distribute-y")}
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
              onDeleteNodes(contextSelectionIds);
              onDismiss();
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
            onClick={() => onInsertPassthrough(contextMenu.edgeId, contextMenu.flowPosition)}
          >
            <Plus size={14} />
            Insert passthrough
          </button>
          <span className={cx(styles, "context-menu-separator")} />
          <button
            type="button"
            role="menuitem"
            className={cx(styles, "is-danger")}
            onClick={() => onDisconnectEdge(contextMenu.edgeId)}
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
                onQuickAddQueryChange(event.target.value);
                onQuickAddIndexChange(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  onQuickAddIndexChange(
                    Math.min(quickAddIndex + 1, Math.max(0, quickAddEntries.length - 1)),
                  );
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  onQuickAddIndexChange(Math.max(0, quickAddIndex - 1));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const entry = quickAddEntries[quickAddIndex];
                  if (entry) onAddQuickNode(entry.definition, entry.input);
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
                onMouseEnter={() => onQuickAddIndexChange(index)}
                onClick={() => onAddQuickNode(definition, input)}
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
              <button type="button" role="menuitem" onClick={onSelectAllNodes}>
                <Focus size={14} />
                Select all nodes
                <kbd>Ctrl+A</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={nodeCount < 2}
                onClick={() => onTidyNodes()}
              >
                <Network size={14} />
                Tidy graph
              </button>
              <button type="button" role="menuitem" onClick={onFitGraph}>
                <Focus size={14} />
                Fit graph in view
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
