# XR Phase 2 — STEP 4: Architecture Validation (before code)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


Each task is validated against the Constitution and the Phase 2 scope **before** implementation.
A plan is rejected if it leaves a second authority, collapses distinct extension semantics, breaks a
Phase-0/1 guarantee, adds a feature, or migrates data irreversibly.

Removal dates use the phase calendar: Phase 2 lands `7.1.0`. "Dated removal" for an intra-phase
retirement means **the removal commit is inside this phase** (Part 13.5 forbids stopping at the
facade); the ADR records the expansion window explicitly.

---

## T1 — Execution envelope + `AgentService` as sole entry

| Check | Result |
|---|---|
| One authority after change? | Yes — `ExecutionEnvelope` is the only lifecycle; `runAgent` becomes the envelope's private loop step. |
| Distinct semantics collapsed? | No — the envelope carries *phases*, not extension types. |
| Phase-0/1 preserved? | Yes — Phase-0 `extraTools` bridge is absorbed (surfaces get *more* parity, not less); Phase-1 stores untouched. |
| Net-new feature? | No — no new user-visible capability; surfaces gain only the parity Phase 0 already intended. |
| Reversible? | Yes — `XR_EXECUTION_ENVELOPE=legacy` restores the pre-Phase-2 direct path during the window. |

**EC steps.** (1) expand: add `src/core/execution/envelope.ts` + `AgentService.execute()` beside
`runAgent`. (2) migrate: shell → telegram → voice → adapter, each behaviour-preserving, each with a
parity assertion. (3) contract: rename the loop `runAgentLoop`, stop exporting it as an entry point,
delete the flag, and land the architectural test that fails if any module outside
`core/execution/` imports the loop. **Removal milestone: within Phase 2 (this branch).**

**Verdict: APPROVED.**

---

## T2 — Single `ToolRegistryService`

| Check | Result |
|---|---|
| One authority? | Yes — one registration + discovery surface for all four contribution sources. |
| Distinct semantics collapsed? | **No — explicitly preserved.** Each entry keeps a `kind` (`core`/`plugin`/`mcp`/`skill`) and its own runtime invocation path. A prompt-pack skill is registered as a **prompt contribution**, never as a callable tool. Per-kind contract tests enforce this. |
| Phase-0/1 preserved? | Yes — `REMOVED_STUB_TOOLS` stays a deny-list; no stub may register. |
| Net-new feature? | No — namespacing/collision policy is a *correctness* fix for an existing privilege-confusion defect, not a capability. |
| Reversible? | Yes — registration is in-memory; no persisted schema change. |

**EC steps.** (1) expand: `ToolRegistryService` + namespaced ids + alias map so unqualified legacy
names keep resolving. (2) migrate: core/plugins/mcp/skills register through it; envelope discovers
through it. (3) contract: `tools/registry.ts` becomes the core-tool *contribution source* only
(`coreToolContributions()`), and no consumer builds its own tool list. **Removal milestone: within Phase 2.**

**Verdict: APPROVED** (subject to the semantics-contract tests being written first).

---

## T3 — One routing authority

| Check | Result |
|---|---|
| One authority? | Yes — `IntelligenceRouter` via `RoutingService`; `providers/routing.ts` **deleted**. |
| Security improvement? | Yes — closes the locality bypass (legacy fallback ignored `no_cloud`/`private_only`). |
| Phase-0/1 preserved? | Yes — Phase-0's fallback-diversity fix (`routing.ts:161-180`) is **carried into** the facade, not dropped. Explicitly re-tested. |
| Net-new feature? | No. |
| Reversible? | Yes — flag `XR_ROUTING_AUTHORITY=legacy` during the window; no persisted state. |
| Cycle impact | Dissolves dependency cycle #1. |

**EC steps.** (1) expand: `src/intelligence/routing-service.ts` facade absorbing strategy
translation + fallback diversity + **fail-closed locality on exhaustion**. (2) migrate:
`ProviderService`, `intelligence/service.ts`, `agents/types.ts`, tests. (3) contract: delete
`src/providers/routing.ts`. **Removal milestone: within Phase 2.**

**Verdict: APPROVED.**

---

## T4 — One `PlanningService`

| Check | Result |
|---|---|
| One authority? | Yes — one service, two schema-validated output kinds. |
| Distinct semantics collapsed? | No — a workflow DAG and a control action list stay distinct *outputs*; only the planning authority is unified. |
| Fail-closed? | Improved — the workflow kind gains the Zod validation the control kind already had (Art. IV.4). |
| Net-new feature? | No. |
| Reversible? | Yes — pure code path. |

