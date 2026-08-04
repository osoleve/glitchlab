import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { WorkflowFrameNode } from "./FrameNode";

describe("collapsed frame activity", () => {
  it("keeps the active child legible without motion", () => {
    render(
      <ReactFlowProvider>
        <WorkflowFrameNode
          {...({
            id: "frame",
            type: "workflowFrame",
            selected: false,
            dragging: false,
            zIndex: 0,
            isConnectable: false,
            positionAbsoluteX: 0,
            positionAbsoluteY: 0,
            data: {
              title: "Models",
              color: "violet",
              collapsed: true,
              aggregateStatus: "active",
              activeChildTitle: "Vintage completion",
            },
          } as Parameters<typeof WorkflowFrameNode>[0])}
        />
      </ReactFlowProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Running Vintage completion");
    expect(screen.getByRole("button", { name: "Expand frame" })).toBeVisible();
  });

  it("announces partial completion with a truthful count", () => {
    render(
      <ReactFlowProvider>
        <WorkflowFrameNode
          {...({
            id: "frame",
            type: "workflowFrame",
            selected: false,
            dragging: false,
            zIndex: 0,
            isConnectable: false,
            positionAbsoluteX: 0,
            positionAbsoluteY: 0,
            data: {
              title: "Models",
              color: "amber",
              collapsed: true,
              aggregateStatus: "partial",
              aggregateCompletedCount: 1,
              aggregateTotalCount: 3,
            },
          } as Parameters<typeof WorkflowFrameNode>[0])}
        />
      </ReactFlowProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("1/3 complete");
  });
});
