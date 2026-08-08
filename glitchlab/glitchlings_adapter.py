"""Optional bridge to an installed package or configured Glitchlings checkout."""

from __future__ import annotations

import hashlib
import importlib
import inspect
import json
import sys
from enum import Enum
from pathlib import Path
from typing import Any

from .config import setting


class GlitchlingsUnavailable(RuntimeError):
    """Raised when the optional Glitchlings runtime cannot be loaded."""


_MODULE: Any | None = None
_IMPORT_ERROR: str | None = None


def _candidate_source_path() -> Path | None:
    configured = setting("GLITCHLINGS_PATH").strip()
    if configured:
        candidate = Path(configured).expanduser()
        source = candidate / "src" if (candidate / "src" / "glitchlings").is_dir() else candidate
        if (source / "glitchlings").is_dir():
            return source.resolve()
    return None


def load_glitchlings() -> Any:
    """Load Glitchlings from an explicit checkout or installed package."""

    global _IMPORT_ERROR, _MODULE
    if _MODULE is not None:
        return _MODULE

    source_path = _candidate_source_path()
    if source_path is not None and str(source_path) not in sys.path:
        sys.path.insert(0, str(source_path))

    try:
        _MODULE = importlib.import_module("glitchlings")
        _IMPORT_ERROR = None
        return _MODULE
    except Exception as exc:  # noqa: BLE001 - optional plugin boundary
        _IMPORT_ERROR = f"{type(exc).__name__}: {exc}"
        raise GlitchlingsUnavailable(
            "Glitchlings could not be imported. Set GLITCHLAB_GLITCHLINGS_PATH "
            "to a compatible checkout and run Glitchlab with the same Python version "
            "as its compiled extension."
        ) from exc


def plugin_status() -> dict[str, Any]:
    """Return availability and version without raising across the API boundary."""

    try:
        module = load_glitchlings()
    except GlitchlingsUnavailable:
        return {"available": False, "version": None, "error": _IMPORT_ERROR}
    return {
        "available": True,
        "version": getattr(module, "__version__", "local"),
        "path": str(Path(module.__file__).resolve()),
        "error": None,
    }


def _json_default(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    try:
        json.dumps(value)
    except TypeError:
        return repr(value)
    return value


def _parameter_descriptor(parameter: inspect.Parameter) -> dict[str, Any]:
    default = None if parameter.default is inspect.Parameter.empty else parameter.default
    annotation = parameter.annotation
    choices: list[Any] = []
    if inspect.isclass(annotation) and issubclass(annotation, Enum):
        choices = [member.value for member in annotation]
    return {
        "name": parameter.name,
        "required": parameter.default is inspect.Parameter.empty,
        "default": _json_default(default),
        "annotation": (
            None
            if annotation is inspect.Parameter.empty
            else getattr(annotation, "__name__", str(annotation))
        ),
        "choices": choices,
    }


def discover_glitchlings() -> list[dict[str, Any]]:
    """Inspect the public registry and constructor controls."""

    load_glitchlings()
    zoo = importlib.import_module("glitchlings.zoo")
    discovered: list[dict[str, Any]] = []
    for name in sorted(zoo.BUILTIN_GLITCHLINGS):
        glitchling_class = zoo.get_glitchling_class(name)
        parameters = []
        for parameter in inspect.signature(glitchling_class.__init__).parameters.values():
            if parameter.name == "self" or parameter.kind in {
                inspect.Parameter.VAR_KEYWORD,
                inspect.Parameter.VAR_POSITIONAL,
            }:
                continue
            parameters.append(_parameter_descriptor(parameter))
        discovered.append(
            {
                "name": name,
                "label": getattr(zoo.BUILTIN_GLITCHLINGS[name], "name", name.title()),
                "class": glitchling_class.__name__,
                "parameters": parameters,
            }
        )
    return discovered


def _row_seed(master_seed: int, index: int) -> int:
    digest = hashlib.sha256(f"{master_seed}:{index}".encode()).digest()
    return int.from_bytes(digest[:8], "big") & ((1 << 63) - 1)


def _instantiate_glitchling(spec: dict[str, Any], *, seed: int | None = None) -> Any:
    load_glitchlings()
    zoo = importlib.import_module("glitchlings.zoo")
    glitchling_class = zoo.get_glitchling_class(str(spec["name"]))
    params = dict(spec.get("params") or {})
    params["seed"] = int(spec.get("seed", 151) if seed is None else seed)
    return glitchling_class(**params)


def _instantiate_corruptor(
    spec: dict[str, Any],
    *,
    seed: int | None = None,
) -> tuple[Any, list[str]]:
    load_glitchlings()
    if spec.get("kind") == "glitchling":
        member = _instantiate_glitchling(spec, seed=seed)
        return member, [member.name]

    if spec.get("kind") != "gaggle":
        raise ValueError("Corruptor must be a GlitchlingSpec or GaggleSpec.")

    zoo = importlib.import_module("glitchlings.zoo")
    members = [_instantiate_glitchling(member) for member in spec.get("members", [])]
    if not members:
        raise ValueError("A gaggle requires at least one connected glitchling.")
    gaggle_seed = int(spec.get("seed", 151) if seed is None else seed)
    gaggle = zoo.Gaggle(
        members,
        seed=gaggle_seed,
        transcript_target=spec.get("transcript_target", "last"),
        exclude_patterns=spec.get("exclude_patterns") or None,
        include_only_patterns=spec.get("include_only_patterns") or None,
    )
    return gaggle, [member.name for member in gaggle.apply_order]


def corrupt_text(
    value: str | list[str],
    spec: dict[str, Any],
) -> dict[str, Any] | list[dict[str, Any]]:
    """Apply a corruptor deterministically and return self-describing results."""

    values = value if isinstance(value, list) else [value]
    master_seed = int(spec.get("seed", 151))
    results: list[dict[str, Any]] = []
    for index, text in enumerate(values):
        seed = master_seed if len(values) == 1 else _row_seed(master_seed, index)
        corruptor, apply_order = _instantiate_corruptor(spec, seed=seed)
        output = corruptor.corrupt(text)
        results.append(
            {
                "kind": "corruption_result",
                "input": text,
                "output": output,
                "seed": seed,
                "spec": spec,
                "apply_order": apply_order,
            }
        )
    return results if isinstance(value, list) else results[0]
