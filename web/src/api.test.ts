import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCatalog, runGraph } from "./api";

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
});
