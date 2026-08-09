import { type NodeProps, NodeResizer } from "@xyflow/react";
import { StickyNote, Trash2 } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
import styles from "./CanvasNote.module.css";
import { moduleClassNames as cx } from "./moduleClassNames";
import type { NoteColor, WorkflowNote } from "./types";

const COLORS: Array<{ name: NoteColor; value: string }> = [
  { name: "amber", value: "#e2aa5f" },
  { name: "teal", value: "#5ec5bb" },
  { name: "violet", value: "#a98bf4" },
  { name: "rose", value: "#e2768e" },
  { name: "slate", value: "#8492ad" },
];

export function CanvasNote({ data, selected }: NodeProps<WorkflowNote>) {
  const [draft, setDraft] = useState(data.text);
  const color = COLORS.find((item) => item.name === data.color)?.value ?? COLORS[0].value;

  useEffect(() => {
    setDraft(data.text);
  }, [data.text]);

  return (
    <article
      className={cx(styles, "note", selected && "is-selected")}
      style={{ "--note-color": color } as CSSProperties}
      data-note-color={data.color}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={220}
        minHeight={132}
        maxWidth={720}
        maxHeight={640}
        handleClassName={cx(styles, "resize-handle")}
        lineClassName={cx(styles, "resize-line")}
      />
      <header className={cx(styles, "note-header", "note-drag-handle")}>
        <StickyNote size={14} aria-hidden="true" />
        <strong>Note</strong>
        <fieldset className={cx(styles, "color-list", "nodrag")} aria-label="Note color">
          {COLORS.map((item) => (
            <button
              key={item.name}
              type="button"
              className={cx(styles, "color-button", item.name === data.color && "is-active")}
              style={{ "--swatch": item.value } as CSSProperties}
              aria-label={`Use ${item.name} note color`}
              aria-pressed={item.name === data.color}
              onClick={(event) => {
                event.stopPropagation();
                data.onUpdate?.({ color: item.name });
              }}
            />
          ))}
        </fieldset>
        <button
          type="button"
          className={cx(styles, "remove-button", "nodrag")}
          aria-label="Delete note"
          title="Delete note"
          onClick={(event) => {
            event.stopPropagation();
            data.onRemove?.();
          }}
        >
          <Trash2 size={13} />
        </button>
      </header>
      <textarea
        className={cx(styles, "note-text", "nodrag", "nowheel", "nopan")}
        aria-label="Canvas note"
        value={draft}
        placeholder="Leave context for the next person…"
        spellCheck
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          data.onUpdate?.({ text });
        }}
      />
    </article>
  );
}
