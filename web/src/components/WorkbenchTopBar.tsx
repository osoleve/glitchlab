import {
  Bug,
  FilePlus2,
  FolderOpen,
  LoaderCircle,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Undo2,
} from "lucide-react";
import styles from "../App.module.css";
import { moduleClassNames as cx } from "../moduleClassNames";
import type { CatalogResponse, GraphDocument, WorkflowSpec } from "../types";

interface WorkbenchTopBarProps {
  activeGraph?: GraphDocument;
  activeTabId: string;
  activeWorkflow?: WorkflowSpec;
  afterHours: boolean;
  canRedo: boolean;
  canUndo: boolean;
  catalog?: CatalogResponse;
  graphBusy: boolean;
  isDirty: boolean;
  graphName: string;
  nodeCount: number;
  running: boolean;
  savingGraph: boolean;
  savingWorkflow: boolean;
  onExecute: () => void;
  onGraphNameChange: (name: string) => void;
  onOpenEditSaveDialog: () => void;
  onOpenLibrary: () => void;
  onRequestSaveGraph: (saveAs: boolean) => void;
  onRequestStarterReset: () => void;
  onRedo: () => void;
  onToggleAfterHours: () => void;
  onUndo: () => void;
}

export function WorkbenchTopBar({
  activeGraph,
  activeTabId,
  activeWorkflow,
  afterHours,
  canRedo,
  canUndo,
  catalog,
  graphBusy,
  isDirty,
  graphName,
  nodeCount,
  running,
  savingGraph,
  savingWorkflow,
  onExecute,
  onGraphNameChange,
  onOpenEditSaveDialog,
  onOpenLibrary,
  onRequestSaveGraph,
  onRequestStarterReset,
  onRedo,
  onToggleAfterHours,
  onUndo,
}: WorkbenchTopBarProps) {
  return (
    <header className={cx(styles, "topbar")}>
      <button
        type="button"
        className={cx(styles, "brand")}
        aria-label="Toggle after-hours weave"
        aria-pressed={afterHours}
        title="Wake the loom"
        onClick={onToggleAfterHours}
      >
        <div className={cx(styles, "brand-mark")} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className={cx(styles, "brand-copy")}>
          <strong>Glitchlab</strong>
          <small>{afterHours ? "the loom hums back" : "after hours"}</small>
        </span>
      </button>
      <div className={cx(styles, "graph-title")}>
        <span className={cx(styles, "graph-title-label")}>
          {activeWorkflow
            ? "workflow"
            : activeGraph
              ? `saved graph · r${activeGraph.revision}`
              : "graph draft"}
        </span>
        <input
          aria-label={activeWorkflow ? "Workflow name" : "Graph name"}
          value={graphName}
          disabled={savingGraph || running}
          onChange={(event) => onGraphNameChange(event.target.value)}
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
          className={cx(styles, "secondary-button compact-action-button")}
          onClick={onUndo}
          disabled={!canUndo || running || graphBusy}
          title="Undo graph change (Ctrl+Z)"
          aria-label="Undo graph change"
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          className={cx(styles, "secondary-button compact-action-button")}
          onClick={onRedo}
          disabled={!canRedo || running || graphBusy}
          title="Redo graph change (Ctrl+Shift+Z)"
          aria-label="Redo graph change"
        >
          <Redo2 size={15} />
        </button>
        <button
          type="button"
          className={cx(styles, "secondary-button")}
          onClick={onOpenLibrary}
          disabled={running || graphBusy || !catalog}
          title="Open a saved graph or template"
        >
          <FolderOpen size={15} />
          Open
        </button>
        {activeWorkflow ? (
          <button
            type="button"
            className={cx(styles, "secondary-button workflow-save-button")}
            onClick={onOpenEditSaveDialog}
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
              onClick={() => onRequestSaveGraph(false)}
              disabled={savingGraph || running || !catalog}
              title="Save graph (Ctrl+S)"
            >
              {savingGraph ? (
                <LoaderCircle className={cx(styles, "spin-icon")} size={15} />
              ) : (
                <Save size={15} />
              )}
              Save
            </button>
            <button
              type="button"
              className={cx(styles, "secondary-button compact-action-button")}
              onClick={() => onRequestSaveGraph(true)}
              disabled={savingGraph || running || !catalog}
              title="Save as a new graph (Ctrl+Shift+S)"
              aria-label="Save as a new graph"
            >
              <FilePlus2 size={15} />
            </button>
            {activeTabId === "main" && !activeGraph && (
              <button
                type="button"
                className={cx(styles, "secondary-button compact-action-button")}
                onClick={onRequestStarterReset}
                disabled={savingGraph || running || !catalog}
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
          onClick={onExecute}
          disabled={running || savingGraph || nodeCount === 0}
          title="Run graph (Ctrl+Enter)"
        >
          {running ? (
            <LoaderCircle className={cx(styles, "spin-icon")} size={16} />
          ) : (
            <Play size={16} fill="currentColor" />
          )}
          {running ? "Running…" : "Run graph"}
        </button>
      </div>
    </header>
  );
}
