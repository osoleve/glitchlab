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
from .models import GraphRunFailure, GraphSpec

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
    return {
        "nodes": get_catalog(options),
        "glitchlings": discovered,
        "plugin": status,
    }


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
