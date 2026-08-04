import { Handle, type NodeProps, NodeResizer, Position } from "@xyflow/react";
import {
  Binary,
  BookOpenText,
  Box,
  Braces,
  Bug,
  Cloud,
  Combine,
  Database,
  Eraser,
  Eye,
  FileInput,
  FileOutput,
  GitBranch,
  GitFork,
  Hash,
  Layers3,
  List,
  PlugZap,
  Replace,
  ScanText,
  Scissors,
  Sparkles,
  TextCursorInput,
  Users,
  WandSparkles,
  Workflow,
} from "lucide-react";
import { type ComponentType, type CSSProperties, useEffect, useState } from "react";
import { ErrorBoundary, NodeErrorFallback } from "./ErrorBoundary";
import { selectedLoomText } from "./loom";
import { moduleClassNames as cx } from "./moduleClassNames";
import type { FieldDefinition, WorkflowNode, WorkflowNodeData } from "./types";
import styles from "./WorkflowNode.module.css";

const ICONS: Record<string, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  text_input: TextCursorInput,
  number_input: Hash,
  template_input: Braces,
  fill_hole: Binary,
  render_template: BookOpenText,
  split: Scissors,
  replace: Replace,
  trim: Eraser,
  extract_text: ScanText,
  join: Combine,
  list_input: List,
  collect: Layers3,
  cartesian: GitFork,
  select_field: Box,
  endpoint: PlugZap,
  openrouter_endpoint: Cloud,
  model: Box,
  completion: Sparkles,
  loom: GitBranch,
  glitchling: Bug,
  gaggle: Users,
  corrupt: WandSparkles,
  huggingface_dataset: Database,
  read_file: FileInput,
  write_file: FileOutput,
  preview: Eye,
};

function summary(data: WorkflowNodeData): string {
  const config = data.config;
  const suppliedByPort = (field: string) =>
    data.controlPorts[field] === "input" || data.controlPorts[field] === "passthrough";
  switch (data.kind) {
    case "text_input":
      return suppliedByPort("text")
        ? "text supplied by input"
        : String(config.text ?? "").slice(0, 54);
    case "number_input":
      return suppliedByPort("value")
        ? `${String(config.value ?? 0)} default`
        : String(config.value ?? 0);
    case "template_input":
      return suppliedByPort("template")
        ? "template supplied by input"
        : String(config.template ?? "").slice(0, 54);
    case "model":
      return suppliedByPort("model_id") ? "model supplied by input" : String(config.model_id ?? "");
    case "endpoint":
      return suppliedByPort("base_url")
        ? "endpoint supplied by input"
        : String(config.base_url ?? "");
    case "openrouter_endpoint":
      return `OpenRouter · ${String(config.api_key_env ?? "OPENROUTER_API_KEY")}`;
    case "huggingface_dataset":
      return `${String(config.dataset_id ?? "")} · ${String(config.split ?? "train")} · ${String(
        config.limit ?? 100,
      )} rows`;
    case "completion":
      return `${
        suppliedByPort("max_tokens") ? "wired tokens" : `${String(config.max_tokens ?? 96)} tokens`
      } · ${suppliedByPort("seed") ? "wired seed" : `seed ${String(config.seed ?? "—")}`}`;
    case "loom":
      return data.state ? selectedLoomText(data.state).slice(0, 72) : "Open the Loom to begin";
    case "glitchling":
      return `${String(config.name ?? "")} · seed ${String(config.seed ?? "")}`;
    case "read_file":
    case "write_file":
      return String(config.path ?? "");
    default:
      return "";
  }
}

function categoryClass(category: string): string {
  return category.toLowerCase().replace(/\s+/g, "-");
}

function inlineValue(field: FieldDefinition, value: unknown): string | number {
  if (value === null || value === undefined) return "";
  if (field.control === "number" || field.control === "number_optional") {
    return typeof value === "number" ? value : Number(value);
  }
  if (field.control === "json") {
    return JSON.stringify(value);
  }
  return String(value);
}

function inlineControlHeight(fields: FieldDefinition[]): number {
  const wideHeight = fields.reduce((height, field) => {
    if (field.control === "textarea") return height + 64;
    if (field.control === "text" || field.control === "json") {
      return height + 40;
    }
    return height;
  }, 0);
  const compactCount = fields.filter(
    (field) => field.control !== "textarea" && field.control !== "text" && field.control !== "json",
  ).length;
  return wideHeight + Math.ceil(compactCount / 3) * 40 + 4;
}

interface InlineTextareaProps {
  ariaLabel: string;
  disabled: boolean;
  placeholder: string;
  update: (value: string) => void;
  value: string;
}

function InlineTextarea({ ariaLabel, disabled, placeholder, update, value }: InlineTextareaProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <textarea
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraft(nextValue);
        update(nextValue);
      }}
      aria-label={ariaLabel}
      rows={2}
    />
  );
}

