import { describe, expect, it } from "vitest";
import {
  downstreamClosure,
  inducedEdgeIds,
  semanticExecutionFingerprint,
  upstreamClosure,
} from "./graphTraversal";
import type { GraphSpec, LoomEdge } from "./types";

const nodeIds = ["shared", "left", "right", "merge", "after"];
const edges = [
  { id: "shared-left", source: "shared", target: "left" },
  { id: "shared-right", source: "shared", target: "right" },
  { id: "left-merge", source: "left", target: "merge" },
  { id: "right-merge", source: "right", target: "merge" },
  { id: "merge-after", source: "merge", target: "after" },
] as LoomEdge[];

describe("graph traversal", () => {
  it("computes upstream unions in stable graph order", () => {
    expect(upstreamClosure(nodeIds, edges, ["merge", "left"])).toEqual([
      "shared",
      "left",
      "right",
      "merge",
    ]);
  });

  it("computes downstream branches in stable graph order", () => {
    expect(downstreamClosure(nodeIds, edges, ["right"])).toEqual(["right", "merge", "after"]);
  });

  it("keeps only edges wholly inside a scope", () => {
    expect(inducedEdgeIds(edges, ["shared", "right", "merge"])).toEqual([
      "shared-right",
      "right-merge",
    ]);
  });
});

describe("semantic execution fingerprint", () => {
  const graph: GraphSpec = {
    name: "Layout one",
    nodes: [
      {
        id: "source",
        kind: "text_input",
        title: "Source",
        config: { nested: { second: 2, first: 1 }, text: "thread" },
        control_ports: {},
        position: { x: 10, y: 20 },
      },
    ],
    edges: [],
  };

  it("ignores layout, graph name, titles, and object key order", () => {
    const rearranged: GraphSpec = {
      ...graph,
      name: "Layout two",
      nodes: [
        {
          ...graph.nodes[0],
          title: "Renamed",
          position: { x: 900, y: -50 },
          config: { text: "thread", nested: { first: 1, second: 2 } },
        },
      ],
    };

    expect(semanticExecutionFingerprint(rearranged)).toBe(semanticExecutionFingerprint(graph));
  });

  it("changes for execution-affecting config and topology", () => {
    const reconfigured: GraphSpec = {
      ...graph,
      nodes: [
        {
          ...graph.nodes[0],
          config: { ...graph.nodes[0].config, text: "changed" },
        },
      ],
    };
    const rewired: GraphSpec = {
      ...graph,
      edges: [
        {
          id: "ignored-edge-id",
          source: "source",
          source_port: "text",
          target: "target",
          target_port: "value",
        },
      ],
    };

    expect(semanticExecutionFingerprint(reconfigured)).not.toBe(
      semanticExecutionFingerprint(graph),
    );
    expect(semanticExecutionFingerprint(rewired)).not.toBe(semanticExecutionFingerprint(graph));
  });
});
