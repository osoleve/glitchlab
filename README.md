# Glitchlab

[![CI](https://github.com/osoleve/glitchlab/actions/workflows/ci.yml/badge.svg)](https://github.com/osoleve/glitchlab/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Glitchlab is a workflow orchestrator for structured inference, currently focused on text. It's a WIP and personal software, so don't expect Alteryx-quality software.

> "we have alteryx at home"
>
> [img](https://github.com/user-attachments/assets/72b048df-5e6c-4361-b0b5-6cc23498cb95)





It is a local-first, typed node workbench for connecting model completions, deterministic transformations, datasets, collections, and files without losing track of how an output was produced.

Glitchlab is the distribution, Python package, CLI, API, and workbench.

## Features

- **Cable ties!** Bundle related wires into tidy, draggable routes.
- **A basic loom!** Grow and compare branching text histories without flattening them into a single prompt.
- **Glitchlings integration for text perturbation.** Discover operations from the public registry, seed them deterministically, and record what happened.
- **Hugging Face integration for loading datasets.** Select bounded rows and columns for use in a graph.
- Typed ports, preflight validation, partial execution, and deterministic runs.
- Raw OpenAI-compatible `/v1/completions`, including an OpenRouter preset.
- Reusable workflows, collection tools, file I/O, cache telemetry, and complete run manifests.
- Saved graphs that stay data, rather than quietly becoming arbitrary Python programs.

## Quick start

You will need Python 3.12, [uv](https://docs.astral.sh/uv/), and Node.js 22 or newer.

On Windows:

```powershell
git clone https://github.com/osoleve/glitchlab.git
Set-Location glitchlab
.\run.ps1
```

On macOS or Linux:

```bash
git clone https://github.com/osoleve/glitchlab.git
cd glitchlab
uv sync --python 3.12
npm --prefix web ci
npm --prefix web run build
uv run glitchlab
```

Open [http://127.0.0.1:8788](http://127.0.0.1:8788).

The canvas works without a model server. Generation nodes need a raw OpenAI-compatible completions endpoint; the starter graph expects one at `http://127.0.0.1:8790/v1`.

## Models and providers

Glitchlab deliberately sends raw prompts to `/v1/completions`. It does not silently apply a chat template or trim prompt whitespace.

You can point completion nodes at:

- a local OpenAI-compatible server;
- OpenRouter;
- another compatible endpoint.

## Configuration

Copy `.env.example` to `.env` when you need local configuration. `run.ps1` loads it automatically.

Useful settings include:

- `GLITCHLAB_WORKSPACE` — the root available to file nodes.
- `GLITCHLAB_STATE_DIR` — an optional state-root override.
- `GLITCHLAB_CACHE_DIR` — the completion-cache location.
- `GLITCHLAB_GLITCHLINGS_PATH` — an optional local Glitchlings checkout.
- `OPENROUTER_API_KEY` and `HF_TOKEN` — optional provider credentials.
- `GLITCHLAB_ALLOW_ABSOLUTE_PATHS=1` — explicitly allow file nodes outside the workspace.

Graphs may store the name of an API-key environment variable, but never the secret itself.

## Provenance and safety

Every run records the graph digest, execution order, timings, terminal outputs, cache status, and model/provider metadata. File nodes are confined to `GLITCHLAB_WORKSPACE` unless the absolute-path override is deliberately enabled.

Glitchlab is local research software, not a hardened multi-user execution service. Treat imported graphs as input worth reviewing before you run them.

## Development

Backend checks:

```powershell
uv sync --python 3.12
uv run ruff check .
uv run python scripts/export_openapi.py --check
uv run pytest -q
```

Frontend checks:

```powershell
Set-Location web
npm ci
npm run api:check
npm run lint
npm test
npm run build
npm run test:e2e
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the [MIT license](LICENSE) before sending the loom anywhere adventurous.

## Guarantee

There is a version of this that works on my machine\*

\*I do not guarantee I have that version.
