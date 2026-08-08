"""Glitchlab runtime configuration."""

from __future__ import annotations

import os
from pathlib import Path

ENV_PREFIX = "GLITCHLAB"
STATE_DIRECTORY_NAME = ".glitchlab"


def setting(name: str, default: str = "") -> str:
    """Read a Glitchlab setting."""

    return os.getenv(f"{ENV_PREFIX}_{name}", default)


def state_directory(workspace: Path) -> Path:
    """Return the configured Glitchlab state root."""

    configured = setting("STATE_DIR").strip()
    if configured:
        return Path(configured).expanduser().resolve()

    return workspace.resolve() / STATE_DIRECTORY_NAME
