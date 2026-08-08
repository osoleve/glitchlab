import type { CSSProperties } from "react";
import styles from "./ComparePreviewValue.module.css";
import { moduleClassNames as cx } from "./moduleClassNames";
import { jsonText, normalizePreviewValue, unwrapOutput } from "./previewModel";

function asSeries(value: unknown): unknown[] {
  const unwrapped = unwrapOutput(value);
  return Array.isArray(unwrapped) ? unwrapped : [unwrapped];
}

function asSequence(value: unknown): unknown[] {
  const unwrapped = unwrapOutput(value);
  return Array.isArray(unwrapped) ? unwrapped : [unwrapped];
}

function readableValue(value: unknown): string {
  const model = normalizePreviewValue(value);
  return model.kind === "structured" ? model.raw : model.readableText;
}

function compactText(value: unknown): string {
  const text = readableValue(value);
  const lines = text.split("\n");
  const excerpt = lines.slice(0, 4).join("\n").slice(0, 260);
  return excerpt.length < text.length ? `${excerpt}…` : excerpt;
}

export function ComparePreviewValue({
  value,
  labels,
  compact = false,
  stale = false,
}: {
  value: unknown;
  labels?: string[];
  compact?: boolean;
  stale?: boolean;
}) {
  const series = asSeries(value);
  const sequences = series.map(asSequence);
  const rowCount = Math.max(0, ...sequences.map((sequence) => sequence.length));
  const resolvedLabels = series.map((_item, index) => labels?.[index] ?? `Sequence ${index + 1}`);
  const gridStyle = { "--comparison-columns": series.length } as CSSProperties;

  return (
    <section
      className={cx(styles, "comparison-preview", compact && "is-compact")}
      aria-label={`Comparison of ${series.length} sequences`}
    >
      <div className={cx(styles, "comparison-summary")}>
        <span>{series.length} sequences</span>
        <span>
          {rowCount} aligned rows{stale ? " · prior run" : ""}
        </span>
      </div>
      <div className={cx(styles, "comparison-row", "comparison-heading")} style={gridStyle}>
        <span aria-hidden="true">#</span>
        {resolvedLabels.map((label, index) => (
          <strong key={`${label}-${index}`} title={label}>
            {label}
          </strong>
        ))}
      </div>
      <div className={cx(styles, "comparison-rows")}>
        {Array.from({ length: rowCount }, (_value, rowIndex) => (
          <div className={cx(styles, "comparison-row")} style={gridStyle} key={rowIndex}>
            <span className={cx(styles, "comparison-index")}>{rowIndex + 1}</span>
            {sequences.map((sequence, seriesIndex) => {
              const item = sequence[rowIndex];
              return item === undefined ? (
                <em key={seriesIndex}>missing</em>
              ) : (
                <pre key={seriesIndex}>{compact ? compactText(item) : readableValue(item)}</pre>
              );
            })}
          </div>
        ))}
      </div>
      {!compact && (
        <details className={cx(styles, "comparison-provenance")}>
          <summary>Provenance and raw values</summary>
          <pre>{jsonText(value)}</pre>
        </details>
      )}
    </section>
  );
}
