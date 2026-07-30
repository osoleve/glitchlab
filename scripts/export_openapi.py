"""Export Glitchloom's FastAPI schema as a deterministic frontend artifact."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = REPOSITORY_ROOT / "web" / "src" / "generated" / "openapi.json"

if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from glitchloom.server import app  # noqa: E402


def render_openapi() -> str:
    """Return stable, reviewable JSON for the application's OpenAPI document."""

    return json.dumps(
        app.openapi(),
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ) + "\n"


def main() -> None:
    """Write the schema, or fail when a checked-in snapshot has drifted."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail instead of writing when the checked-in schema differs",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"schema destination (default: {DEFAULT_OUTPUT})",
    )
    args = parser.parse_args()

    destination = args.output.resolve()
    rendered = render_openapi()
    if args.check:
        existing = (
            destination.read_text(encoding="utf-8")
            if destination.is_file()
            else None
        )
        if existing != rendered:
            raise SystemExit(
                f"OpenAPI schema drifted: run {Path(__file__).name} "
                f"to refresh {destination}."
            )
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(rendered, encoding="utf-8", newline="\n")
    print(destination)


if __name__ == "__main__":
    main()
