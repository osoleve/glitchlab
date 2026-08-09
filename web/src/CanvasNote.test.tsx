import { fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasNote } from "./CanvasNote";
import type { WorkflowNote } from "./types";

function renderNote(note: WorkflowNote) {
  render(
    <ReactFlowProvider>
      <CanvasNote
        {...({ id: note.id, data: note.data, selected: true } as Parameters<typeof CanvasNote>[0])}
      />
    </ReactFlowProvider>,
  );
}

describe("CanvasNote", () => {
  it("preserves whitespace and the caret while editing", () => {
    const onUpdate = vi.fn();
    renderNote({
      id: "note-a",
      type: "workflowNote",
      position: { x: 0, y: 0 },
      data: { text: "two words", color: "amber", onUpdate },
    });
    const textarea = screen.getByLabelText("Canvas note") as HTMLTextAreaElement;
    textarea.setSelectionRange(3, 3);
    fireEvent.change(textarea, { target: { value: "two  words", selectionStart: 4 } });

    expect(textarea).toHaveValue("two  words");
    expect(textarea.selectionStart).toBe(4);
    expect(onUpdate).toHaveBeenLastCalledWith({ text: "two  words" });
  });

  it("updates color and exposes a delete action", () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    renderNote({
      id: "note-a",
      type: "workflowNote",
      position: { x: 0, y: 0 },
      data: { text: "Read me", color: "amber", onUpdate, onRemove },
    });

    fireEvent.click(screen.getByRole("button", { name: "Use teal note color" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));

    expect(onUpdate).toHaveBeenCalledWith({ color: "teal" });
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
