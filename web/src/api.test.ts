import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCatalog, runGraph, runGraphStreaming, saveWorkflow } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API response boundaries", () => {
  it("rejects a successful response whose JSON shape violates the contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ nodes: "not-an-array" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(fetchCatalog()).rejects.toThrow(
      "Catalog request returned an unexpected response shape.",
    );
  });

  it("retains structured run errors at the fetch boundary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: {
              message: "Invalid graph contract",
              node_id: "broken-node",
              nodes: [],
            },
          }),
          {
            status: 422,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(
      runGraph({ name: "Broken", nodes: [], edges: [] }, { mode: "full", target_node_ids: [] }),
    ).rejects.toMatchObject({
      detail: {
        message: "Invalid graph contract",
        node_id: "broken-node",
        nodes: [],
      },
    });
  });

  it("falls back to the legacy route only when streaming is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(undefined, { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: { message: "legacy failure", nodes: [] } }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runGraphStreaming(
        { name: "Fallback", nodes: [], edges: [] },
        { mode: "full", target_node_ids: [] },
        () => undefined,
      ),
    ).rejects.toMatchObject({ detail: { message: "legacy failure" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never replays a successful request after a stream protocol error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        `${JSON.stringify({
          protocol_version: 1,
          sequence: 1,
          at: "2026-08-02T00:00:00Z",
          run_id: "run",
          event: "run_started",
          requested_scope: { mode: "full", target_node_ids: [] },
        })}\n`,
        { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runGraphStreaming(
        { name: "No replay", nodes: [], edges: [] },
        { mode: "full", target_node_ids: [] },
        () => undefined,
      ),
    ).rejects.toThrow("before a terminal event");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("accepts all generated definitions returned by a workflow save", async () => {
    const graph = { name: "Fold body", nodes: [], edges: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            workflow: {
              id: "workflow-id",
              version: 1,
              name: "Fold body",
              description: "",
              digest: "digest",
              created_at: "2026-08-10T00:00:00Z",
              graph,
              inputs: [],
              outputs: [],
            },
            definitions: [{ kind: "workflow:workflow-id:v1" }, { kind: "fold:workflow-id:v1" }],
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const response = await saveWorkflow({
      name: "Fold body",
      description: "",
      graph,
      inputs: [],
      outputs: [],
    });

    expect(response.definitions).toHaveLength(2);
  });
});
