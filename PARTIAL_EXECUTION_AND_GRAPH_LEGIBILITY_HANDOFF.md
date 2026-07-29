# Partial execution and graph legibility handoff

**Prepared:** 2026-07-29
**Baseline:** Glitchloom 0.6.0, after saved looms, document tabs, expanded
context menus, and Passthrough wire insertion.

## 2026-07-29 implementation update

The partial-execution tranche described below is now implemented as Glitchloom
0.7.0:

- explicit `RunRequest` / `RunScope` envelopes and manifest scope provenance;
- deterministic single- and multi-target upstream-closure execution;
- unrelated invalid branches, cycles, and side effects excluded from target runs;
- shared frontend upstream/downstream traversal utilities with Vitest coverage;
- **Run to here**, **Run to selection**, **Select upstream**, scope fit, target
  badges, and in-scope edge/node emphasis;
- semantic execution fingerprints plus synchronous revision checks, with stale
  prior-run treatment and layout-only freshness;
- the Inspector output-tab dependency fix; and
- automated backend/frontend gates plus live 1365x768 and 1920x1080 QA.

The remaining recommended direction at that point was the deterministic
left-to-right **Tidy selection / Tidy graph** tranche under “Auto-layout and
edge legibility follow-up.” Its implementation status is recorded below.

## 2026-07-29 graph-legibility update

The recommended auto-layout tranche is now implemented:

- deterministic left-to-right Dagre layout for a selection or the complete
  graph;
- measured node sizes with stable defaults, non-overlapping ranks, and visual
  center preservation, plus an automatic full-graph refit;
- layout-only dirty-state behavior, so tidy actions persist without making
  execution results stale;
- smooth stepped wire routing and upstream/downstream path emphasis for the
  current selection, without obscuring a selected wire; and
- pure Vitest coverage for determinism, non-overlap, center preservation,
  out-of-scope edge filtering, and cyclic draft tolerance.

The next recommended direction is a small durable run-provenance tranche:
versioned success/failure envelopes and an explicit run-bundle download, as
described by `TECH_DEBT_REPORT.md:TD-05`. General resume, cancellation,
streaming status, and intermediate-node caching remain deliberately deferred.

This is the starting context for the next implementation session. The two
workstreams should be designed together: the graph traversal that determines a
partial run is also the most useful primitive for explaining and focusing a
large graph.

Recent implementation commits, oldest first:

- `9fd3c4a feat(looms): add persistent graph documents`
- `3406561 feat(ui): add saved loom document tabs`
- `98203c0 feat(canvas): expand context menu actions`
- `702d2c8 fix(looms): harden document state transitions`
- `47c007b docs: explain loom documents and canvas actions`
- `0ebbd4e chore(release): bump version to 0.6.0`

## Live/local setup

- The app is served at `http://127.0.0.1:8788`.
- The server was restarted after the 0.6.0 work and `/api/health` reported
  `version: 0.6.0`.
- `/api/catalog` reported 23 nodes including `passthrough`.
- The current live workspace is this repository root:
  `C:\Users\andre\Downloads\talkie-diachrony-main\talkie-diachrony-main\glitchloom`.
- Mutable saved looms therefore live under `.glitchloom/looms`. They are local
  runtime state, not checked-in examples.
- Preserve the workspace when restarting. In a fresh PowerShell:

  ```powershell
  $env:GLITCHLOOM_WORKSPACE = (Resolve-Path .).Path
  .\run.ps1
  ```

  `run.ps1` otherwise chooses the parent of the Glitchloom project when the
  environment variable is absent, which would make the saved-loom library and
  file-node root appear to change.

Useful startup verification:

```powershell
Invoke-RestMethod http://127.0.0.1:8788/api/health
(Invoke-RestMethod http://127.0.0.1:8788/api/catalog).nodes |
    Where-Object kind -eq "passthrough"
```

Quality gates remain:

```powershell
uv run ruff check .
uv run pytest -q

Set-Location web
npm run build
```

Meaningful canvas changes also need live checks at 1365x768 and 1920x1080.

## What is already in place

### Execution

- `glitchloom/engine.py:GraphEngine._validate_and_order()` validates typed
  ports, multiplicity, required inputs, and cycles, then returns a deterministic
  topological order plus incoming edges and terminal nodes.
- `GraphEngine.run()` executes that order sequentially, retains a
  `NodeRunResult` for every executed node, returns terminal outputs, and freezes
  the submitted graph in a reproducibility manifest.
- Failures already carry the failed node ID and all completed node results.
- Completion nodes have an exact-request content-addressed cache. This helps
  repeated partial runs, but it is not a general intermediate-node cache or a
  resume system.
- Versioned workflow nodes execute as atomic top-level nodes. Internally they
  launch a child `GraphEngine` against the pinned workflow graph and share the
  workspace, HTTP client, and workflow store.
- The API is currently `POST /api/runs` with a bare `GraphSpec`.

### Frontend run state

- `web/src/api.ts:runGraph()` serializes the current React Flow graph and posts
  it to `/api/runs`.
