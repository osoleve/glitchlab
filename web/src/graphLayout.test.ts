import { describe, expect, it } from "vitest";
import {
  type LayoutEdge,
  type LayoutFrame,
  type LayoutNode,
  tidyGraphLayout,
  tidyNodeLayout,
} from "./graphLayout";

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
  it("lays out a branching graph left-to-right without overlap", async () => {
    const positions = await tidyNodeLayout(nodes, edges);

    expect(positions.get("source")!.x).toBeLessThan(positions.get("left")!.x);
    expect(positions.get("left")!.x).toBeLessThan(positions.get("merge")!.x);
    expect(positions.get("right")!.x).toBeLessThan(positions.get("merge")!.x);
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        expect(overlaps(nodes[left], nodes[right], positions)).toBe(false);
      }
    }
  });

  it("is deterministic and ignores edges outside the supplied nodes", async () => {
    const first = await tidyNodeLayout(nodes, [...edges, { source: "outside", target: "merge" }]);
    const reordered = await tidyNodeLayout([...nodes].reverse(), [...edges].reverse());

    expect(Object.fromEntries(first)).toEqual(Object.fromEntries(reordered));
  });

  it("preserves the visual center of the arranged nodes", async () => {
    const originalPositions = new Map(nodes.map((node) => [node.id, node.position]));
    const positions = await tidyNodeLayout(nodes, edges);
    const before = boundsCenter(nodes, originalPositions);
    const after = boundsCenter(nodes, positions);

    expect(after.x).toBeCloseTo(before.x, 8);
    expect(after.y).toBeCloseTo(before.y, 8);
  });

  it("can tidy a cyclic draft deterministically", async () => {
    const cycleEdges = [
      { source: "left", target: "right" },
      { source: "right", target: "left" },
    ];

    await expect(tidyNodeLayout(nodes.slice(1, 3), cycleEdges)).resolves.toBeDefined();
    expect(Object.fromEntries(await tidyNodeLayout(nodes.slice(1, 3), cycleEdges))).toEqual(
      Object.fromEntries(await tidyNodeLayout(nodes.slice(1, 3).reverse(), cycleEdges.reverse())),
    );
  });

  it("moves a tie pair with the nodes while keeping it between its members", async () => {
    const tiedEdges = edges.slice(2).map((edge, index) => ({ ...edge, id: `edge-${index}` }));
    const ties: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 800, y: 300 },
      { x: 860, y: 300 },
    ];
    const result = await tidyGraphLayout(nodes, tiedEdges, [
      { id: "bundle", edgeIds: tiedEdges.map((edge) => edge.id), ties },
    ]);
    const movedTies = result.wireBundleTies.get("bundle")!;

    expect(movedTies).not.toEqual(ties);
    expect(result.nodePositions.get("left")!.x + nodes[1].width).toBeLessThan(movedTies[0].x);
    expect(result.nodePositions.get("right")!.x + nodes[2].width).toBeLessThan(movedTies[0].x);
    expect(result.nodePositions.get("merge")!.x).toBeGreaterThan(movedTies[1].x);
  });

  it("chains a wire through several tie pairs in placement order", async () => {
    const parallelNodes = [nodes[0], nodes[3]];
    const parallelEdges = [
      { id: "wire-a", source: "source", target: "merge" },
      { id: "wire-b", source: "source", target: "merge" },
    ];
    const first = {
      id: "tie-1",
      edgeIds: ["wire-a", "wire-b"],
      ties: [
        { x: 480, y: 320 },
        { x: 540, y: 320 },
      ] as [{ x: number; y: number }, { x: number; y: number }],
    };
    const second = {
      id: "tie-2",
      edgeIds: ["wire-a", "wire-b"],
      ties: [
        { x: 680, y: 320 },
        { x: 740, y: 320 },
      ] as [{ x: number; y: number }, { x: number; y: number }],
    };
    const result = await tidyGraphLayout(parallelNodes, parallelEdges, [second, first]);
    const movedFirst = result.wireBundleTies.get(first.id)!;
    const movedSecond = result.wireBundleTies.get(second.id)!;
    const midpoint = (ties: [{ x: number; y: number }, { x: number; y: number }]) =>
      (ties[0].x + ties[1].x) / 2;

    expect(result.nodePositions.get("source")!.x + nodes[0].width).toBeLessThan(movedFirst[0].x);
    expect(midpoint(movedFirst)).toBeLessThan(midpoint(movedSecond));
    expect(result.nodePositions.get("merge")!.x).toBeGreaterThan(movedSecond[1].x);
  });

  it("lays out tied graphs deterministically, honoring ties on partial member sets", async () => {
    const tiedEdges = edges.map((edge, index) => ({ ...edge, id: `edge-${index}` }));
    const tie = {
      id: "bundle",
      edgeIds: tiedEdges.map((edge) => edge.id),
      ties: [
        { x: 800, y: 300 },
        { x: 860, y: 300 },
      ] as [{ x: number; y: number }, { x: number; y: number }],
    };
    const first = await tidyGraphLayout(nodes, tiedEdges, [tie]);
    const reordered = await tidyGraphLayout([...nodes].reverse(), [...tiedEdges].reverse(), [tie]);
    const partial = await tidyGraphLayout(nodes.slice(0, 3), tiedEdges, [tie]);

    expect(Object.fromEntries(first.nodePositions)).toEqual(
      Object.fromEntries(reordered.nodePositions),
    );
    expect(Object.fromEntries(first.wireBundleTies)).toEqual(
      Object.fromEntries(reordered.wireBundleTies),
    );
    expect([...partial.nodePositions.keys()].sort()).toEqual(["left", "right", "source"]);
    expect([...partial.wireBundleTies.keys()]).toEqual(["bundle"]);
  });

  it("lays out frame children locally and treats the sized frame as an outer supernode", async () => {
    const compoundNodes: LayoutNode[] = [
      { ...nodes[0], id: "before" },
      { ...nodes[1], id: "inside-a", parentId: "frame" },
      { ...nodes[2], id: "inside-b", parentId: "frame" },
      { ...nodes[3], id: "after" },
    ];
    const frame: LayoutFrame = {
      id: "frame",
      position: { x: 440, y: 180 },
      width: 420,
      height: 260,
      collapsed: false,
    };
    const result = await tidyGraphLayout(
      compoundNodes,
      [
        { source: "before", target: "inside-a" },
        { source: "inside-a", target: "inside-b" },
        { source: "inside-b", target: "after" },
      ],
      [],
      [frame],
    );
    const framePosition = result.framePositions.get(frame.id)!;
    const frameSize = result.frameSizes.get(frame.id)!;
    const before = result.nodePositions.get("before")!;
    const insideA = result.nodePositions.get("inside-a")!;
    const insideB = result.nodePositions.get("inside-b")!;
    const after = result.nodePositions.get("after")!;

    expect(before.x + compoundNodes[0].width).toBeLessThan(framePosition.x);
    expect(framePosition.x + frameSize.width).toBeLessThan(after.x);
    expect(insideA.x).toBeGreaterThanOrEqual(28);
    expect(insideA.y).toBeGreaterThanOrEqual(62);
    expect(insideA.x).toBeLessThan(insideB.x);
    expect(insideB.x + compoundNodes[2].width).toBeLessThanOrEqual(frameSize.width - 28);
  });

  it("keeps a mixed-source fan-in tie inside its targets' frame", async () => {
    const compoundNodes: LayoutNode[] = [
      { ...nodes[0], id: "external-endpoint" },
      { ...nodes[1], id: "external-prompt" },
      { ...nodes[2], id: "internal-model", parentId: "frame" },
      { ...nodes[3], id: "internal-completion", parentId: "frame" },
    ];
    const frame: LayoutFrame = {
      id: "frame",
      position: { x: 440, y: 180 },
      width: 520,
      height: 360,
      collapsed: false,
    };
    const fanInEdges = [
      { id: "endpoint-input", source: "external-endpoint", target: "internal-completion" },
      { id: "model-input", source: "internal-model", target: "internal-completion" },
      { id: "prompt-input", source: "external-prompt", target: "internal-completion" },
    ];
    const result = await tidyGraphLayout(
      compoundNodes,
      fanInEdges,
      [
        {
          id: "fan-in",
          edgeIds: fanInEdges.map((edge) => edge.id),
          ties: [
            { x: 700, y: 400 },
            { x: 760, y: 400 },
          ],
        },
      ],
      [frame],
    );
    const frameSize = result.frameSizes.get(frame.id)!;
    const framePosition = result.framePositions.get(frame.id)!;
    const model = result.nodePositions.get("internal-model")!;
    const completion = result.nodePositions.get("internal-completion")!;
    const movedTies = result.wireBundleTies.get("fan-in")!;

    expect(result.framePositions.has(frame.id)).toBe(true);
    expect(model.x).toBeLessThan(completion.x);
    expect(model.x).toBeGreaterThanOrEqual(28);
    expect(completion.x + compoundNodes[3].width).toBeLessThanOrEqual(frameSize.width - 28);
    for (const tie of movedTies) {
      expect(tie.x).toBeGreaterThan(framePosition.x);
      expect(tie.x).toBeLessThan(framePosition.x + frameSize.width);
      expect(tie.y).toBeGreaterThan(framePosition.y);
      expect(tie.y).toBeLessThan(framePosition.y + frameSize.height);
    }
  });

  it("treats a collapsed frame as a leaf while preserving child positions", async () => {
    const child = { ...nodes[1], id: "inside", parentId: "frame" };
    const frame: LayoutFrame = {
      id: "frame",
      position: { x: 440, y: 180 },
      width: 420,
      height: 260,
      collapsed: true,
    };
    const result = await tidyGraphLayout(
      [{ ...nodes[0], id: "before" }, child, { ...nodes[3], id: "after" }],
      [
        { source: "before", target: "inside" },
        { source: "inside", target: "after" },
      ],
      [],
      [frame],
    );

    expect(result.nodePositions.has(child.id)).toBe(false);
    expect(result.framePositions.has(frame.id)).toBe(true);
    expect(result.frameSizes.has(frame.id)).toBe(false);
    expect(result.nodePositions.get("before")!.x).toBeLessThan(
      result.framePositions.get(frame.id)!.x,
    );
    expect(result.framePositions.get(frame.id)!.x + frame.width).toBeLessThan(
      result.nodePositions.get("after")!.x,
    );
  });
});
