import { Handle, Position, type NodeProps } from "@xyflow/react";
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
  Layers3,
  List,
  PlugZap,
  Replace,
  Scissors,
  Sparkles,
  TextCursorInput,
  Users,
  WandSparkles,
} from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import type { LoomNode, LoomNodeData } from "./types";

const ICONS: Record<string, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  text_input: TextCursorInput,
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
  switch (data.kind) {
    case "text_input":
      return String(config.text ?? "").slice(0, 54);
    case "template_input":
      return String(config.template ?? "").slice(0, 54);
    case "model":
      return String(config.model_id ?? "");
    case "endpoint":
      return String(config.base_url ?? "");
    case "completion":
      return `${String(config.max_tokens ?? 96)} tokens · seed ${String(config.seed ?? "—")}`;
    case "glitchling":
      return `${String(config.name ?? "")} · seed ${String(config.seed ?? "")}`;
    case "read_file":
    case "write_file":
      return String(config.path ?? "");
    default:
      return data.definition.description;
  }
}

function categoryClass(category: string): string {
  return category.toLowerCase().replace(/\s+/g, "-");
}

export function LoomNodeCard({ data, selected }: NodeProps<LoomNode>) {
  const Icon = ICONS[data.kind] ?? Box;
  const portRows = Math.max(
    data.definition.inputs.length,
    data.definition.outputs.length,
    1,
  );
  const nodeStyle = {
    "--port-rows": portRows,
  } as CSSProperties;

  return (
    <article
      className={`loom-node category-${categoryClass(data.definition.category)} ${
        selected ? "is-selected" : ""
      } status-${data.runStatus}`}
      style={nodeStyle}
    >
      <div className="node-thread" aria-hidden="true" />
      <header className="node-header">
        <span className="node-icon" aria-hidden="true">
          <Icon size={16} strokeWidth={1.8} />
        </span>
        <div className="node-heading-copy">
          <span>{data.definition.category}</span>
          <strong>{data.title}</strong>
        </div>
        <span className="node-status" aria-label={`Run status: ${data.runStatus}`}>
          <i aria-hidden="true" />
          <b>{data.runStatus === "completed" ? "done" : data.runStatus}</b>
        </span>
      </header>
      <p className="node-summary">{summary(data) || "Configure in the inspector"}</p>

      <div className="node-inputs">
        {data.definition.inputs.map((port) => (
          <div className="node-port node-port-input" key={port.name}>
            <Handle
              id={port.name}
              type="target"
              position={Position.Left}
            />
            <span className="port-label">{port.label}</span>
            <em>{port.type}</em>
          </div>
        ))}
      </div>
      <div className="node-outputs">
        {data.definition.outputs.map((port) => (
          <div className="node-port node-port-output" key={port.name}>
            <em>{port.type}</em>
            <span className="port-label">{port.label}</span>
            <Handle
              id={port.name}
              type="source"
              position={Position.Right}
            />
          </div>
        ))}
      </div>
    </article>
  );
}
