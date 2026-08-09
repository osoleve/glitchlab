import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const endpointDefinition: NodeDefinition = {
  kind: "endpoint",
  label: "Completion endpoint",
  category: "Models",
  description: "An OpenAI-compatible endpoint reference.",
  inputs: [],
  outputs: [],
  fields: [
    {
      name: "base_url",
      label: "Base URL",
      control: "text",
      type: "text",
      default: "http://127.0.0.1:8000/v1",
      help: "",
      options: [],
      placeholder: "",
      inline: true,
    },
  ],
};

function InspectorEndpointHarness({ onUpdate = vi.fn() }: { onUpdate?: ReturnType<typeof vi.fn> }) {
  const [baseUrl, setBaseUrl] = useState("http://models.test/v1");
  const selectedNode: WorkflowNode = {
    id: "endpoint",
    type: "workflowNode",
    position: { x: 0, y: 0 },
    data: {
      kind: "endpoint",
      title: "Endpoint",
      definition: endpointDefinition,
      config: { base_url: baseUrl },
      controlPorts: {},
      runStatus: "idle",
    },
  };
  return (
    <Inspector
      selectedNode={selectedNode}
      nodes={[selectedNode]}
      edges={[]}
      glitchlings={[]}
      {...handlers}
      onUpdateField={(field, value) => {
        onUpdate(field, value);
        if (field === "base_url") setBaseUrl(String(value));
      }}
    />
  );
}

describe("Inspector output selection", () => {
  beforeEach(() => localStorage.clear());

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

  it("preserves endpoint caret edits and offers the committed value for reuse", () => {
    const onUpdate = vi.fn();
    render(<InspectorEndpointHarness onUpdate={onUpdate} />);
    const input = screen.getByRole("textbox", { name: "Base URL" }) as HTMLInputElement;
    input.setSelectionRange(7, 7);
    fireEvent.change(input, {
      target: { value: "http://new.models.test/v1", selectionStart: 11 },
    });

    expect(input.selectionStart).toBe(11);
    expect(onUpdate).toHaveBeenLastCalledWith("base_url", "http://new.models.test/v1");
    fireEvent.blur(input);
    expect(screen.getByRole("combobox", { name: "Recent endpoint URLs" })).toHaveTextContent(
      "http://new.models.test/v1",
    );
  });
});
