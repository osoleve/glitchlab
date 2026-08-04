import { describe, expect, it } from "vitest";
import {
  appendLoomEntry,
  buildLoomGenerationGraph,
  buildLoomTokenProbeGraph,
  createLoomState,
  generatedLoomEntry,
  generatedLoomTokenProbe,
  loomTree,
  selectedLoomSegment,
  selectedLoomText,
  selectLoomEntry,
  updateLoomEntryText,
} from "./loom";
import type { GraphSpec, LoomState, RunResponse } from "./types";

const NOW = "2026-08-03T12:00:00Z";

function branchedState(): LoomState {
  let next = 0;
  const createId = () => `entry-${next++}`;
  let state = createLoomState(createId, () => NOW);
  state = updateLoomEntryText(state, "entry-0", "  Once", () => NOW);
  state = appendLoomEntry(state, " upon", { createId, now: () => NOW });
  state = appendLoomEntry(state, " a time  ", { createId, now: () => NOW });
  return state;
}

function graph(state: LoomState): GraphSpec {
  return {
    name: "Branching test",
    nodes: [
      {
        id: "endpoint-1",
        kind: "endpoint",
        title: "Endpoint",
        config: { base_url: "http://127.0.0.1:8790/v1" },
        control_ports: {},
        position: { x: 0, y: 0 },
      },
      {
        id: "model-1",
        kind: "model",
        title: "Model",
        config: { model_id: "talkie" },
        control_ports: {},
        position: { x: 0, y: 100 },
      },
      {
        id: "loom-1",
        kind: "loom",
        title: "Loom",
        config: { max_tokens: 24, seed: 10 },
        control_ports: {},
        state,
        position: { x: 300, y: 0 },
      },
    ],
    edges: [
      {
        id: "endpoint-edge",
        source: "endpoint-1",
        source_port: "endpoint",
        target: "loom-1",
        target_port: "endpoint",
      },
      {
        id: "model-edge",
        source: "model-1",
        source_port: "model",
        target: "loom-1",
        target_port: "model",
      },
    ],
  };
}

describe("Loom state", () => {
  it("distinguishes the selected segment from the exact emitted path", () => {
    const state = branchedState();
    expect(selectedLoomSegment(state)).toBe(" a time  ");
    expect(selectedLoomText(state)).toBe("  Once upon a time  ");
    expect(selectedLoomText(selectLoomEntry(state, "entry-1"))).toBe("  Once upon");
  });

  it("adds a branch beneath the selected entry without deleting siblings", () => {
    let next = 3;
    const state = selectLoomEntry(branchedState(), "entry-1");
    const branched = appendLoomEntry(state, " elsewhere", {
      createId: () => `entry-${next++}`,
      now: () => NOW,
    });
    expect(branched.entries.map((entry) => entry.id)).toEqual([
      "entry-0",
      "entry-1",
      "entry-2",
      "entry-3",
    ]);
    expect(branched.entries.at(-1)?.parent_id).toBe("entry-1");
    expect(branched.selected_id).toBe("entry-3");
  });

  it("materializes the ordered parent-child hierarchy instead of inferring it from depth", () => {
    let state = selectLoomEntry(branchedState(), "entry-1");
    state = appendLoomEntry(state, " side path", {
      createId: () => "entry-3",
      now: () => NOW,
    });
    const tree = loomTree(state);
    expect(tree.entry.id).toBe("entry-0");
    expect(tree.children.map((branch) => branch.entry.id)).toEqual(["entry-1"]);
    expect(tree.children[0].children.map((branch) => branch.entry.id)).toEqual([
      "entry-2",
      "entry-3",
    ]);
  });
});

describe("Loom generation", () => {
  it("reuses completion execution with exact prompt text and varied configured seeds", () => {
    const state = branchedState();
    const transient = buildLoomGenerationGraph(graph(state), "loom-1", state, 2);
    const target = transient.nodes.find((node) => node.id === "loom-1");
    const prompt = transient.nodes.find((node) => node.kind === "text_input");
    expect(target?.kind).toBe("completion");
    expect(target?.state).toBeUndefined();
    expect(target?.config.seed).toBe(12);
    expect(prompt?.config.text).toBe("  Once upon a time  ");
    expect(transient.edges.at(-1)?.target_port).toBe("prompt");
  });

  it("extracts generated text and compact provenance from an ordinary run", () => {
    const response = {
      status: "completed",
      nodes: [
        {
          node_id: "loom-1",
          kind: "completion",
          status: "completed",
          duration_ms: 4,
          outputs: {
            result: { kind: "completion_result", text: " continuation", cache_hit: false },
          },
        },
      ],
      terminal_outputs: {},
      manifest: {
        run_id: "run-1",
        graph_digest: "abc",
        finished_at: NOW,
        started_at: NOW,
        graph_name: "test",
        graph: graph(branchedState()),
        engine_version: "test",
        scope: { mode: "targets", target_node_ids: ["loom-1"], executed_node_ids: [] },
      },
    } as RunResponse;
    expect(generatedLoomEntry(response, "loom-1")).toEqual({
      text: " continuation",
      completion: { kind: "completion_result", text: " continuation", cache_hit: false },
      run: { run_id: "run-1", graph_digest: "abc", finished_at: NOW },
    });
  });

  it("forces a one-token, ten-logprob probe even when extra body overrides completion fields", () => {
    const state = branchedState();
    const source = graph(state);
    const target = source.nodes.find((node) => node.id === "loom-1");
    if (target) {
      target.config.extra_body = { max_tokens: 99, logprobs: 2, stop: ["END"], top_k: 40 };
    }
    const transient = buildLoomTokenProbeGraph(source, "loom-1", state);
    const probe = transient.nodes.find((node) => node.id === "loom-1");
    expect(probe?.config).toMatchObject({
      max_tokens: 1,
      logprobs: 10,
      stop: "",
      extra_body: { max_tokens: 1, logprobs: 10, stop: [], top_k: 40 },
    });
    expect(transient.name).toBe("Branching test · Loom next tokens");
  });

  it("sorts and extracts the ten next-token alternatives from completion provenance", () => {
    const response = {
      status: "completed",
      nodes: [
        {
          node_id: "loom-1",
          kind: "completion",
          status: "completed",
          duration_ms: 4,
          outputs: {
            result: {
              kind: "completion_result",
              text: " sampled",
              logprobs: {
                top_logprobs: [
                  {
                    " tenth": -10,
                    " first": -0.1,
                    " second": -0.2,
                    " third": -0.3,
                    " fourth": -0.4,
                    " fifth": -0.5,
                    " sixth": -0.6,
                    " seventh": -0.7,
                    " eighth": -0.8,
                    " ninth": -0.9,
                    " eleventh": -11,
                  },
                ],
              },
            },
          },
        },
      ],
      terminal_outputs: {},
      manifest: {
        run_id: "run-probe",
        graph_digest: "probe-digest",
        finished_at: NOW,
        started_at: NOW,
        graph_name: "probe",
        graph: graph(branchedState()),
        engine_version: "test",
        scope: { mode: "targets", target_node_ids: ["loom-1"], executed_node_ids: [] },
      },
    } as RunResponse;
    const probe = generatedLoomTokenProbe(response, "loom-1");
    expect(probe.choices).toHaveLength(10);
    expect(probe.choices[0]).toEqual({ token: " first", logprob: -0.1 });
    expect(probe.choices.at(-1)).toEqual({ token: " tenth", logprob: -10 });
    expect(probe.run.run_id).toBe("run-probe");
  });
});
