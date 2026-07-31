import { PanelLeftClose, Pencil, Plus, Search, X } from "lucide-react";
import type { DragEvent, RefObject } from "react";
import styles from "../App.module.css";
import { moduleClassNames as cx } from "../moduleClassNames";
import type { CatalogResponse, NodeDefinition } from "../types";

interface NodePaletteProps {
  catalog?: CatalogResponse;
  catalogError?: string;
  groupedCatalog: Map<string, NodeDefinition[]>;
  paletteQuery: string;
  paletteRef: RefObject<HTMLElement | null>;
  onAddNode: (definition: NodeDefinition) => void;
  onClose: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>, definition: NodeDefinition) => void;
  onManageWorkflow: (definition: NodeDefinition, x: number, y: number) => void;
  onQueryChange: (query: string) => void;
}

function categorySlug(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "-");
}

export function NodePalette({
  catalog,
  catalogError,
  groupedCatalog,
  paletteQuery,
  paletteRef,
  onAddNode,
  onClose,
  onDragStart,
  onManageWorkflow,
  onQueryChange,
}: NodePaletteProps) {
  return (
    <aside ref={paletteRef} className={cx(styles, "palette")}>
      <div className={cx(styles, "palette-heading")}>
        <span>Node library</span>
        <button
          type="button"
          className={cx(styles, "panel-close-button")}
          onClick={onClose}
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
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Filter nodes"
          aria-label="Filter nodes"
        />
        {paletteQuery && (
          <button type="button" aria-label="Clear node filter" onClick={() => onQueryChange("")}>
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
                  onDragStart={(event) => onDragStart(event, definition)}
                  onClick={() => onAddNode(definition)}
                  onContextMenu={(event) => {
                    if (!definition.workflow) return;
                    event.preventDefault();
                    onManageWorkflow(definition, event.clientX, event.clientY);
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
                      onManageWorkflow(definition, bounds.right, bounds.bottom);
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
  );
}
