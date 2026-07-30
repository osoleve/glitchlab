import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  AppErrorFallback,
  ErrorBoundary,
  NodeErrorFallback,
  PreviewErrorFallback,
} from "./ErrorBoundary";

function ThrowingChild(): ReactNode {
  throw new Error("Synthetic render failure");
}

describe("ErrorBoundary", () => {
  it("renders its fallback while keeping the surrounding tree mounted", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <div>
        <span>Canvas shell</span>
        <ErrorBoundary fallback={(error) => <PreviewErrorFallback error={error} />}>
          <ThrowingChild />
        </ErrorBoundary>
      </div>,
    );

    expect(screen.getByText("Canvas shell")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Output could not be rendered");
    expect(screen.getByText("Synthetic render failure")).toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it("provides useful app and node fallbacks", () => {
    const appView = render(<AppErrorFallback error={new Error("Root failure")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Glitchloom could not render this screen");
    expect(screen.getByRole("button", { name: "Reload app" })).toBeInTheDocument();
    appView.unmount();

    render(<NodeErrorFallback error={new Error("Node failure")} title="Preview" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Preview");
    expect(screen.getByRole("alert")).toHaveTextContent("Node failure");
  });
});
