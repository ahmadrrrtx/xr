# ADR-0009 — Restrictiveness Lattice (Escalate-Only Isolation Placement)

- **Status:** Accepted (Phase 4 · T1)
- **Owner:** Trust/Security Lead
- **Date:** 2026-08-01
- **Constitution:** Art. IX.2 (isolation follows risk), Art. IV.4 (fail closed),
  Art. XII (low-risk stays fast). Art. IX: agents/capabilities may only
  ESCALATE isolation, never downgrade.

## Context

Phase 2 recorded placement on the execution envelope but nothing enforced it;
the canonical agent loop could execute a high-risk shell command with full
host authority. Isolation backends existed (in-process, restricted-process,
namespace sandbox, container) but selection was per-tier adequacy, with no
ordering principle and no per-run monotonicity. A capability could also
declare permissions that implied a lower tier than policy demanded.

## Decision

1. **Total order (lattice) over placements** (`src/runtime/trust/lattice.ts`):
   `in_process < restricted_process < namespace_sandbox < container ≈
   browser_isolated < gvisor < firecracker`. `atLeastAsRestrictive`,
   `mergePlacements` (max), `placementSatisfiesTier`.
2. **Escalate-only merge**: effective tier = max(classified tier,
   capability-declared `minimumTier`, per-run escalated tier). `TrustService`
   tracks per-run escalation (`runTiers`, `runPlacements`); once a run
   reaches a tier/placement, later actions in the run cannot go below it.
3. **Backend selection stays adequacy-based** (cheapest adequate backend for
   the tier — Art. XII: sub-ms tool calls must not cold-start a microVM); the
   lattice governs MERGES, minimums, and refusals, and the record (`envelope`
   outcome placement, trust record) always reflects the strongest placement
   ACTUALLY enforced, not a label.
4. **Hardened mode** (`security.hardened`, default true; env
   `XR_TRUST_HARDENED=0` to opt out): the tier-1 in-process fallback is
   refused even when configured; unisolated high-risk paths are refused.
5. **Extended placements** gvisor/firecracker are detection hooks: selected
   only when the runtime is present; otherwise fail closed. MicroVM
   orchestration is deferred (Phase 5+).

## Consequences

- High-risk actions can no longer run with host authority by default; proven
  by `test/trust/canonical-shell-isolation.test.ts` (real loop, real backend,
  marker-file effect assertion) and `test/trust/lattice.test.ts`.
- Capability authors can declare `minimumTier` to demand MORE isolation;
  they cannot demand less.
- The guarantee matrix (`scripts/guarantee-matrix.ts`) is generated from the
  same lattice + live probes, so claims are machine-checked.
- Trade-off: per-run state adds a small bookkeeping map; cost is negligible
  vs. the isolation actions themselves.
