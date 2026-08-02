# Glitchloom technical-debt report

**Audit date:** 2026-07-28  
**Scope:** backend, frontend, tests, examples, packaging, local launcher, cache/file
behavior, and the `elsie-1` serving sources. This audit includes the uncommitted
preview/inspector/layout work present in the working tree on the audit date.
Line references capture that audit snapshot and may shift as the same-session UI
iteration continues.

## Same-session status after the audit

The UI iteration completed immediately after the audit partially mitigates
**TD-01** and should not be mistaken for still-open work:

- semantic edits now produce a visible dirty-state indicator;
- **Reset starter** warns before replacing a dirty graph or current run and keeps
  the previous graph recoverable through **Undo**;
- running no longer steals the selected node or displays a false stop affordance;
- click-to-add places new nodes in nearby open space instead of covering the
  existing graph;
- collected completion cards carry their source branch titles, so comparison
  does not require reconstructing edge order from the canvas.

At that point, the core TD-01 correctness work remained open: result freshness
was not tied to a semantic graph revision, semantic editing was not frozen or
snapshot-separated during an in-flight run, and cancellation/stale-result
behavior lacked automated coverage.

## 0.7.0 follow-up

The partial-execution tranche on 2026-07-29 closes the misleading-result core of
**TD-01**:

- the client now fingerprints execution-affecting graph semantics while excluding
  position, size, title, and loom-name changes;
- every in-flight response is compared with both that submitted fingerprint and a
  synchronously incremented semantic revision;
- a response arriving after a semantic edit is retained only as a visibly stale
  prior run, and semantic edits stale an already-completed result immediately;
- node status and execution-scope highlighting are not presented as current for a
  stale response; and
- Vitest coverage fixes the semantic/layout fingerprint boundary and the Inspector
  now reacts when output arrives for an already-selected node.

Cancellation and durable failed-run manifests remain separate follow-ups. The
historical evidence and line references below describe the original audit
snapshot.

## 0.8.0 version-zero follow-up

The 2026-08-02 tranche closes two more parts of the original trust gap:

- completion cache identity now includes provider, timeout, non-secret headers,
  request body, and a one-way credential fingerprint; and
- a typed protocol-v1 NDJSON companion endpoint reports the backend's effective
  plan, node lifecycle, and edge-transfer boundaries without exposing values.

The frontend does not replay a run after a stream has been accepted, so an
unknown transport outcome cannot silently duplicate provider or filesystem side
effects. This is live observability, not durable provenance: TD-05 still needs
persisted success and failure envelopes plus a run-bundle export. Disconnect
cancellation is also best-effort for work already inside a thread or remote
request, and there is not yet a user-facing cancel control.

## Executive summary

There is no P0 defect in the default, loopback-only development setup. The most
important debt is about **trusting what the workbench says happened**:

1. A graph can change while or after a run, while the UI continues to present
   the old result as current.
2. Port topology is preflight-validated, but node configuration is not. Several
   malformed or internally inconsistent requests can therefore fail only after
   execution has started.
3. Completion normalization discards all but the first provider choice, and
   list/branch execution is fully serial with avoidable HTTP-client churn.
4. Successful provenance is returned but not durably retained; failed runs have
   no manifest at all.
5. The exact-request cache has no provider/deployment identity or retention
   policy, which can silently reuse results across credential rotation or model
   redeployment.

The current UI iteration is a real usability improvement, particularly the
structured completion preview and collapsible panels. Its highest-leverage next
step is not more visual polish: it is a small correctness and regression-testing
envelope around run freshness, connections, preview shapes, and long-running
runs.

### Priority meanings

- **P1:** address before relying on Glitchloom for larger experiments or exposing
  it beyond the default loopback process.
- **P2:** address in the next hardening cycle; the current spike works, but these
  issues will become costly or misleading as usage broadens.
- **P3:** maintainability work to do after the correctness/test envelope exists.

## Recommended implementation order

| Order | Work package | Findings |
|---:|---|---|
| 1 | Make run results attributable and stale-safe | TD-01, TD-05 |
| 2 | Introduce versioned, validated node/request contracts | TD-02, TD-03 |
| 3 | Add automated UI/contract regression coverage | TD-07 |
| 4 | Bound result and cache growth | TD-06, TD-08 |
| 5 | Harden non-loopback and remote serving modes | TD-04, TD-11 |
| 6 | Fix setup, optional-integration, and filesystem durability | TD-09, TD-10, TD-12 |
| 7 | Decompose frontend implementation hotspots | TD-13 |

