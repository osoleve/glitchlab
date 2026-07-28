import { Check, Copy, FileJson2, Text } from "lucide-react";
import { useState } from "react";

type JsonRecord = Record<string, unknown>;

interface CompletionEntry {
  text: string;
  model?: string;
  modelRevision?: string;
  finishReason?: string;
  usage?: JsonRecord;
  latencyMs?: number;
  cacheHit?: boolean;
  seed?: string;
  prompt?: string;
  parameters?: JsonRecord;
  choiceIndex?: number;
}

interface TextEntry {
  text: string;
  label?: string;
  seed?: string;
  input?: string;
}

const OUTPUT_WRAPPERS = new Set(["value", "result", "items", "text", "output"]);

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function unwrapOutput(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!isRecord(current)) break;
    const keys = Object.keys(current);
    if (keys.length !== 1 || !OUTPUT_WRAPPERS.has(keys[0])) break;
    current = current[keys[0]];
  }
  return current;
}

function usageRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function parametersRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function cacheHit(value: unknown): boolean | undefined {
  if (!isRecord(value) || typeof value.hit !== "boolean") return undefined;
  return value.hit;
}

function normalizedCompletion(value: JsonRecord): CompletionEntry | undefined {
  const text = typeof value.text === "string" ? value.text : undefined;
  const completionSignals =
    value.kind === "completion_result" ||
    "finish_reason" in value ||
    "usage" in value ||
    "parameters" in value ||
    "request_id" in value ||
    "cache" in value;
  if (text === undefined || !completionSignals) return undefined;

  const parameters = parametersRecord(value.parameters);
  return {
    text,
    model: asString(value.model),
    modelRevision: asString(value.model_revision),
    finishReason: asString(value.finish_reason),
    usage: usageRecord(value.usage),
    latencyMs: asNumber(value.latency_ms),
    cacheHit: cacheHit(value.cache),
    seed:
      parameters?.seed === undefined || parameters.seed === null
        ? undefined
        : String(parameters.seed),
    prompt: typeof value.prompt === "string" ? value.prompt : undefined,
    parameters,
  };
}

function rawCompletionResponse(value: JsonRecord): CompletionEntry[] | undefined {
  if (!Array.isArray(value.choices)) return undefined;
  const usage = usageRecord(value.usage);
  const parameters = parametersRecord(value.parameters);
  const latencyMs =
    asNumber(value.latency_ms) ??
    (asNumber(value.elapsed_seconds) === undefined
      ? undefined
      : (asNumber(value.elapsed_seconds) as number) * 1000);
  const entries = value.choices.flatMap((choice, fallbackIndex) => {
    if (!isRecord(choice) || typeof choice.text !== "string") return [];
    return [
      {
        text: choice.text,
        model: asString(value.model),
        modelRevision:
          asString(value.model_revision) ?? asString(value.system_fingerprint),
        finishReason: asString(choice.finish_reason),
        usage,
        latencyMs,
        cacheHit: cacheHit(value.cache),
        seed:
          parameters?.seed === undefined || parameters.seed === null
            ? undefined
            : String(parameters.seed),
        prompt: typeof value.prompt === "string" ? value.prompt : undefined,
        parameters,
        choiceIndex: asNumber(choice.index) ?? fallbackIndex,
      } satisfies CompletionEntry,
    ];
  });
  return entries.length > 0 ? entries : undefined;
}

function completionEntries(value: unknown): CompletionEntry[] | undefined {
  const unwrapped = unwrapOutput(value);
  if (isRecord(unwrapped)) {
    const normalized = normalizedCompletion(unwrapped);
    if (normalized) return [normalized];
    return rawCompletionResponse(unwrapped);
  }
  if (!Array.isArray(unwrapped) || unwrapped.length === 0) return undefined;
  const groups = unwrapped.map((item) => completionEntries(item));
  if (groups.some((group) => group === undefined)) return undefined;
  return groups.flatMap((group) => group ?? []);
}

function textEntry(value: unknown): TextEntry | undefined {
  if (typeof value === "string") return { text: value };
  if (!isRecord(value)) return undefined;
  if (value.kind === "corruption_result" && typeof value.output === "string") {
    const spec = isRecord(value.spec) ? value.spec : undefined;
    return {
      text: value.output,
      label: asString(spec?.name) ?? "Corrupted text",
      seed: value.seed === undefined ? undefined : String(value.seed),
      input: typeof value.input === "string" ? value.input : undefined,
    };
  }
  if (typeof value.text === "string" && Object.keys(value).length === 1) {
    return { text: value.text };
  }
  return undefined;
}

function textEntries(value: unknown): TextEntry[] | undefined {
  const unwrapped = unwrapOutput(value);
  const single = textEntry(unwrapped);
  if (single) return [single];
  if (!Array.isArray(unwrapped) || unwrapped.length === 0) return undefined;
  const entries = unwrapped.map((item) => textEntry(unwrapOutput(item)));
  return entries.every((entry) => entry !== undefined)
    ? (entries as TextEntry[])
    : undefined;
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

function jsonText(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  return serialized === undefined ? String(value) : serialized;
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
          <span>
            {label ?? (total > 1 ? `Completion ${index + 1}` : "Completion")}
          </span>
          <strong>{entry.model ?? "Model response"}</strong>
        </div>
        {entry.choiceIndex !== undefined && (
          <code>choice {entry.choiceIndex}</code>
        )}
      </header>
      <div className="preview-tags">
        {entry.finishReason && (
          <span title="Finish reason">{entry.finishReason}</span>
        )}
        {tokens && <span title="Token usage">{tokens}</span>}
        {latency && <span title="Request latency">{latency}</span>}
        {entry.cacheHit !== undefined && (
          <span className={entry.cacheHit ? "is-hit" : "is-miss"}>
            {entry.cacheHit ? "cache hit" : "fresh"}
          </span>
        )}
        {entry.seed && <span title="Sampling seed">seed {entry.seed}</span>}
        {entry.modelRevision && (
          <span title={entry.modelRevision}>
            rev {entry.modelRevision.slice(0, 9)}
          </span>
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

export function PreviewValue({
  value,
  itemLabels,
}: {
  value: unknown;
  itemLabels?: string[];
}) {
  const [copied, setCopied] = useState<"text" | "json">();
  const completions = completionEntries(value);
  const texts = completions ? undefined : textEntries(value);
  const raw = jsonText(value);
  const readableText = completions
    ? completions.map((entry) => entry.text).join("\n\n")
    : texts?.map((entry) => entry.text).join("\n\n");
  const itemCount = completions?.length ?? texts?.length;
  const labels =
    itemLabels && itemLabels.length === itemCount ? itemLabels : undefined;
  const shapeLabel = completions
    ? `${itemCount} completion${itemCount === 1 ? "" : "s"}`
    : texts
      ? `${itemCount} text item${itemCount === 1 ? "" : "s"}`
      : Array.isArray(unwrapOutput(value))
        ? `${(unwrapOutput(value) as unknown[]).length} items`
        : "Structured value";

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
          {shapeLabel}
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
            onClick={() => copy("json", raw)}
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
      {!completions && !texts && <pre className="json-preview">{raw}</pre>}

      {(completions || texts) && (
        <details className="raw-data-details">
          <summary>Raw data</summary>
          <pre className="json-preview">{raw}</pre>
        </details>
      )}
    </div>
  );
}
