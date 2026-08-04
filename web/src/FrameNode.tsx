import { Handle, type NodeProps, NodeResizer, Position } from "@xyflow/react";
import { ChevronDown, ChevronRight, Frame } from "lucide-react";
import type { CSSProperties } from "react";
import styles from "./FrameNode.module.css";
import { moduleClassNames as cx } from "./moduleClassNames";
import type { FrameColor, WorkflowFrame } from "./types";

const COLORS: Array<{ name: FrameColor; value: string }> = [
  { name: "violet", value: "#a98bf4" },
  { name: "teal", value: "#5ec5bb" },
  { name: "amber", value: "#e2aa5f" },
  { name: "rose", value: "#e2768e" },
  { name: "slate", value: "#8492ad" },
];

export function WorkflowFrameNode({ data, selected }: NodeProps<WorkflowFrame>) {
  const color = COLORS.find((item) => item.name === data.color)?.value ?? COLORS[0].value;
  const frameStyle = { "--frame-color": color } as CSSProperties;
  return (
    <section
      className={cx(
        styles,
        "frame",
        selected && "is-selected",
        data.collapsed && "is-collapsed",
        data.aggregateStatus && `status-${data.aggregateStatus}`,
      )}
      style={frameStyle}
      data-frame-color={data.color}
    >
      <NodeResizer
        isVisible={selected && !data.collapsed}
        minWidth={280}
        minHeight={160}
        handleClassName={cx(styles, "resize-handle")}
        lineClassName={cx(styles, "resize-line")}
      />
      <header className={cx(styles, "frame-header")}>
        <Frame size={14} aria-hidden="true" />
        <input
          className={cx(styles, "frame-title", "nodrag")}
          value={data.title}
          aria-label="Frame title"
          onChange={(event) => data.onUpdate?.({ title: event.target.value })}
          onPointerDown={(event) => event.stopPropagation()}
        />
        {data.collapsed && data.aggregateStatus && (
          <span className={cx(styles, "aggregate-status")} role="status">
            {data.aggregateStatus === "active"
              ? data.activeChildTitle
                ? `Running ${data.activeChildTitle}`
                : "Running"
              : data.aggregateStatus === "partial"
                ? `${data.aggregateCompletedCount ?? 0}/${data.aggregateTotalCount ?? 0} complete`
                : data.aggregateStatus}
          </span>
        )}
        <fieldset className={cx(styles, "color-list", "nodrag")} aria-label="Frame color">
          {COLORS.map((item) => (
            <button
              key={item.name}
              type="button"
              className={cx(styles, "color-button", item.name === data.color && "is-active")}
              style={{ "--swatch": item.value } as CSSProperties}
              aria-label={`Use ${item.name} frame color`}
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
          className={cx(styles, "collapse-button", "nodrag")}
          onClick={(event) => {
            event.stopPropagation();
            data.onToggleCollapsed?.();
          }}
          aria-label={data.collapsed ? "Expand frame" : "Collapse frame"}
          aria-expanded={!data.collapsed}
        >
          {data.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>
      </header>
      {data.collapsed && (
        <>
          <Handle
            id="proxy-input"
            type="target"
            position={Position.Left}
            isConnectable={false}
            className={cx(styles, "proxy-handle")}
          />
          <Handle
            id="proxy-output"
            type="source"
            position={Position.Right}
            isConnectable={false}
            className={cx(styles, "proxy-handle")}
          />
        </>
      )}
    </section>
  );
}
