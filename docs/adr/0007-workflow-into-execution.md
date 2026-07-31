# ADR 0007 — Retiring `src/workflow/` into the execution fabric

**Status:** Ratified (Phase 2, 2026-07-31)
**Applies to:** Durable run state and the multi-step workflow substrate
**Supersedes:** `src/workflow/` as a top-level module — **removed**
**Constitutional basis:** Art. VI.3 (*"one durable-execution path … one workflow
substrate"*), Art. III.2, §2.2 boundary law (*"A second implementation of any
L0/L1 concern is a defect, not a feature"*)

---

## Context

Two L1 run authorities existed:

| Module | Files | LOC | Owns |
|---|---|---|---|
| `src/workflow/` | 8 | 3 436 | `WorkflowEngine`, DAG/nodes, state machine, versioning, human approval, repository |
| `src/execution/` | 19 | 5 262 | `ExecutionService`, durable records, leases, checkpoints, recovery, 9 adapters |

They are complementary in *content* but duplicative in *authority*: both defined
run lifecycle states and both persisted run state. The existence of
`execution/adapters/workflow-adapter.ts` is direct evidence that the seam
already required maintenance.

## Decision

**1. `ExecutionService` is the single durable-run authority.** The DAG substrate
moved to `src/execution/workflow/` and is owned by the execution fabric.
`src/workflow/` is **deleted**.

**2. The two models compose explicitly rather than compete.**

- `ExecutionService` — **what ran, durably**: records, leases, checkpoints,
  recovery.
- `workflow.*` — **how a multi-step run is shaped**: nodes, DAG, state machine,
  versioning, human approval.

**3. Re-exported as a namespace, not flattened.**

```ts
export * as workflow from "./workflow/index.ts";
```

This is deliberate. `workflow/types.ts` and `execution/types.ts` both define
run/state vocabularies; a flat `export *` would silently collide two state
machines and re-create the ambiguity this ADR removes. The namespace keeps the
distinction the audit found.

**4. Phase-0 · T3 delegation is preserved verbatim.** The engine continues to
delegate agent work through its injected `WorkflowAgentRunner`. It must never
re-implement the loop — and cannot, since `test/core/no-bypass.test.ts` forbids
importing it.

## Why no data migration was needed

`WorkflowRepo` and its table DDL are **byte-identical**; only the module path
changed. There is no schema delta, so the change is trivially reversible — a
`git mv` back. This is a deliberate property of the design, not luck: the
retirement was scoped to move the *code* home without touching the *data*
shape, following the expand-contract guidance to keep data in place while
extracting functionality.

## Enforcement

- `test/phase0/workflow-effects.test.ts` — the Phase-0 executor-delegation
  effect tests still pass unchanged.
- `test/workflow/engine.test.ts`, `test/workflow/types.test.ts` — the full
  engine and state-machine suites pass against the relocated modules.
- `test/architecture/boundaries.test.ts` — fails the build if any module imports
  `src/workflow/` again.

## Consequences

**Positive.** One durable-run authority. The workflow adapter's bridging role
becomes composition rather than translation between rival engines. Two
over-threshold files (`workflow/engine.ts`, `workflow/types.ts`) moved under an
owner that now has a split plan.

**Negative.** `src/execution/` is now a larger subtree. That is the correct
trade: one large, coherent L1 subsystem beats two competing ones (P6 — *"a
smaller coherent platform is superior to a larger incoherent catalog"*).

## Removal schedule

| Item | Status | Removal |
|---|---|---|
| `src/workflow/` as a top-level module | **removed** in Phase 2 | done |
| `execution/workflow/engine.ts` node-executor split | owned plan recorded | Phase 3 (see `docs/phase2/SIZE-WAIVERS.json`) |
