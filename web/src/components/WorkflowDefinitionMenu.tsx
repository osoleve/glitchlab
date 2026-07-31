import { LoaderCircle, Pencil, Trash2 } from "lucide-react";
import styles from "../App.module.css";
import { moduleClassNames as cx } from "../moduleClassNames";
import type { NodeDefinition } from "../types";

export interface WorkflowMenuState {
  x: number;
  y: number;
  definition: NodeDefinition;
}

interface WorkflowDefinitionMenuProps {
  menu: WorkflowMenuState;
  loadingWorkflowId?: string;
  onDelete: (definition: NodeDefinition) => void;
  onEdit: (definition: NodeDefinition) => void;
}

export function WorkflowDefinitionMenu({
  menu,
  loadingWorkflowId,
  onDelete,
  onEdit,
}: WorkflowDefinitionMenuProps) {
  const loading = loadingWorkflowId === menu.definition.workflow?.id;

  return (
    <div
      className={cx(styles, "context-menu workflow-library-menu")}
      role="menu"
      style={{
        left: Math.min(menu.x, window.innerWidth - 226),
        top: Math.min(menu.y, window.innerHeight - 150),
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => onEdit(menu.definition)}
        disabled={loading}
      >
        {loading ? (
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
        onClick={() => onDelete(menu.definition)}
      >
        <Trash2 size={14} />
        Delete saved workflow
      </button>
    </div>
  );
}
