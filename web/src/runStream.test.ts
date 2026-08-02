import { describe, expect, it, vi } from "vitest";
import { parseRunEventStream } from "./runStream";

function stream(lines: string[], splits: number[] = []): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(lines.join("\n"));
  const boundaries = [...splits, encoded.length];
  let start = 0;
  return new ReadableStream({
    start(controller) {
      for (const end of boundaries) {
        controller.enqueue(encoded.slice(start, end));
        start = end;
      }
      controller.close();
    },
  });
}

const event = (sequence: number, name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    protocol_version: 1,
    sequence,
    at: "2026-08-02T00:00:00Z",
    run_id: "run-one",
    event: name,
    ...extra,
  });

const completedResponse = {
  status: "completed",
  manifest: {
    run_id: "run-one",
    graph_name: "test",
    graph_digest: "digest",
    engine_version: "test",
    started_at: "2026-08-02T00:00:00Z",
    finished_at: "2026-08-02T00:00:01Z",
    python_version: "3.12",
    workspace: "test",
    glitchlings_version: null,
    scope: { mode: "full", target_node_ids: [], executed_node_ids: [] },
    graph: { name: "test", nodes: [], edges: [] },
  },
  nodes: [],
  terminal_outputs: {},
};

describe("run event stream parser", () => {
  it("parses NDJSON across arbitrary chunk boundaries", async () => {
    const onEvent = vi.fn();
    const terminal = await parseRunEventStream(
      stream(
        [
          event(1, "run_started", {
            requested_scope: { mode: "full", target_node_ids: [] },
          }),
          event(2, "run_completed", { response: completedResponse }),
        ],
        [3, 17, 41],
      ),
      onEvent,
    );

    expect(terminal.event).toBe("run_completed");
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: "a sequence gap",
      lines: [
        event(1, "run_started", {
          requested_scope: { mode: "full", target_node_ids: [] },
        }),
        event(3, "run_completed", { response: completedResponse }),
      ],
      message: "sequence violation",
    },
    {
      name: "a changed run id",
      lines: [
        event(1, "run_started", {
          requested_scope: { mode: "full", target_node_ids: [] },
        }),
        event(2, "run_completed", { response: completedResponse, run_id: "run-two" }),
      ],
      message: "changed run_id",
    },
    {
      name: "missing terminal event",
      lines: [
        event(1, "run_started", {
          requested_scope: { mode: "full", target_node_ids: [] },
        }),
      ],
      message: "before a terminal event",
    },
    {
      name: "an event after terminal",
      lines: [
        event(1, "run_completed", { response: completedResponse }),
        event(2, "run_failed", { detail: { message: "late" } }),
      ],
      message: "after its terminal event",
    },
  ])("rejects $name", async ({ lines, message }) => {
    await expect(parseRunEventStream(stream(lines), () => undefined)).rejects.toThrow(message);
  });

  it("cancels the reader when a protocol error occurs", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `${event(1, "run_started", {
              requested_scope: { mode: "full", target_node_ids: [] },
            })}\n${event(3, "run_completed", { response: completedResponse })}\n`,
          ),
        );
      },
      cancel,
    });

    await expect(parseRunEventStream(body, () => undefined)).rejects.toThrow("sequence violation");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    ["requested scope", event(1, "run_started")],
    ["node_started", event(1, "node_started", { node_id: "node", kind: 7 })],
    [
      "node_completed",
      event(1, "node_completed", { node_id: "node", kind: "test", duration_ms: -1 }),
    ],
    ["node_failed", event(1, "node_failed", { node_id: "node", kind: "test", duration_ms: 1 })],
    [
      "structured error detail",
      event(1, "run_failed", {
        detail: { message: "bad", node_id: "node", nodes: [{ node_id: "node" }] },
      }),
    ],
    [
      "completed response",
      event(1, "run_completed", {
        response: { ...completedResponse, nodes: [{ node_id: "node" }] },
      }),
    ],
  ])("rejects malformed event-specific field: %s", async (_name, line) => {
    await expect(parseRunEventStream(stream([line]), () => undefined)).rejects.toThrow(
      /invalid|omitted/,
    );
  });
});
