# Phase 09 — Memory / Context Engine — Final Report

**Date:** 2026-08-18
**Base:** `main` @ `0ca11ab` (Phase 08 unified capability)
**Verdict:** PHASE 09 PASS

---

## 1. IMPLEMENTED

Exact changes (no rewrite of the Phase 6 Memory Engine):

### Files added

| File | Role |
|---|---|
| `src/context/engine.ts` | Engine lifecycle + truthful doctor/status |
| `src/context/isolated-store.ts` | Workspace-stamped MemoryStore wrapper |
| `src/context/memory-scope.ts` | Explicit session / workspace / agent / global scopes |
| `src/context/working.ts` | Session + working memory (not durable) |
| `src/context/budget.ts` | Context budget pipeline + progressive disclosure |
| `src/context/microcompact.ts` | Quality-checked compaction with fallback |
| `src/context/skill-promotion.ts` | Conversation ≠ automatic skill |
| `test/context/phase09-engine.test.ts` | Enablement / lifecycle / doctor honesty |
| `test/context/phase09-isolation.test.ts` | CRITICAL workspace isolation |
| `test/context/phase09-budget.test.ts` | Budget, progressive, compaction, scopes, deletion, poisoning, skills |
| `test/context/phase09-latency.test.ts` | Measured p50/p95/p99 + indexing amplification |
| `benchmarks/memory-recall/dataset.json` | Deterministic recall dataset |
| `benchmarks/memory-recall/latest.json` | Measured recall latency |
| `scripts/memory-recall-bench.ts` | Recall + context + compaction + index bench |
| `docs/architecture/PHASE_09_MEMORY_CONTEXT_ENGINE.md` | Architecture |

### Files modified

- `src/context/index.ts` — export new surfaces
- `src/context/injection.ts` — progressive disclosure (`metadata` / `summary` / `full`)
- `src/context/service.ts` — IsolatedMemoryStore extras + retrieval latency
- `src/commands/doctor.ts` — truthful engine / store / retrieval / index / integrity
- `src/daemon/routes/memory.routes.ts` — IsolatedMemoryStore + engine report
- `src/daemon/routes/system.routes.ts` — engine report on overview
- `src/interfaces/onboard.ts` — explicit durable-memory consent (default yes)
- `test/ux/onboarding-yes.test.ts` — OnboardingState field
- `docs/OWNERSHIP.md` — regenerated (163 areas)

### Files not modified (on purpose)

Waived large modules were **not grown**: `workspace-store.ts`, `memory/store.ts`, `types.ts`, `config.ts`, `repository.ts`. Isolation and lifecycle were layered on top.

---

## 2. EXISTING SYSTEMS REUSED

Already correct and preserved:

- Progressive item lifecycle (`verbatim → summary → condensed → externalized`)
- Hybrid retrieval (lexical + semantic abstain + structured + RRF k=60)
- Render-time integrity gate + poison admission
- Conflict resolver + undo ledger + provenance
- Local-only lexical baseline
- Incremental content-addressed indexing (sha256 skip)
- `XRApp.switchWorkspace` canonical lifecycle (Phase 03)
- Separate SQLite file per workspace (`WorkspaceManager`)
- Memory-as-tools (`memory_search` / `memory_get` / `memory_navigate` / `memory_conflicts`)
- Config default `memory.enabled: true` + `XR_MEMORY_DISABLED=1` kill switch
- SkillEngine verifiability / freeze / regression / rollback

Extended (not replaced): MemoryStore, ContextService, injection, doctor, daemon memory/overview routes, onboarding.

---

## 3. MEMORY ARCHITECTURE

| Tier | Implementation | Durable | Authority |
|---|---|---|---|
| Session | `SessionMemory` | No | None |
| Working | `WorkingMemory` (bounded) | No | None |
| Durable | `IsolatedMemoryStore` + `ContextService` | Yes | Never — data only |
| Procedural | `SkillEngine` via `considerSkillPromotion` | Yes | Only after verification gates |

Session-scoped writes are refused by IsolatedMemoryStore.

---

## 4. RETRIEVAL

Unchanged formula. Temporal decay remains the existing freshness prior inside `computePrior`. Embedding stays optional; offline lexical always works.

`IsolatedMemoryStore` stamps `workspace_id` and filters stamped foreign rows. `authorize()` still rejects `workspace_mismatch` before ranking.

---

## 5. CONTEXT

