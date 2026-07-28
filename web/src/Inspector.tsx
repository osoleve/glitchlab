import { ChevronRight, Copy, Gauge, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  FieldDefinition,
  GlitchlingDescriptor,
  LoomNode,
  NodeRunResult,
  RunResponse,
} from "./types";

interface InspectorProps {
  selectedNode?: LoomNode;
  glitchlings: GlitchlingDescriptor[];
  run?: RunResponse;
  error?: string;
  onUpdateTitle: (value: string) => void;
  onUpdateField: (field: string, value: unknown) => void;
  onDelete: () => void;
}

function displayValue(field: FieldDefinition, value: unknown): string | number {
  if (field.control === "json") {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "number" ? value : String(value);
}

function cacheSummary(value: unknown): { hits: number; total: number } | undefined {
  let hits = 0;
  let total = 0;

  const visit = (entry: unknown, depth: number) => {
    if (depth > 4 || entry === null || typeof entry !== "object") return;
    if (Array.isArray(entry)) {
      entry.forEach((item) => visit(item, depth + 1));
      return;
    }
    const record = entry as Record<string, unknown>;
    const cache = record.cache;
    if (cache !== null && typeof cache === "object" && !Array.isArray(cache)) {
      const hit = (cache as Record<string, unknown>).hit;
      if (typeof hit === "boolean") {
        total += 1;
        if (hit) hits += 1;
      }
    }
    Object.entries(record).forEach(([key, child]) => {
      if (key !== "cache") visit(child, depth + 1);
    });
  };

  visit(value, 0);
  return total > 0 ? { hits, total } : undefined;
}

function ResultView({
  result,
  terminal,
}: {
  result?: NodeRunResult;
  terminal?: Record<string, unknown>;
}) {
  const [copied, setCopied] = useState(false);
  const value = result?.outputs ?? terminal;
  if (!value) {
    return <p className="empty-copy">Run the loom to inspect this node’s output.</p>;
  }
  const text = JSON.stringify(value, null, 2);
  const cache = cacheSummary(value);
  return (
    <div className="result-block">
      <div className="result-meta">
        <span>{result ? `${result.duration_ms.toFixed(1)} ms` : "terminal output"}</span>
        <div className="result-actions">
          {cache && (
            <span className={`cache-chip ${cache.hits === cache.total ? "is-hit" : ""}`}>
              {cache.hits === cache.total
                ? cache.total === 1
                  ? "cache hit"
                  : `${cache.hits}/${cache.total} cached`
                : `${cache.hits}/${cache.total} cached`}
            </span>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label="Copy JSON"
            onClick={() => {
              void navigator.clipboard.writeText(text);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
          >
            <Copy size={14} />
          </button>
        </div>
      </div>
      <pre>{text}</pre>
      {copied && <span className="copy-note">Copied</span>}
    </div>
  );
}

export function Inspector({
  selectedNode,
  glitchlings,
  run,
  error,
  onUpdateTitle,
  onUpdateField,
  onDelete,
}: InspectorProps) {
  const selectedResult = useMemo(
    () => run?.nodes.find((result) => result.node_id === selectedNode?.id),
    [run, selectedNode],
  );
  const selectedTerminal = selectedNode
    ? run?.terminal_outputs[selectedNode.id]
    : undefined;
  const selectedGlitchling =
    selectedNode?.data.kind === "glitchling"
      ? glitchlings.find(
          (item) => item.name === String(selectedNode.data.config.name ?? ""),
        )
      : undefined;

  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <div>
          <span>Inspector</span>
          <small>{selectedNode ? "instrument controls" : "loom telemetry"}</small>
        </div>
        {selectedNode && <code>{selectedNode.id}</code>}
      </div>
      {selectedNode ? (
        <>
          <section className="inspector-section">
            <div className="inspector-node-meta">
              <span>{selectedNode.data.definition.category}</span>
              <span className={`inspector-status status-${selectedNode.data.runStatus}`}>
                <i />
                {selectedNode.data.runStatus === "completed"
                  ? "complete"
                  : selectedNode.data.runStatus}
              </span>
            </div>
            <label className="field">
              <span>Node title</span>
              <input
                value={selectedNode.data.title}
                onChange={(event) => onUpdateTitle(event.target.value)}
              />
            </label>
            <p className="node-description">{selectedNode.data.definition.description}</p>
          </section>
          <section className="inspector-section fields-section">
            <h2>Configuration</h2>
            {selectedNode.data.definition.fields.length === 0 && (
              <p className="empty-copy">This node has no local controls.</p>
            )}
            {selectedNode.data.definition.fields.map((field) => {
              const value = selectedNode.data.config[field.name] ?? field.default;
              if (field.control === "checkbox") {
                return (
                  <label className="check-field" key={field.name}>
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(event) => onUpdateField(field.name, event.target.checked)}
                    />
                    <span>{field.label}</span>
                  </label>
                );
              }
              if (field.control === "select") {
                return (
                  <label className="field" key={field.name}>
                    <span>{field.label}</span>
                    <select
                      value={String(value ?? "")}
                      onChange={(event) => onUpdateField(field.name, event.target.value)}
                    >
                      {field.options.map((option) => (
                        <option value={option.value} key={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {field.help && <small>{field.help}</small>}
                  </label>
                );
              }
              const multiline = field.control === "textarea" || field.control === "json";
              return (
                <label className="field" key={field.name}>
                  <span>{field.label}</span>
                  {multiline ? (
                    <textarea
                      rows={field.control === "json" ? 5 : 3}
                      value={displayValue(field, value)}
                      placeholder={field.placeholder}
                      spellCheck={field.control !== "json"}
                      onChange={(event) => onUpdateField(field.name, event.target.value)}
                    />
                  ) : (
                    <input
                      type={
                        field.control === "number" ||
                        field.control === "number_optional"
                          ? "number"
                          : "text"
                      }
                      value={displayValue(field, value)}
                      placeholder={field.placeholder}
                      onChange={(event) =>
                        onUpdateField(
                          field.name,
                          field.control === "number"
                            ? Number(event.target.value)
                            : field.control === "number_optional"
                              ? event.target.value === ""
                                ? null
                                : Number(event.target.value)
                              : event.target.value,
                        )
                      }
                    />
                  )}
                  {field.help && <small>{field.help}</small>}
                </label>
              );
            })}
            {selectedGlitchling && selectedGlitchling.parameters.length > 0 && (
              <details className="schema-details">
                <summary>
                  Constructor schema <ChevronRight size={14} />
                </summary>
                <ul>
                  {selectedGlitchling.parameters.map((parameter) => (
                    <li key={parameter.name}>
                      <code>{parameter.name}</code>
                      <span>{parameter.annotation ?? "value"}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          <section className="inspector-section result-section">
            <h2>Last output</h2>
            <ResultView result={selectedResult} terminal={selectedTerminal} />
          </section>
          <button type="button" className="delete-button" onClick={onDelete}>
            <Trash2 size={15} /> Delete node
          </button>
        </>
      ) : (
        <section className="inspector-section">
          <div className="empty-inspector-mark" aria-hidden="true">
            <Gauge size={18} />
          </div>
          <h2>Loom telemetry</h2>
          <p className="empty-copy">
            Select an instrument to tune its controls and inspect its latest output.
          </p>
          {run && (
            <div className="run-summary">
              <span>Last run</span>
              <code>{run.manifest.run_id.slice(0, 8)}</code>
              <strong>{run.nodes.length} nodes completed</strong>
            </div>
          )}
          {error && <p className="error-copy">{error}</p>}
        </section>
      )}
    </aside>
  );
}
