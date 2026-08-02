"""Bounded Hugging Face Hub dataset ingestion for graph nodes."""

from __future__ import annotations

import base64
import importlib
import math
import os
import re
from collections.abc import Mapping, Sequence
from datetime import date, datetime, time
from enum import Enum
from typing import Any

from .glitchlings_adapter import GlitchlingsUnavailable, load_glitchlings

MAX_DATASET_ROWS = 10_000
HUB_DATASET_ID_PATTERN = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$"
)
SPLIT_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
ENV_NAME_PATTERN = re.compile(r"^[A-Z_][A-Z0-9_]*$")


class HuggingFaceDatasetsUnavailable(RuntimeError):
    """Raised when the pinned Hugging Face datasets runtime cannot be loaded."""


def _require_datasets_runtime() -> Any:
    """Load datasets, preferring Glitchlings' public optional-dependency gate."""

    try:
        load_glitchlings()
        loaders = importlib.import_module("glitchlings.compat.loaders")
        module = loaders.require_datasets(
            "Hugging Face datasets is required for the dataset node."
        )
    except (GlitchlingsUnavailable, ImportError, ModuleNotFoundError):
        try:
            module = importlib.import_module("datasets")
        except ImportError as exc:
            raise HuggingFaceDatasetsUnavailable(
                "Hugging Face datasets is not installed; run `uv sync` to install it."
            ) from exc

    version = str(getattr(module, "__version__", "0"))
    try:
        major = int(version.split(".", 1)[0])
    except ValueError as exc:
        raise HuggingFaceDatasetsUnavailable(
            f"Could not verify the Hugging Face datasets version {version!r}."
        ) from exc
    if major < 4:
        raise HuggingFaceDatasetsUnavailable(
            "Hugging Face datasets 4 or newer is required; older releases can execute "
            "dataset loading scripts."
        )
    return module


def _resolve_hub_revision(
    dataset_id: str,
    requested_revision: str,
    *,
    token: str | None,
) -> str:
    """Resolve a mutable Hub ref to the exact dataset commit it currently names."""

    try:
        hub = importlib.import_module("huggingface_hub")
    except ImportError as exc:
        raise HuggingFaceDatasetsUnavailable(
            "huggingface-hub is required to resolve dataset revisions; run `uv sync`."
        ) from exc
    info = hub.HfApi().dataset_info(
        repo_id=dataset_id,
        revision=requested_revision,
        token=token,
    )
    resolved_revision = str(getattr(info, "sha", "") or "").strip()
    if not resolved_revision:
        raise ValueError(
            f"Hugging Face Hub did not resolve {dataset_id!r} at "
            f"revision {requested_revision!r} to a commit SHA."
        )
    return resolved_revision


def _json_value(value: Any, *, path: str) -> Any:
    """Normalize supported dataset scalars without unstable repr fallbacks."""

    if value is None or isinstance(value, str | int | bool):
        return value
    if isinstance(value, float):
        if math.isfinite(value):
            return value
        if math.isnan(value):
            label = "nan"
        elif value > 0:
            label = "infinity"
        else:
            label = "-infinity"
        return {"encoding": "nonfinite-float", "value": label}
    if isinstance(value, Enum):
        return _json_value(value.value, path=path)
    if isinstance(value, bytes):
        return {
            "encoding": "base64",
            "data": base64.b64encode(value).decode("ascii"),
        }
    if isinstance(value, datetime | date | time):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {
            str(key): _json_value(item, path=f"{path}.{key}")
            for key, item in value.items()
        }
    if isinstance(value, Sequence):
        return [
            _json_value(item, path=f"{path}[{index}]")
            for index, item in enumerate(value)
        ]
    tolist_method = getattr(value, "tolist", None)
    if callable(tolist_method):
        items = tolist_method()
        if items is not value:
            return _json_value(items, path=path)
    item_method = getattr(value, "item", None)
    if callable(item_method):
        scalar = item_method()
        if scalar is not value:
            return _json_value(scalar, path=path)
    raise TypeError(
        f"Dataset value at {path} has unsupported type {type(value).__name__}; "
        "choose a JSON-compatible dataset configuration."
    )


