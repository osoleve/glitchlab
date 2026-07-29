"""Typed DAG validation and execution."""

from __future__ import annotations

import hashlib
import itertools
import json
import os
import platform
import re
import time
import uuid
from collections import defaultdict, deque
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from . import __version__
from .catalog import (
    control_port_name,
    definitions_by_kind,
    with_control_ports,
)
from .glitchlings_adapter import corrupt_text, plugin_status
from .models import (
    GraphEdge,
    GraphNode,
    GraphRunFailure,
    GraphSpec,
    NodeRunResult,
    RunManifest,
    RunResponse,
)
from .workflows import WORKFLOW_KIND_PREFIX, WorkflowStore

HOLE_PATTERN = re.compile(r"(?<!\?)\?([A-Za-z_][A-Za-z0-9_]*)")


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _canonical_digest(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


def _decode_escapes(value: str) -> str:
    return value.replace("\\n", "\n").replace("\\t", "\t").replace("\\r", "\r")


def _json_config(value: Any, *, field: str) -> Any:
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    if not stripped:
        return {}
    try:
        return json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{field} must be valid JSON: {exc.msg}") from exc


def _template(source: str, bindings: dict[str, Any] | None = None) -> dict[str, Any]:
    holes = list(dict.fromkeys(HOLE_PATTERN.findall(source)))
    return {
        "kind": "text_template",
        "source": source,
        "holes": holes,
        "bindings": bindings or {},
    }


def _render_template(value: dict[str, Any]) -> str:
    if value.get("kind") != "text_template":
        raise ValueError("Expected a TextTemplate value.")
    bindings = value.get("bindings") or {}
    missing = [hole for hole in value.get("holes", []) if hole not in bindings]
    if missing:
        raise ValueError(f"Template has unbound holes: {', '.join(missing)}")

    return _stringify_template(value)


def _stringify_template(value: dict[str, Any]) -> str:
    """Render bound holes while preserving unbound holes for inspection."""

    if value.get("kind") != "text_template":
        raise ValueError("Expected a TextTemplate value.")
    bindings = value.get("bindings") or {}
    rendered = HOLE_PATTERN.sub(
        lambda match: (
            str(bindings[match.group(1)])
            if match.group(1) in bindings
            else match.group(0)
        ),
        value["source"],
    )
    return rendered.replace("??", "?")


def _coerce_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        kind = value.get("kind")
        if kind == "text_template":
            return _render_template(value)
        if kind == "corruption_result":
            return str(value["output"])
        if kind == "completion_result":
            return str(value["text"])
    raise ValueError(f"Expected text-compatible input, received {type(value).__name__}.")


def _select_path(value: Any, path: str) -> Any:
    parts = [part for part in path.split(".") if part]

    def select_one(item: Any) -> Any:
        current = item
        for part in parts:
            if isinstance(current, list):
                try:
                    current = current[int(part)]
                except (ValueError, IndexError) as exc:
                    raise ValueError(f"Cannot select list index {part!r}.") from exc
            elif isinstance(current, dict) and part in current:
                current = current[part]
            else:
                raise ValueError(f"Field path {path!r} is missing at {part!r}.")
        return current

    if isinstance(value, list):
        return [select_one(item) for item in value]
    return select_one(value)


class GraphEngine:
    """Validate and execute a graph in topological order."""

    def __init__(
        self,
        *,
        workspace: Path | None = None,
        http_client: httpx.AsyncClient | None = None,
        workflow_store: WorkflowStore | None = None,
        workflow_stack: tuple[str, ...] = (),
    ) -> None:
        configured_workspace = os.getenv("GLITCHLOOM_WORKSPACE", "").strip()
        self.workspace = (
            Path(configured_workspace).expanduser()
            if configured_workspace
            else workspace or Path.cwd()
        ).resolve()
        configured_cache = os.getenv("GLITCHLOOM_CACHE_DIR", "").strip()
        self.cache_dir = (
            Path(configured_cache).expanduser()
            if configured_cache
            else self.workspace / ".glitchloom" / "cache"
        ).resolve()
        self.http_client = http_client
        self.definitions = definitions_by_kind()
        self.workflow_store = workflow_store or WorkflowStore(self.workspace)
        self.workflow_stack = workflow_stack

    def _definition(self, kind: str) -> dict[str, Any]:
        definition = self.definitions.get(kind)
        if definition is not None:
            return definition
        if kind.startswith(WORKFLOW_KIND_PREFIX):
            return self.workflow_store.definition_for_kind(kind)
        raise ValueError(f"Unknown node kind {kind!r}.")

    def _node_definition(self, node: GraphNode) -> dict[str, Any]:
        """Return the exact port contract for one configured graph node."""

        return with_control_ports(
            self._definition(node.kind),
            node.control_ports,
        )

    def _cached_result(
        self,
        namespace: str,
        payload: dict[str, Any],
        *,
        mode: str,
    ) -> tuple[str, dict[str, Any] | None]:
        if mode not in {"use", "refresh", "off"}:
            raise ValueError(f"Unknown cache mode {mode!r}.")
        key = _canonical_digest(
            {
                "namespace": namespace,
                "engine_version": __version__,
                "payload": payload,
            }
        )
        if mode != "use":
            return key, None
        path = self.cache_dir / namespace / f"{key}.json"
        if not path.is_file():
            return key, None
        try:
            cached = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return key, None
        if not isinstance(cached, dict):
            return key, None
        cached["cache"] = {"hit": True, "key": key}
        return key, cached

    def _store_cached_result(
        self,
        namespace: str,
        key: str,
        value: dict[str, Any],
        *,
        mode: str,
    ) -> None:
        if mode == "off":
            return
        directory = self.cache_dir / namespace
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{key}.json"
        temporary = directory / f".{key}.{uuid.uuid4().hex}.tmp"
        temporary.write_text(
            json.dumps(value, ensure_ascii=False, sort_keys=True, default=str),
            encoding="utf-8",
        )
        temporary.replace(path)

    def _resolve_workspace_path(self, raw_path: str) -> Path:
        candidate = Path(raw_path).expanduser()
        if candidate.is_absolute():
            resolved = candidate.resolve()
        else:
            resolved = (self.workspace / candidate).resolve()
        if os.getenv("GLITCHLOOM_ALLOW_ABSOLUTE_PATHS") != "1":
            try:
                resolved.relative_to(self.workspace)
            except ValueError as exc:
                raise ValueError(
                    f"Path {resolved} is outside the Glitchloom workspace {self.workspace}."
                ) from exc
        return resolved

    def _validate_and_order(
        self,
        graph: GraphSpec,
        injected_inputs: dict[str, dict[str, Any]] | None = None,
    ) -> tuple[list[GraphNode], dict[str, list[GraphEdge]], set[str]]:
        if not graph.nodes:
            raise GraphRunFailure("The graph has no nodes.")

        nodes = {node.id: node for node in graph.nodes}
        if len(nodes) != len(graph.nodes):
            raise GraphRunFailure("Node IDs must be unique.")
        for node in graph.nodes:
            try:
                self._node_definition(node)
            except ValueError as exc:
                raise GraphRunFailure(str(exc), node_id=node.id) from exc

        incoming: dict[str, list[GraphEdge]] = defaultdict(list)
        outgoing: dict[str, list[GraphEdge]] = defaultdict(list)
        indegree = {node.id: 0 for node in graph.nodes}
        connected_targets: set[tuple[str, str]] = set()
        for node_id, supplied in (injected_inputs or {}).items():
            node = nodes.get(node_id)
            if node is None:
                raise GraphRunFailure(
                    f"Workflow input references missing node {node_id!r}."
                )
            target_ports = {
                port["name"]: port for port in self._node_definition(node)["inputs"]
            }
            for port_name in supplied:
                if port_name not in target_ports:
                    raise GraphRunFailure(
                        f"Node {node_id!r} has no input port {port_name!r}."
                    )
                connected_targets.add((node_id, port_name))
        for edge in graph.edges:
            if edge.source not in nodes or edge.target not in nodes:
                raise GraphRunFailure(f"Edge {edge.id!r} references a missing node.")
            source_definition = self._node_definition(nodes[edge.source])
            target_definition = self._node_definition(nodes[edge.target])
            source_ports = {port["name"]: port for port in source_definition["outputs"]}
            target_ports = {port["name"]: port for port in target_definition["inputs"]}
            if edge.source_port not in source_ports:
                raise GraphRunFailure(
                    f"Node {edge.source!r} has no output port {edge.source_port!r}."
                )
            if edge.target_port not in target_ports:
                raise GraphRunFailure(
                    f"Node {edge.target!r} has no input port {edge.target_port!r}."
                )
            target_port = target_ports[edge.target_port]
            key = (edge.target, edge.target_port)
            if key in connected_targets and not target_port["multiple"]:
                raise GraphRunFailure(
                    f"Input {edge.target}.{edge.target_port} accepts only one connection."
                )
            connected_targets.add(key)

            source_type = source_ports[edge.source_port]["type"]
            target_type = target_port["type"]
            if "any" not in {source_type, target_type} and source_type != target_type:
                raise GraphRunFailure(
                    f"Cannot connect {source_type} to {target_type} "
                    f"({edge.source}.{edge.source_port} → {edge.target}.{edge.target_port})."
                )
            incoming[edge.target].append(edge)
            outgoing[edge.source].append(edge)
            indegree[edge.target] += 1

        for node in graph.nodes:
            definition = self._node_definition(node)
            connected = {edge.target_port for edge in incoming[node.id]}
            connected.update((injected_inputs or {}).get(node.id, {}))
            missing = [
                port["name"]
                for port in definition["inputs"]
                if port["required"] and port["name"] not in connected
            ]
            if missing:
                raise GraphRunFailure(
                    f"{definition['label']} is missing required input(s): {', '.join(missing)}.",
                    node_id=node.id,
                )

        queue = deque(node.id for node in graph.nodes if indegree[node.id] == 0)
        ordered: list[GraphNode] = []
        while queue:
            node_id = queue.popleft()
            ordered.append(nodes[node_id])
            for edge in outgoing[node_id]:
                indegree[edge.target] -= 1
                if indegree[edge.target] == 0:
                    queue.append(edge.target)
        if len(ordered) != len(graph.nodes):
            raise GraphRunFailure("Graph cycles are not allowed; use a bounded iteration node.")
        terminal_nodes = {node.id for node in graph.nodes if not outgoing[node.id]}
        return ordered, incoming, terminal_nodes

    def _gather_inputs(
        self,
        node: GraphNode,
        incoming: dict[str, list[GraphEdge]],
        outputs: dict[str, dict[str, Any]],
        injected_inputs: dict[str, dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        definition = self._node_definition(node)
        port_definitions = {port["name"]: port for port in definition["inputs"]}
        gathered = dict((injected_inputs or {}).get(node.id, {}))
        grouped: dict[str, list[Any]] = defaultdict(list)
        for edge in incoming[node.id]:
            grouped[edge.target_port].append(outputs[edge.source][edge.source_port])
        for port_name, values in grouped.items():
            if port_definitions[port_name]["multiple"]:
                injected = gathered.get(port_name, [])
                injected_values = injected if isinstance(injected, list) else [injected]
                gathered[port_name] = [*injected_values, *values]
            else:
                if port_name in gathered:
                    raise ValueError(
                        f"Input {node.id}.{port_name} received both a workflow value "
                        "and an internal connection."
                    )
                gathered[port_name] = values[0]
        return gathered

    def _apply_control_inputs(
        self,
        node: GraphNode,
        inputs: dict[str, Any],
    ) -> tuple[GraphNode, dict[str, Any]]:
        """Move promoted input values into an isolated effective config."""

        config = dict(node.config)
        native_inputs = dict(inputs)
        for field_name, mode in node.control_ports.items():
            if mode not in {"input", "passthrough"}:
                continue
            port_name = control_port_name(field_name)
            if port_name in native_inputs:
                config[field_name] = native_inputs.pop(port_name)
        return node.model_copy(update={"config": config}), native_inputs

    def _append_control_outputs(
        self,
        node: GraphNode,
        outputs: dict[str, Any],
    ) -> dict[str, Any]:
        """Add promoted local-control values to a node's runtime outputs."""

        if not {"output", "passthrough"}.intersection(
            node.control_ports.values()
        ):
            return outputs
        definition = self._definition(node.kind)
        fields = {field["name"]: field for field in definition["fields"]}
        expanded = dict(outputs)
        for field_name, mode in node.control_ports.items():
            if mode not in {"output", "passthrough"}:
                continue
            field = fields[field_name]
            value = node.config.get(
                field_name,
                field["default"],
            )
            if field["control"] == "json":
                value = _json_config(value, field=field_name)
            expanded[control_port_name(field_name)] = value
        return expanded

    async def _generate_completion(
        self,
        endpoint: dict[str, Any],
        model: dict[str, Any],
        prompt_value: Any,
        config: dict[str, Any],
    ) -> dict[str, Any] | list[dict[str, Any]]:
        if isinstance(prompt_value, list):
            results = []
            for prompt in prompt_value:
                result = await self._generate_completion(endpoint, model, prompt, config)
                if isinstance(result, list):
                    results.extend(result)
                else:
                    results.append(result)
            return results

        prompt = _coerce_text(prompt_value)
        base_url = str(endpoint["base_url"]).rstrip("/")
        url = f"{base_url}/completions"
        request_body: dict[str, Any] = {
            "model": model["model_id"],
            "prompt": prompt,
            "temperature": float(config.get("temperature", 0.8)),
            "top_p": float(config.get("top_p", 0.95)),
            "max_tokens": int(config.get("max_tokens", 96)),
        }
        seed = config.get("seed")
        if seed not in {None, ""}:
            request_body["seed"] = int(seed)
        logprobs = config.get("logprobs")
        if logprobs not in {None, ""}:
            request_body["logprobs"] = int(logprobs)
        stop = [line for line in str(config.get("stop", "")).splitlines() if line]
        if stop:
            request_body["stop"] = stop
        extra_body = _json_config(config.get("extra_body", {}), field="extra_body")
        if not isinstance(extra_body, dict):
            raise ValueError("extra_body must be a JSON object.")
        request_body.update(extra_body)
        cache_mode = str(config.get("cache_mode", "use"))
        cache_payload = {
            "endpoint": base_url,
            "api_key_env": str(endpoint.get("api_key_env", "")),
            "request": request_body,
        }
        cache_key, cached = self._cached_result(
            "completions",
            cache_payload,
            mode=cache_mode,
        )
        if cached is not None:
            return cached

        headers: dict[str, str] = {}
        api_key_env = str(endpoint.get("api_key_env", "")).strip()
        if api_key_env:
            api_key = os.getenv(api_key_env)
            if not api_key:
                raise ValueError(f"Endpoint expects API key environment variable {api_key_env!r}.")
            headers["Authorization"] = f"Bearer {api_key}"

        timeout = float(endpoint.get("timeout_seconds", 120))
        started = time.perf_counter()
        if self.http_client is None:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(url, json=request_body, headers=headers)
        else:
            response = await self.http_client.post(url, json=request_body, headers=headers)
        latency_ms = (time.perf_counter() - started) * 1000
        response.raise_for_status()
        payload = response.json()
        choices = payload.get("choices") or []
        if not choices:
            raise ValueError("Completion response contains no choices.")
        first = choices[0]
        result = {
            "kind": "completion_result",
            "text": first.get("text", ""),
            "prompt": prompt,
            "model": model["model_id"],
            "model_revision": payload.get("model_revision"),
            "endpoint": base_url,
            "parameters": request_body,
            "finish_reason": first.get("finish_reason"),
            "logprobs": first.get("logprobs"),
            "usage": payload.get("usage"),
            "request_id": payload.get("id"),
            "latency_ms": round(latency_ms, 3),
            "raw": payload,
            "cache": {"hit": False, "key": cache_key},
        }
        self._store_cached_result(
            "completions",
            cache_key,
            result,
            mode=cache_mode,
        )
        return result

    def _write_value(self, value: Any, config: dict[str, Any]) -> dict[str, Any]:
        path = self._resolve_workspace_path(str(config.get("path", "")))
        if path.exists() and not bool(config.get("overwrite", False)):
            raise FileExistsError(f"{path} already exists; enable overwrite to replace it.")
        path.parent.mkdir(parents=True, exist_ok=True)
        output_format = str(config.get("format", "jsonl"))
        if output_format == "text":
            payload = _coerce_text(value)
        elif output_format == "json":
            payload = json.dumps(value, ensure_ascii=False, indent=2, default=str) + "\n"
        elif output_format == "jsonl":
            rows = value if isinstance(value, list) else [value]
            payload = "".join(
                json.dumps(row, ensure_ascii=False, default=str) + "\n" for row in rows
            )
        else:
            raise ValueError(f"Unsupported output format {output_format!r}.")
        path.write_text(payload, encoding="utf-8")
        return {
            "kind": "file_ref",
            "path": str(path),
            "format": output_format,
            "bytes": len(payload.encode()),
            "sha256": hashlib.sha256(payload.encode()).hexdigest(),
        }

    async def _execute_node(
        self,
        node: GraphNode,
        inputs: dict[str, Any],
    ) -> dict[str, Any]:
        config = node.config
        kind = node.kind
        if kind.startswith(WORKFLOW_KIND_PREFIX):
            if kind in self.workflow_stack:
                chain = " → ".join((*self.workflow_stack, kind))
                raise ValueError(f"Recursive workflow expansion is not allowed: {chain}.")
            if len(self.workflow_stack) >= 32:
                raise ValueError("Workflow nesting exceeds the maximum depth of 32.")
            workflow = self.workflow_store.get_by_kind(kind)
            expected_digest = str(config.get("workflow_digest", "")).strip()
            if expected_digest and expected_digest != workflow.digest:
                raise ValueError(
                    f"Workflow digest mismatch: expected {expected_digest}, "
                    f"loaded {workflow.digest}."
                )
            injected: dict[str, dict[str, Any]] = defaultdict(dict)
            for binding in workflow.inputs:
                if binding.name in inputs:
                    injected[binding.node_id][binding.node_port] = inputs[binding.name]
            child = GraphEngine(
                workspace=self.workspace,
                http_client=self.http_client,
                workflow_store=self.workflow_store,
                workflow_stack=(*self.workflow_stack, kind),
            )
            response = await child.run(
                workflow.graph,
                injected_inputs=dict(injected),
            )
            child_outputs = {
                result.node_id: result.outputs
                for result in response.nodes
                if result.status == "completed"
            }
            return {
                binding.name: child_outputs[binding.node_id][binding.node_port]
                for binding in workflow.outputs
            }
        if kind == "text_input":
            return {"text": str(config.get("text", ""))}
        if kind == "number_input":
            value = config.get("value", 0)
            if isinstance(value, bool):
                raise ValueError("Number requires a numeric value.")
            if not isinstance(value, int | float):
                value = float(value)
            return {"number": value}
        if kind == "template_input":
            return {"template": _template(str(config.get("template", "")))}
        if kind == "fill_hole":
            template_value = dict(inputs["template"])
            if template_value.get("kind") != "text_template":
                raise ValueError("Fill hole requires a TextTemplate input.")
            name = str(config.get("name", "")).lstrip("?")
            if name not in template_value.get("holes", []):
                raise ValueError(f"Template has no ?{name} hole.")
            bindings = dict(template_value.get("bindings") or {})
            bindings[name] = inputs.get("value", config.get("value", ""))
            bound_template = _template(template_value["source"], bindings)
            return {
                "template": bound_template,
                "text": _stringify_template(bound_template),
            }
        if kind == "render_template":
            return {"text": _render_template(inputs["template"])}
        if kind == "split":
            text = _coerce_text(inputs["text"])
            pattern = _decode_escapes(str(config.get("pattern", "\\n")))
            items = re.split(pattern, text) if config.get("regex") else text.split(pattern)
            return {"items": items}
        if kind == "replace":
            text = _coerce_text(inputs["text"])
            find = str(config.get("find", ""))
            replacement = str(config.get("replacement", ""))
            output = re.sub(find, replacement, text) if config.get("regex") else text.replace(
                find, replacement
            )
            return {"text": output}
        if kind == "join":
            separator = _decode_escapes(str(config.get("separator", "\\n")))
            return {"text": separator.join(_coerce_text(item) for item in inputs["items"])}
        if kind == "list_input":
            raw_items = config.get("items", "")
            if isinstance(raw_items, list):
                items = raw_items
            else:
                raw = str(raw_items).strip()
                if raw.startswith("["):
                    items = _json_config(raw, field="items")
                    if not isinstance(items, list):
                        raise ValueError("List JSON must decode to an array.")
                else:
                    items = str(raw_items).splitlines()
            return {"items": items}
        if kind == "collect":
            values = list(inputs["item"])
            if config.get("flatten"):
                values = list(
                    itertools.chain.from_iterable(
                        value if isinstance(value, list) else [value] for value in values
                    )
                )
            return {"items": values}
        if kind == "cartesian":
            return {
                "items": [
                    {"left": left, "right": right}
                    for left, right in itertools.product(inputs["left"], inputs["right"])
                ]
            }
        if kind == "select_field":
            return {"value": _select_path(inputs["value"], str(config.get("path", "")))}
        if kind == "passthrough":
            return {"value": inputs["value"]}
        if kind == "endpoint":
            return {
                "endpoint": {
                    "kind": "endpoint_ref",
                    "base_url": str(config.get("base_url", "")).rstrip("/"),
                    "api_key_env": str(config.get("api_key_env", "")),
                    "timeout_seconds": float(config.get("timeout_seconds", 120)),
                }
            }
        if kind == "model":
            return {
                "model": {
                    "kind": "model_ref",
                    "model_id": str(config.get("model_id", "")),
                }
            }
        if kind == "completion":
            result = await self._generate_completion(
                inputs["endpoint"],
                inputs["model"],
                inputs["prompt"],
                config,
            )
            return {"result": result}
        if kind == "glitchling":
            params = _json_config(config.get("params", {}), field="params")
            if not isinstance(params, dict):
                raise ValueError("Glitchling params must be a JSON object.")
            return {
                "glitchling": {
                    "kind": "glitchling",
                    "name": str(config.get("name", "typogre")),
                    "seed": int(config.get("seed", 151)),
                    "params": params,
                }
            }
        if kind == "gaggle":
            return {
                "gaggle": {
                    "kind": "gaggle",
                    "members": inputs["members"],
                    "seed": int(config.get("seed", 151)),
                    "transcript_target": config.get("transcript_target", "last"),
                    "exclude_patterns": _json_config(
                        config.get("exclude_patterns", []), field="exclude_patterns"
                    ),
                    "include_only_patterns": _json_config(
                        config.get("include_only_patterns", []), field="include_only_patterns"
                    ),
                }
            }
        if kind == "corrupt":
            value = inputs["text"]
            if isinstance(value, list):
                texts = [_coerce_text(item) for item in value]
            else:
                texts = _coerce_text(value)
            return {"result": corrupt_text(texts, inputs["corruptor"])}
        if kind == "read_file":
            path = self._resolve_workspace_path(str(config.get("path", "")))
            return {"text": path.read_text(encoding="utf-8")}
        if kind == "write_file":
            return {"file": self._write_value(inputs["value"], config)}
        if kind == "preview":
            return {"value": inputs["value"]}
        raise ValueError(f"No executor is registered for node kind {kind!r}.")

    async def run(
        self,
        graph: GraphSpec,
        *,
        injected_inputs: dict[str, dict[str, Any]] | None = None,
    ) -> RunResponse:
        """Execute a validated graph and return results plus a frozen manifest."""

        started_at = _utc_now()
        run_id = str(uuid.uuid4())
        ordered, incoming, terminal_nodes = self._validate_and_order(
            graph,
            injected_inputs,
        )
        outputs: dict[str, dict[str, Any]] = {}
        results: list[NodeRunResult] = []
        for node in ordered:
            started = time.perf_counter()
            try:
                inputs = self._gather_inputs(
                    node,
                    incoming,
                    outputs,
                    injected_inputs,
                )
                effective_node, native_inputs = self._apply_control_inputs(
                    node,
                    inputs,
                )
                node_outputs = await self._execute_node(
                    effective_node,
                    native_inputs,
                )
                node_outputs = self._append_control_outputs(
                    effective_node,
                    node_outputs,
                )
            except Exception as exc:  # noqa: BLE001 - report node boundary failures
                duration_ms = (time.perf_counter() - started) * 1000
                results.append(
                    NodeRunResult(
                        node_id=node.id,
                        kind=node.kind,
                        status="failed",
                        duration_ms=round(duration_ms, 3),
                        error=f"{type(exc).__name__}: {exc}",
                    )
                )
                raise GraphRunFailure(
                    f"{self._definition(node.kind)['label']} failed: {exc}",
                    node_id=node.id,
                    results=results,
                ) from exc
            duration_ms = (time.perf_counter() - started) * 1000
            outputs[node.id] = node_outputs
            results.append(
                NodeRunResult(
                    node_id=node.id,
                    kind=node.kind,
                    status="completed",
                    duration_ms=round(duration_ms, 3),
                    outputs=node_outputs,
                )
            )

        status = plugin_status()
        finished_at = _utc_now()
        manifest = RunManifest(
            run_id=run_id,
            graph_name=graph.name,
            graph_digest=_canonical_digest(graph.model_dump(mode="json")),
            engine_version=__version__,
            started_at=started_at,
            finished_at=finished_at,
            python_version=platform.python_version(),
            workspace=str(self.workspace),
            glitchlings_version=status.get("version") if status.get("available") else None,
            graph=graph,
        )
        return RunResponse(
            status="completed",
            manifest=manifest,
            nodes=results,
            terminal_outputs={node_id: outputs[node_id] for node_id in terminal_nodes},
        )


__all__ = [
    "GraphEngine",
    "HOLE_PATTERN",
    "_render_template",
    "_stringify_template",
    "_template",
]
