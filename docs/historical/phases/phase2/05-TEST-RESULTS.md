# XR Phase 2 — STEP 7/8: Test Results & Measurements

All figures measured on the Phase-2 branch head, Linux (Ubuntu, bun 1.3.14).
Baseline figures measured on `c1c1831` via a clean `git worktree`.

---

## 1. Suite results

| Gate | Baseline (`c1c1831`) | Phase 2 | Status |
|---|---|---|---|
| `bun test` | 2033 pass / 0 fail (136 files) | **2235 pass / 0 fail** (145 files) | ✅ +202 tests |
| `bun run typecheck` | clean | **clean** | ✅ |
| `bun run release:check` | 6/6 surfaces in sync | **6/6 in sync at 7.0.1** | ✅ |
| `bun run claim-lint` | 8 evidenced claims | **8 evidenced claims, 0 unsupported** | ✅ |
| `bun run baseline:inventory` | ok | **ok** | ✅ |
| `bun run reliability:test` | 52 pass / 0 fail | **52 pass / 0 fail** | ✅ no regression |
| `bun run golden-path` | `ok:true` | **`ok:true`, 17 checks, chainValid** | ✅ no regression |
| `bun run mutation:run` | PASS (5 modules) | **PASS (8 modules)** | ✅ +3 gated |
| `bun run boundaries` | *did not exist* | **0 violations / 485 modules** | ✅ new |
| `bun run size-gate` | *did not exist* | **pass** | ✅ new |

## 2. New Phase-2 test suites

| File | Tests | Proves |
|---|---|---|
| `test/core/no-bypass.test.ts` | 7 | No surface bypasses the envelope (static + dynamic-aware, seeded control) |
| `test/core/envelope.test.ts` | 11 | The envelope produces real **effects**: session rows, audit entries, files on disk, fail-closed approval |
| `test/tools/semantics-contract.test.ts` | 23 | One registry; per-kind semantics preserved; collision policy fails closed |
| `test/intelligence/locality-invariant.test.ts` | 90 | Locality enforced on every path; Phase-0 T11 diversity preserved; mutation-hardened |
| `test/services/planning-service.test.ts` | 14 | One planner, both output kinds schema-validated |
| `test/state/memory-to-context-migration.test.ts` | 17 | Lossless, exactly reversible migration; round-trip stable |
| `test/architecture/boundaries.test.ts` | 18 | Acyclicity + L0–L6 table + retired-module bans, with 4 seeded violations |
| `test/architecture/size-gate.test.ts` | 12 | Size threshold with owned plans; 3 seeded violations |
| `test/daemon/dashboard-split.test.ts` | 9 | The split is **byte-identical** to the pre-split output (SHA-256 pinned) |
| `test/phase0/surface-parity.test.ts` | 6 (re-based) | Phase-0 parity guarantee preserved on the new mechanism |

**Every suite asserts effects**, not transitions: which `run()` executed, what is
on disk, which rows exist, whether the chain verifies.

## 3. Dependency graph

| | Baseline | Phase 2 |
|---|---|---|
| Modules cruised | 509 | 485 |
| **Runtime cycles** | **3** | **0** |
| Cycle 1 | `intelligence/index → service → providers/routing → router` | dissolved (T3) |
| Cycle 2 | `control/computer-use ↔ control/service ↔ environment/service` | dissolved (T8) |
| Cycle 3 | `evaluation/compatibility ↔ evaluation/index` | dissolved (T8) |
| Boundary violations | not measured (no tooling) | **0** |

Type-only cycles (erased at compile time) are reported at `warn` and bounded by
the architectural test — see ADR-0005.

## 4. Mutation gate

Threshold 0.6. Three Phase-2 authorities were **added** to the gate.

| Module | Score | Note |
|---|---|---|
| `state/write-gate.ts` | 1.00 | Phase 1 |
| `integrations/credentials.ts` | 1.00 | Phase 0 |
| `services/review-decision.ts` | 0.84 | Phase 0 |
| `tools/registry-service.ts` | **0.78** | **new (T2)** |
| `execution/state-machine.ts` | 0.75 | pre-existing |
| `state/workspace-store.ts` | 0.74 | Phase 1 |
| `intelligence/routing-service.ts` | **0.71** | **new (T3)** — was 0.43, see below |
| `core/execution/envelope.ts` | **1.00** | **new (T1)** |

### The routing-service finding (an honest one)

The gate initially scored `routing-service.ts` at **0.43** — below threshold.
That was a real signal: most operator flips inside the routing authority did not
break a single test, so the suite was asserting far less than it appeared to.