**EC steps.** (1) expand: `src/services/planning-service.ts` with `plan({kind:"workflow"|"control"})`
+ Zod schemas for both. (2) migrate: `multi-agent-service`, `commands/agents`, `daemon/control-api`,
`daemon/routes/control.routes`, `tools/control`. (3) contract: planners become non-exported
strategies behind the service. **Removal milestone: within Phase 2.**

**Verdict: APPROVED.**

---

## T5 — One context store (`memory/` retired)

| Check | Result |
|---|---|
| One authority? | Yes — `context/` owns durable context; `src/memory/` **deleted**. |
| Constitution alignment | Art. V names this exact design as the compliant example. |
| Data safety | Reversible numbered migration (`up`/`down`), executed inside the Phase-1 `WriteGate` (single `BEGIN IMMEDIATE`). Round-trip test asserts lossless restore. |
| Consent honesty | `legacy_unknown` preserved — consent is never fabricated (Art. IV.5, P5). |
| Stable surface | `xr memory …` kept as a **deprecated alias** forwarding to `xr context` (Art. XXVII); removed no earlier than 8.0.0. |
| Net-new feature? | No. |

**EC steps.** (1) expand: `MIGRATION_2` adds the canonical projection; `ContextAuthority` dual-reads
legacy + canonical behind `XR_CONTEXT_AUTHORITY`. (2) migrate: 18 production importers repoint; the
memory engine used by the envelope becomes a `context/`-owned adapter. (3) contract: delete
`src/memory/`; keep the CLI alias with a deprecation notice. **Removal milestone: `src/memory/`
deleted within Phase 2; CLI alias retired in 8.0.0 (dated).**

**Verdict: APPROVED.**

---

## T6 — One execution engine (`workflow/` retired)

| Check | Result |
|---|---|
| One authority? | Yes — `ExecutionService` owns durable runs; the DAG model moves under `execution/workflow/`. |
| Phase-0 preserved? | Yes — `WorkflowAgentRunner` delegation (Phase 0 · T3) is carried over verbatim; the engine must never re-implement the agent loop. Re-tested by `test/phase0/workflow-effects.test.ts`. |
| Data safety | Workflow run state stays in the same tables/repo (moved module, unchanged schema) → no data migration needed, therefore trivially reversible. Verified by keeping `WorkflowRepo` and its table DDL byte-identical. |
| Net-new feature? | No. |

**EC steps.** (1) expand: move `types/nodes/state-machine/versioning/engine/inspection/repository`
under `src/execution/workflow/`, re-export from the old paths. (2) migrate: repoint all importers.
(3) contract: delete `src/workflow/`. **Removal milestone: within Phase 2.**

**Verdict: APPROVED.**

---

## T7 — Split giant files

| Check | Result |
|---|---|
| Behaviour change? | None permitted — splits are mechanical moves + re-exports; the full suite must stay green. |
| Threshold | 800 LOC, enforced by a CI gate with an **owned, dated waiver list** (Art. V.3 allows an over-threshold module only *with an owned plan*). |
| Startup regression? | Splits reduce per-module parse cost and preserve lazy `await import()` seams; measured before/after (Art. XII). |

**Verdict: APPROVED.**

---

## T8 — Enforced acyclic boundaries

| Check | Result |
|---|---|
| One authority for boundary policy? | Yes — **one** rule set (`.dependency-cruiser.cjs`) consumed by both the CI job and the in-repo architectural test. Adding ESLint would create a second policy source (Cmdt 6 violation) — rejected; recorded in ADR-0005. |
| Enforced, not documented? | Yes — CI fails on a seeded cycle and on a seeded cross-boundary import; proven by a negative test. |
| Dynamic imports | Covered: the graph includes `dynamic: true` edges, and the architectural test additionally scans dynamic specifiers. |

**Verdict: APPROVED with documented deviation (ADR-0005).**

---

## T9 — Remove phase-named modules

| Check | Result |
|---|---|
| One home per concern? | Yes — each folder moves to its L0–L6 home. |
| Concern deleted? | No — `trust/`, `capabilities/`, `environment/`, `evaluation/`, `deployment/`, `baseline/` are *relocated*, not removed. No capability is lost. |
| Stable surface | Internal module paths only; no public CLI/API path changes. |
| Reversible? | Yes — pure moves, recorded in the ADR with the old→new map. |

**Verdict: APPROVED.**

---

## Cross-cutting guards applied to every task

1. Full suite (2033 tests) must be green after **each** task, not only at the end.
2. `bun run typecheck` clean after each task.
3. No new `any` / empty `catch` on touched trust/execution/API/persistence boundaries (Art. IV.1).
4. Startup sampled before/after (Art. XII).
5. Each retirement gets an ADR with: expansion window, migration path, reversibility reference, removal date.
