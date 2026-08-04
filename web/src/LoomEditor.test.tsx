import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runGraph } from "./api";
import { LoomEditor } from "./LoomEditor";
import { appendLoomEntry, createLoomState, selectLoomEntry, updateLoomEntryText } from "./loom";
import type { GraphSpec, LoomState, RunResponse, WorkflowNode } from "./types";

vi.mock("./api", () => ({ runGraph: vi.fn() }));

const NOW = "2026-08-03T12:00:00Z";

function initialState(): LoomState {
  const state = createLoomState(
    () => "root",
    () => NOW,
  );
  return updateLoomEntryText(state, "root", "  seed text  ", () => NOW);
}

function loomNode(state: LoomState): WorkflowNode {
  return {
    id: "loom-1",
    type: "workflowNode",
    position: { x: 200, y: 0 },
    data: {
      kind: "loom",
      title: "Draft loom",
      definition: {
        kind: "loom",
        label: "Loom",
        category: "Text",
        description: "Branching text",
        inputs: [
          {
            name: "endpoint",
            label: "Endpoint",
            type: "endpoint",
            required: true,
            multiple: false,
          },
          {
            name: "model",
            label: "Model",
            type: "model",
            required: true,
            multiple: false,
          },
        ],
        outputs: [{ name: "text", label: "Text", type: "text", required: true, multiple: false }],
        fields: [],
        editor: "loom",
      },
      config: { seed: 5 },
      controlPorts: {},
      state,
      runStatus: "idle",
    },
  };
}

function graph(state: LoomState): GraphSpec {
  return {
    name: "Test graph",
    nodes: [
      {
        id: "endpoint",
        kind: "endpoint",
        title: "Endpoint",
        config: {},
        control_ports: {},
        position: { x: 0, y: 0 },
      },
      {
        id: "model",
        kind: "model",
        title: "Model",
        config: {},
        control_ports: {},
        position: { x: 0, y: 100 },
      },
      {
        id: "loom-1",
        kind: "loom",
        title: "Draft loom",
        config: { seed: 5 },
        control_ports: {},
        state,
        position: { x: 200, y: 0 },
      },
    ],
    edges: [
      {
        id: "endpoint-loom",
        source: "endpoint",
        source_port: "endpoint",
        target: "loom-1",
        target_port: "endpoint",
      },
      {
        id: "model-loom",
        source: "model",
        source_port: "model",
        target: "loom-1",
        target_port: "model",
      },
    ],
  };
}

function Harness({ startingState = initialState() }: { startingState?: LoomState }) {
  const [state, setState] = useState(startingState);
  return (
    <LoomEditor graph={graph(state)} node={loomNode(state)} onChange={setState} onClose={vi.fn()} />
  );
}

function completionResponse(
  text = " generated branch",
  topLogprobs?: Record<string, number>,
): RunResponse {
  return {
    status: "completed",
    nodes: [
      {
        node_id: "loom-1",
        kind: "completion",
        status: "completed",
        duration_ms: 3,
        outputs: {
          result: {
            kind: "completion_result",
            text,
            ...(topLogprobs ? { logprobs: { tokens: [text], top_logprobs: [topLogprobs] } } : {}),
          },
        },
      },
    ],
    terminal_outputs: {},
    manifest: {
      run_id: "run-1",
      graph_digest: "digest",
      graph_name: "Test graph · Loom branch",
      engine_version: "test",
      started_at: NOW,
      finished_at: NOW,
      scope: {
        mode: "targets",
        target_node_ids: ["loom-1"],
        executed_node_ids: ["endpoint", "model", "loom-1"],
      },
    },
  };
}

