/**
 * XR 4.3 — Unified Execution Fabric with Durable Agency (public entry point).
 *
 * ── Phase 2 · T6: ONE execution engine ──────────────────────────────────────
 *
 * XR had two run authorities: `ExecutionService` (durable records, leases,
 * checkpoints, recovery) and `WorkflowEngine` (DAG, human approval, versioning)
 * in a separate top-level `src/execution/workflow/`. Both defined a run lifecycle and
 * both persisted run state — a duplicate L1 concern, which Art. VI.3 forbids
 * ("one durable-execution path … one workflow substrate").
 *
 * `src/execution/workflow/` is retired. The DAG substrate now lives at
 * `src/execution/workflow/`, owned by this module, and is re-exported below
 * under the `workflow` namespace so the two models compose explicitly instead
 * of competing:
 *
 *   · `ExecutionService`  — WHAT ran, durably: records, leases, recovery.
 *   · `workflow.*`        — HOW a multi-step run is shaped: nodes, DAG, state.
 *
 * The workflow engine keeps delegating agent work through its injected
 * `WorkflowAgentRunner` (Phase 0 · T3) — it must never re-implement the loop.
 *
 * The namespace import is deliberate: `workflow/types.ts` and
 * `execution/types.ts` both define run/state vocabularies, and flattening them
 * into one namespace would silently collide two state machines. Keeping
 * `workflow.*` explicit preserves the distinction the audit found.
 */
export * from "./types.ts";
export * from "./errors.ts";
export * from "./state-machine.ts";
export * from "./service.ts";
export * from "./repository.ts";
export * from "./inspection.ts";
export * from "./checkpoint.ts";
export * from "./lease.ts";
export * from "./lane.ts";
export * from "./recovery.ts";
export * as adapters from "./adapters/index.ts";
export * as workflow from "./workflow/index.ts";
