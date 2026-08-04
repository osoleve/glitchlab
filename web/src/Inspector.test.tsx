import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Inspector } from "./Inspector";
import type { NodeDefinition, RunResponse, WorkflowNode } from "./types";

const definition: NodeDefinition = {
  kind: "preview",
  label: "Preview",
  category: "Output",
  description: "Inspect a value.",
  inputs: [],
  outputs: [],
  fields: [],
};

function node(id: string, kind = "text"): WorkflowNode {
  return {
    id,
    type: "workflowNode",
    position: { x: 0, y: 0 },
    data: {
      kind,
      title: `Node ${id}`,
      definition: { ...definition, kind },
      config: {},
      controlPorts: {},
      runStatus: "idle",
    },
  };
}

function runFor(nodeId: string): RunResponse {
  return {
    status: "completed",
    manifest: {
      run_id: "run-1",
      graph_name: "Test graph",
      graph_digest: "digest",
      engine_version: "test",
      started_at: "2026-07-30T00:00:00Z",
      finished_at: "2026-07-30T00:00:01Z",
      glitchlings_version: null,
      scope: {
        mode: "full",
        target_node_ids: [],
        executed_node_ids: [nodeId],
      },
    },
    nodes: [
      {
        node_id: nodeId,
        kind: "text",
        status: "completed",
        duration_ms: 4.2,
        outputs: { value: "result arrived" },
      },
    ],
    terminal_outputs: {},
  };
}

const handlers = {
  onUpdateTitle: vi.fn(),
  onUpdateField: vi.fn(),
  onUpdateControlPort: vi.fn(),
  onDelete: vi.fn(),
  onClose: vi.fn(),
};

describe("Inspector output selection", () => {
  it("switches to Output when a result arrives for the selected node", () => {
    const selectedNode = node("text-1");
    const view = render(
      <Inspector
        selectedNode={selectedNode}
        nodes={[selectedNode]}
        edges={[]}
        glitchlings={[]}
        {...handlers}
      />,
    );

    expect(screen.getByRole("tab", { name: "Configure" })).toHaveAttribute("aria-selected", "true");

    view.rerender(
      <Inspector
        selectedNode={selectedNode}
        nodes={[selectedNode]}
        edges={[]}
        glitchlings={[]}
        run={runFor(selectedNode.id)}
        {...handlers}
      />,
    );

    expect(screen.getByRole("tab", { name: /Output/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("result arrived")).toBeInTheDocument();
  });

  it("lets the user return to Configure after output is available", async () => {
    const user = userEvent.setup();
    const selectedNode = node("text-1");
    render(
      <Inspector
        selectedNode={selectedNode}
        nodes={[selectedNode]}
        edges={[]}
        glitchlings={[]}
        run={runFor(selectedNode.id)}
        {...handlers}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Configure" }));

    expect(screen.getByRole("tab", { name: "Configure" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens preview nodes on Output before a run exists", () => {
    const selectedNode = node("preview-1", "preview");
    render(
      <Inspector
        selectedNode={selectedNode}
        nodes={[selectedNode]}
        edges={[]}
        glitchlings={[]}
        {...handlers}
      />,
    );

    expect(screen.getByRole("tab", { name: "Output" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Run the graph to inspect this node’s output.")).toBeInTheDocument();
  });
});