- Progressive disclosure: metadata → summary (~1536) → full (explicit / high confidence / `expandIds`)
- Budget pipeline: SYSTEM → CORE → USER/WORKSPACE → ACTIVE TASK → RELEVANT MEMORY → TOOLS/SKILLS → RECENT CONVERSATION
- Derived from `CONTEXT_BOUNDS` / `TIER_POLICIES` — no second config
- `microCompact`: quality check, max retries, fallback = original conversation

---

## 6. WORKSPACE ISOLATION

**Implementation:** file-per-workspace (primary) + `workspace_id` stamp (defense) + IsolatedMemoryStore filter + authorize-before-rank + XRApp.switchWorkspace only.

**Tests:** A→B, B→A, A→C, C→A, concurrent, cached/semantic, assembly, shared-file detected, XRApp rebind.

**Results:** all pass. `WORKSPACE_A_SECRET` is not found in B; it is found again in A.

---

## 7. SECURITY

- Instruction-like memory is quarantined at admission (existing poison scan)
- Injection channel assignment unchanged — memory cannot become an instruction
- Secrets still go through `maskSecrets` (no second redactor)
- Provenance / integrity / undo unchanged
- Security suite: 112 pass / 0 fail (`test/context/security.test.ts` + `test/security/`)

---

## 8. PRIVACY

- Capture remains explicit (`remember …`) or consent-gated
- Onboarding now asks “Enable durable memory?” (default yes; `--yes` keeps it on)
- `XR_MEMORY_DISABLED=1` still wins
- Delete removes the row; IsolatedMemoryStore.remove also invalidates embeddings
- Revoke / undo / export unchanged and still honest

---

## 9. BENCHMARKS

Host: Linux x64, 2× Intel Xeon @ 2.60 GHz, 1.9 GiB RAM, Bun 1.3.14.

| Metric | p50 | p95 | p99 | Target |
|---|---:|---:|---:|---|
| Lexical recall, 50 entries, warm | 0.67 ms | 3.51 ms | 4.54 ms | p95 < 250 ms |
| Lexical recall, cold | 0.89 ms | 3.32 ms | 3.32 ms | p95 < 250 ms |
| Suite latency (30 samples) | 0.74 ms | 1.62 ms | 2.59 ms | p95 < 250 ms |
| Context assembly | 0.28 ms | 2.94 ms | 2.94 ms | — |
| Micro-compaction | 0.27 ms | 0.95 ms | 0.95 ms | — |
| Indexing 2nd pass | 0 embedded / 50 skipped | | | no amplification regression |

Phase 00 frozen baseline memory recall p95 was ~5.1 ms. No regression.

---

## 10. TEST RESULTS

| Gate | Result |
|---|---|
| typecheck | PASS |
| boundaries | PASS — 566 modules, 1857 deps, 0 violations |
| size-gate | PASS |
| hot-path-lint | PASS |
| claim-lint | PASS |
| Full suite | **3339 pass / 19 skip / 0 fail** (274 files) |
| Phase 09 tests | 32 pass |
| Security | 112 pass / 0 fail |
| Onboarding `--yes` | 5 pass (memory consent default-true) |

---

## 11. BASELINE COMPARISON

| Area | Status |
|---|---|
| Memory retrieval latency | Improved / still ≪ 250 ms |
| Indexing amplification | Unchanged (2nd reindex skips all unchanged rows) |
| Workspace isolation | Improved (explicit tests + IsolatedMemoryStore) |
| Doctor honesty | Improved (store-unavailable ≠ enabled) |
| CLI / daemon / security / reliability | Unchanged (full suite green) |
| Unexplained regressions | None |

---

## 12. REMAINING RISKS

1. **CLI `MemoryStore` paths** still go through the unwrapped engine. Isolation there still depends on separate SQLite files (the WorkspaceManager contract). IsolatedMemoryStore is used on daemon routes, ContextService extras, doctor/status, and tests.
2. **Unstamped legacy rows** in a *shared* database file would still be visible to both workspace ids. WorkspaceManager never shares files; `verifyWorkspaceIsolation` reports shared files as unverified.
3. **Default injection body** is now the 1536-char summary (was a 600-char line). Full suite is green; watch context size on very long memories.
4. **Doctor isolation field** is `unverified` unless a probe is run — we do not run the canary probe on every `xr doctor` (it writes). Isolation is proven by the automated test, not by a live canary in doctor.

None of these are exit-criterion failures.

---

## 13. FINAL VERDICT

PHASE 09 PASS
