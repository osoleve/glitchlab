"""FastAPI application for the local Glitchloom runner."""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator
from contextlib import suppress
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .catalog import get_catalog
from .engine import GraphEngine
from .glitchlings_adapter import discover_glitchlings, plugin_status
from .graphs import GraphConflictError, GraphStore, GraphTemplateStore
from .models import (
    CatalogResponse,
    DeleteGraphDocumentResponse,
    DeleteWorkflowResponse,
    GraphDocumentDraft,
    GraphDocumentListResponse,
    GraphDocumentResponse,
    GraphDocumentUpdate,
    GraphRunFailure,
    GraphTemplateListResponse,
    HealthResponse,
    LoadGraphDocumentResponse,
    LoadGraphTemplateResponse,
    LoadWorkflowResponse,
    RunErrorResponse,
    RunEvent,
    RunRequest,
    RunResponse,
    RunStreamEvent,
    SaveWorkflowResponse,
    WorkflowDraft,
    WorkflowListResponse,
)
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


class NDJSONOpenAPIResponse(JSONResponse):
    """Teach FastAPI that each streamed line follows a JSON response model."""

    media_type = "application/x-ndjson"


class NDJSONStreamingResponse(StreamingResponse):
    """Stream newline-delimited JSON without response buffering."""

    media_type = "application/x-ndjson"


@app.get("/api/health", response_model=HealthResponse)
def health() -> dict[str, Any]:
    """Return backend and plugin health."""

    return {
        "status": "ok",
        "version": __version__,
        "workspace": str(GraphEngine().workspace),
        "glitchlings": plugin_status(),
    }


@app.get("/api/catalog", response_model=CatalogResponse)
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


@app.get("/api/graphs", response_model=GraphDocumentListResponse)
def list_graphs() -> dict[str, Any]:
    """Return saved editable graph documents without their full graph bodies."""

    store = GraphStore(GraphEngine().workspace)
    return {
        "graphs": [graph.model_dump(mode="json") for graph in store.list()]
    }


@app.post("/api/graphs", status_code=201, response_model=GraphDocumentResponse)
def create_graph(draft: GraphDocumentDraft) -> dict[str, Any]:
    """Create a mutable top-level workflow graph document."""

    store = GraphStore(GraphEngine().workspace)
    try:
        graph = store.create(draft)
    except GraphConflictError as exc:
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
    return {"graph": graph.model_dump(mode="json")}


@app.get("/api/graphs/{graph_id}", response_model=LoadGraphDocumentResponse)
def get_graph(graph_id: str) -> dict[str, Any]:
    """Load a saved document and exact definitions for its versioned nodes."""

    store = GraphStore(GraphEngine().workspace)
    try:
        graph = store.get(graph_id)
        definitions = store.definitions(graph.graph)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail={"message": str(exc)}) from exc
    return {
        "graph": graph.model_dump(mode="json"),
        "definitions": definitions,
    }


@app.put("/api/graphs/{graph_id}", response_model=GraphDocumentResponse)
def update_graph(graph_id: str, draft: GraphDocumentUpdate) -> dict[str, Any]:
    """Update a mutable graph with optimistic revision protection."""

    store = GraphStore(GraphEngine().workspace)
    try:
        graph = store.update(
            graph_id,
            GraphDocumentDraft(graph=draft.graph),
            expected_revision=draft.expected_revision,
        )
    except GraphConflictError as exc:
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
    return {"graph": graph.model_dump(mode="json")}


@app.delete("/api/graphs/{graph_id}", response_model=DeleteGraphDocumentResponse)
def delete_graph(graph_id: str) -> dict[str, Any]:
    """Move a saved top-level graph to recoverable trash."""

    store = GraphStore(GraphEngine().workspace)
    try:
        deleted = store.delete(graph_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail={"message": str(exc)}) from exc
    return {"deleted": deleted}


@app.get("/api/graph-templates", response_model=GraphTemplateListResponse)
def list_graph_templates() -> dict[str, Any]:
    """List checked-in graphs that always open as unsaved copies."""

    store = GraphTemplateStore(GraphEngine().workspace)
    return {
        "templates": [
            template.model_dump(mode="json") for template in store.list()
        ]
    }


@app.get(
    "/api/graph-templates/{template_id}",
    response_model=LoadGraphTemplateResponse,
)
def get_graph_template(template_id: str) -> dict[str, Any]:
    """Load one read-only template and exact definitions for its graph."""

    store = GraphTemplateStore(GraphEngine().workspace)
    try:
        template = store.get(template_id)
        definitions = store.definitions(template.graph)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail={"message": str(exc)}) from exc
    return {
        "template": template.model_dump(mode="json"),
        "definitions": definitions,
    }


@app.get("/api/workflows", response_model=WorkflowListResponse)
def list_workflows() -> dict[str, Any]:
    """Return the latest immutable version of each named workflow."""

    store = WorkflowStore(GraphEngine().workspace)
    return {
        "workflows": [
            workflow.model_dump(mode="json") for workflow in store.list_latest()
        ]
    }


@app.post("/api/workflows", status_code=201, response_model=SaveWorkflowResponse)
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


@app.get(
    "/api/workflows/{workflow_id}/versions/{version}",
    response_model=LoadWorkflowResponse,
)
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


@app.post(
    "/api/workflows/{workflow_id}/versions",
    status_code=201,
    response_model=SaveWorkflowResponse,
)
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


@app.delete(
    "/api/workflows/{workflow_id}",
    response_model=DeleteWorkflowResponse,
)
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


@app.post(
    "/api/runs",
    response_model=RunResponse,
    responses={422: {"model": RunErrorResponse}},
)
async def run_graph(request: RunRequest) -> dict[str, Any]:
    """Execute a graph and surface node-scoped failures."""

    try:
        response = await GraphEngine().run(request.graph, scope=request.scope)
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


async def _run_event_lines(request: RunRequest) -> AsyncIterator[bytes]:
    """Encode bounded NDJSON; disconnect cancellation cannot stop worker threads."""

    events: asyncio.Queue[RunEvent] = asyncio.Queue(maxsize=256)

    async def publish(event: RunEvent) -> None:
        await events.put(event)

    async def execute() -> None:
        try:
            await GraphEngine().run(
                request.graph,
                scope=request.scope,
                event_sink=publish,
            )
        except Exception:  # noqa: BLE001 - the engine emits the terminal failure event
            return

    task = asyncio.create_task(execute())
    try:
        while not task.done() or not events.empty():
            try:
                event = await asyncio.wait_for(events.get(), timeout=0.1)
            except TimeoutError:
                continue
            payload = event.model_dump(mode="json")
            yield (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
        await task
    finally:
        if not task.done():
            task.cancel()
        with suppress(asyncio.CancelledError):
            await task


@app.post(
    "/api/runs/stream",
    response_class=NDJSONOpenAPIResponse,
    responses={
        200: {
            "model": RunStreamEvent,
            "description": "Protocol-v1 run events, one JSON object per line.",
        },
        422: {
            "description": "Request validation error.",
            "content": {
                "application/json": {
                    "schema": {"$ref": "#/components/schemas/RunErrorResponse"}
                }
            },
        },
    },
)
async def stream_graph(request: RunRequest) -> NDJSONStreamingResponse:
    """Execute a graph while streaming truthful node and edge activity."""

    return NDJSONStreamingResponse(
        _run_event_lines(request),
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


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