- `web/src/App.tsx:execute()` has a single full-run path. At submission it marks
  every node running; on success it marks returned node IDs complete; on failure
  it marks prior results complete and selects the failed node.
- `web/src/Inspector.tsx` can already display outputs from any returned
  `NodeRunResult`, not just graph-terminal nodes. This makes it usable for
  partial targets with little structural change.
- Run results are transient UI state. Saved looms persist graph structure and
  positions, not run responses.

### Legibility and graph manipulation

- Graph positions survive loom save/load through `web/src/graph.ts`.
- React Flow already provides selection, multi-selection, resizing, fit view,
  zoom controls, and a pannable/zoomable minimap.
- Nodes carry category color, port type labels, and idle/running/completed/failed
  status styling.
- Context menus already support:
  - searchable quick-add on empty canvas;
  - duplicate and delete;
  - select downstream;
  - align left/top;
  - distribute horizontally/vertically;
  - save selection as a versioned workflow;
  - split a wire with Passthrough or disconnect it.
- `App.tsx:selectDownstream()` is a working breadth-first traversal, but it is
  embedded in the component and scans all edges repeatedly. It should become a
  shared adjacency-based graph utility before partial execution is added.
- `App.tsx:nodeSize()` already uses measured node dimensions with deterministic
  defaults for alignment/distribution.

## Recommended partial-execution contract

### First semantic: run to target

The first feature should be **Run to here**, not **Run from here**.

Given one or more target node IDs, execute the union of their transitive
upstream dependencies, including the targets themselves. Preserve topological
order inside that induced subgraph.

This has predictable DAG semantics:

- a node context menu can request one target;
- a selection context menu can request several targets;
- a full run remains the existing topbar action;
- requested target nodes are the outputs of the partial run, even when one
  requested target is upstream of another requested target.

Do not initially offer “run this node alone.” Required inputs must still come
from real upstream nodes. Do not offer “run from here” until Glitchloom has an
explicit contract for retained intermediate values, their provenance, and
their invalidation.

### Request and manifest shape

Prefer an explicit request envelope rather than adding UI-only behavior:

```python
class RunScope(BaseModel):
    mode: Literal["full", "targets"] = "full"
    target_node_ids: list[str] = Field(default_factory=list)


class RunRequest(BaseModel):
    graph: GraphSpec
    scope: RunScope = Field(default_factory=RunScope)
```

Record the effective scope in `RunManifest`, including:

- mode;
- normalized requested target IDs;
- executed node IDs in deterministic order.

Keep the complete submitted graph in the manifest. Do not replace it with the
induced graph: the surrounding unfinished graph is part of what the user saw
when they initiated the run. Keep the existing full-graph digest and add scope
metadata so the same graph with different targets remains distinguishable.

For a full run, `terminal_outputs` keeps its current meaning. For a target run,
return every requested target in `terminal_outputs`, rather than only terminals
of the induced subgraph.

### Backend factoring

Add a pure, separately tested scope helper before changing the executor:

1. Build node, incoming-edge, and outgoing-edge indexes once.
2. Validate and normalize target IDs.
3. Traverse incoming edges from every target to compute the upstream closure.
4. Construct or logically filter to the induced node/edge set.
5. Pass only that scope through validation and topological ordering.

Partial execution should deliberately allow an unrelated unfinished branch to
remain incomplete. Invalidity that is outside the requested closure should not
block the run. Invalidity that feeds a requested target must still fail before
any executor side effect.

Likewise, an unrelated cycle may be ignored, while a cycle inside the requested
closure must fail. Saved looms are validated when persisted, but the in-memory
draft can temporarily be incomplete; partial execution is useful precisely in
that state.

Keep a versioned workflow node atomic in the first implementation. If it is in
the top-level closure, execute its saved child graph exactly as today. Do not
silently scope the workflow internals to output-binding nodes; that would change
the workflow's side-effect semantics.

### Side effects and caching

Only nodes in the upstream closure execute. A `write_file` node elsewhere in
the graph must not run.

A side-effect node that is itself inside the required closure will run. The UI
should make the proposed scope visible before or while executing, so this is
not surprising. A later pass may add a side-effect warning, but should not
invent skipped dependency semantics.

Completion cache behavior can remain unchanged. Deterministic transforms are
recomputed. General output memoization/resume is a separate feature because it
needs exact input, implementation-version, workflow-version, and environment
identity.

## Correctness work that belongs in the same slice

`TECH_DEBT_REPORT.md:TD-01` remains relevant: the current graph can be edited
while a run is in flight, and an older result can then be shown as current.
Partial execution makes this more visible, so do not add it without a small
stale-result envelope.

Minimum acceptable behavior:

1. Compute a semantic execution fingerprint for the submitted snapshot.
2. Exclude layout-only changes such as position from that fingerprint.
3. Store the fingerprint with the in-flight request and returned run.
4. If execution-affecting config, control ports, nodes, or edges changed before
   the response arrived, retain the response only as a visibly stale prior run;
   do not mark it current.
