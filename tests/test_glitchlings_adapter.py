from __future__ import annotations

import os
from pathlib import Path

import pytest

from glitchlab.config import setting
from glitchlab.glitchlings_adapter import corrupt_text, discover_glitchlings, plugin_status

LOCAL_CHECKOUT_VALUE = setting("GLITCHLINGS_PATH").strip()
LOCAL_CHECKOUT = Path(LOCAL_CHECKOUT_VALUE).expanduser() if LOCAL_CHECKOUT_VALUE else None


def test_installed_glitchlings_discovery_and_corruption() -> None:
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
    assert status["version"] is not None
    assert {"typogre", "scannequin"}.issubset({item["name"] for item in discovered})
    assert first == second
    assert first["apply_order"] == ["Typogre"]


@pytest.mark.skipif(
    LOCAL_CHECKOUT is None or not LOCAL_CHECKOUT.is_dir(),
    reason="set GLITCHLAB_GLITCHLINGS_PATH to run the integration test",
)
def test_local_glitchlings_discovery_and_corruption(monkeypatch: pytest.MonkeyPatch) -> None:
    assert LOCAL_CHECKOUT is not None
    monkeypatch.setenv("GLITCHLAB_GLITCHLINGS_PATH", str(LOCAL_CHECKOUT))
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
