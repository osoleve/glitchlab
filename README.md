# Glitchloom

Glitchloom is a local-first inference workbench: a typed node canvas for composing
base-model calls, deterministic text transformations, collection operations, and
self-describing experiment outputs.

The 0.8 version-zero milestone ships with a live vertical slice for:

- `talkie-1930-13b-base`
- `talkie-web-13b-base`
- the native base-completion service on `elsie-1`
- the local `osoleve/glitchlings` checkout
- generic OpenAI-compatible `/v1/completions` endpoints
- OpenRouter's raw `/api/v1/completions` transport
- commit-pinned, bounded Hugging Face Hub dataset slices

The starter graph is a compact Loom workshop: one OpenAI-compatible endpoint and
one model feed a Loom node, whose selected text is sent to a preview. Opening the
Loom provides a branching text workspace without changing ordinary graph-run
semantics.
The workbench also tracks unsaved graph changes and provides document-wide
undo/redo from the topbar or `Ctrl`/`Cmd`+`Z` and `Ctrl`/`Cmd`+`Shift`+`Z`.
History covers graph edits and starter resets while excluding run results and
selection state. The workbench preserves the current selection while a run
completes and labels collected completion cards with their source node titles.
Selected canvas nodes have working resize handles, `Ctrl`/`Cmd`+click builds a
multi-node selection, and `Delete` / `Backspace` removes the current canvas
selection. Right-clicking nodes, selections, wires, or the canvas opens
Glitchloom's context menu. Selected wires expose draggable endpoints; dropping
one away from a compatible port disconnects it. `Ctrl+Enter` runs the graph. The
node library and inspector use standard draggable dividers, support arrow-key
resizing when focused, and reset to their responsive defaults on double-click.

Frequently tuned catalog fields can also render directly on their workflow
cards. Text and template sources, model IDs, file paths, Glitchling choices,
and the primary completion knobs can be edited without opening the inspector.
The catalog explicitly chooses these inline controls; the inspector remains the
complete configuration and control-port surface.

The **Trim whitespace** text node removes leading and trailing whitespace while
preserving whitespace inside the text, avoiding a regular expression for this
common completion-cleanup step.

The **Extract delimited text** node accepts either plain text or a normalized
completion result. It selects the first span between literal start and end
markers, with either marker optionally left empty for one-sided extraction. By
default a missing configured marker fails the node; disabling **Require match**
instead emits empty text and `matched: false`. A typical structured fill path is
**Generate completion → Extract delimited text → Trim whitespace → Fill hole**.
Do not reuse the closing marker as the completion stop string when the extractor
must verify it, because completion providers commonly omit matched stop text.

## Loom nodes

A **Loom** is a text-producing workflow node with required **Endpoint** and
**Model** inputs. An ordinary graph run never calls the model from a Loom: it
emits the exact concatenated text along the path from the root to the currently
selected entry, including all leading, trailing, and inter-segment whitespace.
The inputs exist for interactive generation when the Loom editor is open.

The editor stores a validated, ordered branch tree inside the graph node. Select
any prior entry, edit it, write a child, generate one to four full-completion
candidates, or inspect the ten most likely next tokens. The branch browser is a
nested left-to-right tree, so every generation is grouped with its actual
parent. Token choices use hotkeys `0` through `9`; selecting one stores that
exact token as a child and immediately loads the next distribution for
token-by-token steering.

Generation uses that same root-to-selection text without trimming, then reuses
the ordinary completion executor in target-run mode. Generated entries retain
their normalized completion output plus a compact run ID, graph digest, and
completion timestamp. Selecting an entry immediately changes the complete path
emitted by the Loom node. Digit hotkeys are disabled while an input, select, or
textarea has focus so they never interfere with editing.

Completion settings remain catalog-driven and are edited in the normal node
inspector. Seeded sibling generation derives distinct deterministic seeds from
the configured seed. Graph documents own their Loom state; no arbitrary code is
stored or executed.

## Partial execution and run freshness

