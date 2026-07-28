"""Run the checked-in live Talkie graph without holding an interactive shell."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path


def main() -> int:
    project_root = Path(__file__).resolve().parents[1]
    graph_path = project_root / "examples" / "talkie-smoke.json"
    result_path = project_root / "talkie-smoke.result.json"
    error_path = project_root / "talkie-smoke.error.log"
    request = urllib.request.Request(
        "http://127.0.0.1:8788/api/runs",
        data=graph_path.read_bytes(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=1800) as response:
            payload = json.load(response)
        result_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except (OSError, urllib.error.HTTPError, json.JSONDecodeError) as exc:
        body = (
            exc.read().decode(errors="replace")
            if isinstance(exc, urllib.error.HTTPError)
            else ""
        )
        error_path.write_text(f"{type(exc).__name__}: {exc}\n{body}", encoding="utf-8")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
