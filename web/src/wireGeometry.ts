import { Position } from "@xyflow/react";
import type { FlowPosition, WireBundle, WireBundleMembership } from "./types";

export interface WireTieGeometry {
  bundle: WireBundle;
  laneTies: [FlowPosition, FlowPosition];
}

export interface WireGeometry {
  path: string;
  bundles: WireTieGeometry[];
}

export interface WireEndpoints {
  edgeId: string;
  source: FlowPosition;
  target: FlowPosition;
}

interface TrunkAnchor {
  start: FlowPosition;
  end: FlowPosition;
  unit: FlowPosition;
  trunkLength: number;
}

function trunkVector(bundle: WireBundle): { dx: number; dy: number; length: number } {
  const [start, end] = bundle.ties;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return { dx, dy, length: Math.max(1, Math.hypot(dx, dy)) };
}

export function wireBundleOrder(bundle: WireBundle, endpoints: readonly WireEndpoints[]): string[] {
  const byEdgeId = new Map(endpoints.map((endpoint) => [endpoint.edgeId, endpoint]));
  if (bundle.edgeIds.some((edgeId) => !byEdgeId.has(edgeId))) return [...bundle.edgeIds];

  const { dx, dy, length } = trunkVector(bundle);
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

export function wireBundleTieAngle(bundle: WireBundle): number {
  const { dx, dy } = trunkVector(bundle);
  return (Math.atan2(dy, dx) * 180) / Math.PI + 90;
}

export function bundleTrunkPath(bundle: WireBundle): string {
  const [start, end] = bundle.ties;
  return `M ${point(start)} L ${point(end)}`;
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

function distance(from: FlowPosition, to: FlowPosition): number {
  return Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
}

function laneTies(
  bundle: WireBundle,
  edgeIndex: number,
  edgeCount: number,
): [FlowPosition, FlowPosition] {
  const spacing = edgeCount > 7 ? 4 : 5.5;
  const offset = (edgeIndex - (edgeCount - 1) / 2) * spacing;
  const { dx, dy, length } = trunkVector(bundle);
  const shift = { x: (-dy / length) * offset, y: (dx / length) * offset };
  const [start, end] = bundle.ties;
  return [
    { x: start.x + shift.x, y: start.y + shift.y },
    { x: end.x + shift.x, y: end.y + shift.y },
  ];
}

export function sortBundlesAlongWire<T extends { bundle: WireBundle }>(
  source: FlowPosition,
  target: FlowPosition,
  memberships: readonly T[],
): T[] {
  const direction = { x: target.x - source.x, y: target.y - source.y };
  const along = (bundle: WireBundle) => {
    const mid = {
      x: (bundle.ties[0].x + bundle.ties[1].x) / 2,
      y: (bundle.ties[0].y + bundle.ties[1].y) / 2,
    };
    return (mid.x - source.x) * direction.x + (mid.y - source.y) * direction.y;
  };
  return [...memberships].sort(
    (left, right) =>
      along(left.bundle) - along(right.bundle) || left.bundle.id.localeCompare(right.bundle.id),
  );
}

function trunkLead(trunkLength: number, gap: number): number {
  return Math.min(58, Math.max(24, trunkLength * 0.22), gap * 0.45);
}

function endpointLead(gap: number): number {
  return Math.min(90, Math.max(34, gap * 0.32), gap * 0.5);
}

export function wireGeometry(
  source: FlowPosition,
  target: FlowPosition,
  sourcePosition: Position,
  targetPosition: Position,
  memberships: readonly WireBundleMembership[],
): WireGeometry {
  const ordered = sortBundlesAlongWire(source, target, memberships);
  const bundles: WireTieGeometry[] = ordered.map((membership) => ({
    bundle: membership.bundle,
    laneTies: laneTies(membership.bundle, membership.edgeIndex, membership.edgeCount),
  }));
  const anchors: TrunkAnchor[] = bundles.map((entry) => {
    const { dx, dy, length } = trunkVector(entry.bundle);
    return {
      start: entry.laneTies[0],
      end: entry.laneTies[1],
      unit: { x: dx / length, y: dy / length },
      trunkLength: length,
    };
  });

  const commands = [`M ${point(source)}`];
  anchors.forEach((anchor, index) => {
    const previous = anchors[index - 1];
    const from = previous?.end ?? source;
    const gap = distance(from, anchor.start);
    const exitLead = previous ? trunkLead(previous.trunkLength, gap) : 0;
    const exitControl = previous
      ? { x: from.x + previous.unit.x * exitLead, y: from.y + previous.unit.y * exitLead }
      : outwardControl(source, sourcePosition, endpointLead(gap));
    const entryLead = trunkLead(anchor.trunkLength, gap);
    const entryControl = {
      x: anchor.start.x - anchor.unit.x * entryLead,
      y: anchor.start.y - anchor.unit.y * entryLead,
    };
    commands.push(
      `C ${point(exitControl)} ${point(entryControl)} ${point(anchor.start)}`,
      `L ${point(anchor.end)}`,
    );
  });
  const last = anchors.at(-1);
  if (last) {
    const gap = distance(last.end, target);
    const exitLead = trunkLead(last.trunkLength, gap);
    const exitControl = {
      x: last.end.x + last.unit.x * exitLead,
      y: last.end.y + last.unit.y * exitLead,
    };
    commands.push(
      `C ${point(exitControl)} ${point(outwardControl(target, targetPosition, endpointLead(gap)))} ${point(target)}`,
    );
  }

  return { path: commands.join(" "), bundles };
}
