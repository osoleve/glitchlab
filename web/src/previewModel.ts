export type JsonRecord = Record<string, unknown>;

export interface CompletionEntry {
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

export interface TextEntry {
  text: string;
  label?: string;
  seed?: string;
  input?: string;
}

export type PreviewModel =
  | {
      kind: "completion";
      entries: CompletionEntry[];
      raw: string;
      readableText: string;
      shapeLabel: string;
    }
  | {
      kind: "text";
      entries: TextEntry[];
      raw: string;
      readableText: string;
      shapeLabel: string;
    }
  | {
      kind: "structured";
      raw: string;
      shapeLabel: string;
    };

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

function asSeed(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

export function unwrapOutput(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!isRecord(current)) break;
    const keys = Object.keys(current);
    if (keys.length !== 1 || !OUTPUT_WRAPPERS.has(keys[0])) break;
    current = current[keys[0]];
  }
  return current;
}

function record(value: unknown): JsonRecord | undefined {
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

  const parameters = record(value.parameters);
  return {
    text,
    model: asString(value.model),
    modelRevision: asString(value.model_revision),
    finishReason: asString(value.finish_reason),
    usage: record(value.usage),
    latencyMs: asNumber(value.latency_ms),
    cacheHit: cacheHit(value.cache),
    seed: asSeed(parameters?.seed),
    prompt: typeof value.prompt === "string" ? value.prompt : undefined,
    parameters,
  };
}

function rawCompletionResponse(value: JsonRecord): CompletionEntry[] | undefined {
  if (!Array.isArray(value.choices)) return undefined;
  const usage = record(value.usage);
  const parameters = record(value.parameters);
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
        modelRevision: asString(value.model_revision) ?? asString(value.system_fingerprint),
        finishReason: asString(choice.finish_reason),
        usage,
        latencyMs,
        cacheHit: cacheHit(value.cache),
        seed: asSeed(choice.seed) ?? asSeed(parameters?.seed),
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
    const spec = record(value.spec);
    return {
      text: value.output,
      label: asString(spec?.name) ?? "Corrupted text",
      seed: asSeed(value.seed),
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
  return entries.every((entry) => entry !== undefined) ? (entries as TextEntry[]) : undefined;
}

export function jsonText(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  return serialized === undefined ? String(value) : serialized;
}

export function normalizePreviewValue(value: unknown): PreviewModel {
  const raw = jsonText(value);
  const completions = completionEntries(value);
  if (completions) {
    return {
      kind: "completion",
      entries: completions,
      raw,
      readableText: completions.map((entry) => entry.text).join("\n\n"),
      shapeLabel: `${completions.length} completion${completions.length === 1 ? "" : "s"}`,
    };
  }

  const texts = textEntries(value);
  if (texts) {
    return {
      kind: "text",
      entries: texts,
      raw,
      readableText: texts.map((entry) => entry.text).join("\n\n"),
      shapeLabel: `${texts.length} text item${texts.length === 1 ? "" : "s"}`,
    };
  }

  const unwrapped = unwrapOutput(value);
  return {
    kind: "structured",
    raw,
    shapeLabel: Array.isArray(unwrapped) ? `${unwrapped.length} items` : "Structured value",
  };
}