## Findings

### TD-01 — P1: Results can be presented as current after the graph has changed

**Evidence**

- Edge edits are applied directly without invalidating the current run
  (`web/src/App.tsx:152-169`).
- Adding and deleting nodes do not clear or stale-mark the stored `run`
  (`web/src/App.tsx:171-229`). Reset does clear the run, but is a separate
  one-click destructive action (`web/src/App.tsx:230-240`).
- Editing a field resets only that node's visual status; it does not clear or
  mark the stored run or downstream node outputs stale
  (`web/src/App.tsx:523-530`).
- `execute()` submits a snapshot, but editing remains enabled while the request
  is in flight. When the response returns, it marks the *current* nodes complete
  without checking whether they are still the submitted graph
  (`web/src/App.tsx:242-293`).
- The inspector selects outputs only by node ID from the last `RunResponse`
  (`web/src/Inspector.tsx:67-80`). It has no graph revision comparison.
- Output-tab auto-selection reads `hasOutput`, but its effect depends only on
  selected node ID, so a result arriving for an already-selected node does not
  trigger the intended tab decision (`web/src/Inspector.tsx:80-86`).
- Every successful run tries to select the literal starter ID `"preview"`,
  even when a user-built graph has no node with that ID
  (`web/src/App.tsx:251-265`).

**Impact**

A user can change a prompt, reconnect an edge, add/delete nodes, or edit during
a slow model load and then see an old completion under the new configuration.
That is a scientific-correctness problem, not just a status-color bug.

The running button also swaps to a stop icon while remaining disabled
(`web/src/App.tsx:332-340`), so the interface suggests cancellation without
providing it.

**Recommended direction**

- Maintain a monotonic semantic graph revision or a client-computed semantic
  digest.
- Store the submitted revision with each in-flight run. Accept the result only
  as current when it still matches; otherwise retain it explicitly as a
  **stale prior run**.
- Invalidate downstream status/output on semantic node and edge changes. Layout
  movement should not invalidate execution.
- Either freeze semantic editing during a run or allow it while clearly
  separating the in-flight snapshot.
- Add `AbortController` support in `runGraph()` and a real cancel action. The
  backend should distinguish client cancellation from a node failure.
- Add confirmation or undo for **Starter** and node deletion until persistent
  documents exist.

**Done when**

An automated test can edit a graph during a delayed run and prove that the
response is never labeled as the current result of the edited graph.

---

### TD-02 — P1: “Typed DAG” stops at ports; configuration and wire contracts are untyped dictionaries

**Evidence**

- Catalog ports and fields are free-form dictionaries
  (`glitchloom/catalog.py:9-44`), and the node catalog itself is a list of
  dictionaries (`glitchloom/catalog.py:47-307`).
- `GraphNode.config` is `dict[str, Any]` (`glitchloom/models.py:17-23`).
- Preflight validates node kinds, ports, multiplicity, simple exact type names,
  required connections, and cycles, but never validates each node's config
  (`glitchloom/engine.py:208-286`).
- Numeric conversion, JSON parsing, empty URL/model handling, regex compilation,
  and output-format checks happen inside execution
  (`glitchloom/engine.py:321-343`, `glitchloom/engine.py:404-420`,
  `glitchloom/engine.py:437-565`).
- The frontend manually mirrors backend catalog strings
  (`web/src/types.ts:3-54`) and trusts unchecked `response.json()` casts
  (`web/src/api.ts:18-56`).
- The canvas accepts every React Flow connection and waits until a run for the
  server to reject bad type or multiplicity combinations
  (`web/src/App.tsx:158-169`).

There is also a concrete provenance hole: `extra_body` is merged *after* the
canonical `model`, `prompt`, and sampling fields
(`glitchloom/engine.py:324-343`). It can overwrite the prompt sent to the
provider while the normalized result still records the original upstream
`prompt` (`glitchloom/engine.py:380-394`).

**Impact**

Failures that could be found before execution can occur after earlier
independent nodes have already made provider calls or written files. Backend and
frontend contract drift is a manual-update risk. Reserved-field overrides can
make recorded provenance disagree with the actual provider request.

