import { GitBranch, Keyboard, LoaderCircle, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runGraph } from "./api";
import styles from "./LoomEditor.module.css";
import type { LoomBranch, LoomTokenChoice } from "./loom";
import {
  appendLoomEntry,
  buildLoomGenerationGraph,
  buildLoomTokenProbeGraph,
  generatedLoomEntry,
  generatedLoomTokenProbe,
  loomEntry,
  loomPath,
  loomTree,
  selectedLoomText,
  selectLoomEntry,
  updateLoomEntryText,
} from "./loom";
import { moduleClassNames as cx } from "./moduleClassNames";
import type { GraphSpec, LoomRunReference, LoomState, WorkflowNode } from "./types";

interface LoomEditorProps {
  graph: GraphSpec;
  node: WorkflowNode;
  onChange: (state: LoomState) => void;
  onClose: () => void;
}

interface VisibleTokenProbe {
  parentId: string;
  prompt: string;
  choices: LoomTokenChoice[];
  completion: Record<string, unknown>;
  run: LoomRunReference;
}

function entryLabel(text: string): string {
  const visible = text.replace(/\s+/g, " ");
  return visible.length > 0 ? visible : "Empty text";
}

function visibleToken(token: string): string {
  if (token.length === 0) return "∅";
  return token.replaceAll(" ", "·").replaceAll("\t", "⇥").replaceAll("\n", "↵\n");
}

