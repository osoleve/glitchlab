import { ChevronRight, Gauge, PanelRightClose, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PreviewValue } from "./PreviewValue";
import type {
  ControlPortMode,
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
  onUpdateControlPort: (
    field: string,
    mode?: ControlPortMode,
  ) => void;
  onDelete: () => void;
  onClose: () => void;
}

function ControlPortSelector({
  field,
  mode,
  onChange,
}: {
  field: FieldDefinition;
  mode?: ControlPortMode;
  onChange: (mode?: ControlPortMode) => void;
}) {
  return (
    <div
      className="control-port-selector"
      role="group"
      aria-label={`${field.label} port mode`}
    >
      <button
        type="button"
        className={!mode ? "is-active" : ""}
        aria-label={`Keep ${field.label} local`}
        aria-pressed={!mode}
        onClick={() => onChange(undefined)}
      >
        Local
      </button>
      <button
        type="button"
        className={mode === "input" ? "is-active" : ""}
        aria-label={`Expose ${field.label} as input port`}
        aria-pressed={mode === "input"}
        onClick={() => onChange("input")}
      >
        In
      </button>
      <button
        type="button"
        className={mode === "output" ? "is-active" : ""}
        aria-label={`Expose ${field.label} as output port`}
        aria-pressed={mode === "output"}
        onClick={() => onChange("output")}
      >
        Out
      </button>
      <button
        type="button"
        className={mode === "passthrough" ? "is-active" : ""}
        aria-label={`Expose ${field.label} as input and output ports`}
        aria-pressed={mode === "passthrough"}
        onClick={() => onChange("passthrough")}
      >
        I/O
      </button>
    </div>
  );
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
  onUpdateControlPort,
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
  }, [hasOutput, selectedNode?.data.kind, selectedNode?.id]);

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
      {run?.client?.stale && (
        <p className="stale-run-notice">
          Prior output — the graph changed after this run was submitted.
        </p>
      )}
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
                {selectedNode.data.definition.fields.length > 0 && (
                  <p className="control-port-help">
                    Keep a control local, promote it to a typed input or output,
                    or use I/O as a pass-through. Inputs fall back to the local
                    value when unconnected and can become saved workflow
                    boundaries.
                  </p>
                )}
                {selectedNode.data.definition.fields.length === 0 && (
                  <p className="empty-copy">This node has no local controls.</p>
                )}
                {selectedNode.data.definition.fields.map((field) => {
                  const value = selectedNode.data.config[field.name] ?? field.default;
                  const portMode = selectedNode.data.controlPorts[field.name];
                  const acceptsInput =
                    portMode === "input" || portMode === "passthrough";
                  const inputHelp =
                    portMode === "passthrough"
                      ? "Unconnected uses this default; a connected value also passes to the output socket."
                      : "Used as the default while the input socket is unconnected.";
                  if (field.control === "checkbox") {
                    return (
                      <div className="config-control" key={field.name}>
                        <div className="config-control-heading">
                          <span>{field.label}</span>
                          <ControlPortSelector
                            field={field}
                            mode={portMode}
                            onChange={(mode) =>
                              onUpdateControlPort(field.name, mode)
                            }
                          />
                        </div>
                        <label className="check-field">
                          <input
                            type="checkbox"
                            checked={Boolean(value)}
                            onChange={(event) =>
                              onUpdateField(field.name, event.target.checked)
                            }
                          />
                          <span>Enabled</span>
                        </label>
                        {field.help && <small>{field.help}</small>}
                        {acceptsInput && <small>{inputHelp}</small>}
                      </div>
                    );
                  }
                  if (field.control === "select") {
                    return (
                      <div className="config-control" key={field.name}>
                        <div className="config-control-heading">
                          <span>{field.label}</span>
                          <ControlPortSelector
                            field={field}
                            mode={portMode}
                            onChange={(mode) =>
                              onUpdateControlPort(field.name, mode)
                            }
                          />
                        </div>
                        <select
                          aria-label={field.label}
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
                        {acceptsInput && <small>{inputHelp}</small>}
                      </div>
                    );
                  }
                  const multiline =
                    field.control === "textarea" || field.control === "json";
                  return (
                    <div className="config-control" key={field.name}>
                      <div className="config-control-heading">
                        <span>{field.label}</span>
                        <ControlPortSelector
                          field={field}
                          mode={portMode}
                          onChange={(mode) =>
                            onUpdateControlPort(field.name, mode)
                          }
                        />
                      </div>
                      {multiline ? (
                        <textarea
                          aria-label={field.label}
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
                          aria-label={field.label}
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
                      {acceptsInput && <small>{inputHelp}</small>}
                    </div>
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
              <span>{run.client?.stale ? "Prior run · stale" : "Last run"}</span>
              <code>{run.manifest.run_id.slice(0, 8)}</code>
              <strong>
                {run.nodes.length} nodes completed ·{" "}
                {run.manifest.scope.mode === "targets"
                  ? `${run.manifest.scope.target_node_ids.length} target${
                      run.manifest.scope.target_node_ids.length === 1 ? "" : "s"
                    }`
                  : "full loom"}
              </strong>
            </div>
          )}
          {error && <p className="error-copy">{error}</p>}
        </section>
      )}
    </aside>
  );
}
