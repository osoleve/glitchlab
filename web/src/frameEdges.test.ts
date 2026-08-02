import { describe, expect, it } from "vitest";
import { collapseFrameEdges } from "./frameEdges";
import type { LoomEdge, LoomNode } from "./types";

const node = (id: string, parentId?: string) => ({ id, parentId }) as LoomNode;
const edge = (id: string, source: string, target: string) =>
  ({
    id,
    source,
    sourceHandle: "out",
    target,
    targetHandle: "in",
  }) as LoomEdge;

describe("collapsed frame edges", () => {
  it("hides internal edges and proxies boundary connectivity", () => {
    const result = collapseFrameEdges(
      [edge("inside", "a", "b"), edge("outgoing", "b", "c"), edge("incoming", "c", "a")],
      [node("a", "frame"), node("b", "frame"), node("c")],
      new Set(["frame"]),
    );

    expect(result.map((item) => item.id)).toEqual(["proxy:outgoing", "proxy:incoming"]);
    expect(result[0]).toMatchObject({
      source: "frame",
      sourceHandle: "proxy-output",
      target: "c",
      selectable: false,
      data: { semanticEdgeIds: ["outgoing"], presentationProxy: true },
    });
    expect(result[1]).toMatchObject({ target: "frame", targetHandle: "proxy-input" });
  });

  it("proxies both endpoints across collapsed frames", () => {
    const result = collapseFrameEdges(
      [edge("cross", "a", "b")],
      [node("a", "left"), node("b", "right")],
      new Set(["left", "right"]),
    );

    expect(result[0]).toMatchObject({ source: "left", target: "right" });
  });
});
