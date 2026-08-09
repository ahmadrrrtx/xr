# Phase 6 — Step 4 Architecture Validation (before code)

Each task validated against the Constitution. Rejection triggers: second store · retrieved-content-as-authority · asserted recall · mandatory cloud embedding · Phase-0–5 regression.

| Task | ADR-1 boundary | ADR-2 single-authority | ADR-4 authority≠intelligence | ADR-5 local-first | ADR-9 perf | ADR-11 compat | Verdict |
|---|---|---|---|---|---|---|---|
| **T1** Progressive lifecycle | L1 runtime (`src/context/`) — existing home | Extends the one store; adds *columns*, not a store | Promotion is deterministic; compression already fail-closed | Fully local | Promotion runs async/off hot path | Additive `lifecycle_stage` column, default preserves behavior; demotion reverses | **VALID** |
| **T2** Hybrid + memory-as-tools | L1 (`context/hybrid.ts`, `context/tools.ts`); tools registered as **core** contributions via existing registry-builder host hook | One retriever (fusion lives inside the existing pipeline, not beside it) | Tools return **data channel** results; grant + integrity gate on every result; no tool may write instructions | Lexical channel is the complete offline path; semantic optional | Retrieval p95 budget preserved (bounded channels, RRF O(n log n)); embedding stays async/off hot path | Tool names additive; injection behavior unchanged when tools absent | **VALID** |
| **T3** Integrity gate + corpus | L1 (`context/integrity.ts`) | One gate, invoked at the single render point(s) | Gate is deterministic re-validation at render time; quarantine channel last, user role | Local | Scan cost bounded per package | Gate tightens behavior only toward deny — rejection surfaces exist already | **VALID** |
| **T4** Conflict resolution / selective forgetting | L1 (`context/conflicts.ts`) | Resolution records in additive table in the one store | Deterministic policy resolves supersession only; contradictions require user decision — never a model | Local | Off hot path (CLI/tool-driven) | Additive table; forget = reversible expiry flag | **VALID** |
| **T5** Recall benchmark harness | L1 (`context/eval/`) + `scripts/` | Measures the one retriever — asserts the *same* code path the agent uses | N/A (measurement) | Offline-capable by construction (lexical mandatory) | Offline/async only; never imported by runtime hot path | No schema change | **VALID** |
| **T6** Undo ledger + user control | L1 (`context/undo.ts`) | One ops ledger table in the one store; covers legacy `user_memory` via snapshot | Undo restores data, never grants authority | Local | Off hot path | Additive table | **VALID** |
| **T7** Local-only knowledge | test-only | — | — | The whole point | — | — | **VALID** |
| **T8** One-store guard + asserted-recall sweep | test-only | Guard test enforces | — | — | — | — | **VALID** |

**Explicitly rejected designs (recorded):**
- A separate “memory tools” SQLite/vector index — second store (Art. VIII.2) ✗
- Tool results rendered as system-role or with text like “follow these saved instructions” — retrieved ≠ authority ✗
- Running the recall benchmark during agent startup or retrieval — hot-path regression (Art. XII) ✗
- Deleting original items at the “externalized” stage — evidence loss (Art. VIII.4) ✗
- Auto-resolving contradictions by model judgment — authority from intelligence ✗ (deterministic policy for supersession; user for the rest)

**Phase-0–5 non-regression plan:** full `bun test` + `typecheck` + `boundaries` + `size-gate` + `hot-path-lint` + `claim-lint` re-run at exit; golden-path and integrity suites re-verified; retrieval budget measured at 100k in the benchmark script and the perf test.
