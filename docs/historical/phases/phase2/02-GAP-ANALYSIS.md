# XR Phase 2 — STEP 2: Gap Analysis

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


Audited reality (STEP 1) vs. the XR Architecture Constitution (Art. III / IV / V / VI / XIV),
the Phase 2 Specification (Part D) and engineering standards. Ordered by dependency: a gap may only
be closed after every gap it depends on.

Legend — **EC** = the expand-contract sequence the task follows.

---

## G1 → T1 · Execution: four entry points, one required (Art. III.2, VI.3, VI "Violations")

**Constitutional text violated:** Art. VI Violations — *"A surface calling `runAgent` directly,
bypassing the service."* Art. III.2 — one source of truth per concern.

**Reality:** `runAgent` is called directly by shell (`app.ts:564`), telegram (`bot.ts:179`), voice
(`pipeline.ts:155`) and the fabric adapter (`agent-adapter.ts:183`). Each hand-builds `AgentDeps`,
so context assembly, routing audit, typed repos and scoping exist only on the `AgentService` path.

**Gap:** no canonical lifecycle object; no way to *prove* a surface used it.

**EC:** expand → define `ExecutionEnvelope` (intent→plan→policy→placement→action→observation→
evidence→outcome) + `AgentService.execute(envelope)`; migrate → each surface swaps its `runAgent`
call for the envelope, behaviour-preserving, one surface per step; contract → `runAgent` stops being
exported as an entry point and becomes internal to the envelope (`runAgentLoop`), enforced by an
architectural test that greps the module graph.

**Acceptance:** surface-parity test + "no surface bypasses the envelope" architectural test
(static import scan **and** a runtime assertion that the envelope is the only `runAgent` caller).

---

## G2 → T2 · Tool registration: four disjoint registries (Art. III "Compliant Designs", XIV, XV)

**Constitutional text violated:** Art. III Compliant Designs — *"A single `ToolRegistryService`
where core/plugins/skills/MCP register."* Art. XIV/XV — extension semantics must stay distinct.

**Reality:** `tools/registry.ts` (array literal), `plugins/registry.ts`, `skills/registry.ts`,
`mcp/registry.ts`. No namespacing → name collisions silently resolve by scan order, which is a
privilege-confusion vector (a plugin tool named `shell` vs. the core `shell`).

**Gap:** no single registration/discovery authority; no collision policy; no per-kind contract test.

**EC:** expand → `ToolRegistryService` with namespaced ids (`core:`, `plugin:<id>:`, `mcp:<server>:`,
`skill:<id>:`) and a `kind` discriminator that **preserves** runtime semantics; migrate → core tools
register through it; plugin/MCP/skill managers register through it; `AgentService` discovers through
it; contract → the ad-hoc `extraTools` concatenation in the envelope is replaced by registry
discovery.

**Constraint (Global Rule 6):** the registry unifies *registration & discovery only*. A prompt-pack
skill must not become a callable `Tool`; it stays a prompt contribution. Enforced by per-kind
contract tests.

---

## G3 → T3 · Routing: a second authority that can bypass locality (Art. III.2, IX, XX)

**Constitutional text violated:** Art. III.2; Art. IX/XIV (governance choke point); Part 20 of the
phase spec (locality bypass is security-relevant).

**Reality:** `ProviderRouter` delegates *selection* to `IntelligenceRouter` but keeps (a) its own
narrower locality derivation that ignores `private_only`/`no_cloud`, and (b) an `unavailable`
fallback that constructs `config.defaults.provider` directly, bypassing the locality decision.

**Gap:** two authorities; one of them can hand a cloud provider to a `no_cloud` workspace.

**EC:** expand → `RoutingService` facade over `IntelligenceRouter` as the sole authority, absorbing
the legacy `RoutingStrategy` translation and the fallback-diversity rule, with locality enforced
**on every path including exhaustion**; migrate → `ProviderService`, `intelligence/service.ts`,
tests move to the facade behind flag `XR_ROUTING_AUTHORITY`; contract → delete
`src/providers/routing.ts`, which also dissolves dependency cycle #1.

**Acceptance:** locality-invariant test proves `no_cloud`/`private_only`/`local_only` are honoured
even when no candidate is available (fail closed, never silently cloud).

---

## G4 → T4 · Planning: two planners, one unvalidated (Art. III.2, IV.1, IV.4)

**Reality:** `agents/planner.ts` → `WorkflowRecord`, no runtime validation. `control/planner.ts` →
`Action[]`, Zod-validated and fail-closed.

**Gap:** two authorities; asymmetric validation ⇒ the workflow path can accept a malformed
model-proposed plan (Art. IV.4 fail-closed violation).

**EC:** expand → `PlanningService` with two schema-validated output kinds
(`plan.kind === "workflow" | "control"`); migrate → both call-site families move to the service;
contract → the standalone planners become internal strategies of the service (no second entry).

---

## G5 → T5 · Context: two durable stores (Art. III.2, V "Compliant Designs")

**Constitutional text violated:** Art. V Compliant Designs — *"A `context/` module that owns all
durable context, with `memory/` retired on a dated schedule."* (The Constitution names this exact
retirement.)

**Reality:** `memory/` (9 files, 2 646 LOC, table `user_memory`, own CLI) and `context/` (15 files,
6 679 LOC, typed items, own CLI). Both CLI-exposed; both injected into the agent.

