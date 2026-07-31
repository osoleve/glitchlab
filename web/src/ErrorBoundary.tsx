import { Component, type ReactNode } from "react";
import styles from "./ErrorBoundary.module.css";
import { moduleClassNames as cx } from "./moduleClassNames";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: (error: Error) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

function errorMessage(error: Error): string {
  return error.message || "Unknown rendering error.";
}

export function AppErrorFallback({ error }: { error: Error }) {
  return (
    <main className={cx(styles, "app-error-boundary")} role="alert">
      <section className={cx(styles, "app-error-card")}>
        <span className={cx(styles, "app-error-kicker")}>Render failure</span>
        <h1>Glitchloom could not render this screen</h1>
        <p>
          The workbench hit an unexpected UI error. Reload the app to recover the normal workspace;
          unsaved changes may not survive a reload.
        </p>
        <details>
          <summary>Error details</summary>
          <code>{errorMessage(error)}</code>
        </details>
        <button type="button" onClick={() => window.location.reload()}>
          Reload app
        </button>
      </section>
    </main>
  );
}

export function PreviewErrorFallback({ error }: { error: Error }) {
  return (
    <div className={cx(styles, "preview-error")} role="alert">
      <strong>Output could not be rendered</strong>
      <span>The run is still available. Try another node or run the loom again.</span>
      <code>{errorMessage(error)}</code>
    </div>
  );
}

export function NodeErrorFallback({ title, error }: { title: string; error: Error }) {
  return (
    <article className={cx(styles, "node-error-card")} role="alert">
      <span className={cx(styles, "app-error-kicker")}>Node render failure</span>
      <strong>{title}</strong>
      <span>This node could not be displayed. The rest of the canvas is still available.</span>
      <code>{errorMessage(error)}</code>
    </article>
  );
}