describe("LoomEditor", () => {
  beforeEach(() => {
    vi.mocked(runGraph).mockReset();
  });

  it("preserves exact edits and adds a selected manual child", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const selected = screen.getByRole("textbox", { name: "Selected loom segment" });
    await user.clear(selected);
    await user.type(selected, "  revised  ");
    expect(selected).toHaveValue("  revised  ");

    await user.type(screen.getByRole("textbox", { name: "Manual loom branch text" }), " child ");
    await user.click(screen.getByRole("button", { name: "Add and select" }));
    expect(screen.getByRole("textbox", { name: "Selected loom segment" })).toHaveValue(" child ");
    expect(screen.getByText("2 entries")).toBeInTheDocument();
    expect(
      screen.getByText("Loom output · root to selection").nextElementSibling?.textContent,
    ).toBe("  revised   child ");
  });

  it("generates through a transient completion target and selects its result", async () => {
    const user = userEvent.setup();
    vi.mocked(runGraph).mockResolvedValue(completionResponse());
    render(<Harness />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Candidates" }), "1");
    await user.click(screen.getByRole("button", { name: "Generate completions" }));

    await waitFor(() => expect(runGraph).toHaveBeenCalledOnce());
    const [submitted, scope] = vi.mocked(runGraph).mock.calls[0];
    expect(submitted.nodes.find((node) => node.id === "loom-1")?.kind).toBe("completion");
    expect(submitted.nodes.find((node) => node.kind === "text_input")?.config.text).toBe(
      "  seed text  ",
    );
    expect(scope).toEqual({ mode: "targets", target_node_ids: ["loom-1"] });
    expect(screen.getByRole("textbox", { name: "Selected loom segment" })).toHaveValue(
      " generated branch",
    );
  });

  it("nests descendants under their real parent in the left-to-right tree", () => {
    let nextId = 0;
    const createId = () => `entry-${nextId++}`;
    let state = createLoomState(createId, () => NOW);
    state = updateLoomEntryText(state, "entry-0", "root", () => NOW);
    state = appendLoomEntry(state, "child A", { createId, now: () => NOW });
    state = appendLoomEntry(state, "grandchild A", { createId, now: () => NOW });
    state = selectLoomEntry(state, "entry-0");
    state = appendLoomEntry(state, "child B", { createId, now: () => NOW });
    render(<Harness startingState={state} />);

    const childA = screen.getByRole("treeitem", { name: /^child A human$/i });
    const childABranch = childA.closest<HTMLElement>('[role="none"]');
    expect(childABranch).not.toBeNull();
    expect(
      within(childABranch!).getByRole("treeitem", { name: /^grandchild A human$/i }),
    ).toBeVisible();
    expect(within(childABranch!).queryByRole("treeitem", { name: /^child B human$/i })).toBeNull();
    expect(screen.getByRole("treeitem", { name: /root edited/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("inserts hotkey-selected tokens exactly and automatically probes the new prompt", async () => {
    const user = userEvent.setup();
    const choices = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [` token-${index}`, -0.1 - index]),
    );
    vi.mocked(runGraph)
      .mockResolvedValueOnce(completionResponse(" sampled", choices))
      .mockResolvedValueOnce(completionResponse(" next", { " next": -0.2 }));
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Show next tokens" }));
    await waitFor(() => expect(runGraph).toHaveBeenCalledOnce());
    expect(screen.getAllByRole("button", { name: /Insert token \d:/ })).toHaveLength(10);

    const manual = screen.getByRole("textbox", { name: "Manual loom branch text" });
    await user.type(manual, "0");
    expect(screen.getByRole("textbox", { name: "Selected loom segment" })).toHaveValue(
      "  seed text  ",
    );
    expect(runGraph).toHaveBeenCalledOnce();

    await user.click(screen.getByText("Token steering"));
    await user.keyboard("0");
    await waitFor(() => expect(runGraph).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("textbox", { name: "Selected loom segment" })).toHaveValue(" token-0");
    expect(screen.getByText("2 entries")).toBeInTheDocument();
    const [secondGraph] = vi.mocked(runGraph).mock.calls[1];
    expect(
      secondGraph.nodes.find((candidate) => candidate.kind === "text_input")?.config.text,
    ).toBe("  seed text   token-0");
  });
});
