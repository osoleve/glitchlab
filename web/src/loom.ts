import type {
  GraphNodeSpec,
  GraphSpec,
  LoomEntry,
  LoomRunReference,
  LoomState,
  RunResponse,
} from "./types";

type CreateId = () => string;
type Now = () => string;

export interface LoomBranch {
  entry: LoomEntry;
  children: LoomBranch[];
}

export interface LoomTokenChoice {
  token: string;
  logprob: number;
}

export interface LoomTokenProbe {
  choices: LoomTokenChoice[];
  completion: Record<string, unknown>;
  run: LoomRunReference;
}

const defaultId: CreateId = () => crypto.randomUUID();
const defaultNow: Now = () => new Date().toISOString();

export function createLoomState(createId: CreateId = defaultId, now: Now = defaultNow): LoomState {
  const rootId = createId();
  return {
    kind: "loom",
    version: 1,
    selected_id: rootId,
    entries: [
      {
        id: rootId,
        parent_id: null,
        text: "",
        source: "human",
        created_at: now(),
      },
    ],
  };
}

export function loomEntry(state: LoomState, entryId: string): LoomEntry {
  const entry = state.entries.find((candidate) => candidate.id === entryId);
  if (!entry) throw new Error(`Loom entry ${entryId} does not exist.`);
  return entry;
}

