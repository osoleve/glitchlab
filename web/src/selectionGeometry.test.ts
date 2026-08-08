import { describe, expect, it } from "vitest";
import { polylineIntersectsRect, rectsIntersect, selectionRect } from "./selectionGeometry";

describe("selection geometry", () => {
  it("normalizes drag direction and detects partial node overlap", () => {
    const rect = selectionRect({ x: 100, y: 80 }, { x: 20, y: 10 });
    expect(rect).toEqual({ left: 20, top: 10, right: 100, bottom: 80 });
    expect(rectsIntersect(rect, { left: 90, top: 70, right: 140, bottom: 120 })).toBe(true);
  });

  it("selects a wire when its rendered path crosses the marquee", () => {
    const rect = selectionRect({ x: 40, y: 40 }, { x: 80, y: 80 });
    expect(
      polylineIntersectsRect(
        [
          { x: 0, y: 60 },
          { x: 120, y: 60 },
        ],
        rect,
      ),
    ).toBe(true);
    expect(
      polylineIntersectsRect(
        [
          { x: 0, y: 10 },
          { x: 120, y: 10 },
        ],
        rect,
      ),
    ).toBe(false);
  });
});