The current `"any"` escape hatch also hides useful unions: completion prompts
and corruptors accept several known shapes, but preflight cannot express or
explain those combinations (`glitchloom/catalog.py:198-207`,
`glitchloom/catalog.py:256-264`).

**Recommended direction**

- Define versioned `PortDefinition`, `FieldDefinition`, and per-node config
  models, preferably as Pydantic discriminated unions keyed by `kind`.
- Validate and normalize **all** configs before executing the first node.
- Add constraints for URLs, non-empty model IDs/paths, finite/ranged numbers,
  regex syntax, JSON object/array expectations, and allowed enum values.
- Reject `extra_body` collisions with canonical fields, or expose overrides as
  explicit catalog fields whose final values are exactly what provenance
  records.
- Generate frontend wire types from OpenAPI/JSON Schema, then validate fetched
  payloads at the boundary instead of asserting them.
- Use the same compatibility function in backend validation and React Flow's
  `isValidConnection`.

**Done when**

Every catalog node has a config-validation test, malformed graphs fail before
any executor side effect, and a schema-drift check fails CI if backend and
frontend contracts diverge.

---

### TD-03 — P1: Completion semantics lose choices and scale serially

**Evidence**

- A list of prompts is expanded into sequential recursive requests
  (`glitchloom/engine.py:311-319`).
- When no injected client is present, every request creates and closes a new
  `httpx.AsyncClient` (`glitchloom/engine.py:366-372`).
- Provider responses are normalized from `choices[0]`; every additional choice
  is available only inside `raw` and is unusable by ordinary downstream nodes
  (`glitchloom/engine.py:375-395`).
- `extra_body` can request `n > 1`, so this loss is reachable through the
  supported UI.
- The whole DAG runs one node at a time even when branches are independent
  (`glitchloom/engine.py:567-606`).

**Impact**

OpenAI-compatible `n` behavior is silently truncated. Prompt collections and
independent provider branches have avoidable latency and connection overhead.
Partial list failure can also leave earlier requests cached even though the node
as a whole reports failure.

**Recommended direction**

- Decide and encode one contract: either forbid `n != 1`, or return an ordered
  collection of normalized choice records with choice index, prompt index, and
  provider-reported seed.
- Keep request-level usage/latency visually separate from per-choice metadata.
  The current raw-envelope preview assigns the same aggregate usage to every
  choice and derives seed only from response-level `parameters`, while the
  Talkie service reports seed on each choice
  (`web/src/PreviewValue.tsx:94-125`,
  `remote/glitchloom_talkie_api.py:279-287`).
- Prefer provider-side prompt batching where supported, with a documented
  fallback.
- Reuse one lifespan-scoped `AsyncClient` with explicit connection limits and
  close it on application shutdown.
- Add bounded concurrency for independent pure/network nodes while preserving
  deterministic edge order and serializing side-effecting file nodes.
- Define partial-batch behavior explicitly: fail atomically, or return per-item
  success/error records.

**Done when**

Contract tests cover multiple prompts, multiple choices, one malformed choice,
provider HTTP errors, cache modes, ordering, and bounded concurrency.

---

### TD-04 — P1 gate: Non-loopback mode has no security boundary

**Evidence**

- The default is safely loopback, but `GLITCHLOOM_HOST` can bind the same
  unauthenticated app to another interface (`glitchloom/server.py:91-98`,
  `.env.example:7-9`).
- `/api/runs` accepts arbitrary submitted graphs
  (`glitchloom/server.py:64-79`).
- Those graphs can read and write any path inside `GLITCHLOOM_WORKSPACE`
  (`glitchloom/engine.py:193-206`, `glitchloom/engine.py:558-562`) and can make
  server-side requests to arbitrary completion base URLs
  (`glitchloom/engine.py:321-374`).
- CORS is restricted (`glitchloom/server.py:21-30`), but CORS is not
  authentication and does not protect against non-browser clients.

**Impact**

There is no problem in the documented single-user loopback setup. If the host is
changed to `0.0.0.0` for convenience, however, another network client can use
Glitchloom as a workspace read/write API and an internal-network request proxy.
`GLITCHLOOM_ALLOW_ABSOLUTE_PATHS=1` increases that impact.

**Recommended direction**

- Refuse non-loopback binding unless an explicit unsafe-development flag or an
  authentication configuration is present.
