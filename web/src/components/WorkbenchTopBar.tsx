import { Bug, FilePlus2, FolderOpen, LoaderCircle, Play, RotateCcw, Save } from "lucide-react";
import styles from "../App.module.css";
import { moduleClassNames as cx } from "../moduleClassNames";
import type { CatalogResponse, LoomSpec, WorkflowSpec } from "../types";

interface WorkbenchTopBarProps {
  activeLoom?: LoomSpec;
  activeTabId: string;
  activeWorkflow?: WorkflowSpec;
  afterHours: boolean;
  catalog?: CatalogResponse;
  graphBusy: boolean;
  isDirty: boolean;
  loomName: string;
  nodeCount: number;
  running: boolean;
  savingLoom: boolean;
  savingWorkflow: boolean;
  onExecute: () => void;
  onLoomNameChange: (name: string) => void;
  onOpenEditSaveDialog: () => void;
  onOpenLibrary: () => void;
  onRequestSaveLoom: (saveAs: boolean) => void;
  onRequestStarterReset: () => void;
  onToggleAfterHours: () => void;
}

export function WorkbenchTopBar({
  activeLoom,
  activeTabId,
  activeWorkflow,
  afterHours,
  catalog,
  graphBusy,
  isDirty,
  loomName,
  nodeCount,
  running,
  savingLoom,
  savingWorkflow,
  onExecute,
  onLoomNameChange,
  onOpenEditSaveDialog,
  onOpenLibrary,
  onRequestSaveLoom,
  onRequestStarterReset,
  onToggleAfterHours,
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
          onChange={(event) => onLoomNameChange(event.target.value)}
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
          onClick={onOpenLibrary}
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
              onClick={() => onRequestSaveLoom(false)}
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
              onClick={() => onRequestSaveLoom(true)}
              disabled={savingLoom || running || !catalog}
              title="Save as a new loom (Ctrl+Shift+S)"
              aria-label="Save as a new loom"
            >
              <FilePlus2 size={15} />
            </button>
            {activeTabId === "main" && !activeLoom && (
              <button
                type="button"
                className={cx(styles, "secondary-button compact-action-button")}
                onClick={onRequestStarterReset}
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
          onClick={onExecute}
          disabled={running || savingLoom || nodeCount === 0}
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
  );
}
