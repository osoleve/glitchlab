import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ComparePreviewValue } from "./ComparePreviewValue";

describe("ComparePreviewValue", () => {
  it("aligns unequal sequences by index and keeps provenance collapsed", () => {
    render(
      <ComparePreviewValue
        value={{ values: [["old one", "old two"], ["new one"]] }}
        labels={["Earlier", "Later"]}
      />,
    );

    expect(screen.getByLabelText("Comparison of 2 sequences")).toBeInTheDocument();
    expect(screen.getByText("Earlier")).toBeInTheDocument();
    expect(screen.getByText("Later")).toBeInTheDocument();
    expect(screen.getByText("old two")).toBeInTheDocument();
    expect(screen.getByText("missing")).toBeInTheDocument();
    expect(screen.getByText("Provenance and raw values").closest("details")).not.toHaveAttribute(
      "open",
    );
  });
});
