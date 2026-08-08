# Contributing to Glitchlab

Thanks for helping improve Glitchlab. Focused bug reports, documentation fixes,
tests, and small pull requests are especially useful while the project is in alpha.

## Development setup

Install Python 3.12, [uv](https://docs.astral.sh/uv/), and Node.js 22. From the
repository root:

```powershell
uv sync --python 3.12
Set-Location web
npm ci
```

Copy `.env.example` to `.env` only when you need non-default paths or optional
providers. Never commit API keys, tokens, model outputs, caches, or saved local
graphs.

## Before opening a pull request

Run the backend gates:

```powershell
uv run ruff check .
uv run python scripts/export_openapi.py --check
uv run pytest -q
```

Then run the frontend gates from `web/`:

```powershell
npm run api:check
npm run lint
npm test
npm run build
npm run test:e2e
```

Browser changes should remain usable at 1365×768 and 1920×1080. Backend node
changes must keep `glitchlab/catalog.py`, `glitchlab/engine.py`, the generated
frontend schema, and their tests in sync.

## Pull requests

- Explain the user-visible behavior and why the change belongs in the general
  workbench rather than an experiment-specific node.
- Preserve prompt whitespace, typed ports, deterministic execution, provenance,
  and the workspace file boundary.
- Keep secrets in environment variables; graphs may store only the variable name.
- Include or update tests for behavior changes and keep the README and examples
  synchronized with the implementation.

By contributing, you agree that your contribution is licensed under the MIT License.
