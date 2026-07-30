import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import App from "./App";
import { AppErrorFallback, ErrorBoundary } from "./ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary fallback={(error) => <AppErrorFallback error={error} />}>
    <StrictMode>
      <App />
    </StrictMode>
  </ErrorBoundary>,
);
