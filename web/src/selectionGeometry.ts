import type { FlowPosition } from "./types";

export interface SelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function selectionRect(start: FlowPosition, end: FlowPosition): SelectionRect {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
}

export function rectsIntersect(left: SelectionRect, right: SelectionRect): boolean {
  return !(
    left.right < right.left ||
    left.left > right.right ||
    left.bottom < right.top ||
    left.top > right.bottom
  );
}

function pointInside(point: FlowPosition, rect: SelectionRect): boolean {
  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  );
}

function orientation(a: FlowPosition, b: FlowPosition, c: FlowPosition): number {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function onSegment(a: FlowPosition, b: FlowPosition, point: FlowPosition): boolean {
  return (
    point.x >= Math.min(a.x, b.x) &&
    point.x <= Math.max(a.x, b.x) &&
    point.y >= Math.min(a.y, b.y) &&
    point.y <= Math.max(a.y, b.y)
  );
}

function segmentsIntersect(
  a: FlowPosition,
  b: FlowPosition,
  c: FlowPosition,
  d: FlowPosition,
): boolean {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  if (first === 0 && onSegment(a, b, c)) return true;
  if (second === 0 && onSegment(a, b, d)) return true;
  if (third === 0 && onSegment(c, d, a)) return true;
  if (fourth === 0 && onSegment(c, d, b)) return true;
  return first > 0 !== second > 0 && third > 0 !== fourth > 0;
}

export function segmentIntersectsRect(
  start: FlowPosition,
  end: FlowPosition,
  rect: SelectionRect,
): boolean {
  if (pointInside(start, rect) || pointInside(end, rect)) return true;
  const topLeft = { x: rect.left, y: rect.top };
  const topRight = { x: rect.right, y: rect.top };
  const bottomRight = { x: rect.right, y: rect.bottom };
  const bottomLeft = { x: rect.left, y: rect.bottom };
  return (
    segmentsIntersect(start, end, topLeft, topRight) ||
    segmentsIntersect(start, end, topRight, bottomRight) ||
    segmentsIntersect(start, end, bottomRight, bottomLeft) ||
    segmentsIntersect(start, end, bottomLeft, topLeft)
  );
}

export function polylineIntersectsRect(
  points: readonly FlowPosition[],
  rect: SelectionRect,
): boolean {
  if (points.length === 1) return pointInside(points[0], rect);
  for (let index = 1; index < points.length; index += 1) {
    if (segmentIntersectsRect(points[index - 1], points[index], rect)) return true;
  }
  return false;
}

export function pathPoints(path: SVGPathElement, spacing = 8): FlowPosition[] {
  const length = path.getTotalLength();
  if (!Number.isFinite(length) || length <= 0) return [];
  const sampleCount = Math.max(2, Math.ceil(length / spacing));
  return Array.from({ length: sampleCount + 1 }, (_value, index) =>
    path.getPointAtLength((length * index) / sampleCount),
  );
}
