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

export interface SolvedBundleRoute<T extends { bundle: WireBundle }> {
  item: T;
  ties: [FlowPosition, FlowPosition];
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

function offsetLaneTies(
  ties: [FlowPosition, FlowPosition],
  edgeIndex: number,
  edgeCount: number,
): [FlowPosition, FlowPosition] {
  const spacing = edgeCount > 7 ? 4 : 5.5;
  const offset = (edgeIndex - (edgeCount - 1) / 2) * spacing;
  const dx = ties[1].x - ties[0].x;
  const dy = ties[1].y - ties[0].y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const shift = { x: (-dy / length) * offset, y: (dx / length) * offset };
  return [
    { x: ties[0].x + shift.x, y: ties[0].y + shift.y },
    { x: ties[1].x + shift.x, y: ties[1].y + shift.y },
  ];
}

interface RouteState {
  cost: number;
  key: string;
  previousMask: number;
  previousIndex: number;
  previousOrientation: number;
}

const EXACT_ROUTE_LIMIT = 10;
const ROUTE_EPSILON = 1e-6;

function orientedTies(bundle: WireBundle, orientation: number): [FlowPosition, FlowPosition] {
  return orientation === 0 ? [bundle.ties[0], bundle.ties[1]] : [bundle.ties[1], bundle.ties[0]];
}

function routeStateIsBetter(candidate: RouteState, current?: RouteState): boolean {
  if (!current) return true;
  if (candidate.cost < current.cost - ROUTE_EPSILON) return true;
  return Math.abs(candidate.cost - current.cost) <= ROUTE_EPSILON && candidate.key < current.key;
}

function greedyBundleRoute<T extends { bundle: WireBundle }>(
  source: FlowPosition,
  memberships: readonly T[],
): SolvedBundleRoute<T>[] {
  const remaining = new Set(memberships.map((_membership, index) => index));
  const route: SolvedBundleRoute<T>[] = [];
  let cursor = source;
  while (remaining.size > 0) {
    const candidates = [...remaining].flatMap((index) =>
      [0, 1].map((orientation) => {
        const ties = orientedTies(memberships[index].bundle, orientation);
        return {
          index,
          orientation,
          ties,
          cost: distance(cursor, ties[0]),
          key: `${memberships[index].bundle.id}:${orientation}`,
        };
      }),
    );
    candidates.sort((left, right) => left.cost - right.cost || left.key.localeCompare(right.key));
    const next = candidates[0];
    route.push({ item: memberships[next.index], ties: next.ties });
    remaining.delete(next.index);
    cursor = next.ties[1];
  }
  return route;
}

/**
 * Find the shortest deterministic route through undirected tie-pair segments.
 * A projection sort fails once ties are off-axis or stored in the opposite
 * direction, so solve order and orientation together.
 */
export function solveBundleRoute<T extends { bundle: WireBundle }>(
  source: FlowPosition,
  target: FlowPosition,
  memberships: readonly T[],
): SolvedBundleRoute<T>[] {
  if (memberships.length === 0) return [];
  if (memberships.length > EXACT_ROUTE_LIMIT) return greedyBundleRoute(source, memberships);

  const fullMask = (1 << memberships.length) - 1;
  const states: Array<Array<Array<RouteState | undefined>>> = Array.from(
    { length: fullMask + 1 },
    () => Array.from({ length: memberships.length }, () => [undefined, undefined]),
  );

  memberships.forEach((membership, index) => {
    for (const orientation of [0, 1]) {
      const ties = orientedTies(membership.bundle, orientation);
      states[1 << index][index][orientation] = {
        cost: distance(source, ties[0]),
        key: `${membership.bundle.id}:${orientation}`,
        previousMask: 0,
        previousIndex: -1,
        previousOrientation: 0,
      };
    }
  });

  for (let mask = 1; mask <= fullMask; mask += 1) {
    for (let index = 0; index < memberships.length; index += 1) {
      for (const orientation of [0, 1]) {
        const current = states[mask][index][orientation];
        if (!current) continue;
        const currentExit = orientedTies(memberships[index].bundle, orientation)[1];
        for (let nextIndex = 0; nextIndex < memberships.length; nextIndex += 1) {
          if ((mask & (1 << nextIndex)) !== 0) continue;
          for (const nextOrientation of [0, 1]) {
            const nextTies = orientedTies(memberships[nextIndex].bundle, nextOrientation);
            const candidate: RouteState = {
              cost: current.cost + distance(currentExit, nextTies[0]),
              key: `${current.key}|${memberships[nextIndex].bundle.id}:${nextOrientation}`,
              previousMask: mask,
              previousIndex: index,
              previousOrientation: orientation,
            };
            const nextMask = mask | (1 << nextIndex);
            if (routeStateIsBetter(candidate, states[nextMask][nextIndex][nextOrientation])) {
              states[nextMask][nextIndex][nextOrientation] = candidate;
            }
          }
        }
      }
    }
  }

  let best:
    | { state: RouteState; index: number; orientation: number; totalCost: number }
    | undefined;
  for (let index = 0; index < memberships.length; index += 1) {
    for (const orientation of [0, 1]) {
      const state = states[fullMask][index][orientation];
      if (!state) continue;
      const exit = orientedTies(memberships[index].bundle, orientation)[1];
      const totalCost = state.cost + distance(exit, target);
      if (
        !best ||
        totalCost < best.totalCost - ROUTE_EPSILON ||
        (Math.abs(totalCost - best.totalCost) <= ROUTE_EPSILON && state.key < best.state.key)
      ) {
        best = { state, index, orientation, totalCost };
      }
    }
  }

  if (!best) return [];
  const reversed: SolvedBundleRoute<T>[] = [];
  let mask = fullMask;
  let index = best.index;
  let orientation = best.orientation;
  while (mask !== 0) {
    const state = states[mask][index][orientation]!;
    reversed.push({
      item: memberships[index],
      ties: orientedTies(memberships[index].bundle, orientation),
    });
    mask = state.previousMask;
    index = state.previousIndex;
    orientation = state.previousOrientation;
  }
  return reversed.reverse();
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
  const route = solveBundleRoute(source, target, memberships);
  const bundles: WireTieGeometry[] = route.map(({ item, ties }) => ({
    bundle: item.bundle,
    laneTies: offsetLaneTies(ties, item.edgeIndex, item.edgeCount),
  }));
  const anchors: TrunkAnchor[] = bundles.map((entry) => {
    const dx = entry.laneTies[1].x - entry.laneTies[0].x;
    const dy = entry.laneTies[1].y - entry.laneTies[0].y;
    const length = Math.max(1, Math.hypot(dx, dy));
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
