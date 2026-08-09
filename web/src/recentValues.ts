export type RecentValueKind = "endpoint" | "model";

const STORAGE_KEY = "glitchlab.recent-node-values.v1";
const MAX_RECENT_VALUES = 8;

interface StoredRecentValues {
  endpoint: string[];
  model: string[];
}

const EMPTY_VALUES: StoredRecentValues = { endpoint: [], model: [] };

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readStoredValues(): StoredRecentValues {
  const target = storage();
  if (!target) return EMPTY_VALUES;
  try {
    const parsed = JSON.parse(target.getItem(STORAGE_KEY) ?? "null") as Partial<StoredRecentValues>;
    return {
      endpoint: Array.isArray(parsed?.endpoint)
        ? parsed.endpoint.filter((value): value is string => typeof value === "string")
        : [],
      model: Array.isArray(parsed?.model)
        ? parsed.model.filter((value): value is string => typeof value === "string")
        : [],
    };
  } catch {
    return EMPTY_VALUES;
  }
}

function isPlaceholder(kind: RecentValueKind, value: string): boolean {
  return kind === "model" && /^(?:(?:first|second)-)?model-id$/i.test(value);
}

export function loadRecentValues(kind: RecentValueKind): string[] {
  return [...readStoredValues()[kind]];
}

export function rememberRecentValue(kind: RecentValueKind, rawValue: string): string[] {
  const value = rawValue.trim();
  if (!value || isPlaceholder(kind, value)) return loadRecentValues(kind);

  const values = readStoredValues();
  const next = [value, ...values[kind].filter((candidate) => candidate !== value)].slice(
    0,
    MAX_RECENT_VALUES,
  );
  values[kind] = next;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    // Browsing with storage disabled should not make node controls unusable.
  }
  return next;
}
