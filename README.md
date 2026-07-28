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
have working resize handles, `Delete` / `Backspace` removes the current canvas
selection, and `Ctrl+Enter` runs the loom. The node library and inspector use
standard draggable dividers, support arrow-key resizing when focused, and reset
to their responsive defaults on double-click.

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
  `?name` holes are bound. `??` escapes a literal question mark.
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
model-server lifecycle management, persistent graph or reusable subgraph files,
streaming tokens, or bounded iteration. Reusable subgraphs are the intended
abstraction for named bundles such as “run both Talkies”; they should not become
model-specific native nodes. The plugin boundary should become a versioned, typed
operation manifest rather than executing arbitrary callables from saved graphs.
