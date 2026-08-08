# Glitchlab Agent Guide

These instructions apply to the entire repository.

## Purpose

Glitchlab is a local-first, typed node workbench for structured inference. It
combines OpenAI-compatible base-model completions, deterministic text
transformations, collections, file I/O, and optional Glitchlings corruption
operations while retaining experiment provenance.

Keep the native runtime general-purpose. Model- or experiment-specific bundles
belong in reusable saved subgraphs, not in special node kinds.

## Repository Map

- `glitchlab/`: FastAPI server, node catalog, typed DAG validation/execution,
  caching, and the Glitchlings adapter.
- `web/`: React, TypeScript, Vite, and React Flow frontend.
- `tests/`: backend and integration-contract tests.
- `examples/`: checked-in graph examples.
- `scripts/`: schema and maintenance utilities.

## Setup and Quality Gates

Use Python 3.12 because the local Glitchlings native extension targets CPython
3.12.

```powershell
uv sync --python 3.12
uv run ruff check .
uv run python scripts/export_openapi.py --check
uv run pytest -q

Set-Location web
npm ci
npm run api:check
npm run lint
npm test
npm run build
npm run test:e2e
```

The real Glitchlings integration test runs when `GLITCHLAB_GLITCHLINGS_PATH`
points to a compatible checkout. Otherwise it skips cleanly.

For an end-to-end Windows launch:

```powershell
.\run.ps1
```

The app is served at `http://127.0.0.1:8788`.

## Architecture Rules

- Node contracts originate in `glitchlab/catalog.py`; execution belongs in
  `glitchlab/engine.py`. Update both, the frontend schema consumers, and tests
  together.
- Preserve typed ports, preflight validation, deterministic topological
  execution, terminal outputs, and complete run manifests.
- Completion endpoints use raw `/v1/completions`. Do not silently apply chat
  templates or rewrite prompts.
- Prompt whitespace is semantically significant. Do not trim it implicitly.
  Prefer a visible warning or an explicit transformation node.
- Graphs may name an API-key environment variable but must never persist the
  secret value.
- Completion cache keys must cover every request-affecting field. Bump the
  package version when cached result schemas or cache semantics change.
- File nodes remain scoped to `GLITCHLAB_WORKSPACE` unless the documented
  absolute-path override is explicitly enabled.
- Glitchlings must be discovered through their public registry and invoked
  deterministically with recorded specs, seeds, and application order.
- Saved graphs must not become an arbitrary Python-code execution channel.
  Future plugin operations should use versioned typed manifests.

## Frontend Rules

- The inspector is catalog-driven. New node fields should render from the
  backend schema instead of adding node-specific forms.
- Keep the canvas usable at 1365x768 and 1920x1080. After meaningful layout
  changes, verify starter fit, node selection, inspector controls, edges, run
  states, minimap, and browser console output at both sizes.
- Preserve visible cache hit/miss telemetry and run/error states.
- Do not commit `web/dist`, TypeScript build-info files, or generated Vite
  configuration output.

## Change Discipline

- Preserve unrelated user changes and generated experiment outputs.
- Use focused commits and keep the README, examples, and operational docs in
  sync with behavior.
- For backend changes, run Ruff and pytest. For frontend changes, also run the
  production build.
