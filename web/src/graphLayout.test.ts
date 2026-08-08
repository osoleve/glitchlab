import { describe, expect, it } from "vitest";
import { type LayoutEdge, type LayoutNode, tidyGraphLayout, tidyNodeLayout } from "./graphLayout";

const nodes: LayoutNode[] = [
  {
    id: "source",
    position: { x: 120, y: 300 },
    width: 220,
    height: 120,
  },
  {
    id: "left",
    position: { x: 520, y: 80 },
    width: 240,
    height: 180,
  },
  {
    id: "right",
    position: { x: 470, y: 520 },
    width: 236,
    height: 150,
  },
  {
    id: "merge",
    position: { x: 900, y: 310 },
    width: 260,
    height: 210,
  },
];

const edges: LayoutEdge[] = [
  { source: "source", target: "left" },
  { source: "source", target: "right" },
  { source: "left", target: "merge" },
  { source: "right", target: "merge" },
];

function boundsCenter(
  inputs: readonly LayoutNode[],
  positions: ReadonlyMap<string, { x: number; y: number }>,
) {
  const left = Math.min(...inputs.map((node) => positions.get(node.id)!.x));
  const top = Math.min(...inputs.map((node) => positions.get(node.id)!.y));
  const right = Math.max(...inputs.map((node) => positions.get(node.id)!.x + node.width));
  const bottom = Math.max(...inputs.map((node) => positions.get(node.id)!.y + node.height));
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

function overlaps(
  left: LayoutNode,
  right: LayoutNode,
  positions: ReadonlyMap<string, { x: number; y: number }>,
) {
  const a = positions.get(left.id)!;
  const b = positions.get(right.id)!;
  return !(
    a.x + left.width <= b.x ||
    b.x + right.width <= a.x ||
    a.y + left.height <= b.y ||
    b.y + right.height <= a.y
  );
}

describe("tidy node layout", () => {
  it("lays out a branching graph left-to-right without overlap", () => {
    const positions = tidyNodeLayout(nodes, edges);

    expect(positions.get("source")!.x).toBeLessThan(positions.get("left")!.x);
    expect(positions.get("left")!.x).toBeLessThan(positions.get("merge")!.x);
    expect(positions.get("right")!.x).toBeLessThan(positions.get("merge")!.x);
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        expect(overlaps(nodes[left], nodes[right], positions)).toBe(false);
      }
    }
  });

  it("is deterministic and ignores edges outside the supplied nodes", () => {
    const first = tidyNodeLayout(nodes, [...edges, { source: "outside", target: "merge" }]);
    const reordered = tidyNodeLayout([...nodes].reverse(), [...edges].reverse());

    expect(Object.fromEntries(first)).toEqual(Object.fromEntries(reordered));
  });

  it("preserves the visual center of the arranged nodes", () => {
    const originalPositions = new Map(nodes.map((node) => [node.id, node.position]));
    const positions = tidyNodeLayout(nodes, edges);
    const before = boundsCenter(nodes, originalPositions);
    const after = boundsCenter(nodes, positions);

    expect(after.x).toBeCloseTo(before.x, 8);
    expect(after.y).toBeCloseTo(before.y, 8);
  });

  it("can tidy a cyclic draft deterministically", () => {
    const cycleEdges = [
      { source: "left", target: "right" },
      { source: "right", target: "left" },
    ];

    expect(() => tidyNodeLayout(nodes.slice(1, 3), cycleEdges)).not.toThrow();
    expect(Object.fromEntries(tidyNodeLayout(nodes.slice(1, 3), cycleEdges))).toEqual(
      Object.fromEntries(tidyNodeLayout(nodes.slice(1, 3).reverse(), cycleEdges.reverse())),
    );
  });

  it("lays out wire bundles as multiplex and demultiplex routing nodes", () => {
    const tiedEdges = edges.slice(2).map((edge, index) => ({ ...edge, id: `edge-${index}` }));
    const result = tidyGraphLayout(nodes, tiedEdges, [
      { id: "bundle", edgeIds: tiedEdges.map((edge) => edge.id) },
    ]);
    const waypoints = result.wireBundleWaypoints.get("bundle")!;
    const sourceRight = Math.max(
      result.nodePositions.get("left")!.x + nodes[1].width,
      result.nodePositions.get("right")!.x + nodes[2].width,
    );
    const targetLeft = result.nodePositions.get("merge")!.x;

    expect(waypoints[0].x).toBeGreaterThan(sourceRight);
    expect(waypoints[0].x).toBeLessThan(waypoints[1].x);
    expect(waypoints[1].x).toBeLessThan(targetLeft);
  });

  it("lays out tied graphs deterministically and ignores partial ties", () => {
    const tiedEdges = edges.map((edge, index) => ({ ...edge, id: `edge-${index}` }));
    const tie = { id: "bundle", edgeIds: tiedEdges.map((edge) => edge.id) };
    const first = tidyGraphLayout(nodes, tiedEdges, [tie]);
    const reordered = tidyGraphLayout([...nodes].reverse(), [...tiedEdges].reverse(), [tie]);
    const partial = tidyGraphLayout(nodes.slice(0, 3), tiedEdges, [tie]);

    expect(Object.fromEntries(first.nodePositions)).toEqual(
      Object.fromEntries(reordered.nodePositions),
    );
    expect(Object.fromEntries(first.wireBundleWaypoints)).toEqual(
      Object.fromEntries(reordered.wireBundleWaypoints),
    );
    expect(partial.wireBundleWaypoints.size).toBe(0);
  });
});
