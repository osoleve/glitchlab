import { Handle, type NodeProps, NodeResizer, Position } from "@xyflow/react";
import {
  Binary,
  BookOpenText,
  Box,
  Braces,
  Bug,
  Combine,
  Eye,
  FileInput,
  FileOutput,
  GitFork,
  Hash,
  Layers3,
  List,
  PlugZap,
  Replace,
  Scissors,
  Sparkles,
  TextCursorInput,
  Users,
  WandSparkles,
  Workflow,
} from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import type { FieldDefinition, LoomNode, LoomNodeData } from "./types";

const ICONS: Record<string, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  text_input: TextCursorInput,
  number_input: Hash,
  template_input: Braces,
  fill_hole: Binary,
  render_template: BookOpenText,
  split: Scissors,
  replace: Replace,
  join: Combine,
  list_input: List,
  collect: Layers3,
  cartesian: GitFork,
  select_field: Box,
  endpoint: PlugZap,
  model: Box,
  completion: Sparkles,
  glitchling: Bug,
  gaggle: Users,
  corrupt: WandSparkles,
  read_file: FileInput,
  write_file: FileOutput,
  preview: Eye,
};

function summary(data: LoomNodeData): string {
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
    case "completion":
      return `${
        suppliedByPort("max_tokens") ? "wired tokens" : `${String(config.max_tokens ?? 96)} tokens`
      } · ${suppliedByPort("seed") ? "wired seed" : `seed ${String(config.seed ?? "—")}`}`;
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

export function LoomNodeCard({ data, selected }: NodeProps<LoomNode>) {
  const Icon = data.kind.startsWith("workflow:") ? Workflow : (ICONS[data.kind] ?? Box);
  const inlineFields = data.definition.fields.filter((field) => field.inline);
  const summaryText = summary(data);
  const hasSummary = inlineFields.length === 0 && summaryText.length > 0;
  const inlineHeight = inlineFields.length > 0 ? inlineControlHeight(inlineFields) : 0;
  const contentHeight = hasSummary ? 28 : inlineHeight;
  const portRows = Math.max(data.definition.inputs.length, data.definition.outputs.length, 1);
  const baseHeight = 74 + contentHeight;
  const minimumHeight = baseHeight + portRows * 28;
  const nodeStyle = {
    "--node-base-height": `${baseHeight}px`,
    "--port-top": `${52 + contentHeight}px`,
    "--port-rows": portRows,
    "--inline-controls-height": `${inlineHeight}px`,
  } as CSSProperties;

  return (
    <article
      className={`loom-node category-${categoryClass(data.definition.category)} ${
        selected ? "is-selected" : ""
      } status-${data.runStatus} ${
        data.executionScopeRole ? `execution-scope-${data.executionScopeRole}` : ""
      }`}
      style={nodeStyle}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={220}
        minHeight={minimumHeight}
        maxWidth={520}
        maxHeight={520}
        handleClassName="loom-resize-handle"
        lineClassName="loom-resize-line"
      />
      <div className="node-thread" aria-hidden="true" />
      <header className="node-header">
        <span className="node-icon" aria-hidden="true">
          <Icon size={16} strokeWidth={1.8} />
        </span>
        <div className="node-heading-copy">
          <span>{data.definition.category}</span>
          <strong>{data.title}</strong>
        </div>
        <span className="node-status" role="status" aria-label={`Run status: ${data.runStatus}`}>
          <i aria-hidden="true" />
          <b>{data.runStatus === "completed" ? "done" : data.runStatus}</b>
        </span>
      </header>
      {hasSummary && <p className="node-summary">{summaryText}</p>}
      {inlineFields.length > 0 && (
        <section
          className="node-inline-fields nodrag nowheel"
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
                className={`node-inline-field ${wide ? "is-wide" : ""} ${
                  field.control === "textarea" ? "is-textarea" : ""
                } ${field.control === "checkbox" ? "is-checkbox" : ""}`}
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
                  <textarea
                    value={String(value ?? "")}
                    placeholder={field.placeholder}
                    disabled={disabled}
                    onChange={(event) => update(event.target.value)}
                    aria-label={`${field.label} for ${data.title}`}
                    rows={2}
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

      <div className="node-inputs">
        {data.definition.inputs.map((port) => (
          <div
            className={`node-port node-port-input ${port.control ? "is-control-port" : ""}`}
            key={port.name}
            title={port.control ? `${port.label} control input` : undefined}
          >
            <Handle id={port.name} type="target" position={Position.Left} />
            <span className="port-label">{port.label}</span>
            <em>{port.type}</em>
          </div>
        ))}
      </div>
      <div className="node-outputs">
        {data.definition.outputs.map((port) => (
          <div
            className={`node-port node-port-output ${port.control ? "is-control-port" : ""}`}
            key={port.name}
            title={port.control ? `${port.label} control output` : undefined}
          >
            <em>{port.type}</em>
            <span className="port-label">{port.label}</span>
            <Handle id={port.name} type="source" position={Position.Right} />
          </div>
        ))}
      </div>
    </article>
  );
}
