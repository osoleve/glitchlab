"""FastAPI application for the local Glitchloom runner."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import __version__
from .catalog import get_catalog
from .engine import GraphEngine
from .glitchlings_adapter import discover_glitchlings, plugin_status
from .looms import LoomConflictError, LoomStore, LoomTemplateStore
from .models import GraphRunFailure, GraphSpec, LoomDraft, LoomUpdate, WorkflowDraft
from .workflows import WorkflowInUseError, WorkflowStore, workflow_definition

app = FastAPI(title="Glitchloom", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, Any]:
    """Return backend and plugin health."""

    return {
        "status": "ok",
        "version": __version__,
        "workspace": str(GraphEngine().workspace),
        "glitchlings": plugin_status(),
    }


@app.get("/api/catalog")
def catalog() -> dict[str, Any]:
    """Return node definitions and live Glitchlings controls."""

    status = plugin_status()
    discovered: list[dict[str, Any]] = []
    if status["available"]:
        discovered = discover_glitchlings()
    options = [
        {"label": item["label"], "value": item["name"]}
        for item in discovered
    ]
    engine = GraphEngine()
    workflows = engine.workflow_store.list_latest()
    return {
        "nodes": [
            *get_catalog(options),
            *(workflow_definition(workflow) for workflow in workflows),
        ],
        "glitchlings": discovered,
        "plugin": status,
    }


@app.get("/api/looms")
def list_looms() -> dict[str, Any]:
    """Return saved editable graph documents without their full graph bodies."""

    store = LoomStore(GraphEngine().workspace)
    return {
        "looms": [loom.model_dump(mode="json") for loom in store.list()]
    }


@app.post("/api/looms", status_code=201)
def create_loom(draft: LoomDraft) -> dict[str, Any]:
    """Create a mutable top-level loom document."""

    store = LoomStore(GraphEngine().workspace)
    try:
        loom = store.create(draft)
    except LoomConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(exc),
                "current_revision": exc.current_revision,
                "current_digest": exc.current_digest,
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc)}) from exc
    return {"loom": loom.model_dump(mode="json")}


@app.get("/api/looms/{loom_id}")
def get_loom(loom_id: str) -> dict[str, Any]:
    """Load a saved document and exact definitions for its versioned nodes."""

    store = LoomStore(GraphEngine().workspace)
    try:
        loom = store.get(loom_id)
        definitions = store.definitions(loom.graph)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail={"message": str(exc)}) from exc
    return {
        "loom": loom.model_dump(mode="json"),
        "definitions": definitions,
    }


@app.put("/api/looms/{loom_id}")
def update_loom(loom_id: str, draft: LoomUpdate) -> dict[str, Any]:
    """Update a mutable loom with optimistic revision protection."""

    store = LoomStore(GraphEngine().workspace)
    try:
        loom = store.update(
            loom_id,
            LoomDraft(graph=draft.graph),
            expected_revision=draft.expected_revision,
        )
    except LoomConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(exc),
                "current_revision": exc.current_revision,
                "current_digest": exc.current_digest,
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc)}) from exc
    return {"loom": loom.model_dump(mode="json")}


@app.delete("/api/looms/{loom_id}")
def delete_loom(loom_id: str) -> dict[str, Any]:
    """Move a saved top-level loom to recoverable trash."""

    store = LoomStore(GraphEngine().workspace)
    try:
        deleted = store.delete(loom_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail={"message": str(exc)}) from exc
    return {"deleted": deleted}


@app.get("/api/loom-templates")
def list_loom_templates() -> dict[str, Any]:
    """List checked-in graphs that always open as unsaved copies."""

    store = LoomTemplateStore(GraphEngine().workspace)
    return {
        "templates": [
            template.model_dump(mode="json") for template in store.list()
        ]
    }


@app.get("/api/loom-templates/{template_id}")
def get_loom_template(template_id: str) -> dict[str, Any]:
    """Load one read-only template and exact definitions for its graph."""

    store = LoomTemplateStore(GraphEngine().workspace)
    try:
        template = store.get(template_id)
        definitions = store.definitions(template.graph)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail={"message": str(exc)}) from exc
    return {
        "template": template.model_dump(mode="json"),
        "definitions": definitions,
    }


@app.get("/api/workflows")
def list_workflows() -> dict[str, Any]:
    """Return the latest immutable version of each named workflow."""

    store = WorkflowStore(GraphEngine().workspace)
    return {
        "workflows": [
            workflow.model_dump(mode="json") for workflow in store.list_latest()
        ]
    }


@app.post("/api/workflows", status_code=201)
def save_workflow(draft: WorkflowDraft) -> dict[str, Any]:
    """Persist a selected graph as a new immutable workflow version."""

    store = WorkflowStore(GraphEngine().workspace)
    try:
        _validate_workflow_draft(store, draft)
        workflow = store.save(draft)
    except (GraphRunFailure, ValueError) as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc)}) from exc
    return {
        "workflow": workflow.model_dump(mode="json"),
        "definition": workflow_definition(workflow),
    }


def _validate_workflow_draft(
    store: WorkflowStore,
    draft: WorkflowDraft,
) -> None:
    """Validate a reusable graph with its public inputs treated as supplied."""

    store.validate(draft)
    provided_inputs: dict[str, dict[str, Any]] = {}
    for binding in draft.inputs:
        provided_inputs.setdefault(binding.node_id, {})[binding.node_port] = (
            [] if binding.multiple else None
        )
    GraphEngine(workflow_store=store)._validate_and_order(
        draft.graph,
        provided_inputs,
    )


@app.get("/api/workflows/{workflow_id}/versions/{version}")
def get_workflow(workflow_id: str, version: int) -> dict[str, Any]:
    """Load one exact workflow version for tabbed editing."""

    store = WorkflowStore(GraphEngine().workspace)
    try:
        workflow = store.get(workflow_id, version)
        definitions = {
            node.kind: store.node_definition(node.kind)
            for node in workflow.graph.nodes
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail={"message": str(exc)}) from exc
    return {
        "workflow": workflow.model_dump(mode="json"),
        "definitions": list(definitions.values()),
    }


@app.post("/api/workflows/{workflow_id}/versions", status_code=201)
def update_workflow(
    workflow_id: str,
    draft: WorkflowDraft,
) -> dict[str, Any]:
    """Append an edited workflow as a new immutable version."""

    store = WorkflowStore(GraphEngine().workspace)
    try:
        _validate_workflow_draft(store, draft)
        workflow = store.save(draft, workflow_id=workflow_id)
    except (GraphRunFailure, ValueError) as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc)}) from exc
    return {
        "workflow": workflow.model_dump(mode="json"),
        "definition": workflow_definition(workflow),
    }


@app.delete("/api/workflows/{workflow_id}")
def delete_workflow(workflow_id: str, force: bool = False) -> dict[str, Any]:
    """Move a saved workflow and all versions to recoverable trash."""

    store = WorkflowStore(GraphEngine().workspace)
    try:
        deleted = store.delete(workflow_id, force=force)
    except WorkflowInUseError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(exc),
                "dependents": exc.dependents,
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail={"message": str(exc)}) from exc
    return {"deleted": deleted}


@app.post("/api/runs")
async def run_graph(graph: GraphSpec) -> dict[str, Any]:
    """Execute a graph and surface node-scoped failures."""

    try:
        response = await GraphEngine().run(graph)
    except GraphRunFailure as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "message": str(exc),
                "node_id": exc.node_id,
                "nodes": [result.model_dump(mode="json") for result in exc.results],
            },
        ) from exc
    return response.model_dump(mode="json")


def _mount_frontend() -> None:
    web_dist = Path(__file__).resolve().parents[1] / "web" / "dist"
    if web_dist.is_dir():
        app.mount("/", StaticFiles(directory=web_dist, html=True), name="frontend")


_mount_frontend()


def main() -> None:
    """Run the bundled local server."""

    uvicorn.run(
        "glitchloom.server:app",
        host=os.getenv("GLITCHLOOM_HOST", "127.0.0.1"),
        port=int(os.getenv("GLITCHLOOM_PORT", "8788")),
        reload=False,
    )


if __name__ == "__main__":
    main()
