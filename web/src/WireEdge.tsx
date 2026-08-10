import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  EdgeToolbar,
  getBezierPath,
  getSmoothStepPath,
  type InternalNode,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { Cable, Plus, Scissors, Trash2, Unlink2 } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useGraphDocumentStore } from "./stores/graphDocumentStore";
import { pauseGraphHistory, resumeGraphHistory } from "./stores/graphHistory";
import type { FlowPosition, WireBundle, WireColor, WirePresentation, WorkflowEdge } from "./types";
import styles from "./WireEdge.module.css";
import { WIRE_COLOR_OPTIONS } from "./wireAppearance";
import { bundleTrunkPath, wireBundleOrder, wireBundleTieAngle, wireGeometry } from "./wireGeometry";

interface TieDragState {
  pointerId: number;
  bundleId: string;
  tieIndex: number;
  initial: FlowPosition;
  latest: FlowPosition;
  moved: boolean;
}

interface TrunkDragState {
  pointerId: number;
  bundleId: string;
  latestPointer: FlowPosition;
  totalDelta: FlowPosition;
  moved: boolean;
}

function handleCenter(
  node: InternalNode | undefined,
  handleId: string | null | undefined,
  type: "source" | "target",
): FlowPosition | undefined {
  if (!node) return undefined;
  const handles = node.internals.handleBounds?.[type] ?? [];
  const handle =
    handles.find((candidate) => (candidate.id ?? null) === (handleId ?? null)) ?? handles[0];
  if (handle) {
    return {
      x: node.internals.positionAbsolute.x + handle.x + handle.width / 2,
      y: node.internals.positionAbsolute.y + handle.y + handle.height / 2,
    };
  }
  return {
    x: node.internals.positionAbsolute.x + (node.measured.width ?? 0) / 2,
    y: node.internals.positionAbsolute.y + (node.measured.height ?? 0) / 2,
  };
}

function useSelectedWireBundleId(): string | undefined {
  return useGraphDocumentStore((state) =>
    state.selectionKind === "bundle" ? state.selectedWireBundleId : undefined,
  );
}

