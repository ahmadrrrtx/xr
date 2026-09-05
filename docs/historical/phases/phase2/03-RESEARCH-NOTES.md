# XR Phase 2 — STEP 3: Research Notes (principles adopted, with sources)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


Principles are **adopted, not copied**. Each entry records the principle, the source, and the exact
way XR applies it in Phase 2.

---

## R1 — Strangler Fig (system-level replacement)

**Principle.** Replace a legacy component incrementally by building the successor alongside it and
routing traffic through a facade, moving call-sites over one at a time; delete the legacy only when
it has no remaining consumers. Never big-bang.

**Source.** Martin Fowler, *StranglerFigApplication* (2004; term coined) — summarised and applied in
current practice at
<https://www.devleader.ca/2026/07/24/strangler-fig-pattern-in-c-refactoring-a-monolith-to-microservices>:
*"rather than replacing the entire system at once, you incrementally extract and replace pieces while
the rest of the system continues to run normally"*, with a **strangler facade** as the single entry
clients keep using.

**XR application.** T3 (routing) and T6 (workflow→execution) are system-level: `RoutingService` and
`ExecutionService` are the facades; the legacy modules keep running until their consumer count
reaches zero, then are deleted in the same phase (Part 13.5 forbids stopping at the facade).

---

## R2 — Parallel Change / Expand–Contract (interface-level)

**Principle.** Three explicit phases: **expand** (add the new form beside the old), **migrate**
(move consumers at their own pace), **contract** (remove the old form). Consumers never observe a
breaking change.

**Source.** Martin Fowler, *Parallel Change* (bliki, 2014) — <https://martinfowler.com/bliki/ParallelChange.html>:
*"Parallel change, also known as expand and contract, is a pattern to implement backward-incompatible
changes to an interface in a safe manner, by breaking the change into three distinct phases: expand,
migrate, and contract."*

**XR application.** Every retirement in Phase 2 is structured as literally these three steps, and
each ADR records the window and the removal date. T2's namespaced ids are an expand step (old
unqualified names keep resolving through an alias map during migration); T1's envelope is expanded
beside `runAgent` before the surfaces move.

---

## R3 — Expand–Contract for data/schema migration (dual-write, backfill, cut over, drop)

**Principle.** For stores: add the new structure, dual-write, backfill, switch reads, then drop the
legacy structure. Prefer leaving data in place while extracting functionality, then migrate the data.

**Source.** Scott Ambler & Pramod Sadalage, *Refactoring Databases* (2006), as carried forward in
current guidance: *"add the new column, dual-write, backfill, cut over reads, drop the old column …
the database case is the clearest instance of the pattern"* — <https://aipatternbook.com/parallel-change>.

**XR application.** T5 (`memory/` → `context/`): a numbered, **reversible** Phase-1 migration
(`up()`/`down()`, recorded in `schema_migrations`) performs the backfill inside the single-writer
`WriteGate`, so the whole migration is one serialized `BEGIN IMMEDIATE` transaction — atomic against
concurrent XR processes. A dual-read compatibility window keeps legacy rows readable; `down()`
restores the pre-migration state, and the round-trip is asserted by a test.

---

## R4 — Branch by Abstraction + feature flags (choosing where the suture goes)

**Principle.** Introduce a stable abstraction between callers and the current implementation, build
the replacement behind it, and use a flag to route between old and new until the old can be deleted.
Strangler Fig puts the suture in the *routing layer*; Branch by Abstraction puts it *inside the code*.

**Source.** <https://emmanuelvalverderamos.substack.com/p/parallel-change-how-to-evolve-live>:
*"a stable interface is introduced between callers and the current implementation, the new
implementation is built behind it, and a feature flag routes traffic between old and new until the
old one can be deleted … The distinction … is the location of the suture."*

**XR application.** T1/T3/T5 use in-code sutures (`ExecutionEnvelope`, `RoutingService`,
`ContextAuthority`) with env-var flags (`XR_EXECUTION_ENVELOPE`, `XR_ROUTING_AUTHORITY`,
`XR_CONTEXT_AUTHORITY`) that default to the new path and allow one-command rollback to legacy during
the window. Flags are removed at contract time so they cannot become permanent forks.

---

## R5 — Consumer/contract tests guard behaviour across the migration

**Principle.** The consumer states its expectations of the provider as an executable contract; the
provider verifies against it. Contracts make a substitution safe because both sides are checked
against the same, shared expectation rather than against each other's implementation.

**Source.** Pact documentation — <https://docs.pact.io/implementation_guides/javascript/docs/messages>:
*"the API Consumer writes a test to set out its assumptions and needs of its API Provider(s) …
prevent breaking changes"*; extended to service-to-service contracts and deprecation lifecycles by
Sam Newman, *Building Microservices* (2e, 2021).

