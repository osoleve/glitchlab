"""Mutable local persistence for top-level loom documents."""

from __future__ import annotations

import hashlib
import json
import re
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .catalog import with_control_ports
from .models import (
    GraphSpec,
    LoomDraft,
    LoomSpec,
    LoomSummary,
    LoomTemplate,
    LoomTemplateSummary,
)
from .workflows import WorkflowStore

_LOOM_LOCKS_GUARD = threading.Lock()
_LOOM_LOCKS: dict[tuple[Path, str], threading.RLock] = {}


class LoomConflictError(ValueError):
    """Raised when a save would overwrite newer work or duplicate a name."""

    def __init__(
        self,
        message: str,
        *,
        current_revision: int | None = None,
        current_digest: str | None = None,
    ) -> None:
        self.current_revision = current_revision
        self.current_digest = current_digest
        super().__init__(message)


class LoomStore:
    """Create, update, load, and recoverably delete editable loom documents."""

    def __init__(
        self,
        workspace: Path,
        *,
        workflow_store: WorkflowStore | None = None,
    ) -> None:
        workspace = workspace.resolve()
        self.root = workspace / ".glitchloom" / "looms"
        self.workflow_store = workflow_store or WorkflowStore(workspace)

    @staticmethod
    def _validated_id(loom_id: str) -> str:
        try:
            parsed = uuid.UUID(loom_id)
        except ValueError as exc:
            raise ValueError(f"Invalid loom ID {loom_id!r}.") from exc
        normalized = str(parsed)
        if normalized != loom_id:
            raise ValueError(f"Invalid loom ID {loom_id!r}.")
        return normalized

    def _records(self) -> list[LoomSpec]:
        if not self.root.is_dir():
            return []
        records: list[LoomSpec] = []
        for path in sorted(self.root.glob("*.json")):
            try:
                records.append(
                    LoomSpec.model_validate_json(path.read_text(encoding="utf-8"))
                )
            except (OSError, ValueError):
                continue
        return records

    def _document_lock(self, loom_id: str) -> threading.RLock:
        """Share one lock across every store instance for a saved document."""

        key = (self.root, loom_id)
        with _LOOM_LOCKS_GUARD:
            return _LOOM_LOCKS.setdefault(key, threading.RLock())

    @staticmethod
    def _validate_name(graph: GraphSpec) -> GraphSpec:
        name = graph.name.strip()
        if not name:
            raise ValueError("Loom name cannot be empty.")
        return graph.model_copy(update={"name": name})

    def _validate_graph(self, graph: GraphSpec) -> None:
        nodes = {node.id: node for node in graph.nodes}
        if len(nodes) != len(graph.nodes):
            raise ValueError("Loom node IDs must be unique.")
        if any(not node_id for node_id in nodes):
            raise ValueError("Loom node IDs cannot be empty.")

        definitions: dict[str, dict[str, Any]] = {}
        for node in graph.nodes:
            try:
                definitions[node.id] = with_control_ports(
                    self.workflow_store.node_definition(node.kind),
                    node.control_ports,
                )
            except ValueError as exc:
                raise ValueError(
                    f"Node {node.id!r} references unavailable kind {node.kind!r}."
                ) from exc

        edge_ids: set[str] = set()
        connected_targets: set[tuple[str, str]] = set()
        for edge in graph.edges:
            if not edge.id:
                raise ValueError("Loom edge IDs cannot be empty.")
            if edge.id in edge_ids:
                raise ValueError("Loom edge IDs must be unique.")
            edge_ids.add(edge.id)
            if edge.source not in nodes or edge.target not in nodes:
                raise ValueError(f"Edge {edge.id!r} references a missing node.")
            source_ports = {
                port["name"]: port for port in definitions[edge.source]["outputs"]
            }
            target_ports = {
                port["name"]: port for port in definitions[edge.target]["inputs"]
            }
            source_port = source_ports.get(edge.source_port)
            target_port = target_ports.get(edge.target_port)
            if source_port is None:
                raise ValueError(
                    f"Node {edge.source!r} has no output port {edge.source_port!r}."
                )
            if target_port is None:
                raise ValueError(
                    f"Node {edge.target!r} has no input port {edge.target_port!r}."
                )
            target_key = (edge.target, edge.target_port)
            if target_key in connected_targets and not target_port["multiple"]:
                raise ValueError(
                    f"Input {edge.target}.{edge.target_port} accepts one connection."
                )
            connected_targets.add(target_key)
            source_type = source_port["type"]
            target_type = target_port["type"]
            if "any" not in {source_type, target_type} and source_type != target_type:
                raise ValueError(
                    f"Cannot connect {source_type} to {target_type} "
                    f"({edge.source}.{edge.source_port} → "
                    f"{edge.target}.{edge.target_port})."
                )

    def list(self) -> list[LoomSummary]:
        """Return compact metadata for every saved document."""

        return [
            LoomSummary(
                id=record.id,
                name=record.graph.name,
                revision=record.revision,
                digest=record.digest,
                created_at=record.created_at,
                updated_at=record.updated_at,
                node_count=len(record.graph.nodes),
            )
            for record in sorted(
                self._records(),
                key=lambda item: (
                    item.graph.name.casefold(),
                    item.updated_at,
                ),
            )
        ]

    def get(self, loom_id: str) -> LoomSpec:
        """Load one mutable document by stable identity."""

        loom_id = self._validated_id(loom_id)
        path = self.root / f"{loom_id}.json"
        if not path.is_file():
            raise ValueError(f"Loom {loom_id!r} does not exist.")
        try:
            return LoomSpec.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ValueError(f"Loom {loom_id!r} could not be loaded.") from exc

    @staticmethod
    def _digest(graph: GraphSpec) -> str:
        canonical = graph.model_dump(mode="json")
        return hashlib.sha256(
            json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

    def _write(self, record: LoomSpec) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        destination = self.root / f"{record.id}.json"
        temporary = self.root / f".{record.id}.{uuid.uuid4().hex}.tmp"
        temporary.write_text(record.model_dump_json(indent=2), encoding="utf-8")
        temporary.replace(destination)

    def create(self, draft: LoomDraft) -> LoomSpec:
        """Create a new mutable document without touching workflow definitions."""

        graph = self._validate_name(draft.graph)
        self._validate_graph(graph)
        loom_id = str(uuid.uuid4())
        timestamp = datetime.now(UTC).isoformat()
        record = LoomSpec(
            id=loom_id,
            revision=1,
            digest=self._digest(graph),
            created_at=timestamp,
            updated_at=timestamp,
            graph=graph,
        )
        self._write(record)
        return record

    def update(
        self,
        loom_id: str,
        draft: LoomDraft,
        *,
        expected_revision: int,
    ) -> LoomSpec:
        """Replace a document only when the caller still has its latest revision."""

        loom_id = self._validated_id(loom_id)
        graph = self._validate_name(draft.graph)
        self._validate_graph(graph)
        digest = self._digest(graph)
        with self._document_lock(loom_id):
            current = self.get(loom_id)
            if current.revision != expected_revision:
                raise LoomConflictError(
                    f"{current.graph.name!r} is now revision {current.revision}; "
                    f"this tab was opened at revision {expected_revision}.",
                    current_revision=current.revision,
                    current_digest=current.digest,
                )
            if current.digest == digest:
                return current
            revision = current.revision + 1
            record = LoomSpec(
                id=current.id,
                revision=revision,
                digest=digest,
                created_at=current.created_at,
                updated_at=datetime.now(UTC).isoformat(),
                graph=graph,
            )
            self._write(record)
            return record

    def definitions(self, graph: GraphSpec) -> list[dict[str, Any]]:
        """Return exact definitions needed to rehydrate stored workflow nodes."""

        definitions: dict[str, dict[str, Any]] = {}
        for node in graph.nodes:
            definitions[node.kind] = self.workflow_store.node_definition(node.kind)
        return list(definitions.values())

    def delete(self, loom_id: str) -> dict[str, Any]:
        """Move a saved loom to recoverable local trash."""

        loom_id = self._validated_id(loom_id)
        with self._document_lock(loom_id):
            record = self.get(loom_id)
            source = self.root / f"{record.id}.json"
            trash_root = self.root / ".trash"
            trash_root.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
            destination = trash_root / f"{record.id}-{timestamp}.json"
            source.replace(destination)
            return {
                "id": record.id,
                "name": record.graph.name,
                "revision": record.revision,
                "recoverable_path": str(
                    destination.relative_to(self.root.parent.parent)
                ),
            }


class LoomTemplateStore:
    """Read checked-in graph examples without giving them a mutation route."""

    _id_pattern = re.compile(r"^[a-z0-9][a-z0-9_-]*$")

    def __init__(
        self,
        workspace: Path,
        *,
        root: Path | None = None,
        workflow_store: WorkflowStore | None = None,
    ) -> None:
        workspace = workspace.resolve()
        self.root = root or Path(__file__).resolve().parents[1] / "examples"
        self.workflow_store = workflow_store or WorkflowStore(workspace)

    def _load_path(self, path: Path) -> LoomTemplate:
        graph = GraphSpec.model_validate_json(path.read_text(encoding="utf-8"))
        return LoomTemplate(id=path.stem, graph=graph)

    def list(self) -> list[LoomTemplateSummary]:
        """Return every valid checked-in JSON graph as a read-only template."""

        if not self.root.is_dir():
            return []
        summaries: list[LoomTemplateSummary] = []
        for path in sorted(self.root.glob("*.json")):
            if not self._id_pattern.fullmatch(path.stem):
                continue
            try:
                template = self._load_path(path)
            except (OSError, ValueError):
                continue
            summaries.append(
                LoomTemplateSummary(
                    id=template.id,
                    name=template.graph.name,
                    node_count=len(template.graph.nodes),
                )
            )
        return summaries

    def get(self, template_id: str) -> LoomTemplate:
        """Load one safe template slug from the checked-in examples directory."""

        if not self._id_pattern.fullmatch(template_id):
            raise ValueError(f"Invalid loom template ID {template_id!r}.")
        path = self.root / f"{template_id}.json"
        if not path.is_file():
            raise ValueError(f"Loom template {template_id!r} does not exist.")
        try:
            return self._load_path(path)
        except (OSError, ValueError) as exc:
            raise ValueError(
                f"Loom template {template_id!r} could not be loaded."
            ) from exc

    def definitions(self, graph: GraphSpec) -> list[dict[str, Any]]:
        """Return definitions required to rehydrate one read-only template."""

        definitions: dict[str, dict[str, Any]] = {}
        for node in graph.nodes:
            definitions[node.kind] = self.workflow_store.node_definition(node.kind)
        return list(definitions.values())


__all__ = ["LoomConflictError", "LoomStore", "LoomTemplateStore"]