The topbar and `Ctrl+Enter` run the complete graph. Right-click a node and
choose **Run to here**, or right-click a multi-node selection and choose **Run to
selection**, to execute only the requested targets and their complete transitive
upstream closure. Unrelated incomplete branches, cycles, and side effects do not
participate in that target run. Requested targets remain the reported outputs
even when they are not graph terminals.

The canvas keeps the execution scope visible: targets are badged, required
upstream nodes and wires are emphasized, unrelated branches are dimmed, and the
scope can be fit into view. **Select upstream** and **Select downstream** use the
same deterministic traversal without changing the run scope.

Every request carries an explicit full-or-target scope. The manifest records the
normalized targets and deterministic executed-node order while retaining the
complete submitted graph. The client also fingerprints execution-affecting node
configuration, promoted controls, and topology. Editing those semantics marks a
completed response as a visibly stale prior run; moving, resizing, renaming, or
rearranging nodes does not.

Runs use a companion NDJSON progress stream when the browser supports it. The
original JSON run endpoint remains available for compatibility. Node badges now
advance at the executor's real topological boundaries, and a wire pulses only
after its value has actually been gathered by the downstream node. The stream
never carries prompt or output values in progress events. A dropped stream is
reported as an unknown outcome and is not silently retried, because file writes
or provider calls may already have happened.

## Saved graphs and templates

Top-level graphs are editable documents, deliberately separate from immutable
reusable workflows. **Save** updates the current saved graph with revision
protection; **Save as** always creates a new document. Saved graphs reopen in
closable graph tabs, while **Open as copy** removes the source identity and starts
an unsaved tab. This makes a saved graph useful as an experiment template without
risking its source document or any versioned workflow node it contains.

Checked-in graphs under `examples/` appear as read-only templates and also always
open as copies. Mutable graph documents live under
`GLITCHLOOM_WORKSPACE/.glitchloom/graphs`; deletion uses recoverable local trash.
Exact workflow versions referenced by a graph are retained when it loads rather
than being silently replaced by the latest catalog version. `Ctrl+S` saves the
current graph and `Ctrl+Shift+S` opens Save as.

## Canvas context actions

Right-click an empty part of the canvas to search the complete catalog and add a
node at that graph position. Node and multi-node menus support partial execution,
upstream/downstream selection, duplication, alignment, distribution, workflow
extraction, and deletion. **Tidy selection** and **Tidy graph** apply a
deterministic left-to-right DAG layout using the nodes' measured sizes, preserve
the arranged region's visual center, and persist the resulting positions without
invalidating run freshness. A full-graph tidy also refits the completed layout;
selection tidy leaves the surrounding spatial context in place. A multi-node
selection can also be grouped into a collapsible frame. Frames have editable
titles and five color choices; membership, bounds, collapse state, and the graph's
wire-routing preference persist with the graph while remaining presentation-only
for run freshness. Collapsed frames retain their external connectivity through
non-editable boundary wires. Wires and ports are color-coded by their typed value
family; the floating wire action bar can override that color when an experiment
needs an additional visual grouping. Empty-canvas left-drag draws a marquee while
Space-drag or middle-drag pans. A current node or wire selection locks the marquee
to that family; otherwise the first intersected element decides. Ctrl/Cmd adds and
Alt removes from the marquee selection. Wire hit-testing follows the rendered path,
not merely its endpoint nodes.

Select two or more wires to create a routed bundle. Every bundle has extensible
waypoints: drag a waypoint to reshape the route or drag the shared trunk to move the
whole bundle. Existing bundles can accept additional selected wires without being
rebuilt. Bundles participate in **Tidy graph** as virtual multiplex/demultiplex
routing nodes, then remain freely movable afterward. Wire styles and bundles persist
with saved graphs and, like frames and routing style, do not change execution
semantics or run freshness. Hovering a wire highlights its complete route and its
source and destination ports. Selecting nodes
emphasizes their complete upstream and downstream wire paths; unrelated wires
recede while a selected wire remains fully visible. Wires use smooth stepped
routing by default, with Bezier routing available from the canvas menu. Connection
ports use enlarged proximity targets and explicit valid/invalid hover feedback.
A wire can be disconnected or split
by inserting the one-input, one-output **Passthrough** node. Dragging a new
output wire onto empty canvas opens a searchable node picker filtered to
type-compatible input ports. Choosing an entry creates the node at the drop
point and connects the wire to the exact input named in the picker.

