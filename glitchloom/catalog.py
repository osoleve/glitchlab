"""Node catalog exposed to the canvas and enforced by the runner."""

from __future__ import annotations

from copy import deepcopy
from typing import Any


def _port(
    name: str,
    value_type: str,
    *,
    required: bool = True,
    multiple: bool = False,
    label: str | None = None,
) -> dict[str, Any]:
    return {
        "name": name,
        "label": label or name.replace("_", " ").title(),
        "type": value_type,
        "required": required,
        "multiple": multiple,
    }


def _field(
    name: str,
    control: str,
    default: Any,
    *,
    label: str | None = None,
    help_text: str = "",
    options: list[dict[str, Any]] | None = None,
    placeholder: str = "",
) -> dict[str, Any]:
    return {
        "name": name,
        "label": label or name.replace("_", " ").title(),
        "control": control,
        "default": default,
        "help": help_text,
        "options": options or [],
        "placeholder": placeholder,
    }


NODE_DEFINITIONS: list[dict[str, Any]] = [
    {
        "kind": "text_input",
        "label": "Raw text",
        "category": "Text",
        "description": "A literal text value.",
        "inputs": [],
        "outputs": [_port("text", "text")],
        "fields": [_field("text", "textarea", "The future arrives unevenly.")],
    },
    {
        "kind": "template_input",
        "label": "Text with holes",
        "category": "Text",
        "description": "A structured template using ?name holes.",
        "inputs": [],
        "outputs": [_port("template", "template")],
        "fields": [
            _field(
                "template",
                "textarea",
                "?person went to ?store yesterday.",
                help_text="Use ?? for a literal question mark.",
            )
        ],
    },
    {
        "kind": "fill_hole",
        "label": "Fill hole",
        "category": "Text",
        "description": "Bind one named template hole.",
        "inputs": [
            _port("template", "template"),
            _port("value", "any", required=False),
        ],
        "outputs": [_port("template", "template")],
        "fields": [
            _field("name", "text", "person", placeholder="person"),
            _field("value", "text", "Ada", help_text="Used when the value port is unconnected."),
        ],
    },
    {
        "kind": "render_template",
        "label": "Render template",
        "category": "Text",
        "description": "Resolve a fully bound template to text.",
        "inputs": [_port("template", "template")],
        "outputs": [_port("text", "text")],
        "fields": [],
    },
    {
        "kind": "split",
        "label": "Split",
        "category": "Text",
        "description": "Split text with a literal separator or regular expression.",
        "inputs": [_port("text", "text")],
        "outputs": [_port("items", "collection")],
        "fields": [
            _field("pattern", "text", "\\n"),
            _field("regex", "checkbox", False),
        ],
    },
    {
        "kind": "replace",
        "label": "Replace",
        "category": "Text",
        "description": "Replace literal text or regular-expression matches.",
        "inputs": [_port("text", "text")],
        "outputs": [_port("text", "text")],
        "fields": [
            _field("find", "text", ""),
            _field("replacement", "text", ""),
            _field("regex", "checkbox", False),
        ],
    },
    {
        "kind": "join",
        "label": "Join",
        "category": "Text",
        "description": "Join a collection with an optional separator.",
        "inputs": [_port("items", "collection")],
        "outputs": [_port("text", "text")],
        "fields": [_field("separator", "text", "\\n")],
    },
    {
        "kind": "list_input",
        "label": "List",
        "category": "Flow",
        "description": "A JSON array or one item per line.",
        "inputs": [],
        "outputs": [_port("items", "collection")],
        "fields": [_field("items", "textarea", "first prompt\nsecond prompt")],
    },
    {
        "kind": "collect",
        "label": "Collect",
        "category": "Flow",
        "description": "Collect multiple values into one ordered collection.",
        "inputs": [_port("item", "any", multiple=True)],
        "outputs": [_port("items", "collection")],
        "fields": [_field("flatten", "checkbox", False)],
    },
    {
        "kind": "cartesian",
        "label": "Cartesian product",
        "category": "Flow",
        "description": "Cross two collections into {left, right} records.",
        "inputs": [
            _port("left", "collection"),
            _port("right", "collection"),
        ],
        "outputs": [_port("items", "collection")],
        "fields": [],
    },
    {
        "kind": "select_field",
        "label": "Select field",
        "category": "Flow",
        "description": "Read a dotted field path from a record or collection.",
        "inputs": [_port("value", "any")],
        "outputs": [_port("value", "any")],
        "fields": [_field("path", "text", "text")],
    },
    {
        "kind": "endpoint",
        "label": "Completion endpoint",
        "category": "Models",
        "description": "An OpenAI-compatible endpoint reference.",
        "inputs": [],
        "outputs": [_port("endpoint", "endpoint")],
        "fields": [
            _field("base_url", "text", "http://127.0.0.1:8000/v1"),
            _field(
                "api_key_env",
                "text",
                "",
                help_text="Environment variable containing the key; never the key itself.",
            ),
            _field("timeout_seconds", "number", 120),
        ],
    },
    {
        "kind": "model",
        "label": "Model",
        "category": "Models",
        "description": "A completion model identifier.",
        "inputs": [],
        "outputs": [_port("model", "model")],
        "fields": [_field("model_id", "text", "talkie-1930-13b-base")],
    },
    {
        "kind": "completion",
        "label": "Generate completion",
        "category": "Models",
        "description": "Call /v1/completions without applying a chat template.",
        "inputs": [
            _port("endpoint", "endpoint"),
            _port("model", "model"),
            _port("prompt", "any"),
        ],
        "outputs": [_port("result", "completion")],
        "fields": [
            _field("temperature", "number", 0.8),
            _field("top_p", "number", 0.95),
            _field("max_tokens", "number", 96),
            _field("seed", "number_optional", 151),
            _field("stop", "textarea", "", help_text="One stop string per line."),
            _field("logprobs", "number_optional", None),
            _field("extra_body", "json", {}, help_text="Provider-specific request fields."),
            _field(
                "cache_mode",
                "select",
                "use",
                options=[
                    {"label": "Use exact-request cache", "value": "use"},
                    {"label": "Refresh cached result", "value": "refresh"},
                    {"label": "Do not cache", "value": "off"},
                ],
            ),
        ],
    },
    {
        "kind": "glitchling",
        "label": "Glitchling",
        "category": "Glitchlings",
        "description": "Configure one deterministic text corruptor.",
        "inputs": [],
        "outputs": [_port("glitchling", "glitchling")],
        "fields": [
            _field("name", "select", "typogre", options=[]),
            _field("seed", "number", 151),
            _field("params", "json", {}),
        ],
    },
    {
        "kind": "gaggle",
        "label": "Build gaggle",
        "category": "Glitchlings",
        "description": "Build a deterministic composite from connected glitchlings.",
        "inputs": [_port("members", "glitchling", multiple=True)],
        "outputs": [_port("gaggle", "gaggle")],
        "fields": [
            _field("seed", "number", 151),
            _field("transcript_target", "text", "last"),
            _field("exclude_patterns", "json", []),
            _field("include_only_patterns", "json", []),
        ],
    },
    {
        "kind": "corrupt",
        "label": "Corrupt",
        "category": "Glitchlings",
        "description": "Apply a glitchling or gaggle while retaining provenance.",
        "inputs": [
            _port("text", "any"),
            _port("corruptor", "any"),
        ],
        "outputs": [_port("result", "corruption")],
        "fields": [],
    },
    {
        "kind": "read_file",
        "label": "Read file",
        "category": "Files",
        "description": "Read UTF-8 text within the configured workspace.",
        "inputs": [],
        "outputs": [_port("text", "text")],
        "fields": [_field("path", "text", "prompts.txt")],
    },
    {
        "kind": "write_file",
        "label": "Write file",
        "category": "Files",
        "description": "Write text, JSON, or JSONL within the configured workspace.",
        "inputs": [_port("value", "any")],
        "outputs": [_port("file", "file")],
        "fields": [
            _field("path", "text", "runs/output.jsonl"),
            _field(
                "format",
                "select",
                "jsonl",
                options=[
                    {"label": "JSONL", "value": "jsonl"},
                    {"label": "JSON", "value": "json"},
                    {"label": "Text", "value": "text"},
                ],
            ),
            _field("overwrite", "checkbox", False),
        ],
    },
    {
        "kind": "preview",
        "label": "Preview",
        "category": "Inspect",
        "description": "Expose a value in the run inspector.",
        "inputs": [_port("value", "any")],
        "outputs": [_port("value", "any")],
        "fields": [],
    },
]


def get_catalog(glitchling_options: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Return an isolated catalog copy with live Glitchlings choices."""

    catalog = deepcopy(NODE_DEFINITIONS)
    options = glitchling_options or [{"label": "Typogre", "value": "typogre"}]
    for definition in catalog:
        if definition["kind"] != "glitchling":
            continue
        for field in definition["fields"]:
            if field["name"] == "name":
                field["options"] = options
                break
    return catalog


def definitions_by_kind() -> dict[str, dict[str, Any]]:
    """Return canonical node definitions indexed by kind."""

    return {definition["kind"]: definition for definition in NODE_DEFINITIONS}