export function WorkflowNodeCard({ data, selected }: NodeProps<WorkflowNode>) {
  const Icon = data.kind.startsWith("workflow:") ? Workflow : (ICONS[data.kind] ?? Box);
  const inlineFields =
    data.definition.editor === "loom" ? [] : data.definition.fields.filter((field) => field.inline);
  const hasInlineTextarea = inlineFields.some((field) => field.control === "textarea");
  const summaryText = summary(data);
  const hasSummary = inlineFields.length === 0 && summaryText.length > 0;
  const inlineHeight = inlineFields.length > 0 ? inlineControlHeight(inlineFields) : 0;
  const editorHeight = data.definition.editor === "loom" ? 38 : 0;
  const contentHeight = (hasSummary ? 28 : inlineHeight) + editorHeight;
  const portRows = Math.max(data.definition.inputs.length, data.definition.outputs.length, 1);
  const baseHeight = 74 + contentHeight;
  const minimumHeight = baseHeight + portRows * 28;
  const nodeStyle = {
    "--node-base-height": `${baseHeight}px`,
    "--port-top": `${52 + contentHeight}px`,
    "--port-rows": portRows,
    "--inline-controls-height": `${inlineHeight}px`,
    "--port-area-height": `${portRows * 28 + 12}px`,
  } as CSSProperties;

  return (
    <article
      className={cx(
        styles,
        "workflow-node",
        `category-${categoryClass(data.definition.category)}`,
        selected && "is-selected",
        hasInlineTextarea && "has-inline-textarea",
        `status-${data.runStatus}`,
        data.executionScopeRole && `execution-scope-${data.executionScopeRole}`,
      )}
      style={nodeStyle}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={220}
        minHeight={minimumHeight}
        maxWidth={520}
        maxHeight={520}
        handleClassName={cx(styles, "workflow-resize-handle")}
        lineClassName={cx(styles, "workflow-resize-line")}
      />
      <div className={cx(styles, "node-thread")} aria-hidden="true" />
      <header className={cx(styles, "node-header")}>
        <span className={cx(styles, "node-icon")} aria-hidden="true">
          <Icon size={16} strokeWidth={1.8} />
        </span>
        <div className={cx(styles, "node-heading-copy")}>
          <span>{data.definition.category}</span>
          <strong>{data.title}</strong>
        </div>
        <span
          className={cx(styles, "node-status")}
          role="status"
          aria-label={`Run status: ${data.runStatus}`}
        >
          <i aria-hidden="true" />
          <b>{data.runStatus === "completed" ? "done" : data.runStatus}</b>
        </span>
      </header>
      {hasSummary && <p className={cx(styles, "node-summary")}>{summaryText}</p>}
      {data.definition.editor === "loom" && (
        <button
          type="button"
          className={cx(styles, "node-editor-button", "nodrag", "nopan")}
          onClick={(event) => {
            event.stopPropagation();
            data.onOpenEditor?.();
          }}
        >
          <GitBranch size={14} />
          Open loom
        </button>
      )}
      {inlineFields.length > 0 && (
        <section
          className={cx(styles, "node-inline-fields nodrag nowheel nopan")}
          aria-label={`Controls for ${data.title}`}
        >
          {inlineFields.map((field) => {
            const value = data.config[field.name];
            const mode = data.controlPorts[field.name];
            const disabled = mode === "input" || mode === "passthrough";
            const wide =
              field.control === "text" || field.control === "textarea" || field.control === "json";
            const update = (nextValue: unknown) => data.onUpdateField?.(field.name, nextValue);
            return (
              // Biome cannot see that every conditional branch renders a nested form control.
              // biome-ignore lint/a11y/noLabelWithoutControl: the input, select, or textarea is nested below
              <label
                className={cx(
                  styles,
                  "node-inline-field",
                  wide && "is-wide",
                  field.control === "textarea" && "is-textarea",
                  field.control === "checkbox" && "is-checkbox",
                )}
                key={field.name}
                title={disabled ? `${field.label} is supplied by an input wire.` : field.help}
              >
                <span>{field.label}</span>
                {field.control === "checkbox" ? (
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    disabled={disabled}
                    onChange={(event) => update(event.target.checked)}
                  />
                ) : field.control === "select" ? (
                  <select
                    value={String(value ?? "")}
                    disabled={disabled}
                    onChange={(event) => update(event.target.value)}
                    aria-label={`${field.label} for ${data.title}`}
                  >
                    {field.options.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.control === "textarea" ? (
                  <InlineTextarea
                    value={String(value ?? "")}
                    placeholder={field.placeholder}
                    disabled={disabled}
                    update={update}
                    ariaLabel={`${field.label} for ${data.title}`}
                  />
                ) : (
                  <input
                    type={
                      field.control === "number" || field.control === "number_optional"
                        ? "number"
                        : "text"
                    }
                    value={inlineValue(field, value)}
                    placeholder={field.placeholder}
                    disabled={disabled}
                    onChange={(event) =>
                      update(
                        field.control === "number"
                          ? Number(event.target.value)
                          : field.control === "number_optional"
                            ? event.target.value === ""
                              ? null
                              : Number(event.target.value)
                            : event.target.value,
                      )
                    }
                    aria-label={`${field.label} for ${data.title}`}
                  />
                )}
              </label>
            );
          })}
        </section>
      )}

      <div className={cx(styles, "node-inputs")}>
        {data.definition.inputs.map((port) => (
          <div
            className={cx(
              styles,
              "node-port",
              "node-port-input",
              port.control && "is-control-port",
            )}
            key={port.name}
            title={port.control ? `${port.label} control input` : undefined}
          >
            <Handle id={port.name} type="target" position={Position.Left} />
            <span className={cx(styles, "port-label")}>{port.label}</span>
            <em>{port.type}</em>
          </div>
        ))}
      </div>
      <div className={cx(styles, "node-outputs")}>
        {data.definition.outputs.map((port) => (
          <div
            className={cx(
              styles,
              "node-port",
              "node-port-output",
              port.control && "is-control-port",
            )}
            key={port.name}
            title={port.control ? `${port.label} control output` : undefined}
          >
            <em>{port.type}</em>
            <span className={cx(styles, "port-label")}>{port.label}</span>
            <Handle id={port.name} type="source" position={Position.Right} />
          </div>
        ))}
      </div>
    </article>
  );
}

export function WorkflowNodeCardWithBoundary(props: NodeProps<WorkflowNode>) {
  return (
    <ErrorBoundary
      fallback={(error) => <NodeErrorFallback error={error} title={props.data.title} />}
    >
      <WorkflowNodeCard {...props} />
    </ErrorBoundary>
  );
}