- For supported remote use, require a bearer token, add request/graph/body
  limits, make file write and absolute paths separate capabilities, and
  constrain endpoint destinations where practical.
- Emit a prominent startup warning showing bind address, workspace, write
  capability, and absolute-path state.
- Add tests for loopback classification and unsafe configuration combinations.

**Done when**

Changing only `GLITCHLOOM_HOST=0.0.0.0` cannot silently expose file and endpoint
nodes.

---

### TD-05 — P1: Provenance is complete only for successful, still-in-memory responses

**Evidence**

- `RunManifest` has useful successful-run metadata
  (`glitchloom/models.py:55-76`), and the engine constructs it only after every
  node succeeds (`glitchloom/engine.py:608-627`).
- `GraphRunFailure` carries only a message, node ID, and partial node results
  (`glitchloom/models.py:79-91`).
- The 422 response omits run ID, graph digest/snapshot, start/finish timestamps,
  engine/plugin versions, and workspace (`glitchloom/server.py:70-78`).
- The server exposes catalog and run execution only; it has no durable run
  archive or export endpoint (`glitchloom/server.py:33-88`).
- The smoke helper persists its response externally, but ordinary UI runs do
  not (`scripts/run_live_smoke.py:12-36`).

**Impact**

The best provenance exists transiently in a browser response. A reload loses it,
and failed experiments—the cases where diagnosis needs provenance most—are less
self-describing than successful ones. A file node cannot save the final
manifest because the manifest does not exist until after node execution.

**Recommended direction**

- Allocate the run ID and frozen graph snapshot before validation/execution.
- Return one versioned run envelope for both success and failure, with terminal
  status, partial results, and a structured error.
- Add an explicit **Download run bundle** first; optionally add an append-only
  workspace run store later. Do not silently persist API-key values.
- Record application/package build identity and a separate semantic graph
  digest (see TD-09).
- Make retention and redaction choices explicit because prompts and raw provider
  payloads may be sensitive.

**Done when**

A failed run can be exported and independently identified/replayed with the same
quality of provenance as a successful run.

---

### TD-06 — P1 for collection/logprob workloads: Responses duplicate unbounded values

**Evidence**

- Each normalized completion embeds selected fields **and** the complete raw
  provider payload (`glitchloom/engine.py:380-395`).
- Every node's complete outputs are included in `NodeRunResult`
  (`glitchloom/engine.py:596-605`), terminal outputs are serialized again
  (`glitchloom/engine.py:622-627`), and Preview is a pass-through copy
  (`glitchloom/engine.py:563-564`).
- In the starter graph, completion records therefore appear at completion
  nodes, inside Collect, inside Preview, and again as terminal output.
- The new preview eagerly stringifies the entire value and renders every item;
  the raw JSON `<pre>` is mounted even while its `<details>` is closed
  (`web/src/PreviewValue.tsx:289-375`).

**Impact**

Large prompt collections, long text, `logprobs`, or provider-specific payloads
can multiply response size, JSON encoding time, browser memory, and render time.
The FastAPI event loop also performs this serialization as one request with no
pagination or progress.

**Recommended direction**

- Separate small node summaries from value artifacts. Store large values once
  by run-scoped/content-addressed ID and fetch them lazily.
- Make terminal-output duplication references rather than repeated JSON.
- Put size limits on raw provider payload retention and support explicit
  artifact download for the complete value.
- Virtualize or paginate long preview lists; defer raw JSON serialization until
  the details panel is opened; offer truncation with byte/item counts.
- Add performance fixtures for 1, 100, and 10,000 completion records and a large
  logprob payload.

**Done when**

Response and DOM size grow approximately once with the underlying data rather
than once per pass-through/collector node.

---

### TD-07 — P1: The UI and frontend/backend contract have no automated regression suite

**Evidence**

- The frontend defines only `dev`, `build`, and `preview` scripts—no unit,
  browser, lint, or accessibility test command (`web/package.json:6-22`).
- CI runs backend lint/tests and a frontend production build, all on Ubuntu
  (`.github/workflows/ci.yml:14-48`).
- The primary launcher is PowerShell/Windows (`run.ps1:1-33`), but CI never
  exercises it.
- Backend coverage is nine tests (audit command: `uv run pytest -q -p
  no:cacheprovider`, 9 passed). The server test checks health/catalog presence,
  not run success/failure envelopes (`tests/test_server.py:9-31`).
