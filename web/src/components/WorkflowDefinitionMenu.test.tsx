import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NodeDefinition } from "../types";
import { WorkflowDefinitionMenu } from "./WorkflowDefinitionMenu";

function definition(persisted: boolean): NodeDefinition {
  return {
    kind: "fold:af580533-40f1-5c7e-8716-21ce8fb6957b:v1",
    label: "Fold · Generate one worksheet question",
    category: "Workflows",
    description: "Generate questions.",
    inputs: [],
    outputs: [],
    fields: [],
    workflow: {
      id: "af580533-40f1-5c7e-8716-21ce8fb6957b",
      version: 1,
      digest: "digest",
    },
    workflow_snapshot: {},
    workflow_persisted: persisted,
  };
}

describe("WorkflowDefinitionMenu", () => {
  it("offers inspection without a destructive action for embedded snapshots", () => {
    render(
      <WorkflowDefinitionMenu
        menu={{ x: 0, y: 0, definition: definition(false) }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole("menuitem", { name: "Open snapshot in new tab" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Delete saved workflow" })).toBeNull();
  });

  it("keeps edit and delete actions for persisted workflows", () => {
    render(
      <WorkflowDefinitionMenu
        menu={{ x: 0, y: 0, definition: definition(true) }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole("menuitem", { name: "Edit in new tab" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Delete saved workflow" })).toBeVisible();
  });
});