## OpenRouter and Hugging Face datasets

The **OpenRouter endpoint** node is a safe preset for
`https://openrouter.ai/api/v1`. It emits the same typed endpoint reference used by
the generic completion node and always calls raw `/completions`; it does not apply
a chat template or trim prompt whitespace. Set `OPENROUTER_API_KEY` in the process
environment, then connect **OpenRouter endpoint → Model → Generate completion**.
Optional site URL and application-name fields become OpenRouter attribution
headers. Cached results include every request-affecting provider field and are
separated when the credential rotates without writing the credential itself.

OpenRouter's model catalog is dynamic. The checked-in
`examples/openrouter-huggingface.json` graph uses a model slug that was live when
the example was updated; verify or replace it before a long experiment. The node
does not hard-code a model list.

The **Hugging Face dataset** node streams an explicitly bounded Hub slice and
materializes only `limit` rows (maximum 10,000). Before loading, it resolves a
branch, tag, or commit request to the exact Hub commit SHA and loads that SHA;
the result records both references, the configuration, split, offset/limit,
features, and library version. Private datasets can name an environment variable
such as `HF_TOKEN`, but tokens never enter graphs or results. Media decoding is
disabled so image/audio cells remain portable paths or base64 bytes instead of
requiring UI-host media runtimes. Array-like values and non-finite numbers are
normalized to strict JSON-safe representations.

The dataset node exposes both its complete self-describing result and a plain
`rows` collection. A common text path is **Hugging Face dataset → Select field**
with `path=text`, followed by a Glitchling corruption or a completion node. The
completion node maps a collection of prompts deterministically in order.

## Promoted control ports

Every catalog-driven node control can stay **Local**, become a typed **In** port,
become a typed **Out** port, or use **I/O** pass-through from the inspector:

- an input promotion keeps the local value as its unconnected default;
- an output promotion keeps the local editor active and emits its current value;
- I/O emits the connected input when present and the local default otherwise;
- compatible wires survive mode changes when their side remains available; and
- the graph manifest records every promotion alongside the node configuration.

Promoted inputs and outputs use the same type checking and execution path as
native ports. This makes request parameters such as temperature, seed, file
format, or a transformation pattern wireable without adding operation-specific
node kinds. The dedicated **Number** node supplies numeric sockets directly.

## Reusable workflows

Select one or more nodes, right-click, and choose **Save as workflow**. Glitchloom
infers a typed public boundary from:

- required inputs not supplied inside the selection;
- wires entering or leaving the selection; and
- terminal outputs when no wire leaves the selection, including controls
  intentionally promoted to ports.

The save dialog previews that boundary before writing. Saved workflows appear in
the **Workflows** section of the node library and behave like ordinary typed
nodes in a larger graph. Saving the same case-insensitive name appends a new
immutable version; existing nodes continue to reference their exact older
version. Public sockets default to concise parameter names rather than exposing
their internal node targets. Their display names can be edited in the save
dialog without changing the stable typed binding underneath.

Use the pencil beside a workflow in the library, or its right-click menu, to
open the latest version in a dedicated editor tab. Changes stay isolated from
the main graph until they are saved as the next immutable version. Tabs retain
their own canvas state, warn before discarding unsaved edits, and can be switched
or closed independently.

Delete is available from the same management menu. Glitchloom refuses to delete
a workflow referenced by another saved workflow; otherwise it moves all of the
workflow's versions to `.glitchloom/workflows/.trash` so the operation remains
recoverable. Definitions are stored under
`GLITCHLOOM_WORKSPACE/.glitchloom/workflows`, and their versioned kind plus digest
keeps run manifests reproducible. Nested workflows execute through the same DAG
validator and node engine, with recursive expansion rejected.