def _features(dataset: Any) -> Any:
    features = getattr(dataset, "features", None)
    if features is None:
        return None
    to_dict = getattr(features, "to_dict", None)
    if callable(to_dict):
        features = to_dict()
    return _json_value(features, path="features")


def load_huggingface_dataset(config: dict[str, Any]) -> dict[str, Any]:
    """Load and materialize one explicitly bounded, ordered Hub dataset slice."""

    dataset_id = str(config.get("dataset_id", "")).strip()
    if not HUB_DATASET_ID_PATTERN.fullmatch(dataset_id):
        raise ValueError(
            "dataset_id must be a Hugging Face Hub repository ID in owner/name form; "
            "local paths and dataset loading scripts are not allowed."
        )
    config_name = str(config.get("config_name", "")).strip() or None
    requested_revision = str(config.get("revision", "main")).strip()
    if not requested_revision:
        raise ValueError("revision is required; prefer an immutable Hub commit SHA.")
    split = str(config.get("split", "train")).strip()
    if not SPLIT_PATTERN.fullmatch(split):
        raise ValueError(
            "split must be a split name without bracket slicing; use offset and limit."
        )

    offset = int(config.get("offset", 0))
    limit = int(config.get("limit", 100))
    if offset < 0:
        raise ValueError("offset must be zero or greater.")
    if not 1 <= limit <= MAX_DATASET_ROWS:
        raise ValueError(f"limit must be between 1 and {MAX_DATASET_ROWS:,} rows.")

    token_env = str(config.get("token_env", "")).strip()
    token: str | None = None
    if token_env:
        if not ENV_NAME_PATTERN.fullmatch(token_env):
            raise ValueError("token_env must name an environment variable, not contain a token.")
        token = os.getenv(token_env)
        if not token:
            raise ValueError(
                f"Dataset expects token environment variable {token_env!r}."
            )

    datasets = _require_datasets_runtime()
    resolved_revision = _resolve_hub_revision(
        dataset_id,
        requested_revision,
        token=token,
    )
    load_kwargs: dict[str, Any] = {
        "path": dataset_id,
        "split": split,
        "revision": resolved_revision,
        "streaming": True,
    }
    if config_name is not None:
        load_kwargs["name"] = config_name
    if token is not None:
        load_kwargs["token"] = token
    dataset = datasets.load_dataset(**load_kwargs)

    decode = getattr(dataset, "decode", None)
    if callable(decode):
        dataset = decode(False)

    skip = getattr(dataset, "skip", None)
    take = getattr(dataset, "take", None)
    if not callable(skip) or not callable(take):
        raise TypeError("The loaded dataset does not support deterministic streaming slices.")
    sliced = skip(offset).take(limit)
    rows: list[dict[str, Any]] = []
    for index, row in enumerate(sliced):
        if not isinstance(row, Mapping):
            raise TypeError(
                f"Dataset row {offset + index} is not a record; received "
                f"{type(row).__name__}."
            )
        rows.append(_json_value(row, path=f"rows[{offset + index}]"))

    info = getattr(dataset, "info", None)
    dataset_version = getattr(info, "version", None)
    return {
        "kind": "dataset_result",
        "source": {
            "dataset_id": dataset_id,
            "config_name": config_name,
            "requested_revision": requested_revision,
            "resolved_revision": resolved_revision,
            "split": split,
            "slice": {"offset": offset, "limit": limit},
            "streaming": True,
        },
        "rows": rows,
        "row_count": len(rows),
        "features": _features(dataset),
        "fingerprint": getattr(dataset, "_fingerprint", None),
        "dataset_version": None if dataset_version is None else str(dataset_version),
        "datasets_library_version": str(getattr(datasets, "__version__", "unknown")),
    }


__all__ = [
    "HuggingFaceDatasetsUnavailable",
    "MAX_DATASET_ROWS",
    "load_huggingface_dataset",
]