- The real Glitchlings test depends on a checkout under one user's home and
  otherwise skips (`tests/test_glitchlings_adapter.py:10-16`).

**Impact**

The current preview parser, panel/refit behavior, stale-output risk, error
states, and required 1365×768 / 1920×1080 layouts are protected only by manual
QA. Backend catalog changes can compile while changing runtime JSON semantics.
The documented Windows launch can regress while CI stays green.

**Recommended direction**

- Add table-driven unit tests for `PreviewValue` normalization, especially raw
  multiple-choice envelopes, lists, empty text, usage attribution, Talkie's
  per-choice seed, corruptions, and fallback JSON.
- Add Playwright smoke tests at both required viewport sizes for starter fit,
  node selection, field editing, valid/invalid connections, panels, run
  success/failure, stale results, copy behavior, and zero console errors.
- Add backend validation tests for every node kind and graph invariant,
  including duplicate edge IDs, config ranges, cache refresh/off, file
  overwrite races, and multi-choice completions.
- Test the Glitchlings adapter against a small fake public registry in CI; keep
  the native-extension test as a separate environment-gated integration job.
- Add a Windows CI job for `npm ci`, production build, Python tests, and a
  loopback server health/run smoke.

**Done when**

Meaningful preview/layout or catalog/engine contract changes cannot merge on a
TypeScript build alone.

---

### TD-08 — P2: Cache identity, validation, privacy, and retention are underspecified

**Evidence**

- Cache identity is namespace + engine version + endpoint URL + API-key
  **environment-variable name** + request JSON
  (`glitchloom/engine.py:143-171`, `glitchloom/engine.py:344-354`).
- Rotating the secret stored in the same environment variable or redeploying a
  different model behind the same URL does not change the key.
- Cache reads require only that decoded content be a dictionary; the result
  schema is not validated (`glitchloom/engine.py:161-170`).
- Writes are atomic, but there is no TTL, size limit, index, pruning, or
  redaction (`glitchloom/engine.py:173-191`).
- Cache invalidation relies on `__version__`, which is duplicated in
  `pyproject.toml:1-4` and `glitchloom/__init__.py:1-3`.

**Impact**

An “exact request” can resolve to a stale result after credential/account
rotation or provider/model redeployment. Prompts and raw provider payloads
accumulate indefinitely in the workspace. A forgotten package-version bump can
reuse a semantically incompatible cached schema.

**Recommended direction**

- Add an explicit, non-secret endpoint cache namespace/deployment fingerprint
  (for example a configured revision or secret-derived one-way fingerprint).
- Version the cached-result schema independently and validate it on read.
- Store created/accessed time and byte size; add inspect/prune commands and
  documented retention defaults.
- Expose cache location/size in health or settings without listing sensitive
  contents.
- Derive the package version from one source and add a test that cache-semantic
  changes require a cache-schema bump.

**Done when**

Credential/model rotation cannot silently reuse a previous identity's response,
and a user can measure and bound cached sensitive data.

---

### TD-09 — P2: The run digest mixes layout with execution identity and drops display metadata

**Evidence**

- Backend `GraphNode` includes ID, kind, config, and canvas position, but no
  user-visible title (`glitchloom/models.py:17-23`).
- The frontend sends those same fields and omits `data.title`
  (`web/src/api.ts:34-48`), even though titles are editable
  (`web/src/Inspector.tsx:142-147`).
- The sole graph digest hashes the complete submitted graph, including node
  positions and graph name (`glitchloom/engine.py:610-620`).

**Impact**

Moving a node changes the graph digest even though the experiment is unchanged,
while renaming a node for human comprehension is missing from the frozen graph.
The digest therefore serves neither purely semantic identity nor a complete
document snapshot.

**Recommended direction**

- Preserve display title and future document metadata in the graph snapshot.
- Maintain two identities:
  - a **document digest** including layout and labels;
  - an **execution digest** including only semantics, with canonical ordering
    that preserves the order of multi-input edges where order matters.
- Show the short execution digest beside run freshness/history.

**Done when**

Layout-only movement preserves execution identity, and an exported manifest
retains the titles the user saw.

---

### TD-10 — P2: The default starter and setup path depend on optional, machine-specific state

**Evidence**