**XR application.** Rather than adding the Pact broker stack (unjustifiable for an in-process
monolith — subtraction before addition), XR encodes the same idea natively: **per-extension-kind
semantics-contract tests** (T2) assert the invariants each *consumer* of the registry relies on
(a plugin tool is isolated & permissioned; an MCP tool is protocol-bound & remote; a skill is a
prompt contribution and is **never** callable as a tool; a core tool is in-process), and
**interface-parity tests** (T1) assert every surface presents the identical tool set and honours the
identical policy. These are consumer-stated expectations verified against the single provider.

---

## R6 — Module-boundary & dependency-direction enforcement in TypeScript

**Principle.** Encode architecture as machine-checked rules: forbid circular dependencies, forbid
cross-layer imports against the allowed direction, and detect orphans — then fail CI on violation.
The value is that *drift becomes visible early*, before a cycle forms.

**Sources.**
- dependency-cruiser rule model (`forbidden[]` with `from`/`to` path selectors, `circular: true`,
  `orphan: true`, `tsPreCompilationDeps`, CI integration) —
  <https://dev.to/jacobandrewsky/avoid-cross-module-dependencies-with-dependency-cruiser-3b0b> and
  <https://developer.mamezou-tech.com/en/blogs/2024/04/17/chatgpt-dependen-cycruiser/>.
- Layer-direction encoding (Clean-Architecture style: a lower layer may never import a higher one) —
  <https://medium.com/better-programming/validate-dependencies-according-to-clean-architecture-743077ea084c>
  (notes explicitly that `no-circular` alone is insufficient: a forbidden *direction* that does not
  yet close a loop must also be declared).
- Stable-Dependencies rationale: *"The upward arrow does not have to produce a cycle immediately. But
  it creates the structural condition in which a cycle will eventually form"* —
  <https://dev.to/wojciech_kot_b82f5d7cbfc6/stop-circular-dependencies-before-they-stop-you-dependency-cruiser-the-stable-dependencies-34ho>.

**XR application.** T8 encodes the L0–L6 table as explicit `forbidden` rules (not comments), plus
`no-circular` at `error`. Two important adaptations to XR's reality:

1. **Runtime:** dependency-cruiser requires Node ^22/^24/>=26 and CI has no Node toolchain for `src`
   (bun-only). Verified: `bun ./node_modules/dependency-cruiser/bin/dependency-cruise.mjs` works
   (bun's node-compat reports 24.3.0). The CI job therefore invokes it through bun.
2. **Dynamic imports:** the cruiser is static-only. XR uses `await import()` heavily
   (`agent-service.ts`, `extensibility-bridge.ts`, `evaluation/suites/platform.ts`). The cruiser
   *does* record dynamic edges (`"dynamic": true` in its JSON), so the architectural test consumes
   the same graph and additionally scans for dynamic-import specifiers that a purely static reading
   would miss — closing the gap the phase prompt warns about.

**On `eslint-plugin-boundaries`:** its model (element types + dependency policies) is the same model
encoded above. XR has **no ESLint installed** and a deliberate 2-runtime-dependency policy; adding
the ESLint stack for a second copy of the same rules would create a *second source of truth for
boundary policy* — the very thing Cmdt 6 forbids — and inflate install/startup surface against
Art. XII. Decision recorded in ADR-0005 with owner and review date.

---

## R7 — Facade/adapter during migration

**Principle.** A facade gives consumers one stable entry while the implementation is swapped
underneath; adapters translate legacy shapes into the canonical model so the legacy data/API can be
retired without a flag day.

**Source.** Gamma et al., *Design Patterns* (Facade, Adapter); applied to strangler migrations in
the Fowler/Newman material above (R1/R2).

**XR application.** `RoutingService` (facade over `IntelligenceRouter`, absorbing `RoutingStrategy`
translation), `PlanningService` (facade over two planning strategies), `ToolRegistryService`
(facade over four contribution sources), `context/memory-adapter.ts` (already present; extended into
the T5 migration as the lossless translator).

---

## R8 — Migration honesty (XR-specific, from the Constitution)

**Principle.** A migration may not invent facts it cannot know. Legacy records whose consent
provenance is unknowable must be labelled unknown, remain readable, and be flagged for
re-affirmation — never silently upgraded to "approved", never silently deleted.

**Source.** XR Architecture Constitution, Art. IV.5 (no claim outruns evidence), Art. XXIII
(reversibility), Inviolable P5 ("Memory is consent-controlled, scoped, and explainable"); the rule is
already implemented in `src/context/memory-adapter.ts` (`consentState: "legacy_unknown"`).

**XR application.** T5's migration preserves this exactly, and the reversibility test asserts that a
`down()` migration restores the original rows byte-for-byte.