## Run on Windows

From this directory:

```powershell
.\run.ps1
```

The script:

1. creates the Python 3.12 environment with `uv`;
2. discovers `%USERPROFILE%\primestuff\glitchlings` when present;
3. installs and builds the React canvas;
4. starts Glitchloom at <http://127.0.0.1:8788>.

After the first setup, skip dependency installation and rebuilding with:

```powershell
.\run.ps1 -SkipInstall
```

File nodes are scoped to `GLITCHLOOM_WORKSPACE`. The launcher defaults that to
the parent of this project. Copy `.env.example` or set environment variables
before launch to override it.

## Live Talkie service

The starter's ordinary **Completion endpoint** node targets:

```text
http://elsie-1:8790/v1/completions
```

This is the currently deployed OpenAI-compatible base-model service. It loads
each selected Talkie lazily and keeps it resident. Consequently, the first
request for each model after a restart can take substantially longer and
allocate model memory on elsie-1. The former J-Lens systemd unit remains present
but disabled, so the previous service can be restored without rebuilding it.

For another provider, use:

```text
Completion endpoint → Model → Generate completion
```

Endpoint nodes store the *name* of an API-key environment variable, never the
secret itself.

## Execution contract

- Graphs are validated for unique node and edge identities, missing ports,
  incompatible types, duplicate single-input connections, and cycles before
  execution.
- Every run freezes the submitted graph and records a SHA-256 graph digest,
  engine and Glitchlings versions, timestamps, workspace, node durations, and
  typed outputs.
- Protocol-v1 progress events report the authoritative run plan, current node,
  completed nodes, and transferred edge IDs without duplicating data values.
- `CompletionResult` retains the raw prompt, output text, model and exact
  revision, endpoint, request parameters, request ID, provider payload, and
  latency.
- Completion nodes default to an exact-request content-addressed cache under
  `.glitchloom/cache`; each result records its cache key and hit status. Nodes
  can refresh or bypass the cache explicitly.
- `CorruptionResult` retains input, output, complete corruptor spec, seed, and
  the resolved application order.
- Templates remain structured until a `Render template` node verifies that all
  `?name` holes are bound. Each `Fill hole` also emits **Bound text**, a partial
  string preview that substitutes current bindings while leaving unbound holes
  visible. It is an ordinary text port and can drive controls such as Model Id.
  `??` escapes a literal question mark.
- Gaggles use their real Glitchlings `AttackWave` / `AttackOrder` plan and
  deterministic derived seeds.
- Read/write nodes reject paths outside the configured workspace unless
  `GLITCHLOOM_ALLOW_ABSOLUTE_PATHS=1` is explicitly set.

## Development

Backend:

```powershell
uv sync --python 3.12
uv run ruff check .
uv run python scripts/export_openapi.py --check
uv run pytest
uv run uvicorn glitchloom.server:app --host 127.0.0.1 --port 8788
```

Frontend:

```powershell
cd web
npm ci
npm run api:check
npm run lint
npm test
npm run build
npm run test:e2e:install
npm run test:e2e
npm run dev
```

`scripts/export_openapi.py` owns the checked-in backend schema snapshot;
`npm run api:generate` refreshes the TypeScript declarations derived from it.
`npm run lint` checks both Biome lint rules and formatting without changing
files; `npm run format` applies the formatter. Generated API declarations and
the npm lockfile remain generator-owned and are excluded from formatting.
The Playwright suite launches isolated backend and Vite processes, uses
deterministic run responses, and exercises both supported viewport sizes. Vite
proxies `/api` to the backend on port 8788 during normal development.

## Version-zero boundaries

This version intentionally does not yet implement arbitrary Python `Apply func`,
model-server lifecycle management, streaming model tokens, cancellation with
side-effect rollback, or bounded iteration.
Reusable workflows are the abstraction for named
bundles such as “run both Talkies”; they do not become model-specific native
nodes. The plugin boundary should become a versioned, typed operation manifest
rather than executing arbitrary callables from saved graphs.
