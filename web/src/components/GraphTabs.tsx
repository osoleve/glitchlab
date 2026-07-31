import { LayoutDashboard, Plus, Workflow, X } from "lucide-react";
import styles from "../App.module.css";
import { moduleClassNames as cx } from "../moduleClassNames";
import type { GraphTab } from "../stores/types";
import type { LoomSpec, WorkflowSpec } from "../types";

interface GraphTabsProps {
  activeLoom?: LoomSpec;
  activeTabId: string;
  activeWorkflow?: WorkflowSpec;
  canOpenGraph: boolean;
  graphBusy: boolean;
  isDirty: boolean;
  loomName: string;
  running: boolean;
  tabs: GraphTab[];
  onOpenLibrary: () => void;
  onRequestCloseTab: (tab: GraphTab) => void;
  onSwitchTab: (tabId: string) => void;
}

export function GraphTabs({
  activeLoom,
  activeTabId,
  activeWorkflow,
  canOpenGraph,
  graphBusy,
  isDirty,
  loomName,
  running,
  tabs,
  onOpenLibrary,
  onRequestCloseTab,
  onSwitchTab,
}: GraphTabsProps) {
  return (
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
              onClick={() => onSwitchTab(tab.id)}
              disabled={running || graphBusy}
              title={title}
            >
              {tab.type === "workflow" ? <Workflow size={13} /> : <LayoutDashboard size={13} />}
              <span>{title}</span>
              {version && <em>v{version}</em>}
              {revision && <em>r{revision}</em>}
              {dirty && <i role="img" aria-label="Unsaved changes" title="Unsaved changes" />}
            </button>
            {tab.id !== "main" && (
              <button
                type="button"
                className={cx(styles, "graph-tab-close")}
                onClick={() => onRequestCloseTab(tab)}
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
        onClick={onOpenLibrary}
        disabled={running || graphBusy || !canOpenGraph}
        aria-label="Open loom or template"
        title="Open loom or template"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