- README calls Glitchlings an optional local checkout
  (`README.md:7-13`), but the UI always builds a starter containing Typogre and
  Corrupt (`web/src/starter.ts:53-67`).
- When discovery is unavailable, the catalog still supplies Typogre as a
  fallback option (`glitchloom/catalog.py:310-320`), so the graph looks
  configurable but fails only at runtime.
- The same starter hard-codes `http://elsie-1:8790/v1`
  (`web/src/starter.ts:69-77`).
- README says to copy `.env.example` (`README.md:45-47`), but the launcher does
  not load a `.env` file (`run.ps1:1-33`) and the Python dependencies include no
  dotenv/settings loader (`pyproject.toml:7-12`).
- The launcher uses `npm install` (`run.ps1:18-23`) while the repository's
  quality gate and CI use reproducible `npm ci`
  (`AGENTS.md:33-40`, `.github/workflows/ci.yml:45-48`).
- `GLITCHLOOM_CACHE_DIR`, `GLITCHLOOM_ALLOW_ABSOLUTE_PATHS`, and remote
  `TALKIE_CACHE_DIR` are implemented but absent from `.env.example`
  (`glitchloom/engine.py:128-139`, `glitchloom/engine.py:193-206`,
  `remote/glitchloom_talkie_api.py:133-139`).

**Impact**

The nominal first-run path can produce a non-runnable graph on a clean machine,
and copying the documented env template does not configure the process. Setup
behavior differs between local launch and CI.

**Recommended direction**

- Either load `.env` explicitly or remove the copy instruction and document
  PowerShell `$env:` setup. Loading it is more user-friendly.
- Use `npm ci` by default; make dependency update an explicit maintenance
  action.
- Choose a starter based on capability checks: a generic local/example graph
  when Glitchlings or `elsie-1` are unavailable, and a clear selectable Talkie
  template when they are.
- Do not present fallback plugin choices as available operations; show a
  disabled node with the concrete install/configuration action.
- Centralize and document every supported environment variable, default, and
  security implication.

**Done when**

A clean checkout can follow README literally, reach a runnable starter, and see
why any optional capability is unavailable before pressing Run.

---

### TD-11 — P2: Remote Talkie serving is operationally fragile and only partly protocol-correct

**Evidence**

- The systemd unit launches from an unrelated project's virtual environment
  (`remote/talkie-openai.service:5-12`); the remote service has no checked-in
  dependency/lock specification of its own.
- Deployment and hash verification are manual prose
  (`REMOTE_SERVING.md:36-47`, `AGENTS.md:94-100`).
- There are no tests importing or exercising
  `remote/glitchloom_talkie_api.py`.
- Pydantic's default extra-field behavior means unsupported request fields can
  be ignored silently; `CompletionRequest` does not set `extra="forbid"`
  (`remote/glitchloom_talkie_api.py:95-111`).
- Stop strings are applied by truncating text **after** full generation, while
  usage counts all generated steps (`remote/glitchloom_talkie_api.py:254-290`).
- The unit binds an unauthenticated, expensive GPU endpoint to `0.0.0.0`
  (`remote/talkie-openai.service:7-10`). A request may contain a list of many
  48,000-character prompts with up to eight samples each; there is no total
  work/queue limit (`remote/glitchloom_talkie_api.py:95-111`,
  `remote/glitchloom_talkie_api.py:173-189`).

**Impact**

Recreating the service depends on an external environment staying compatible.
Clients can believe unsupported fields were honored. Stop-heavy requests waste
generation and report completion-token usage inconsistent with returned text.
Any host-network exposure permits unbounded expensive queued work.

**Recommended direction**

- Give the service a pinned deploy environment or lock file and a scripted,
  idempotent deploy/rollback/verification command.
- Split pure request/response helpers from CUDA imports so protocol tests run in
  CI; add a small fake runtime for seeded multi-prompt/multi-choice tests.
- Forbid unknown fields and explicitly enumerate supported compatibility
  behavior.
- Integrate stop detection into decoding if feasible; otherwise recompute
  returned-token usage after truncation and document the compute limitation.
- Add authentication or a verified firewall boundary, request-wide token/work
  limits, bounded queue depth, and overload responses.
- Add liveness/readiness distinction and expose queue/load state without
  triggering model load.

**Done when**

The service can be recreated from checked-in sources, protocol-tested without a
GPU, and safely rejects unsupported or excessive work.

---