export function loomPath(state: LoomState, entryId = state.selected_id): LoomEntry[] {
  const byId = new Map(state.entries.map((entry) => [entry.id, entry]));
  const path: LoomEntry[] = [];
  const visited = new Set<string>();
  let current = byId.get(entryId);
  while (current) {
    if (visited.has(current.id)) throw new Error("The Loom contains a cycle.");
    visited.add(current.id);
    path.push(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  if (path.length === 0 || path.at(-1)?.parent_id) {
    throw new Error(`Loom entry ${entryId} is disconnected from its root.`);
  }
  return path.reverse();
}

export function loomTree(state: LoomState): LoomBranch {
  const children = new Map<string | null, LoomEntry[]>();
  for (const entry of state.entries) {
    const parentId = entry.parent_id ?? null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(entry);
    children.set(parentId, siblings);
  }
  const roots = children.get(null) ?? [];
  if (roots.length !== 1) throw new Error("A Loom must contain exactly one root entry.");
  const branch = (entry: LoomEntry): LoomBranch => ({
    entry,
    children: (children.get(entry.id) ?? []).map(branch),
  });
  return branch(roots[0]!);
}

export function selectedLoomSegment(state: LoomState): string {
  return loomEntry(state, state.selected_id).text;
}

export function selectedLoomText(state: LoomState): string {
  return loomPath(state)
    .map((entry) => entry.text)
    .join("");
}

export function selectLoomEntry(state: LoomState, entryId: string): LoomState {
  loomEntry(state, entryId);
  return { ...state, selected_id: entryId };
}

export function updateLoomEntryText(
  state: LoomState,
  entryId: string,
  text: string,
  now: Now = defaultNow,
): LoomState {
  loomEntry(state, entryId);
  return {
    ...state,
    entries: state.entries.map((entry) =>
      entry.id === entryId
        ? { ...entry, text, source: "edited" as const, updated_at: now() }
        : entry,
    ),
  };
}

export function appendLoomEntry(
  state: LoomState,
  text: string,
  options: {
    parentId?: string;
    source?: LoomEntry["source"];
    completion?: Record<string, unknown>;
    run?: LoomRunReference;
    createId?: CreateId;
    now?: Now;
  } = {},
): LoomState {
  const parentId = options.parentId ?? state.selected_id;
  loomEntry(state, parentId);
  const id = (options.createId ?? defaultId)();
  const entry: LoomEntry = {
    id,
    parent_id: parentId,
    text,
    source: options.source ?? "human",
    created_at: (options.now ?? defaultNow)(),
    ...(options.completion ? { completion: options.completion } : {}),
    ...(options.run ? { run: options.run } : {}),
  };
  return { ...state, selected_id: id, entries: [...state.entries, entry] };
}

function uniqueNodeId(graph: GraphSpec, prefix: string): string {
  const ids = new Set(graph.nodes.map((node) => node.id));
  let suffix = 0;
  let candidate = prefix;
  while (ids.has(candidate)) {
    suffix += 1;
    candidate = `${prefix}-${suffix}`;
  }
  return candidate;
}

export function buildLoomGenerationGraph(
  graph: GraphSpec,
  loomNodeId: string,
  state: LoomState,
  candidateOffset = 0,
): GraphSpec {
  const target = graph.nodes.find((node) => node.id === loomNodeId);
  if (target?.kind !== "loom") {
    throw new Error(`Node ${loomNodeId} is not a Loom node.`);
  }
  const promptNodeId = uniqueNodeId(graph, `${loomNodeId}-prompt`);
  const configuredSeed = target.config.seed;
  const config = {
    ...target.config,
    ...(typeof configuredSeed === "number" ? { seed: configuredSeed + candidateOffset } : {}),
  };
  const completionNode: GraphNodeSpec = {
    ...target,
    kind: "completion",
    config,
  };
  delete completionNode.state;
  const promptNode: GraphNodeSpec = {
    id: promptNodeId,
    kind: "text_input",
    title: "Loom branch prompt",
    config: { text: selectedLoomText(state) },
    control_ports: {},
    position: { x: target.position.x - 280, y: target.position.y + 160 },
  };
  return {
    ...graph,
    name: `${graph.name} · Loom branch`,
    nodes: graph.nodes
      .map((node) => (node.id === loomNodeId ? completionNode : node))
      .concat(promptNode),
    edges: [
      ...graph.edges,
      {
        id: `${promptNodeId}-to-${loomNodeId}`,
        source: promptNodeId,
        source_port: "text",
        target: loomNodeId,
        target_port: "prompt",
      },
    ],
  };
}

export function buildLoomTokenProbeGraph(
  graph: GraphSpec,
  loomNodeId: string,
  state: LoomState,
): GraphSpec {
  const transient = buildLoomGenerationGraph(graph, loomNodeId, state);
  return {
    ...transient,
    name: `${graph.name} · Loom next tokens`,
    nodes: transient.nodes.map((candidate) => {
      if (candidate.id !== loomNodeId) return candidate;
      const extraBody =
        typeof candidate.config.extra_body === "object" &&
        candidate.config.extra_body !== null &&
        !Array.isArray(candidate.config.extra_body)
          ? candidate.config.extra_body
          : {};
      return {
        ...candidate,
        config: {
          ...candidate.config,
          max_tokens: 1,
          logprobs: 10,
          stop: "",
          extra_body: {
            ...extraBody,
            max_tokens: 1,
            logprobs: 10,
            stop: [],
          },
        },
      };
    }),
  };
}

export function generatedLoomEntry(
  response: RunResponse,
  nodeId: string,
): { text: string; completion: Record<string, unknown>; run: LoomRunReference } {
  const node = response.nodes.find((candidate) => candidate.node_id === nodeId);
  const result = node?.outputs.result;
  if (
    !node ||
    typeof result !== "object" ||
    result === null ||
    Array.isArray(result) ||
    typeof (result as Record<string, unknown>).text !== "string"
  ) {
    throw new Error("The Loom generation completed without a text result.");
  }
  const completion = result as Record<string, unknown> & { text: string };
  return {
    text: completion.text,
    completion: { ...completion },
    run: {
      run_id: response.manifest.run_id,
      graph_digest: response.manifest.graph_digest,
      finished_at: response.manifest.finished_at,
    },
  };
}

export function generatedLoomTokenProbe(response: RunResponse, nodeId: string): LoomTokenProbe {
  const generated = generatedLoomEntry(response, nodeId);
  const logprobs = generated.completion.logprobs;
  if (typeof logprobs !== "object" || logprobs === null || Array.isArray(logprobs)) {
    throw new Error("The completion endpoint did not return next-token log probabilities.");
  }
  const rows = (logprobs as Record<string, unknown>).top_logprobs;
  const first = Array.isArray(rows) ? rows[0] : undefined;
  if (typeof first !== "object" || first === null || Array.isArray(first)) {
    throw new Error("The completion endpoint returned no next-token alternatives.");
  }
  const choices = Object.entries(first)
    .filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]),
    )
    .map(([token, logprob]) => ({ token, logprob }))
    .sort((left, right) => right.logprob - left.logprob)
    .slice(0, 10);
  if (choices.length === 0) {
    throw new Error("The completion endpoint returned no usable next-token alternatives.");
  }
  return { choices, completion: generated.completion, run: generated.run };
}
