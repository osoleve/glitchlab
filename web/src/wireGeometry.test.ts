import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import type { WireBundle } from "./types";
import { bundledWireGeometry, wireBundleForSelection, wireBundleOrder } from "./wireGeometry";

const bundle: WireBundle = {
  id: "bundle-a",
  edgeIds: ["a", "b", "c"],
  waypoints: [
    { x: 100, y: 80 },
    { x: 220, y: 80 },
  ],
  collapsed: false,
};

describe("wire bundle geometry", () => {
  it("routes bundle members in stable parallel lanes through waypoints", () => {
    const top = bundledWireGeometry(
      { x: 0, y: 20 },
      { x: 320, y: 20 },
      Position.Right,
      Position.Left,
      bundle,
      0,
      3,
    );
    const middle = bundledWireGeometry(
      { x: 0, y: 80 },
      { x: 320, y: 80 },
      Position.Right,
      Position.Left,
      bundle,
      1,
      3,
    );
    expect(top.offsetWaypoints[0].y).toBeLessThan(middle.offsetWaypoints[0].y);
    expect(middle.offsetWaypoints).toEqual(bundle.waypoints);
    expect(middle.trunkPath).toContain("M 100.00,80.00 L 220.00,80.00");
  });

  it("recognizes a bundle containing every selected wire", () => {
    expect(wireBundleForSelection([bundle], ["a", "c"])?.id).toBe("bundle-a");
    expect(wireBundleForSelection([bundle], ["a", "missing"])).toBeUndefined();
    expect(wireBundleForSelection([bundle], ["a"])).toBeUndefined();
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
