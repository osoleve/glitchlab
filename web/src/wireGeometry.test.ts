import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import type { WireBundle, WireBundleMembership } from "./types";
import { bundleTrunkPath, solveBundleRoute, wireBundleOrder, wireGeometry } from "./wireGeometry";

const bundle: WireBundle = {
  id: "bundle-a",
  edgeIds: ["a", "b", "c"],
  ties: [
    { x: 100, y: 80 },
    { x: 220, y: 80 },
  ],
};

function membership(tie: WireBundle, edgeIndex: number, edgeCount: number): WireBundleMembership {
  return { bundle: tie, edgeIndex, edgeCount, ownsHandles: edgeIndex === 0 };
}

describe("wire bundle geometry", () => {
  it("routes bundle members in stable parallel lanes between the tie pair", () => {
    const top = wireGeometry({ x: 0, y: 20 }, { x: 320, y: 20 }, Position.Right, Position.Left, [
      membership(bundle, 0, 3),
    ]);
    const middle = wireGeometry({ x: 0, y: 80 }, { x: 320, y: 80 }, Position.Right, Position.Left, [
      membership(bundle, 1, 3),
    ]);
    expect(top.bundles[0].laneTies[0].y).toBeLessThan(middle.bundles[0].laneTies[0].y);
    expect(middle.bundles[0].laneTies).toEqual(bundle.ties);
    expect(middle.path).toContain("L 220.00,80.00");
    expect(bundleTrunkPath(bundle)).toBe("M 100.00,80.00 L 220.00,80.00");
  });

  it("lerps through every tie pair on the wire in order along its length", () => {
    const late: WireBundle = {
      id: "bundle-late",
      edgeIds: ["a", "b"],
      ties: [
        { x: 400, y: 60 },
        { x: 500, y: 60 },
      ],
    };
    const geometry = wireGeometry(
      { x: 0, y: 80 },
      { x: 620, y: 60 },
      Position.Right,
      Position.Left,
      [membership(late, 0, 2), membership(bundle, 1, 3)],
    );
    expect(geometry.bundles.map((entry) => entry.bundle.id)).toEqual(["bundle-a", "bundle-late"]);
    const trunkRuns = geometry.path.match(/L /g) ?? [];
    expect(trunkRuns).toHaveLength(2);
    expect(geometry.path.indexOf("100.00,80.00")).toBeLessThan(geometry.path.indexOf("400.00"));
    expect(geometry.path.endsWith("620.00,60.00")).toBe(true);
  });

  it("keeps bezier controls inside small gaps between tie pairs", () => {
    const near: WireBundle = {
      id: "bundle-near",
      edgeIds: ["a", "b"],
      ties: [
        { x: 240, y: 80 },
        { x: 320, y: 80 },
      ],
    };
    const geometry = wireGeometry(
      { x: 0, y: 80 },
      { x: 420, y: 80 },
      Position.Right,
      Position.Left,
      [membership(bundle, 0, 2), membership(near, 0, 2)],
    );
    const controls = [...geometry.path.matchAll(/C ([\d.-]+),[\d.-]+ ([\d.-]+),[\d.-]+/g)];
    const between = controls[1];
    expect(Number(between[1])).toBeGreaterThan(220);
    expect(Number(between[2])).toBeLessThan(240);
  });

  it("sorts tie pairs by their position along the wire", () => {
    const early: WireBundle = {
      id: "z-early",
      edgeIds: ["a", "b"],
      ties: [
        { x: 40, y: 100 },
        { x: 80, y: 100 },
      ],
    };
    const sorted = solveBundleRoute({ x: 0, y: 80 }, { x: 320, y: 80 }, [
      { bundle },
      { bundle: early },
    ]).map(({ item }) => item);
    expect(sorted.map((entry) => entry.bundle.id)).toEqual(["z-early", "bundle-a"]);
  });

  it("solves tie order and orientation together instead of trusting stored endpoint order", () => {
    const reversedEarly: WireBundle = {
      id: "reversed-early",
      edgeIds: ["a", "b"],
      ties: [
        { x: 120, y: 80 },
        { x: 60, y: 80 },
      ],
    };
    const late: WireBundle = {
      id: "late",
      edgeIds: ["a", "b"],
      ties: [
        { x: 220, y: 80 },
        { x: 280, y: 80 },
      ],
    };
    const route = solveBundleRoute({ x: 0, y: 80 }, { x: 340, y: 80 }, [
      { bundle: late },
      { bundle: reversedEarly },
    ]);

    expect(route.map(({ item }) => item.bundle.id)).toEqual(["reversed-early", "late"]);
    expect(route[0].ties).toEqual([
      { x: 60, y: 80 },
      { x: 120, y: 80 },
    ]);

    const geometry = wireGeometry(
      { x: 0, y: 80 },
      { x: 340, y: 80 },
      Position.Right,
      Position.Left,
      [membership(late, 0, 1), membership(reversedEarly, 0, 1)],
    );
    expect(geometry.bundles.map(({ bundle: routed }) => routed.id)).toEqual([
      "reversed-early",
      "late",
    ]);
    expect(geometry.bundles[0].laneTies).toEqual([
      { x: 60, y: 80 },
      { x: 120, y: 80 },
    ]);
    expect(geometry.path).toContain("L 120.00,80.00 C 144.00,80.00");
  });

  it("orders bundle lanes by their input-side targets", () => {
    expect(
      wireBundleOrder(bundle, [
        { edgeId: "a", source: { x: 0, y: 0 }, target: { x: 320, y: 120 } },
        { edgeId: "b", source: { x: 0, y: 200 }, target: { x: 320, y: 80 } },
        { edgeId: "c", source: { x: 0, y: 100 }, target: { x: 320, y: 40 } },
      ]),
    ).toEqual(["c", "b", "a"]);
  });
});
