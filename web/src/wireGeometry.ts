import { Position } from "@xyflow/react";
import type { FlowPosition, WireBundle } from "./types";

export interface BundledWireGeometry {
  path: string;
  trunkPath: string;
  offsetWaypoints: FlowPosition[];
}

export interface WireEndpoints {
  edgeId: string;
  source: FlowPosition;
  target: FlowPosition;
}

function axis(bundle: WireBundle): { dx: number; dy: number; length: number } {
  const start = bundle.waypoints[0];
  const end = bundle.waypoints.at(-1)!;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return { dx, dy, length: Math.max(1, Math.hypot(dx, dy)) };
}

export function wireBundleOrder(bundle: WireBundle, endpoints: readonly WireEndpoints[]): string[] {
  const byEdgeId = new Map(endpoints.map((endpoint) => [endpoint.edgeId, endpoint]));
  if (bundle.edgeIds.some((edgeId) => !byEdgeId.has(edgeId))) return [...bundle.edgeIds];

  const { dx, dy, length } = axis(bundle);
  const normal = { x: -dy / length, y: dx / length };
  const projection = (position: FlowPosition) => position.x * normal.x + position.y * normal.y;

  return [...bundle.edgeIds].sort((leftId, rightId) => {
    const left = byEdgeId.get(leftId)!;
    const right = byEdgeId.get(rightId)!;
    const leftSource = projection(left.source);
    const rightSource = projection(right.source);
    const leftTarget = projection(left.target);
    const rightTarget = projection(right.target);
    return leftTarget - rightTarget || leftSource - rightSource || leftId.localeCompare(rightId);
  });
}

function outwardControl(point: FlowPosition, position: Position, distance: number): FlowPosition {
  if (position === Position.Left) return { x: point.x - distance, y: point.y };
  if (position === Position.Top) return { x: point.x, y: point.y - distance };
  if (position === Position.Bottom) return { x: point.x, y: point.y + distance };
  return { x: point.x + distance, y: point.y };
}

function point(position: FlowPosition): string {
  return `${position.x.toFixed(2)},${position.y.toFixed(2)}`;
}

function offsetBundleWaypoints(bundle: WireBundle, offset: number): FlowPosition[] {
  return bundle.waypoints.map((waypoint, index, waypoints) => {
    const previous = waypoints[Math.max(0, index - 1)];
    const next = waypoints[Math.min(waypoints.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    return {
      x: waypoint.x + (-dy / length) * offset,
      y: waypoint.y + (dx / length) * offset,
    };
  });
}

export function wireBundleWaypointAngle(bundle: WireBundle, waypointIndex: number): number {
  const previous = bundle.waypoints[Math.max(0, waypointIndex - 1)];
  const next = bundle.waypoints[Math.min(bundle.waypoints.length - 1, waypointIndex + 1)];
  return (Math.atan2(next.y - previous.y, next.x - previous.x) * 180) / Math.PI + 90;
}

export function bundledWireGeometry(
  source: FlowPosition,
  target: FlowPosition,
  sourcePosition: Position,
  targetPosition: Position,
  bundle: WireBundle,
  edgeIndex: number,
  edgeCount: number,
): BundledWireGeometry {
  const spacing = edgeCount > 7 ? 4 : 5.5;
  const offset = (edgeIndex - (edgeCount - 1) / 2) * spacing;
  const offsetWaypoints = offsetBundleWaypoints(bundle, offset);
  const bundleStart = offsetWaypoints[0];
  const bundleEnd = offsetWaypoints.at(-1)!;
  const firstNext = offsetWaypoints[1];
  const lastPrevious = offsetWaypoints.at(-2)!;
  const firstLength = Math.max(
    1,
    Math.hypot(firstNext.x - bundleStart.x, firstNext.y - bundleStart.y),
  );
  const lastLength = Math.max(
    1,
    Math.hypot(bundleEnd.x - lastPrevious.x, bundleEnd.y - lastPrevious.y),
  );
  const firstUnit = {
    x: (firstNext.x - bundleStart.x) / firstLength,
    y: (firstNext.y - bundleStart.y) / firstLength,
  };
  const lastUnit = {
    x: (bundleEnd.x - lastPrevious.x) / lastLength,
    y: (bundleEnd.y - lastPrevious.y) / lastLength,
  };
  const leadIn = Math.min(58, Math.max(24, firstLength * 0.22));
  const leadOut = Math.min(58, Math.max(24, lastLength * 0.22));
  const sourceDistance = Math.min(
    90,
    Math.max(34, Math.hypot(bundleStart.x - source.x, bundleStart.y - source.y) * 0.32),
  );
  const targetDistance = Math.min(
    90,
    Math.max(34, Math.hypot(target.x - bundleEnd.x, target.y - bundleEnd.y) * 0.32),
  );
  const sourceControl = outwardControl(source, sourcePosition, sourceDistance);
  const startControl = {
    x: bundleStart.x - firstUnit.x * leadIn,
    y: bundleStart.y - firstUnit.y * leadIn,
  };
  const endControl = {
    x: bundleEnd.x + lastUnit.x * leadOut,
    y: bundleEnd.y + lastUnit.y * leadOut,
  };
  const targetControl = outwardControl(target, targetPosition, targetDistance);
  const trunkPoints = offsetWaypoints.slice(1).map((waypoint) => `L ${point(waypoint)}`);

  return {
    path: [
      `M ${point(source)}`,
      `C ${point(sourceControl)} ${point(startControl)} ${point(bundleStart)}`,
      ...trunkPoints,
      `C ${point(endControl)} ${point(targetControl)} ${point(target)}`,
    ].join(" "),
    trunkPath: bundle.waypoints
      .map((waypoint, index) => `${index === 0 ? "M" : "L"} ${point(waypoint)}`)
      .join(" "),
    offsetWaypoints,
  };
}

export function wireBundleForSelection(
  wireBundles: readonly WireBundle[],
  edgeIds: readonly string[],
): WireBundle | undefined {
  if (edgeIds.length < 2) return undefined;
  return wireBundles.find((bundle) => edgeIds.every((edgeId) => bundle.edgeIds.includes(edgeId)));
}