A survivor probe identified the untested branches (fallback-chain selection,
`wrapFallbackLegacy`, `isLocal`/`findBestLocal`). Rather than contriving
scenarios to reach otherwise-unreachable code, the decisions were extracted into
**pure, exported predicates** — `legacyFallbackAllowed`, `isLocalPreset`,
`findBestLocalTarget` — which is better design independent of testing, and their
truth tables were pinned. **0.43 → 0.71.**

## 5. Startup (Art. XII — no regression)

12 samples per command, same machine, clean worktree for the baseline.

| Command | Baseline median | Phase 2 median | Δ | Baseline σ | Within noise? |
|---|---|---|---|---|---|
| `xr --version` | 175.0 ms | 177.0 ms | **+2.0 ms** | 5.0 ms | ✅ (< 2σ = 10.0) |
| `xr help` | 172.5 ms | 178.0 ms | **+5.5 ms** | 4.3 ms | ✅ (< 2σ = 8.6) |

**No startup regression.** Both deltas are inside sample noise. Lazy boot is
preserved: `--version` and `help` still never boot the kernel, and the three
interactive surfaces still avoid it by design (which is precisely why
`executeOnSurface` exists rather than forcing them through `AgentService`).

No performance *improvement* is claimed. Optimisation is Phase 3.

## 6. Source size — honest accounting

Measured with comments and blank lines excluded, and with the eight module
relocations mapped so moved files are compared like-for-like.

| | Baseline | Phase 2 | Δ |
|---|---|---|---|
| Files | 458 | 470 | +12 |
| Total lines | 122 750 | 124 750 | +2 000 |
| **Executable code lines** | **97 557** | **98 625** | **+1 068** |
| Comments / blank | 25 193 | 26 125 | +932 |

### Where the +1 068 came from

| Cause | Δ code | Comment |
|---|---|---|
| Giant-file splits (dashboard, loader) | **+82** | Mechanical; dashboard output is byte-identical |
| Retirements + reversible migration | **+68** | `routing.ts` (−276) and `extensibility-bridge.ts` (−49) deleted; `RoutingService` (+279) and `MIGRATION_2` (+114) added |
| **New single authorities** | **+700** | envelope (128), runner (59), registry (171+75+47), planning-service (120), surface-execution (100) |
| Call-site rewiring | **+218** | agent-adapter, agent-service, agent, barrels |

### This does not meet a "reduce core LOC" target — stated plainly

Phase 2's deliverables list "reduced core LOC". **Core LOC increased by 1 068
executable lines (+1.1%).** Claiming otherwise would be exactly the
evidence-before-claim violation this project exists to prevent.

The honest reading:

- **Four *files* were deleted outright** (`providers/routing.ts`,
  `services/extensibility-bridge.ts`) and **two top-level modules retired into
  existing homes** (`memory/`, `workflow/`), plus six phase-named modules folded
  away. `src/` went from **47 → 41** top-level entries.
- **The +700 is the cost of the consolidation itself.** An execution envelope, a
  tool registry with collision arbitration, and a planning service are *new
  code that replaces distributed, duplicated logic*. The duplication they
  replaced was not concentrated in deletable files — it was spread across four
  hand-built `AgentDeps` constructions, four registration sites and two
  validation regimes. Removing it deleted lines from many files (+218 net after
  rewiring, because the call-sites became envelope construction).
- **The genuine reduction is in authorities, not lines**: 4 execution entries →
  1, 4 registries → 1, 2 routers → 1, 2 planners → 1, 2 context stores → 1,
  2 engines → 1, 3 cycles → 0, 6 phase-named modules → 0.

A future phase that removes the deprecated compatibility surfaces
(`runAgent` alias, `AgentDeps.extraTools`, the `user_memory` table and its
engine at ~848 code lines) will convert this into a net reduction. Those are
scheduled for 8.0.0 in ADR-0002/0003/0006 and are deliberately *not* removed now
because doing so would break reversibility and the deprecation cycle.

## 7. Giant files

| File | Baseline | Phase 2 |
|---|---|---|
| `daemon/dashboard.ts` | **3 619** | **48** (+ 3 modules: 1739/1301/594) |
| `plugins/loader.ts` | **1 586** | **89** (+ 3 modules: 766/503/365, all under threshold) |
| `memory/store.ts` | 1 166 | relocated to `context/memory/` (T5) |
| `workflow/engine.ts` | 1 163 | relocated to `execution/workflow/` (T6) |

17 modules remain over 800 LOC, each with an owned, dated split plan in
`docs/phase2/SIZE-WAIVERS.json`. The gate fails if any of them grows, if a
waiver goes stale, or if a new module lands over threshold unwaived.
