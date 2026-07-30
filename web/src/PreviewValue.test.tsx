import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PreviewValue } from "./PreviewValue";

describe("PreviewValue", () => {
  it("renders normalized completion metadata and source labels", () => {
    render(
      <PreviewValue
        itemLabels={["Older branch", "Newer branch"]}
        value={[
          {
            kind: "completion_result",
            text: "older response",
            model: "talkie-older",
            finish_reason: "stop",
            usage: { completion_tokens: 2, total_tokens: 8 },
            parameters: { seed: 7 },
          },
          {
            choices: [
              {
                text: "newer response",
                index: 1,
                finish_reason: "length",
                seed: 19,
              },
            ],
            model: "talkie-newer",
          },
        ]}
      />,
    );

    expect(screen.getByText("2 completions")).toBeInTheDocument();
    expect(screen.getByText("Older branch")).toBeInTheDocument();
    expect(screen.getByText("Newer branch")).toBeInTheDocument();
    expect(screen.getByText("older response")).toBeInTheDocument();
    expect(screen.getByText("newer response")).toBeInTheDocument();
    expect(screen.getByTitle("Token usage")).toHaveTextContent(
      "2 generated · 8 total",
    );
    expect(screen.getAllByTitle("Sampling seed")).toHaveLength(2);
    expect(screen.getAllByTitle("Sampling seed")[0]).toHaveTextContent("seed 7");
    expect(screen.getAllByTitle("Sampling seed")[1]).toHaveTextContent("seed 19");
    expect(
      screen.getByRole("button", { name: "Copy readable text" }),
    ).toBeEnabled();
  });

  it("renders corruption records as readable text", () => {
    render(
      <PreviewValue
        value={{
          kind: "corruption_result",
          input: "source",
          output: "s0urce",
          seed: 3,
          spec: { name: "Scannequin" },
        }}
      />,
    );

    expect(screen.getByText("1 text item")).toBeInTheDocument();
    expect(screen.getByText("Scannequin")).toBeInTheDocument();
    expect(screen.getByText("s0urce")).toBeInTheDocument();
    expect(screen.getByText("Original text")).toBeInTheDocument();
  });

  it("falls back to formatted JSON for unknown values", () => {
    render(<PreviewValue value={{ nested: { answer: 42 } }} />);

    expect(screen.getByText("Structured value")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy readable text" })).toBeNull();
    expect(screen.getByText(/"answer": 42/)).toBeInTheDocument();
  });
});
