from __future__ import annotations

import json
from pathlib import Path

from glitchloom.server import app

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
OPENAPI_SNAPSHOT = (
    REPOSITORY_ROOT / "web" / "src" / "generated" / "openapi.json"
)
GENERATED_TYPES = REPOSITORY_ROOT / "web" / "src" / "generated" / "api.d.ts"


def _json_schema(
    schema: dict,
    path: str,
    method: str,
    status: str,
) -> dict:
    return schema["paths"][path][method]["responses"][status]["content"][
        "application/json"
    ]["schema"]


def test_openapi_snapshot_matches_application_schema() -> None:
    assert json.loads(OPENAPI_SNAPSHOT.read_text(encoding="utf-8")) == app.openapi()


def test_success_responses_reference_specific_wire_models() -> None:
    schema = app.openapi()
    expected = {
        ("/api/health", "get", "200"): "HealthResponse",
        ("/api/catalog", "get", "200"): "CatalogResponse",
        ("/api/graphs", "get", "200"): "GraphDocumentListResponse",
        ("/api/graphs", "post", "201"): "GraphDocumentResponse",
        ("/api/graphs/{graph_id}", "get", "200"): "LoadGraphDocumentResponse",
        ("/api/graphs/{graph_id}", "put", "200"): "GraphDocumentResponse",
        ("/api/graphs/{graph_id}", "delete", "200"): "DeleteGraphDocumentResponse",
        ("/api/graph-templates", "get", "200"): "GraphTemplateListResponse",
        (
            "/api/graph-templates/{template_id}",
            "get",
            "200",
        ): "LoadGraphTemplateResponse",
        ("/api/workflows", "get", "200"): "WorkflowListResponse",
        ("/api/workflows", "post", "201"): "SaveWorkflowResponse",
        (
            "/api/workflows/{workflow_id}/versions/{version}",
            "get",
            "200",
        ): "LoadWorkflowResponse",
        (
            "/api/workflows/{workflow_id}/versions",
            "post",
            "201",
        ): "SaveWorkflowResponse",
        (
            "/api/workflows/{workflow_id}",
            "delete",
            "200",
        ): "DeleteWorkflowResponse",
        ("/api/runs", "post", "200"): "RunResponse",
        ("/api/runs", "post", "422"): "RunErrorResponse",
    }

    for (path, method, status), model_name in expected.items():
        response_schema = _json_schema(schema, path, method, status)
        assert response_schema == {
            "$ref": f"#/components/schemas/{model_name}"
        }


def test_generated_declarations_cover_paths_and_wire_models() -> None:
    generated = GENERATED_TYPES.read_text(encoding="utf-8")

    assert '"/api/runs"' in generated
    assert '"/api/graphs/{graph_id}"' in generated
    assert '"/api/workflows/{workflow_id}/versions/{version}"' in generated
    assert "CatalogResponse:" in generated
    assert "RunErrorResponse:" in generated
    assert "SaveWorkflowResponse:" in generated
