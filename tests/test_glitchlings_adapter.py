from __future__ import annotations

import os
from pathlib import Path

import pytest

from glitchloom.glitchlings_adapter import corrupt_text, discover_glitchlings, plugin_status

LOCAL_CHECKOUT = Path.home() / "primestuff" / "glitchlings"


@pytest.mark.skipif(not LOCAL_CHECKOUT.is_dir(), reason="local Glitchlings checkout not present")
def test_local_glitchlings_discovery_and_corruption(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GLITCHLOOM_GLITCHLINGS_PATH", str(LOCAL_CHECKOUT))
    os.environ.setdefault("PYTHONHASHSEED", "0")

    discovered = discover_glitchlings()
    status = plugin_status()
    first = corrupt_text(
        "The quick brown fox jumps over the lazy dog.",
        {"kind": "glitchling", "name": "typogre", "seed": 151, "params": {}},
    )
    second = corrupt_text(
        "The quick brown fox jumps over the lazy dog.",
        {"kind": "glitchling", "name": "typogre", "seed": 151, "params": {}},
    )

    assert status["available"]
    assert {"typogre", "scannequin"}.issubset({item["name"] for item in discovered})
    assert first == second
    assert first["apply_order"] == ["Typogre"]

    gaggle_spec = {
        "kind": "gaggle",
        "seed": 151,
        "members": [
            {"kind": "glitchling", "name": "typogre", "seed": 1, "params": {}},
            {"kind": "glitchling", "name": "scannequin", "seed": 2, "params": {}},
        ],
        "transcript_target": "last",
        "exclude_patterns": [],
        "include_only_patterns": [],
    }
    gaggle_first = corrupt_text("A clean deterministic sentence.", gaggle_spec)
    gaggle_second = corrupt_text("A clean deterministic sentence.", gaggle_spec)

    assert gaggle_first == gaggle_second
    assert set(gaggle_first["apply_order"]) == {"Typogre", "Scannequin"}