### TD-12 — P2: User file I/O is synchronous and non-atomic

**Evidence**

- `Write file` checks existence and then writes directly to the destination
  (`glitchloom/engine.py:404-428`). Unlike cache writes, it does not use a
  temporary file plus atomic replace.
- `Read file` and write/cache filesystem work run synchronously inside the async
  graph request (`glitchloom/engine.py:173-191`, `glitchloom/engine.py:558-562`,
  `glitchloom/server.py:64-69`).
- There is no file-size guard.

**Impact**

A crash can leave a truncated experiment output. Concurrent runs can race
between `exists()` and `write_text()`. Large reads/writes block the application
event loop and feed directly into the unbounded response problem in TD-06.

**Recommended direction**

- For overwrite, write to a same-directory temporary file, flush, and atomically
  replace. For no-overwrite, use exclusive creation rather than check-then-write.
- Move blocking I/O to a thread or use an execution worker boundary.
- Add configurable read/write size limits and return structured file errors.
- Test crash-safe replacement, concurrent no-overwrite, symlink/workspace
  boundaries, UTF-8 errors, and Windows path behavior.

**Done when**

Interrupted or concurrent writes cannot silently truncate/replace an output
contrary to the node configuration.

---

### TD-13 — P3: Frontend responsibilities are concentrated in large files

**Evidence**

- `App.tsx` owns catalog loading, graph state, graph mutation, run lifecycle,
  palette, panel layout, and the React Flow canvas in one component
  (`web/src/App.tsx:61-547`).
- `Inspector.tsx` mixes run selection, tabs, generic catalog-field rendering,
  Glitchlings schema presentation, deletion, and output rendering
  (`web/src/Inspector.tsx:23-285`).
- `PreviewValue.tsx` combines shape recognition, normalization, formatting,
  clipboard state, and all preview rendering
  (`web/src/PreviewValue.tsx:4-379`).
- `styles.css` is a single stylesheet of more than 1,700 lines with layout,
  node, inspector, preview, responsive, and animation rules.
- Default config construction is duplicated in `App.tsx:51-55` and
  `web/src/starter.ts:15-17`.

**Impact**

This does not currently block use, but it raises the cost of testing and makes
unrelated UI changes more likely to interfere. The preview parser in particular
is valuable domain logic that should be testable without rendering the entire
inspector.

**Recommended direction**

After TD-07 is in place:

- extract `useGraphDocument`, `useRunController`, and semantic invalidation;
- split palette, top bar, canvas controls, and generic field control components;
- move preview normalization to pure typed functions with fixture tests;
- split styles by component or use scoped modules while retaining shared design
  tokens;
- expose one backend-supplied/default-config helper rather than reconstructing
  defaults in multiple frontend paths.

**Done when**

Run-state, preview normalization, and field rendering can each be tested without
mounting the whole application, and layout CSS changes have a bounded component
scope.

## Items intentionally not classified as debt

The following are explicit spike/product boundaries in `README.md:115-122`, not
cleanup obligations disguised as findings:

- arbitrary Python `Apply func`;
- model-server lifecycle management;
- persistent graph and reusable subgraph files;
- token streaming;
- bounded iteration.

Reusable subgraphs remain the correct future abstraction for named bundles such
as “run both Talkies”; adding model-specific native node kinds would violate the
repository's architecture rather than pay down debt.

Two qualifications matter:

1. Even while persistent graph documents are deferred, destructive reset/delete
   actions need confirmation or undo, and run bundles need an explicit export
   path (TD-01 and TD-05).
2. Even while token streaming is deferred, cancellation and stale-result
   protection are separate correctness requirements (TD-01).

## Existing strengths to preserve

- Graph topology validation happens before execution and already covers missing
  ports, multiplicity, type mismatches, required inputs, and cycles
  (`glitchloom/engine.py:208-286`).
- Prompt whitespace is preserved through completion construction.
- File paths are workspace-scoped by default (`glitchloom/engine.py:193-206`).
- Cache writes use unique temporary files and atomic replacement
  (`glitchloom/engine.py:173-191`).
- Completion and corruption records retain unusually useful provenance.
- The catalog-driven inspector is the right extension direction.
- The current structured preview keeps text primary while retaining raw data.
- CI uses frozen Python dependencies and `npm ci`; the missing piece is broader
  behavior/platform coverage, not replacement of the existing gates.
