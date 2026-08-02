import type { RunErrorDetail, RunResponse, RunScope } from "./types";

export interface RunPlan {
  mode: "full" | "targets";
  target_node_ids: string[];
  node_ids: string[];
  edge_ids: string[];
}

interface RunEventBase {
  protocol_version: 1;
  sequence: number;
  at: string;
  run_id: string;
}

export type RunStreamEvent =
  | (RunEventBase & { event: "run_started"; requested_scope: RunScope })
  | (RunEventBase & { event: "run_planned"; plan: RunPlan })
  | (RunEventBase & { event: "node_started"; node_id: string; kind: string })
  | (RunEventBase & { event: "edges_transferred"; node_id: string; edge_ids: string[] })
  | (RunEventBase & {
      event: "node_completed";
      node_id: string;
      kind: string;
      duration_ms: number;
    })
  | (RunEventBase & {
      event: "node_failed";
      node_id: string;
      kind: string;
      duration_ms: number;
      error: string;
    })
  | (RunEventBase & { event: "run_completed"; response: RunResponse })
  | (RunEventBase & { event: "run_failed"; detail: RunErrorDetail });

const EVENT_NAMES = new Set([
  "run_started",
  "run_planned",
  "node_started",
  "edges_transferred",
  "node_completed",
  "node_failed",
  "run_completed",
  "run_failed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function finiteDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isScope(value: unknown): value is RunScope {
  return (
    isRecord(value) &&
    (value.mode === "full" || value.mode === "targets") &&
    stringArray(value.target_node_ids)
  );
}

function isNodeRunResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.node_id === "string" &&
    typeof value.kind === "string" &&
    (value.status === "completed" || value.status === "failed") &&
    finiteDuration(value.duration_ms) &&
    isRecord(value.outputs) &&
    (value.error === undefined || value.error === null || typeof value.error === "string")
  );
}

function isRunErrorDetail(value: unknown): value is RunErrorDetail {
  return (
    isRecord(value) &&
    typeof value.message === "string" &&
    (value.node_id === undefined || value.node_id === null || typeof value.node_id === "string") &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isNodeRunResult)
  );
}

function isRunResponse(value: unknown): value is RunResponse {
  if (
    !isRecord(value) ||
    value.status !== "completed" ||
    !isRecord(value.manifest) ||
    !Array.isArray(value.nodes) ||
    !value.nodes.every(isNodeRunResult) ||
    !isRecord(value.terminal_outputs)
  ) {
    return false;
  }
  const manifest = value.manifest;
  const scope = manifest.scope;
  return (
    typeof manifest.run_id === "string" &&
    typeof manifest.graph_name === "string" &&
    typeof manifest.graph_digest === "string" &&
    typeof manifest.engine_version === "string" &&
    typeof manifest.started_at === "string" &&
    typeof manifest.finished_at === "string" &&
    typeof manifest.python_version === "string" &&
    typeof manifest.workspace === "string" &&
    (manifest.glitchlings_version === null || typeof manifest.glitchlings_version === "string") &&
    isRecord(manifest.graph) &&
    Array.isArray(manifest.graph.nodes) &&
    Array.isArray(manifest.graph.edges) &&
    isRecord(scope) &&
    (scope.mode === "full" || scope.mode === "targets") &&
    stringArray(scope.target_node_ids) &&
    stringArray(scope.executed_node_ids)
  );
}

function decodeEvent(value: unknown): RunStreamEvent {
  if (
    !isRecord(value) ||
    value.protocol_version !== 1 ||
    !Number.isInteger(value.sequence) ||
    Number(value.sequence) < 1 ||
    typeof value.at !== "string" ||
    typeof value.run_id !== "string" ||
    typeof value.event !== "string" ||
    !EVENT_NAMES.has(value.event)
  ) {
    throw new Error("Run stream returned an invalid protocol-v1 event.");
  }
  if (value.event === "run_started" && !isScope(value.requested_scope))
    throw new Error("Run stream returned an invalid requested scope.");
  if (value.event === "run_planned") {
    if (
      !isRecord(value.plan) ||
      (value.plan.mode !== "full" && value.plan.mode !== "targets") ||
      !stringArray(value.plan.target_node_ids) ||
      !stringArray(value.plan.node_ids) ||
      !stringArray(value.plan.edge_ids)
    ) {
      throw new Error("Run stream returned an invalid run plan.");
    }
  } else if (value.event === "node_started") {
    if (typeof value.node_id !== "string" || typeof value.kind !== "string")
      throw new Error("Run stream returned an invalid node_started event.");
  } else if (value.event === "edges_transferred") {
    if (typeof value.node_id !== "string" || !stringArray(value.edge_ids))
      throw new Error("Run stream returned an invalid edges_transferred event.");
  } else if (value.event === "node_completed") {
    if (
      typeof value.node_id !== "string" ||
      typeof value.kind !== "string" ||
      !finiteDuration(value.duration_ms)
    )
      throw new Error("Run stream returned an invalid node_completed event.");
  } else if (value.event === "node_failed") {
    if (
      typeof value.node_id !== "string" ||
      typeof value.kind !== "string" ||
      !finiteDuration(value.duration_ms) ||
      typeof value.error !== "string"
    )
      throw new Error("Run stream returned an invalid node_failed event.");
  } else if (value.event === "run_completed" && !isRunResponse(value.response)) {
    throw new Error("Run stream returned an invalid completed response.");
  } else if (value.event === "run_failed" && !isRunErrorDetail(value.detail)) {
    throw new Error("Run stream failure omitted structured error detail.");
  }
  return value as unknown as RunStreamEvent;
}

export async function parseRunEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: RunStreamEvent) => void | Promise<void>,
): Promise<RunStreamEvent & { event: "run_completed" | "run_failed" }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let expectedSequence = 1;
  let runId: string | undefined;
  let terminal: (RunStreamEvent & { event: "run_completed" | "run_failed" }) | undefined;

  const acceptLine = async (line: string) => {
    if (!line.trim()) return;
    if (terminal) throw new Error("Run stream emitted an event after its terminal event.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error("Run stream returned malformed NDJSON.");
    }
    const event = decodeEvent(parsed);
    if (event.sequence !== expectedSequence) {
      throw new Error(
        `Run stream sequence violation: expected ${expectedSequence}, received ${event.sequence}.`,
      );
    }
    expectedSequence += 1;
    if (runId === undefined) runId = event.run_id;
    else if (event.run_id !== runId) throw new Error("Run stream changed run_id mid-stream.");
    await onEvent(event);
    if (event.event === "run_completed" || event.event === "run_failed") terminal = event;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        await acceptLine(line);
        newline = buffer.indexOf("\n");
      }
      if (done) break;
    }
    await acceptLine(buffer);
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Preserve the protocol error that caused cancellation.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!terminal) throw new Error("Run stream ended before a terminal event.");
  return terminal;
}