5. A layout/legibility action must not make a valid run stale.

Freezing semantic editing during a run is an acceptable first simplification,
but provenance should still record scope and the submitted graph. Cancellation
can remain a separate follow-up.

Also fix the Inspector output-tab effect while touching run state:
`hasOutput` is computed from the arriving result but is not an effect
dependency, so an already-selected node may remain on Configure when its output
arrives.

## Recommended combined UX

Build traversal/focus before auto-layout:

1. Extract pure utilities, for example `web/src/graphTraversal.ts`:
   - adjacency indexes;
   - upstream closure;
   - downstream closure;
   - edges wholly inside a scope.
2. Add **Select upstream** next to the existing **Select downstream**.
3. Add **Run to here** to the node menu and **Run to selection** to the
   multi-selection menu.
4. When a partial action is chosen, visually distinguish:
   - target nodes;
   - required upstream nodes;
   - unrelated nodes;
   - edges inside versus outside the execution scope.
5. Dim unrelated graph elements rather than hiding them. The user should retain
   spatial context.
6. Offer **Fit execution scope** or reuse `fitView({ nodes: scopedNodes })`.
7. Preserve the last-run scope long enough to explain the result, then clear or
   recompute it on semantic edits.

Keep execution scope separate from ordinary React Flow selection. Selection is
transient editing state; scope is explanatory run state. A separate transient
field/class is preferable to overloading `runStatus`.

The topbar **Run loom** remains a full run. The context menu is the natural home
for the first partial-run action.

## Auto-layout and edge legibility follow-up

Once scope highlighting is trustworthy, add deterministic left-to-right
auto-layout. Left-to-right matches the current input-left/output-right port
contract.

Recommended first action:

- **Tidy selection** when two or more nodes are selected;
- **Tidy graph** from the pane context menu;
- use `@dagrejs/dagre` or an equivalently small deterministic DAG layout;
- feed measured sizes when available and `nodeSize()` defaults otherwise;
- keep a useful rank gap and a larger gap between parallel branches;
- preserve the selection's or graph's visual center after applying positions;
- mark the loom dirty because positions are persisted;
- do not mark execution output stale because only layout changed.

Node resizing currently is not serialized by `web/src/graph.ts`; only position
is. Either make the initial layout rely on deterministic default/measured sizes,
or explicitly add optional width/height to the graph schema and persistence
contract. Do not assume a manual resize will survive save/load.

For edges, prefer interaction-driven emphasis over permanent labels:

- highlight a node's incoming and outgoing paths on selection/hover;
- emphasize edges inside the current execution scope;
- lower opacity for unrelated edges/nodes;
- consider `smoothstep` routing after auto-layout;
- retain selected-edge visibility and reconnect handles;
- avoid animated edges outside the actual execution scope.

## Test plan

### Backend

Add focused tests for:

- one target executes its complete upstream closure and nothing downstream;
- multiple targets execute the union once in stable topological order;
- all explicitly requested targets are returned as outputs;
- an unrelated missing input does not block a target run;
- a missing input inside the closure fails before execution;
- an unrelated side-effect node is not executed;
- target validation rejects missing IDs and duplicate IDs are normalized;
- cycles inside versus outside the closure;
- partial failures return completed in-scope results and the failed node;
- manifest scope records requested and executed IDs;
- workflow nodes remain atomic and pinned;
- full-run behavior and response shape remain covered.

### Frontend

There is still no frontend unit-test harness. Add Vitest before extracting graph
traversal/layout logic, then test those pure utilities directly:

- upstream/downstream closure on branches and merges;
- union scopes;
- deterministic ordering;
- induced edge sets;
- layout determinism and non-overlap;
- layout changes do not alter the semantic execution fingerprint.

Manually verify:

- full run remains unchanged;
- Run to here and Run to selection;
- scope highlighting before/during/after success and failure;
- Inspector output for a nonterminal target;
- stale response behavior after a semantic edit;
- layout-only moves do not stale results;
- minimap, context menus, selection, reconnect, and saved positions;
- 1365x768 and 1920x1080;
- no browser console errors.

## Suggested implementation order

1. Add backend `RunRequest`/`RunScope`, pure scope computation, manifest scope,
   and backend tests.
2. Extract frontend traversal utilities and add Vitest coverage.
3. Add semantic fingerprint/stale-result protection.
4. Add scope-aware `runGraph()` and `execute()` paths.
5. Add Run to here/selection plus upstream selection and visual scope styling.
6. Verify Inspector outputs and target/failure states.
7. Add Tidy selection/graph and edge focus styling.
8. Run all automated gates and live viewport QA.

## Deliberately deferred

- Run from here / resume from retained intermediate values.
- General node-output caching.
- Streaming node-by-node status.
- Cancellation.
- Automatically scoping inside saved workflow definitions.
- Large output-view redesign. Better output views remain desirable, but partial
  execution only needs accurate target output and scope provenance in this
  tranche.