function WireBundleTie({
  bundle,
  tieIndex,
  selected,
}: {
  bundle: WireBundle;
  tieIndex: number;
  selected: boolean;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const moveWireBundleTie = useGraphDocumentStore((state) => state.moveWireBundleTie);
  const selectWireBundle = useGraphDocumentStore((state) => state.selectWireBundle);
  const snipWireBundle = useGraphDocumentStore((state) => state.snipWireBundle);
  const drag = useRef<TieDragState | undefined>(undefined);
  const removeDragListeners = useRef<(() => void) | undefined>(undefined);
  const position = bundle.ties[tieIndex];
  const angle = wireBundleTieAngle(bundle);

  useEffect(
    () => () => {
      removeDragListeners.current?.();
      if (drag.current) resumeGraphHistory();
    },
    [],
  );

  const finishDrag = () => {
    const current = drag.current;
    if (!current) return;
    if (current.moved) {
      moveWireBundleTie(current.bundleId, current.tieIndex, current.initial);
    }
    resumeGraphHistory();
    if (current.moved) {
      moveWireBundleTie(current.bundleId, current.tieIndex, current.latest);
    } else {
      selectWireBundle(current.bundleId);
    }
    drag.current = undefined;
    removeDragListeners.current?.();
    removeDragListeners.current = undefined;
  };

  return (
    <button
      type="button"
      className={`${styles.tieHandle} ${selected ? styles.tieHandleSelected : ""} nodrag nopan`}
      style={{
        transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px) rotate(${angle}deg)`,
      }}
      aria-label={`Move tie ${tieIndex + 1} of the pair around ${bundle.edgeIds.length} wires`}
      title="Drag to move this tie; click to select the pair"
      data-flow-x={position.x}
      data-flow-y={position.y}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        pauseGraphHistory();
        drag.current = {
          pointerId: event.pointerId,
          bundleId: bundle.id,
          tieIndex,
          initial: { ...position },
          latest: { ...position },
          moved: false,
        };
        const move = (pointerEvent: PointerEvent) => {
          if (drag.current?.pointerId !== pointerEvent.pointerId) return;
          const next = screenToFlowPosition({ x: pointerEvent.clientX, y: pointerEvent.clientY });
          drag.current.latest = next;
          drag.current.moved = true;
          moveWireBundleTie(bundle.id, tieIndex, next);
        };
        const finish = (pointerEvent: PointerEvent) => {
          if (drag.current?.pointerId !== pointerEvent.pointerId) return;
          finishDrag();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
        removeDragListeners.current = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", finish);
        };
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectWireBundle(bundle.id);
          return;
        }
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          snipWireBundle(bundle.id);
          return;
        }
        const delta = event.shiftKey ? 1 : 8;
        const movement =
          event.key === "ArrowLeft"
            ? { x: -delta, y: 0 }
            : event.key === "ArrowRight"
              ? { x: delta, y: 0 }
              : event.key === "ArrowUp"
                ? { x: 0, y: -delta }
                : event.key === "ArrowDown"
                  ? { x: 0, y: delta }
                  : undefined;
        if (!movement) return;
        event.preventDefault();
        moveWireBundleTie(bundle.id, tieIndex, {
          x: position.x + movement.x,
          y: position.y + movement.y,
        });
      }}
    >
      <span aria-hidden="true" />
    </button>
  );
}

function BundleTrunk({ bundle, selected }: { bundle: WireBundle; selected: boolean }) {
  const { screenToFlowPosition } = useReactFlow();
  const translateWireBundle = useGraphDocumentStore((state) => state.translateWireBundle);
  const selectWireBundle = useGraphDocumentStore((state) => state.selectWireBundle);
  const drag = useRef<TrunkDragState | undefined>(undefined);
  const removeDragListeners = useRef<(() => void) | undefined>(undefined);
  const path = bundleTrunkPath(bundle);

  useEffect(
    () => () => {
      removeDragListeners.current?.();
      if (drag.current) resumeGraphHistory();
    },
    [],
  );

  const finishDrag = () => {
    const current = drag.current;
    if (!current) return;
    if (current.moved) {
      translateWireBundle(current.bundleId, {
        x: -current.totalDelta.x,
        y: -current.totalDelta.y,
      });
    }
    resumeGraphHistory();
    if (current.moved) translateWireBundle(current.bundleId, current.totalDelta);
    else selectWireBundle(current.bundleId);
    drag.current = undefined;
    removeDragListeners.current?.();
    removeDragListeners.current = undefined;
  };

  return (
    <>
      {selected && <path d={path} className={styles.bundleTrunkSelected} />}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the SVG trunk is a pointer-drag target; the paired tie buttons provide keyboard controls */}
      <path
        d={path}
        className={`${styles.bundleTrunkHitArea} nodrag nopan`}
        onClick={(event) => {
          // The trunk lives inside a member edge's group; swallow the click so
          // interacting with the tie pair never selects the wire under it.
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          const pointer = screenToFlowPosition({ x: event.clientX, y: event.clientY });
          pauseGraphHistory();
          drag.current = {
            pointerId: event.pointerId,
            bundleId: bundle.id,
            latestPointer: pointer,
            totalDelta: { x: 0, y: 0 },
            moved: false,
          };
          const move = (pointerEvent: PointerEvent) => {
            const current = drag.current;
            if (!current || current.pointerId !== pointerEvent.pointerId) return;
            const next = screenToFlowPosition({ x: pointerEvent.clientX, y: pointerEvent.clientY });
            const delta = {
              x: next.x - current.latestPointer.x,
              y: next.y - current.latestPointer.y,
            };
            current.latestPointer = next;
            current.totalDelta = {
              x: current.totalDelta.x + delta.x,
              y: current.totalDelta.y + delta.y,
            };
            current.moved = true;
            translateWireBundle(bundle.id, delta);
          };
          const finish = (pointerEvent: PointerEvent) => {
            if (drag.current?.pointerId !== pointerEvent.pointerId) return;
            finishDrag();
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", finish);
          window.addEventListener("pointercancel", finish);
          removeDragListeners.current = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", finish);
            window.removeEventListener("pointercancel", finish);
          };
        }}
      />
    </>
  );
}

export function WireEdge(props: EdgeProps<WorkflowEdge>) {
  const memberships = props.data?.bundles ?? [];
  const dynamicIndexKey = useStore((state) =>
    memberships
      .map((membership) => {
        const endpoints = membership.bundle.edgeIds.flatMap((edgeId) => {
          const edge = state.edgeLookup.get(edgeId);
          if (!edge) return [];
          const source = handleCenter(
            state.nodeLookup.get(edge.source),
            edge.sourceHandle,
            "source",
          );
          const target = handleCenter(
            state.nodeLookup.get(edge.target),
            edge.targetHandle,
            "target",
          );
          return source && target ? [{ edgeId, source, target }] : [];
        });
        return wireBundleOrder(membership.bundle, endpoints).indexOf(props.id);
      })
      .join(","),
  );
  const selectedBundleId = useSelectedWireBundleId();
  const dynamicIndexes = dynamicIndexKey === "" ? [] : dynamicIndexKey.split(",").map(Number);
  const resolved = memberships.map((membership, index) => {
    const dynamicIndex = dynamicIndexes[index] ?? -1;
    return dynamicIndex >= 0 ? { ...membership, edgeIndex: dynamicIndex } : membership;
  });
  const geometry =
    resolved.length > 0
      ? wireGeometry(
          { x: props.sourceX, y: props.sourceY },
          { x: props.targetX, y: props.targetY },
          props.sourcePosition,
          props.targetPosition,
          resolved,
        )
      : undefined;
  const regularPath =
    props.data?.routing === "bezier" ? getBezierPath(props)[0] : getSmoothStepPath(props)[0];
  const path = geometry?.path ?? regularPath;
  const color = props.data?.wireColorValue ?? "#8f8796";
  const owned = resolved.filter((membership) => membership.ownsHandles);

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerStart={props.markerStart}
        markerEnd={props.markerEnd}
        style={{ ...props.style, stroke: color }}
        interactionWidth={props.interactionWidth ?? 24}
      />
      {props.animated && <path d={path} className={styles.transferOverlay} />}
      {owned.map((membership) => (
        <BundleTrunk
          key={membership.bundle.id}
          bundle={membership.bundle}
          selected={membership.bundle.id === selectedBundleId}
        />
      ))}
      {owned.length > 0 && (
        <EdgeLabelRenderer>
          {owned.map((membership) => (
            <Fragment key={membership.bundle.id}>
              <WireBundleTie
                bundle={membership.bundle}
                tieIndex={0}
                selected={membership.bundle.id === selectedBundleId}
              />
              <WireBundleTie
                bundle={membership.bundle}
                tieIndex={1}
                selected={membership.bundle.id === selectedBundleId}
              />
              <span
                className={styles.bundleCount}
                style={{
                  transform: `translate(-50%, -50%) translate(${membership.bundle.ties[0].x}px, ${membership.bundle.ties[0].y}px)`,
                }}
              >
                ×{membership.edgeCount}
              </span>
            </Fragment>
          ))}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

interface EdgeSamples {
  start: FlowPosition;
  middle: FlowPosition;
  end: FlowPosition;
}

interface PathTieSample {
  middle: FlowPosition;
  direction: FlowPosition;
  halfSpan: number;
}

function closestPathLength(path: SVGPathElement, anchor: FlowPosition, length: number): number {
  const steps = Math.max(24, Math.min(120, Math.ceil(length / 12)));
  let bestLength = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= steps; index += 1) {
    const candidateLength = (length * index) / steps;
    const point = path.getPointAtLength(candidateLength);
    const distance = (point.x - anchor.x) ** 2 + (point.y - anchor.y) ** 2;
    if (distance < bestDistance) {
      bestLength = candidateLength;
      bestDistance = distance;
    }
  }

  let left = Math.max(0, bestLength - length / steps);
  let right = Math.min(length, bestLength + length / steps);
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const first = left + (right - left) / 3;
    const second = right - (right - left) / 3;
    const firstPoint = path.getPointAtLength(first);
    const secondPoint = path.getPointAtLength(second);
    const firstDistance = (firstPoint.x - anchor.x) ** 2 + (firstPoint.y - anchor.y) ** 2;
    const secondDistance = (secondPoint.x - anchor.x) ** 2 + (secondPoint.y - anchor.y) ** 2;
    if (firstDistance <= secondDistance) right = second;
    else left = first;
  }
  return (left + right) / 2;
}

function sampleSelectedEdges(
  edgeIds: string[],
  selectionAnchor?: FlowPosition,
): EdgeSamples | undefined {
  const samples = edgeIds.flatMap((edgeId): PathTieSample[] => {
    const edge = [...document.querySelectorAll<SVGGElement>(".react-flow__edge")].find(
      (element) => element.dataset.id === edgeId,
    );
    const path = edge?.querySelector<SVGPathElement>(".react-flow__edge-path");
    if (!path) return [];
    const length = path.getTotalLength();
    if (!Number.isFinite(length) || length <= 0) return [];
    const desiredCenter = selectionAnchor
      ? closestPathLength(path, selectionAnchor, length)
      : length / 2;
    const endpointMargin = Math.min(14, length * 0.06);
    const halfSpan = Math.min(54, Math.max(22, length * 0.055), (length - endpointMargin * 2) / 2);
    const center = Math.min(
      length - endpointMargin - halfSpan,
      Math.max(endpointMargin + halfSpan, desiredCenter),
    );
    const start = path.getPointAtLength(center - halfSpan);
    const middle = path.getPointAtLength(center);
    const end = path.getPointAtLength(center + halfSpan);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const segmentLength = Math.max(1, Math.hypot(dx, dy));
    return [{ middle, direction: { x: dx / segmentLength, y: dy / segmentLength }, halfSpan }];
  });
  if (samples.length !== edgeIds.length) return undefined;
  const middle = {
    x: samples.reduce((sum, sample) => sum + sample.middle.x, 0) / samples.length,
    y: samples.reduce((sum, sample) => sum + sample.middle.y, 0) / samples.length,
  };
  const directionSum = {
    x: samples.reduce((sum, sample) => sum + sample.direction.x, 0),
    y: samples.reduce((sum, sample) => sum + sample.direction.y, 0),
  };
  const directionLength = Math.hypot(directionSum.x, directionSum.y);
  const direction =
    directionLength > 0.001
      ? { x: directionSum.x / directionLength, y: directionSum.y / directionLength }
      : samples[0].direction;
  const halfSpan = samples.reduce((sum, sample) => sum + sample.halfSpan, 0) / samples.length;
  return {
    start: {
      x: middle.x - direction.x * halfSpan,
      y: middle.y - direction.y * halfSpan,
    },
    middle,
    end: {
      x: middle.x + direction.x * halfSpan,
      y: middle.y + direction.y * halfSpan,
    },
  };
}

export function SelectedBundleToolbar({
  edges,
  wireBundles,
  disabled,
}: {
  edges: WorkflowEdge[];
  wireBundles: WireBundle[];
  disabled: boolean;
}) {
  const selectedBundleId = useSelectedWireBundleId();
  const snipWireBundle = useGraphDocumentStore((state) => state.snipWireBundle);
  const bundle = wireBundles.find((candidate) => candidate.id === selectedBundleId);
  const anchorEdge =
    bundle &&
    edges.find((edge) =>
      edge.data?.bundles?.some((membership) => membership.bundle.id === bundle.id),
    );
  if (!bundle || !anchorEdge) return null;
  // Anchor below the lower tie so the toolbar never covers the trunk or the
  // tie handles while the pair is selected.
  const anchor = {
    x: (bundle.ties[0].x + bundle.ties[1].x) / 2,
    y: Math.max(bundle.ties[0].y, bundle.ties[1].y) + 26,
  };

  return (
    <EdgeToolbar
      edgeId={anchorEdge.id}
      x={anchor.x}
      y={anchor.y}
      isVisible
      alignY="top"
      className={styles.edgeToolbar}
      style={{ zIndex: 8 }}
      aria-label="Selected tie pair actions"
    >
      <span className={styles.edgeCount}>tie pair · {bundle.edgeIds.length} wires</span>
      <button type="button" disabled={disabled} onClick={() => snipWireBundle(bundle.id)}>
        <Scissors size={13} />
        Snip
      </button>
    </EdgeToolbar>
  );
}

export function SelectedWiresToolbar({
  edges,
  wires,
  wireBundles,
  selectionAnchor,
  disabled,
  onBundle,
  onAddToBundle,
  onRemoveFromBundle,
  onSetColor,
  onRemove,
}: {
  edges: WorkflowEdge[];
  wires: WirePresentation[];
  wireBundles: WireBundle[];
  selectionAnchor?: FlowPosition;
  disabled: boolean;
  onBundle: (edgeIds: string[], start: FlowPosition, end: FlowPosition) => void;
  onAddToBundle: (bundleId: string, edgeIds: string[]) => void;
  onRemoveFromBundle: (bundleId: string, edgeIds: string[]) => void;
  onSetColor: (edgeIds: string[], color?: WireColor) => void;
  onRemove: (edgeIds: string[]) => void;
}) {
  const edgeIds = useMemo(
    () =>
      edges.filter((edge) => edge.selected && !edge.data?.presentationProxy).map((edge) => edge.id),
    [edges],
  );
  const [samples, setSamples] = useState<EdgeSamples>();

  useLayoutEffect(() => {
    if (edgeIds.length === 0) {
      setSamples(undefined);
      return;
    }
    setSamples(sampleSelectedEdges(edgeIds, selectionAnchor));
  }, [edgeIds, selectionAnchor]);

  if (edgeIds.length === 0 || !samples) return null;
  const containingBundles = wireBundles.filter((bundle) =>
    edgeIds.every((edgeId) => bundle.edgeIds.includes(edgeId)),
  );
  const intersectingBundles = wireBundles.filter((bundle) =>
    edgeIds.some((edgeId) => bundle.edgeIds.includes(edgeId)),
  );
  const pullTarget = containingBundles.length === 1 ? containingBundles[0] : undefined;
  const addTarget =
    intersectingBundles.length === 1 &&
    edgeIds.some((edgeId) => !intersectingBundles[0].edgeIds.includes(edgeId))
      ? intersectingBundles[0]
      : undefined;
  const overrides = edgeIds.map(
    (edgeId) => wires.find((wire) => wire.edgeId === edgeId)?.color ?? "auto",
  );
  const commonColor = overrides.every((color) => color === overrides[0]) ? overrides[0] : "mixed";

  return (
    <EdgeToolbar
      edgeId={edgeIds[0]}
      x={samples.middle.x}
      y={samples.middle.y}
      isVisible
      alignY="bottom"
      className={styles.edgeToolbar}
      style={{ zIndex: 8 }}
      aria-label="Selected wire actions"
    >
      <span className={styles.edgeCount}>
        {edgeIds.length} wire{edgeIds.length === 1 ? "" : "s"}
      </span>
      <label className={styles.colorPicker}>
        <span>Color</span>
        <select
          aria-label="Wire color"
          value={commonColor}
          disabled={disabled}
          onChange={(event) => {
            const color = event.target.value;
            if (color === "mixed") return;
            onSetColor(edgeIds, color === "auto" ? undefined : (color as WireColor));
          }}
        >
          {commonColor === "mixed" && <option value="mixed">Mixed</option>}
          <option value="auto">By type</option>
          {WIRE_COLOR_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={disabled || edgeIds.length < 2}
        onClick={() => {
          const current = sampleSelectedEdges(edgeIds, selectionAnchor) ?? samples;
          onBundle(edgeIds, current.start, current.end);
        }}
      >
        <Cable size={13} />
        Tie
      </button>
      {addTarget && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAddToBundle(addTarget.id, edgeIds)}
        >
          <Plus size={13} />
          Add to tie
        </button>
      )}
      {pullTarget && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onRemoveFromBundle(pullTarget.id, edgeIds)}
        >
          <Unlink2 size={13} />
          Pull from tie
        </button>
      )}
      <button type="button" disabled={disabled} onClick={() => onRemove(edgeIds)}>
        <Trash2 size={13} />
        Remove
      </button>
    </EdgeToolbar>
  );
}
