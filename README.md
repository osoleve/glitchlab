# Glitchloom

Glitchloom is a local-first inference workbench: a typed node canvas for composing
base-model calls, deterministic text transformations, collection operations, and
self-describing experiment outputs.

The spike ships with a live vertical slice for:

- `talkie-1930-13b-base`
- `talkie-web-13b-base`
- the native base-completion service on `elsie-1`
- the local `osoleve/glitchlings` checkout
- generic OpenAI-compatible `/v1/completions` endpoints

The starter loom expresses the experiment entirely with generic nodes: one
OpenAI-compatible endpoint, two model references, and four completion branches
run the original prompt and a seeded Typogre corruption through both Talkies.
Their normalized completion records are collected and exposed in the inspector.
The output view recognizes both those records and raw OpenAI-compatible completion
envelopes, including lists of either shape. It keeps generated text prominent,
surfaces compact model, finish, token, latency, cache, revision, and seed context,
and leaves request details plus the complete JSON available on demand.
The workbench also tracks unsaved graph changes, confirms and can undo a starter
reset, preserves the current selection while a run completes, and labels
collected completion cards with their source node titles. Selected canvas nodes
have working resize handles, `Ctrl`/`Cmd`+click builds a multi-node selection,
and `Delete` / `Backspace` removes the current canvas selection. Right-clicking
nodes, selections, wires, or the canvas opens Glitchloom's context menu. Selected
wires expose draggable endpoints; dropping one away from a compatible port
disconnects it. `Ctrl+Enter` runs the loom. The node library and inspector use
standard draggable dividers, support arrow-key resizing when focused, and reset
to their responsive defaults on double-click.

## Partial execution and run freshness

The topbar and `Ctrl+Enter` still run the complete loom. Right-click a node and
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

## Saved looms and templates

Top-level looms are editable documents, deliberately separate from immutable
reusable workflows. **Save** updates the current saved loom with revision
protection; **Save as** always creates a new document. Saved looms reopen in
closable graph tabs, while **Open as copy** removes the source identity and starts
an unsaved tab. This makes a saved loom useful as an experiment template without
risking its source document or any versioned workflow node it contains.

Checked-in graphs under `examples/` appear as read-only templates and also always
open as copies. Mutable loom documents live under
`GLITCHLOOM_WORKSPACE/.glitchloom/looms`; deletion uses recoverable local trash.
Exact workflow versions referenced by a loom are retained when it loads rather
than being silently replaced by the latest catalog version. `Ctrl+S` saves the
current loom and `Ctrl+Shift+S` opens Save as.

## Canvas context actions

Right-click an empty part of the canvas to search the complete catalog and add a
node at that graph position. Node and multi-node menus support partial execution,
upstream/downstream selection, duplication, alignment, distribution, workflow
extraction, and deletion. A wire can be disconnected or split by inserting the one-input,
one-output **Passthrough** node. That initial insertion action preserves the
original endpoint handles and leaves room for a future type-aware compatible-node
picker.

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

- Graphs are validated for missing ports, incompatible types, duplicate
  single-input connections, and cycles before execution.
- Every run freezes the submitted graph and records a SHA-256 graph digest,
  engine and Glitchlings versions, timestamps, workspace, node durations, and
  typed outputs.
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
uv run pytest
uv run ruff check .
uv run uvicorn glitchloom.server:app --host 127.0.0.1 --port 8788
```

Frontend:

```powershell
cd web
npm install
npm run dev
```

Vite proxies `/api` to the backend on port 8788.

## Spike boundaries

This version intentionally does not yet implement arbitrary Python `Apply func`,
model-server lifecycle management, streaming tokens, or bounded iteration.
Reusable workflows are the abstraction for named
bundles such as “run both Talkies”; they do not become model-specific native
nodes. The plugin boundary should become a versioned, typed operation manifest
rather than executing arbitrary callables from saved graphs.
