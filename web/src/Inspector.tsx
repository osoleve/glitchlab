import { ChevronRight, Gauge, PanelRightClose, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PreviewValue } from "./PreviewValue";
import type {
  FieldDefinition,
  GlitchlingDescriptor,
  LoomEdge,
  LoomNode,
  NodeRunResult,
  RunResponse,
} from "./types";

interface InspectorProps {
  selectedNode?: LoomNode;
  nodes: LoomNode[];
  edges: LoomEdge[];
  glitchlings: GlitchlingDescriptor[];
  run?: RunResponse;
  error?: string;
  onUpdateTitle: (value: string) => void;
  onUpdateField: (field: string, value: unknown) => void;
  onDelete: () => void;
  onClose: () => void;
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

function ResultView({
  result,
  terminal,
  itemLabels,
}: {
  result?: NodeRunResult;
  terminal?: Record<string, unknown>;
  itemLabels?: string[];
}) {
  const value = result?.outputs ?? terminal;
  if (!value) {
    return <p className="empty-copy">Run the loom to inspect this node’s output.</p>;
  }
  return (
    <div className="result-block">
      {result && (
        <div className="result-runtime">
          <span>Completed in {result.duration_ms.toFixed(1)} ms</span>
        </div>
      )}
      <PreviewValue value={value} itemLabels={itemLabels} />
    </div>
  );
}

function collectionSourceLabels(
  selectedNode: LoomNode | undefined,
  nodes: LoomNode[],
  edges: LoomEdge[],
): string[] | undefined {
  if (!selectedNode) return undefined;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let collectionNode = selectedNode.data.kind === "collect" ? selectedNode : undefined;

  if (selectedNode.data.kind === "preview") {
    const sourceEdge = edges.find(
      (edge) =>
        edge.target === selectedNode.id &&
        (edge.targetHandle === "value" || edge.targetHandle === undefined),
    );
    const sourceNode = sourceEdge ? byId.get(sourceEdge.source) : undefined;
    if (sourceNode?.data.kind === "collect") collectionNode = sourceNode;
  }

  if (!collectionNode) return undefined;
  const labels = edges
    .filter(
      (edge) =>
        edge.target === collectionNode.id &&
        (edge.targetHandle === "item" || edge.targetHandle === undefined),
    )
    .map((edge) => byId.get(edge.source)?.data.title)
    .filter((label): label is string => Boolean(label));
  return labels.length > 0 ? labels : undefined;
}

export function Inspector({
  selectedNode,
  nodes,
  edges,
  glitchlings,
  run,
  error,
  onUpdateTitle,
  onUpdateField,
  onDelete,
  onClose,
}: InspectorProps) {
  const [activeTab, setActiveTab] = useState<"configure" | "output">("configure");
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
  const hasOutput = Boolean(selectedResult?.outputs ?? selectedTerminal);
  const itemLabels = useMemo(
    () => collectionSourceLabels(selectedNode, nodes, edges),
    [edges, nodes, selectedNode],
  );

  useEffect(() => {
    setActiveTab(
      selectedNode?.data.kind === "preview" || hasOutput ? "output" : "configure",
    );
  }, [selectedNode?.id]);

  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <div>
          <span>Inspector</span>
          <small>{selectedNode?.data.title ?? "Loom telemetry"}</small>
        </div>
        <button
          type="button"
          className="panel-close-button"
          onClick={onClose}
          aria-label="Close inspector"
          title="Close inspector"
        >
          <PanelRightClose size={15} />
        </button>
      </div>
      {selectedNode ? (
        <>
          <div className="inspector-tabs" role="tablist" aria-label="Inspector view">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "configure"}
              className={activeTab === "configure" ? "is-active" : ""}
              onClick={() => setActiveTab("configure")}
            >
              Configure
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "output"}
              className={activeTab === "output" ? "is-active" : ""}
              onClick={() => setActiveTab("output")}
            >
              Output
              {hasOutput && <i aria-label="Output available" />}
            </button>
          </div>
          {activeTab === "configure" ? (
            <div role="tabpanel">
              <section className="inspector-section">
                <div className="inspector-node-meta">
                  <span>{selectedNode.data.definition.category}</span>
                  <span
                    className={`inspector-status status-${selectedNode.data.runStatus}`}
                  >
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
                <p className="node-description">
                  {selectedNode.data.definition.description}
                </p>
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
                          onChange={(event) =>
                            onUpdateField(field.name, event.target.checked)
                          }
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
                          onChange={(event) =>
                            onUpdateField(field.name, event.target.value)
                          }
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
                  const multiline =
                    field.control === "textarea" || field.control === "json";
                  return (
                    <label className="field" key={field.name}>
                      <span>{field.label}</span>
                      {multiline ? (
                        <textarea
                          rows={field.control === "json" ? 5 : 3}
                          value={displayValue(field, value)}
                          placeholder={field.placeholder}
                          spellCheck={field.control !== "json"}
                          onChange={(event) =>
                            onUpdateField(field.name, event.target.value)
                          }
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
                {selectedGlitchling &&
                  selectedGlitchling.parameters.length > 0 && (
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
              <button type="button" className="delete-button" onClick={onDelete}>
                <Trash2 size={15} /> Delete node
              </button>
            </div>
          ) : (
            <section className="inspector-section result-section" role="tabpanel">
              <ResultView
                result={selectedResult}
                terminal={selectedTerminal}
                itemLabels={itemLabels}
              />
            </section>
          )}
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