**Gap:** two stores, two CLIs, overlapping concern.

**EC:** expand → a **reversible Phase-1 migration** (`MIGRATION_2`) creating the canonical context
projection of `user_memory`, plus a dual-read compatibility window behind `XR_CONTEXT_AUTHORITY`;
migrate → all 18 production importers move to `context/`; `xr memory` becomes a deprecated alias
that forwards to `xr context` (Art. XXVII deprecation cycle, no broken stable surface);
contract → delete `src/memory/` on the dated schedule.

**Honesty constraint:** consent for legacy rows must remain `legacy_unknown` — never fabricated as
approved (this rule already exists in `context/memory-adapter.ts` and must survive).

---

## G6 → T6 · Workflow/Execution: two engines (Art. III.2, VI.3)

**Reality:** `WorkflowEngine` (DAG + human approval + versioning) and `ExecutionService` (durable
records + leases + checkpoints + recovery + adapters). Both define run lifecycle and persist state.

**Gap:** two run authorities; `execution/adapters/workflow-adapter.ts` proves the seam already hurts.

**EC:** expand → the DAG/node/state-machine model moves under `execution/` as
`execution/workflow/*`, owned by `ExecutionService` (one durable-run authority, one state machine
per level with an explicit mapping); migrate → all `workflow/*` importers repoint; contract →
delete `src/workflow/`.

**Constraint:** Phase-0 executor-delegation (T3 of Phase 0) must survive — the engine must keep
delegating to an injected agent runner, never re-implement the loop.

---

## G7 → T7 · Giant files (Art. IV.2, V.3)

**Reality:** 11 files ≥ 1 000 LOC (dashboard 3 619, workspace-store 1 609, plugins/loader 1 586,
shell/app 1 203, execution/service 1 188, memory/store 1 166, workflow/engine 1 163, shield 1 134,
context/repository 1 069, config 1 020, enterprise/types 1 171).

**Gap:** no size budget, no gate, no owned split plan.

**EC:** not applicable (pure refactor). Split by responsibility, behaviour-identical, then add a
CI size gate at **800 LOC** with an explicit, owned, dated waiver file. Files retired by T5/T6
(memory/store, workflow/engine) are removed rather than split.

---

## G8 → T8 · No enforced boundaries (Art. V.2, V "Acceptance Criteria")

**Constitutional text violated:** Art. V.2 — *"Dependency direction is explicit and acyclic; an
architectural test enforces it."* Art. V Acceptance — *"Dependency-cycle test green."*

**Reality:** zero boundary tooling; 3 live cycles.

**Gap:** nothing prevents regression.

**EC:** n/a. Add `.dependency-cruiser.cjs` encoding the L0–L6 table + `no-circular` + orphan rules,
run **via bun** (node-compat 24; the repo has no npm/node toolchain in CI), plus an in-repo
architectural test so the rule survives even without the external binary. Wire both into CI.

**Note on `eslint-plugin-boundaries`:** the repo has **no ESLint** and a bun-only, near-zero-dependency
policy (2 runtime deps). Adding the full ESLint stack (~180 transitive packages) to satisfy a tool
name would violate Art. IV/subtraction-before-addition and Part 19's no-regression posture. The
*requirement* — real-time, element-type-based boundary policies enforced in CI — is met by
dependency-cruiser (which encodes the same element/dependency-policy model, including cross-boundary
and orphan rules) **plus** a native architectural test that runs in `bun test` on every commit,
giving developers the same fast local feedback loop. This deviation is recorded in
`docs/adr/0005` with rationale, owner and review date, as Art. V/§Exceptions requires.

---

## G9 → T9 · Phase-named modules (Art. V.1, V.4, V "Forbidden Practices")

**Constitutional text violated:** Art. V Forbidden — *"Phase-named directories."* Art. V.1 —
*"Modules map to the L0–L6 boundary table, not to roadmap phases."*

**Reality:** all six named in the Constitution's own rationale are present: `baseline/`,
`capabilities/`, `deployment/`, `environment/`, `evaluation/`, `trust/`; `src/` has 47 top-level
entries.

**Gap:** structure encodes roadmap history, not architecture.

**EC:** fold each into its L0–L6 home via directory moves + re-export shims during the window, then
delete the shims. `trust/` and `capabilities/` are *concerns*, not phases — they move to their layer
homes (`runtime/trust`, `platform/capabilities`) rather than disappearing.

---

## Ordering (dependency-resolved)

```
T8 (baseline tooling, non-blocking)  ─┐
T2 (registry)  ← T1 needs it for discovery
T1 (envelope)  ← depends on T2
T3 (routing)   ← independent, dissolves cycle 1
T4 (planning)  ← independent
T5 (memory→context)   ← touches T1 deps
T6 (workflow→execution) ← touches T4 output kind
T7 (splits)    ← after T5/T6 delete two giants
T9 (phase folders) ← last; largest churn, must not fight other moves
T8 (final enforcement: cycles 0, boundary table on)
```

## Non-goals (explicitly out of scope — Part 9, Part 23)

- Risk-tiered isolation / sandbox hardening → **Phase 4**.
- Performance optimisation beyond unification's incidental gains → **Phase 3**.
- Any net-new user-visible feature → forbidden this phase.