function tokenProbability(logprob: number): string {
  const percent = Math.exp(logprob) * 100;
  if (percent < 0.1) return "<0.1%";
  return `${percent.toFixed(percent < 10 ? 1 : 0)}%`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function LoomEditor({ graph, node, onChange, onClose }: LoomEditorProps) {
  const state = node.data.state;
  const [manualDraft, setManualDraft] = useState("");
  const [candidateCount, setCandidateCount] = useState(3);
  const [activity, setActivity] = useState<"completions" | "tokens">();
  const [tokenProbe, setTokenProbe] = useState<VisibleTokenProbe>();
  const [error, setError] = useState<string>();
  const selectedTreeEntryRef = useRef<HTMLButtonElement | null>(null);

  const selected = useMemo(
    () => (state ? loomEntry(state, state.selected_id) : undefined),
    [state],
  );
  const activePathIds = useMemo(
    () => new Set(state ? loomPath(state).map((entry) => entry.id) : []),
    [state],
  );
  const tree = useMemo(() => (state ? loomTree(state) : undefined), [state]);
  const selectedPathText = useMemo(() => (state ? selectedLoomText(state) : ""), [state]);

  const loadTokenChoices = useCallback(
    async (sourceState: LoomState) => {
      const parentId = sourceState.selected_id;
      const sourcePrompt = selectedLoomText(sourceState);
      setActivity("tokens");
      setError(undefined);
      try {
        const transient = buildLoomTokenProbeGraph(graph, node.id, sourceState);
        const response = await runGraph(transient, {
          mode: "targets",
          target_node_ids: [node.id],
        });
        const probe = generatedLoomTokenProbe(response, node.id);
        setTokenProbe({ parentId, prompt: sourcePrompt, ...probe });
      } catch (caught) {
        setTokenProbe(undefined);
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setActivity(undefined);
      }
    },
    [graph, node.id],
  );

  const chooseToken = useCallback(
    async (index: number) => {
      if (!state || !tokenProbe || activity) return;
      if (tokenProbe.parentId !== state.selected_id || tokenProbe.prompt !== selectedPathText)
        return;
      const choice = tokenProbe.choices[index];
      if (!choice) return;
      const next = appendLoomEntry(state, choice.token, {
        source: "model",
        completion: {
          ...tokenProbe.completion,
          text: choice.token,
          loom_token_choice: {
            rank: index,
            token: choice.token,
            logprob: choice.logprob,
            alternatives: tokenProbe.choices,
          },
        },
        run: tokenProbe.run,
      });
      setTokenProbe(undefined);
      setError(undefined);
      onChange(next);
      await loadTokenChoices(next);
    },
    [activity, loadTokenChoices, onChange, selectedPathText, state, tokenProbe],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !activity) {
        event.preventDefault();
        onClose();
        return;
      }
      if (
        activity ||
        !tokenProbe ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isEditableTarget(event.target) ||
        !/^\d$/.test(event.key)
      ) {
        return;
      }
      const index = Number(event.key);
      if (!tokenProbe.choices[index]) return;
      event.preventDefault();
      void chooseToken(index);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activity, chooseToken, onClose, tokenProbe]);

  useEffect(() => {
    if (
      tokenProbe &&
      state &&
      (tokenProbe.parentId !== state.selected_id || tokenProbe.prompt !== selectedPathText)
    ) {
      setTokenProbe(undefined);
    }
  }, [selectedPathText, state, tokenProbe]);

  useEffect(() => {
    selectedTreeEntryRef.current?.scrollIntoView?.({ block: "nearest", inline: "center" });
  });

  if (!state || !selected || !tree) return null;

  const updateState = (next: LoomState) => {
    setTokenProbe(undefined);
    setError(undefined);
    onChange(next);
  };

  const addManualBranch = () => {
    updateState(appendLoomEntry(state, manualDraft));
    setManualDraft("");
  };

  const generateCandidates = async () => {
    const parentId = state.selected_id;
    const priorGenerated = state.entries.filter((entry) => entry.source === "model").length;
    setActivity("completions");
    setTokenProbe(undefined);
    setError(undefined);
    try {
      const candidates = [];
      for (let index = 0; index < candidateCount; index += 1) {
        const transient = buildLoomGenerationGraph(graph, node.id, state, priorGenerated + index);
        const response = await runGraph(transient, {
          mode: "targets",
          target_node_ids: [node.id],
        });
        candidates.push(generatedLoomEntry(response, node.id));
      }
      let next = state;
      let firstId: string | undefined;
      for (const candidate of candidates) {
        const before = new Set(next.entries.map((entry) => entry.id));
        next = appendLoomEntry(next, candidate.text, {
          parentId,
          source: "model",
          completion: candidate.completion,
          run: candidate.run,
        });
        firstId ??= next.entries.find((entry) => !before.has(entry.id))?.id;
      }
      onChange(firstId ? selectLoomEntry(next, firstId) : next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setActivity(undefined);
    }
  };

  const renderBranch = (branch: LoomBranch, level = 1): React.ReactNode => {
    const selectedEntry = branch.entry.id === state.selected_id;
    return (
      <div
        className={cx(styles, "loom-tree-branch", branch.children.length > 0 && "has-children")}
        role="none"
        key={branch.entry.id}
      >
        <button
          ref={selectedEntry ? selectedTreeEntryRef : undefined}
          type="button"
          role="treeitem"
          aria-level={level}
          aria-expanded={branch.children.length > 0 ? true : undefined}
          aria-selected={selectedEntry}
          className={cx(
            styles,
            "loom-tree-entry",
            selectedEntry && "is-selected",
            activePathIds.has(branch.entry.id) && "is-active-path",
          )}
          onClick={() => updateState(selectLoomEntry(state, branch.entry.id))}
        >
          <i aria-hidden="true" />
          <span>
            <strong>{entryLabel(branch.entry.text)}</strong>
            <small>{branch.entry.source}</small>
          </span>
        </button>
        {branch.children.length > 0 && (
          // biome-ignore lint/a11y/useSemanticElements: ARIA tree descendants require group semantics.
          <div className={cx(styles, "loom-tree-children")} role="group">
            {branch.children.map((child) => renderBranch(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cx(styles, "loom-editor-backdrop")} role="presentation">
      <section
        className={cx(styles, "loom-editor")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="loom-editor-title"
      >
        <header className={cx(styles, "loom-editor-header")}>
          <span className={cx(styles, "loom-editor-mark")} aria-hidden="true">
            <GitBranch size={20} />
          </span>
          <div>
            <small>branching text workspace</small>
            <h2 id="loom-editor-title">{node.data.title}</h2>
          </div>
          <span className={cx(styles, "loom-entry-count")}>{state.entries.length} entries</span>
          <button
            type="button"
            className={cx(styles, "loom-icon-button")}
            onClick={onClose}
            disabled={Boolean(activity)}
            aria-label="Close loom"
          >
            <X size={18} />
          </button>
        </header>

        <div className={cx(styles, "loom-editor-body")}>
          <aside className={cx(styles, "loom-tree-panel")}>
            <div className={cx(styles, "loom-panel-heading")}>
              <span>Branches</span>
              <small>Each generation opens to the right of its actual parent.</small>
            </div>
            <div className={cx(styles, "loom-tree-scroll")}>
              <div className={cx(styles, "loom-tree")} role="tree" aria-label="Loom branches">
                {renderBranch(tree)}
              </div>
            </div>
          </aside>

          <main className={cx(styles, "loom-compose-panel")}>
            <div className={cx(styles, "loom-panel-heading", "loom-compose-heading")}>
              <span>Selected segment</span>
              <small>Edit this segment; the Loom emits the complete root-to-selection path.</small>
            </div>
            <textarea
              className={cx(styles, "loom-selected-text")}
              value={selected.text}
              onChange={(event) =>
                updateState(updateLoomEntryText(state, selected.id, event.target.value))
              }
              aria-label="Selected loom segment"
              spellCheck={false}
            />

            <section className={cx(styles, "loom-prompt-preview")}>
              <span>Loom output · root to selection</span>
              <pre>{selectedPathText}</pre>
            </section>

            <section className={cx(styles, "loom-branch-actions")}>
              <div className={cx(styles, "loom-action-card")}>
                <span>Write a child</span>
                <textarea
                  value={manualDraft}
                  onChange={(event) => setManualDraft(event.target.value)}
                  placeholder="Add exact text beneath the selected entry…"
                  aria-label="Manual loom branch text"
                  spellCheck={false}
                />
                <button type="button" onClick={addManualBranch} disabled={Boolean(activity)}>
                  <Plus size={15} />
                  Add and select
                </button>
              </div>

              <div className={cx(styles, "loom-action-card", "loom-generate-card")}>
                <span>Full completions</span>
                <p>Generate longer alternatives from this node’s wired model and endpoint.</p>
                <label>
                  Candidates
                  <select
                    value={candidateCount}
                    onChange={(event) => setCandidateCount(Number(event.target.value))}
                    disabled={Boolean(activity)}
                  >
                    {[1, 2, 3, 4].map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void generateCandidates()}
                  disabled={Boolean(activity)}
                >
                  {activity === "completions" ? (
                    <LoaderCircle className={cx(styles, "loom-spinner")} size={15} />
                  ) : (
                    <Sparkles size={15} />
                  )}
                  {activity === "completions" ? "Generating…" : "Generate completions"}
                </button>
              </div>

              <div className={cx(styles, "loom-action-card", "loom-token-card")}>
                <div className={cx(styles, "loom-token-heading")}>
                  <span>Token steering</span>
                  <p>
                    Inspect the model’s ten most likely next tokens. Click one or press its 0–9
                    hotkey; the next distribution loads automatically.
                  </p>
                </div>
                <button
                  type="button"
                  className={cx(styles, "loom-token-refresh")}
                  onClick={() => void loadTokenChoices(state)}
                  disabled={Boolean(activity)}
                >
                  {activity === "tokens" ? (
                    <LoaderCircle className={cx(styles, "loom-spinner")} size={15} />
                  ) : tokenProbe ? (
                    <RefreshCw size={15} />
                  ) : (
                    <Keyboard size={15} />
                  )}
                  {activity === "tokens"
                    ? "Reading logits…"
                    : tokenProbe
                      ? "Refresh tokens"
                      : "Show next tokens"}
                </button>
                {tokenProbe && (
                  <fieldset
                    className={cx(styles, "loom-token-grid")}
                    aria-label="Next token choices"
                  >
                    {tokenProbe.choices.map((choice, index) => (
                      <button
                        type="button"
                        className={cx(styles, "loom-token-choice")}
                        key={`${choice.token}-${choice.logprob}`}
                        onClick={() => void chooseToken(index)}
                        disabled={Boolean(activity)}
                        aria-label={`Insert token ${index}: ${JSON.stringify(choice.token)}`}
                        title={`Exact token: ${JSON.stringify(choice.token)}`}
                      >
                        <kbd>{index}</kbd>
                        <code>{visibleToken(choice.token)}</code>
                        <small>
                          {tokenProbability(choice.logprob)} · {choice.logprob.toFixed(3)}
                        </small>
                      </button>
                    ))}
                  </fieldset>
                )}
              </div>
            </section>
            {error && (
              <p className={cx(styles, "loom-error")} role="alert">
                {error}
              </p>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}
