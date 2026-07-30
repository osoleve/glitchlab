import { Check, Copy, FileJson2, Text } from "lucide-react";
import { useState } from "react";
import {
  type CompletionEntry,
  type JsonRecord,
  jsonText,
  normalizePreviewValue,
  type TextEntry,
} from "./previewModel";

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function tokenSummary(usage?: JsonRecord): string | undefined {
  if (!usage) return undefined;
  const prompt = asNumber(usage.prompt_tokens);
  const completion = asNumber(usage.completion_tokens);
  const total = asNumber(usage.total_tokens);
  if (completion !== undefined && total !== undefined) {
    return `${completion} generated · ${total} total`;
  }
  if (completion !== undefined && prompt !== undefined) {
    return `${completion} generated · ${prompt} prompt`;
  }
  if (completion !== undefined) return `${completion} generated`;
  if (total !== undefined) return `${total} tokens`;
  return undefined;
}

function latencySummary(latencyMs?: number): string | undefined {
  if (latencyMs === undefined) return undefined;
  return latencyMs >= 1000
    ? `${(latencyMs / 1000).toFixed(latencyMs >= 10_000 ? 1 : 2)} s`
    : `${Math.round(latencyMs)} ms`;
}

function CompletionCard({
  entry,
  index,
  total,
  label,
}: {
  entry: CompletionEntry;
  index: number;
  total: number;
  label?: string;
}) {
  const tokens = tokenSummary(entry.usage);
  const latency = latencySummary(entry.latencyMs);
  const hasRequestDetails = entry.prompt !== undefined || entry.parameters !== undefined;
  return (
    <article className="completion-card">
      <header className="completion-card-heading">
        <div>
          <span>{label ?? (total > 1 ? `Completion ${index + 1}` : "Completion")}</span>
          <strong>{entry.model ?? "Model response"}</strong>
        </div>
        {entry.choiceIndex !== undefined && <code>choice {entry.choiceIndex}</code>}
      </header>
      <div className="preview-tags">
        {entry.finishReason && <span title="Finish reason">{entry.finishReason}</span>}
        {tokens && <span title="Token usage">{tokens}</span>}
        {latency && <span title="Request latency">{latency}</span>}
        {entry.cacheHit !== undefined && (
          <span className={entry.cacheHit ? "is-hit" : "is-miss"}>
            {entry.cacheHit ? "cache hit" : "fresh"}
          </span>
        )}
        {entry.seed && <span title="Sampling seed">seed {entry.seed}</span>}
        {entry.modelRevision && (
          <span title={entry.modelRevision}>rev {entry.modelRevision.slice(0, 9)}</span>
        )}
      </div>
      <pre className="preview-text">{entry.text}</pre>
      {hasRequestDetails && (
        <details className="preview-details">
          <summary>Request details</summary>
          {entry.prompt !== undefined && (
            <>
              <span className="preview-detail-label">Prompt</span>
              <pre className="preview-prompt">{entry.prompt}</pre>
            </>
          )}
          {entry.parameters !== undefined && (
            <>
              <span className="preview-detail-label">Parameters</span>
              <pre className="preview-parameters">{jsonText(entry.parameters)}</pre>
            </>
          )}
        </details>
      )}
    </article>
  );
}

function TextCard({
  entry,
  index,
  total,
  label,
}: {
  entry: TextEntry;
  index: number;
  total: number;
  label?: string;
}) {
  return (
    <article className="text-preview-card">
      {(total > 1 || entry.label || entry.seed) && (
        <header>
          <strong>{label ?? entry.label ?? `Item ${index + 1}`}</strong>
          {entry.seed && <span>seed {entry.seed}</span>}
        </header>
      )}
      <pre className="preview-text">{entry.text}</pre>
      {entry.input !== undefined && (
        <details className="preview-details">
          <summary>Original text</summary>
          <pre className="preview-prompt">{entry.input}</pre>
        </details>
      )}
    </article>
  );
}

export function PreviewValue({ value, itemLabels }: { value: unknown; itemLabels?: string[] }) {
  const [copied, setCopied] = useState<"text" | "json">();
  const model = normalizePreviewValue(value);
  const completions = model.kind === "completion" ? model.entries : undefined;
  const texts = model.kind === "text" ? model.entries : undefined;
  const readableText = model.kind === "structured" ? undefined : model.readableText;
  const itemCount = model.kind === "structured" ? undefined : model.entries.length;
  const labels = itemLabels && itemLabels.length === itemCount ? itemLabels : undefined;

  const copy = (kind: "text" | "json", content: string) => {
    void navigator.clipboard.writeText(content);
    setCopied(kind);
    window.setTimeout(() => setCopied(undefined), 1200);
  };

  return (
    <div className="preview-value">
      <div className="preview-toolbar">
        <span className="preview-shape">
          {completions || texts ? <Text size={13} /> : <FileJson2 size={13} />}
          {model.shapeLabel}
        </span>
        <div className="preview-actions">
          {readableText !== undefined && (
            <button
              type="button"
              className="preview-copy-button"
              onClick={() => copy("text", readableText)}
              aria-label="Copy readable text"
              title="Copy readable text"
            >
              {copied === "text" ? <Check size={13} /> : <Copy size={13} />}
              Text
            </button>
          )}
          <button
            type="button"
            className="preview-copy-button"
            onClick={() => copy("json", model.raw)}
            aria-label="Copy raw JSON"
            title="Copy raw JSON"
          >
            {copied === "json" ? <Check size={13} /> : <FileJson2 size={13} />}
            JSON
          </button>
        </div>
      </div>

      {completions && (
        <div className="completion-list">
          {completions.map((entry, index) => (
            <CompletionCard
              entry={entry}
              index={index}
              total={completions.length}
              label={labels?.[index]}
              key={`${entry.model ?? "completion"}-${index}`}
            />
          ))}
        </div>
      )}
      {texts && (
        <div className="text-preview-list">
          {texts.map((entry, index) => (
            <TextCard
              entry={entry}
              index={index}
              total={texts.length}
              label={labels?.[index]}
              key={`${entry.label ?? "text"}-${index}`}
            />
          ))}
        </div>
      )}
      {!completions && !texts && <pre className="json-preview">{model.raw}</pre>}

      {(completions || texts) && (
        <details className="raw-data-details">
          <summary>Raw data</summary>
          <pre className="json-preview">{model.raw}</pre>
        </details>
      )}
    </div>
  );
}
