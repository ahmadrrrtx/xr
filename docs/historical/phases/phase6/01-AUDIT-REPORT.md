# Phase 6 — Step 1 Audit Report (Memory, Knowledge & Context Quality)

**Audited against:** live `main` @ `841e12a` (post PR #37), version `7.0.1`.
**Method:** every claim below was verified by reading the listed code, then by running the listed gate. Nothing was taken from prior phase reports at face value (Global Rule 1–2, 10).

---

## 1. Phase 0–5 re-verification (the floor)

| Item | Live evidence | State |
|---|---|---|
| Phase 0 — one release manifest, version unified | `bun run release:check` → “all 6 surfaces in sync at 7.0.1 (Truth)” | **VERIFIED** |
| Phase 0 — claim governance | `bun run claim-lint` → “no unsupported claims · 8 evidenced claims” | **VERIFIED** |
| Phase 0 — baseline inventory | `scripts/baseline-inventory.ts` present; `docs/release/7.0.1/inventory.json` | **VERIFIED** |
| Phase 0 — budget governor | `src/cost/governor.ts` enforced in the loop (`src/core/agent.ts`) | **VERIFIED** |
| Phase 1 — single-writer persistence + audit chain | ADR 0001; `XR_HOME` golden-path: `chainValid:true`, 17/17 checks | **VERIFIED** |
| Phase 1 — reliability suite green | `bun test` → **2432 pass / 0 fail / 175 files** (measured 2026-08-02) | **VERIFIED** |
| Phase 2 — one execution path / one registry / one planner | ADR 0002/0003; `agent-service.ts` sole entry; `test/architecture/boundaries.test.ts` | **VERIFIED** |
| Phase 2 — ONE routing authority | `src/providers/routing.ts` absent; routing = `src/intelligence/routing-service.ts` only | **VERIFIED** |
| Phase 2 — enforced L0–L6 boundaries | `bun run boundaries` → 0 violations (526 modules, 1638 edges) | **VERIFIED** |
| Phase 2 — size gate | `bun run size-gate` → all modules <800 LOC or owned, dated waiver | **VERIFIED** |
| Phase 2 — **`memory/` retired, one context store** | `src/memory/` **does not exist**. Canonical store = `src/context/*`; legacy `user_memory` table adapted via `memory-adapter.ts` (honest `legacy_unknown` consent) | **VERIFIED** (see §3 caveat) |
| Phase 3 — lazy boot / compiled binary / perf budgets | `bun run hot-path-lint` green; `src/core/boot-profile.ts`; perf regression gate scripts present | **VERIFIED** |
| Phase 3 — retrieval p95 <100 ms budget | `test/context/performance.test.ts` asserts budget but only seeds **≤5,000** items → the @100k claim is **not currently proven** | **GAP G6** |
| Phase 4 — isolation lattice / egress / credentials / supply chain | ADR 0009–0011; `bun run typecheck` green; CI scripts (trivy/osv) present | **VERIFIED** |
| Phase 5 — measured, explainable routing | ADR 0012; `src/intelligence/*`; `test/intelligence/*` green | **VERIFIED** |
| Phase 5 — context uses the plane for embeddings/reranking | `src/context/embedding.ts` routes `modelClass: "embeddings"` through `IntelligenceService`, lexical fallback, never silent cloud | **VERIFIED** |

## 2. Phase 6 surface inventory (as built today)

**Files:** `src/context/` 23 modules, ~9,400 LOC: `types.ts` (taxonomy/trust/consent/provenance/freshness/tiers/bounds), `policy.ts` (grants/authorization), `poison.ts` (admission + poison signatures + conflict detection + redaction), `retrieval.ts`, `embedding.ts` (route + deterministic reranker), `repository.ts` (SQLite: `context_items`, `context_provenance`, `context_revocations`, `context_packages`, `context_summaries`), `assembler.ts`, `injection.ts` (channels + quarantine + `verifyInjectionSafety`), `compression.ts` (fail-safe evidence-preserving), `provenance.ts`, `inspection.ts`, `service.ts` (facade), `cli.ts` + `memory/cli.ts`, `memory/*` (legacy engine), `memory-adapter.ts`.

| Surface | What exists now | Verdict |
|---|---|---|
| One store | `src/memory/` absent; single SQLite via `ContextRepository` (+ retained legacy `user_memory` table, adapted — not a second call path) | **ONE STORE: VERIFIED**; quality gaps remain (G8) |
| Taxonomy / tiers | 7 context types, 8 *semantic* tiers with frozen policy table (`TIER_POLICIES`) | VERIFIED |
| Retrieval model | Scope-first SQL fence → authorize-before-ranking → single-vector similarity (**either** semantic cosine **or** lexical, never fused) → deterministic reranker (0.55·sim + 0.25·overlap + 0.2·prior) → contradiction penalties. **Not hybrid** (no lexical+semantic+structured fusion). Full recall explanation per item incl. rerank movement | **CHANGED/GAP G2** |
| Navigability (memory-as-tools) | **None.** Agent path = single-shot `requestContext()` pre-run injection (`agent-service.ts:263`, `agent.ts:326`). No memory tools in the loop; agent cannot re-query, follow links, or resolve contradictions mid-run | **GAP G1 — the headline gap** |
| Tiers lifecycle | Semantic tiers exist; **no progressive lifecycle** (recent → summary → condensed → externalized). `compressItems` is fail-safe and evidence-preserving but nothing drives progressive promotion; `context_summaries` records exist | **GAP G3** |
| Compression fidelity | Deterministic, invariant-checked, fails closed (~532 LOC + 289-line fidelity test) | VERIFIED (strong floor) |
| Anti-poisoning | Write-time admission `admitContextWrite` (anti-spoof clamp, self-approval block, poison signatures, quarantine); deterministic channel assignment (retrieval→never authority); untrusted always quarantined, LAST, user-role. **But:** no re-validation at injection time (stored content is trusted as scanned at write), no standalone poisoning *corpus*, no tool-result path | **GAP G4** (partial floor exists) |
| Conflict resolution | Detection + deterministic penalties (`detectConflicts`/`conflictPenalty`); both sides shown honestly. **No resolution records, no user decision surface, no selective forgetting** | **GAP G5** |
| Consent / provenance / expiry / revocation | Full state machine incl. `legacy_unknown`; revive/revoke audit table; expiry excludes in SQL; redaction of secrets/external paths | VERIFIED |
| Recall-quality measurement | **None.** No harness, no fixtures, no MemoryAgentBench-style competency suite. “recall” quality is implicit, never measured | **GAP G7 — the second headline gap** |
| Local-only path | Deterministic lexical route, zero network; `embedding.ts` falls back locally; network-disabled path is default-tested only at unit level (`performance.test.ts` lexical case) | VERIFIED; needs an explicit network-off test (G7b) |
| User control | CLI: inspect (scope/source/freshness/reason), approve/revoke/correct; `MemoryStore`: update/remove/clear/prune/export/import/consent-summary/superseded. **No undo ledger anywhere**; no conflict UI; no “why recalled” per-item dump beyond explanations | **GAP G8** (floor exists) |
| Perf @100k | Not measured (see Phase 3 row) | **GAP G6** |

## 3. Caveats & findings

- **F1 (not a regression):** legacy `user_memory` remains a table inside the single context store, read through the adapter with `legacy_unknown` consent. This is the documented conservative migration (ADR 0006), not a second store. Phase 6 quality work must cover it (undo, conflicts) via the adapter path.
- **F2:** Retrieval is “lexical XOR semantic” per item (space-mismatch falls back per-item to lexical). Fusion, and a structured channel (type/tag/scope), are absent — hybrid is the Phase 6 lift.
- **F3:** `verifyInjectionSafety()` exists but is not invoked on the injection path; integrity re-validation at render time is the missing enforcement point.
- **F4:** The 8 semantic tiers already carry per-tier trust/freshness caps; “progressive tiers” in Phase 6 must be an *evidence-preserving lifecycle* layered on these, not a rival tier system.
- **F5:** Existing `catch { /* best-effort */ }` blocks in Phase 2 code carry rationale comments. Phase 6 adds **no new** empty catches (Art. IV) — audit-path errors are collected as diagnostics.

## 4. Gap summary → tasks

| Gap | Statement | Task |
|---|---|---|
| G1 | Memory is single-shot top-k injection, not navigable memory-as-tools | **T2** |
| G2 | Retrieval is not hybrid (no lexical+semantic+structured fusion), reranker has no measured benefit | **T2** |
| G3 | No progressive evidence-preserving lifecycle (recent→summary→condensed→externalized) | **T1** |
| G4 | No injection-time integrity re-validation; no standalone memory-poisoning corpus | **T3** |
| G5 | Conflicts detected but not *resolvable*; no selective forgetting; no user-visible decision mechanism | **T4** |
| G6 | @100k retrieval budget asserted, unproven | **T5/T7** |
| G7 | Recall quality never measured; no MemoryAgentBench-style suite (4 domains × 4 competencies); no explicit network-off knowledge test | **T5/T7** |
| G8 | No undo ledger; conflict resolution missing from user-control surface | **T6** |
| G9 | Residual duplicate/legacy drift + asserted-recall language must be re-verified closed | **T8** |
