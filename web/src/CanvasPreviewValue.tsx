import styles from "./CanvasPreviewValue.module.css";
import { moduleClassNames as cx } from "./moduleClassNames";
import { normalizePreviewValue } from "./previewModel";

export function CanvasPreviewValue({ value, stale = false }: { value: unknown; stale?: boolean }) {
  const model = normalizePreviewValue(value);
  const text = model.kind === "structured" ? model.raw : model.readableText;
  const lines = text.split("\n");
  const excerpt = lines.slice(0, 7).join("\n").slice(0, 560);
  const truncated = excerpt.length < text.length;

  return (
    <div className={cx(styles, "canvas-preview-value", stale && "is-stale")}>
      <header>
        <span>{model.shapeLabel}</span>
        {stale && <em>prior run</em>}
      </header>
      <pre>{truncated ? `${excerpt}…` : excerpt}</pre>
    </div>
  );
}
