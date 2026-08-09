import { fireEvent, render, screen } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeDefinition, WorkflowNode } from "./types";
import { WorkflowNodeCard } from "./WorkflowNode";

const endpointDefinition: NodeDefinition = {
  kind: "endpoint",
  label: "Completion endpoint",
  category: "Models",
  description: "An OpenAI-compatible endpoint reference.",
  inputs: [],
  outputs: [
    { name: "endpoint", label: "Endpoint", type: "endpoint", required: true, multiple: false },
  ],
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

function EndpointHarness({ onUpdate = vi.fn() }: { onUpdate?: ReturnType<typeof vi.fn> }) {
  const [baseUrl, setBaseUrl] = useState("http://models.test/v1");
  const props = {
    id: "endpoint",
    selected: true,
    data: {
      kind: "endpoint",
      title: "Local completion API",
      definition: endpointDefinition,
      config: { base_url: baseUrl },
      controlPorts: {},
      runStatus: "idle",
      onUpdateField: (field: string, value: unknown) => {
        onUpdate(field, value);
        if (field === "base_url") setBaseUrl(String(value));
      },
    },
  } as unknown as NodeProps<WorkflowNode>;
  return <WorkflowNodeCard {...props} />;
}

describe("WorkflowNode inline text controls", () => {
  beforeEach(() => localStorage.clear());

  it("preserves a mid-string caret while the graph config rerenders", () => {
    const onUpdate = vi.fn();
    render(
      <ReactFlowProvider>
        <EndpointHarness onUpdate={onUpdate} />
      </ReactFlowProvider>,
    );
    const input = screen.getByRole("textbox", {
      name: "Base URL for Local completion API",
    }) as HTMLInputElement;
    input.setSelectionRange(7, 7);
    fireEvent.change(input, {
      target: { value: "http://new.models.test/v1", selectionStart: 11 },
    });

    expect(input).toHaveValue("http://new.models.test/v1");
    expect(input.selectionStart).toBe(11);
    expect(onUpdate).toHaveBeenLastCalledWith("base_url", "http://new.models.test/v1");
  });

  it("remembers a committed endpoint and offers it for quick reuse", () => {
    render(
      <ReactFlowProvider>
        <EndpointHarness />
      </ReactFlowProvider>,
    );
    const input = screen.getByRole("textbox", {
      name: "Base URL for Local completion API",
    });
    fireEvent.blur(input);

    const recent = screen.getByRole("combobox", { name: "Recent endpoint URLs" });
    expect(recent).toHaveTextContent("http://models.test/v1");
  });
});
