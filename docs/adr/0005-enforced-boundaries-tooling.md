# ADR 0005 — Enforced Boundaries: one rule set, dependency-cruiser + a native test

**Status:** Ratified (Phase 2, 2026-07-31)
**Applies to:** Dependency direction, acyclicity and module size across `src/`
**Constitutional basis:** Art. V.2 (*"Dependency direction is explicit and
acyclic; an architectural test enforces it"*), Art. V.3 (size threshold with an
owned plan), Cmdt 6 (one source of truth per concern), Art. IV/P6 (subtraction
before addition), Art. XII (no startup regression)

---

## Context

The audit found **zero** boundary tooling: no dependency-cruiser config, no
ESLint at all, no architectural test. Three runtime dependency cycles existed
and nothing prevented a fourth. CI ran typecheck, tests, release-check,
claim-lint, baseline, reliability and mutation — no structural gate.

The Phase-2 specification names two tools: `dependency-cruiser` and
`eslint-plugin-boundaries`.

## Decision

### 1. `.dependency-cruiser.cjs` is the single source of boundary truth

It encodes the L0–L6 table as `forbidden` rules — not comments — plus
`no-circular`, retired-module bans, the envelope's sole-caller rule, and
hygiene checks. **Two consumers read the same file**: the CI job (`bun run
boundaries`) and `test/architecture/boundaries.test.ts`, which mirrors the rules
so a contributor sees the failure in `bun test` and the gate survives without
the optional binary.

### 2. Enforcement runs over RUNTIME edges (`tsPreCompilationDeps: false`)

With type edges followed, the cruiser reports **35 "cycles"** in XR. Every one
is closed by a single `import type` edge, which TypeScript **erases** — they
cannot occur at run time and cannot cause partial initialisation. XR uses this
deliberately and documents it: `src/core/tokens.ts` states *"All service-type
imports below are `import type` (erased at compile time) … That keeps tokens.ts
at the bottom of the graph, free of import cycles."*

Failing the build on erased edges would force a worse design — stringly-typed
tokens and `any` parameters — to satisfy a tool. So the hard rule runs on real
edges; type-only loops are reported at `warn` and bounded by the architectural
test. **Runtime cycles: 0.**

### 3. Run through bun, not node

dependency-cruiser requires Node ^22/^24/>=26. The repo is bun-only and CI has
no Node toolchain for `src`. Verified: bun 1.3.14 reports node-compat 24.3.0 and
runs the cruiser correctly, so the CI job invokes it via bun.

### 4. `eslint-plugin-boundaries` is deliberately NOT adopted

**This is the one deviation from the phase specification, recorded here as
Art. V requires.**

The *requirement* is real-time, element-type-based boundary policies enforced in
CI. The *tool* is one way to meet it. XR has:

- **no ESLint at all** — adding it means the ESLint stack plus the plugin
  (~180 transitive packages) against a deliberate **2 runtime dependency**
  policy. That is expansion in a phase whose mandate is subtraction
  (P6, Global Rule 4), and it enlarges install surface against Art. XII.
- **an existing, equivalent rule model** — dependency-cruiser's
  `from`/`to` path selectors express exactly the element-type + dependency-policy
  model `eslint-plugin-boundaries` provides, including cross-boundary and orphan
  rules.

Adopting both would create **a second source of truth for boundary policy** —
precisely what Cmdt 6 forbids and what this phase exists to eliminate. Two rule
sets drift; the drift would be invisible until they disagreed.

The developer-feedback gap the plugin would close is closed instead by
`test/architecture/boundaries.test.ts`: the same rules run on every `bun test`,
which for a bun-native repo is the fast local loop.

| Requirement | Met by |
|---|---|
| Cycles forbidden, CI-enforced | `no-circular` + architectural test |
| Cross-layer direction enforced | 5 layer rules in both consumers |
| Orphan detection | `no-orphans` |
| Real-time local feedback | `bun test` (architectural test) |
| Dynamic-import coverage | architectural test scans `await import()` |
| One source of truth | one config, two readers |

**Owner:** architecture · **Review:** 8.0.0 — revisit if XR adopts ESLint for
other reasons, at which point the boundary rules should be *generated* from
`.dependency-cruiser.cjs` rather than duplicated.

### 5. The layer map reflects the code, not folder names

Verified against the source rather than assumed:

- `core/app.ts`, `core/providers.ts` **are** the composition root; Art. VI.1
  makes wiring every service their job, so they are exempt. A composition root
  forbidden from naming its collaborators cannot exist.
- `core/agent.ts` is the **agent loop** — Art. §2.2 places that in **L1
  Runtime**, not L0. It lives under `core/` historically. Its access is
  constrained by `only-runner-imports-agent-loop` instead.
- `core/execution/*` is the execution envelope — L1 by the same table.

Three narrow exceptions are declared, each with owner and review date:
`providers/presets.ts` (config validates ids against a data catalogue),
`context/repository.ts` (the store owns every table's DDL),
`interfaces/cli.ts` (shared prompt/colour primitive), and `cli/catalog.ts`
(a declarative contract L6 evidence must read).

### 6. Size gate with owned plans

`scripts/size-gate.ts` enforces **800 LOC**. Art. V.3 permits an over-threshold
module *with an owned plan*, so the gate is two-tier and fails on: an unwaived
module, **a waived module that grew**, a waiver missing owner/reason/plan/ISO
review date, and **a stale waiver** for a module now under threshold. A waiver
is permission to be big today, never permission to get bigger, and the register
cannot rot into obsolete excuses.

## Enforcement is proven, not assumed

`test/architecture/boundaries.test.ts` includes **seeded-violation** controls: a
cycle, a cross-boundary import, a surface import and a retired-module import are
each injected and must be detected. A vacuous-pass guard asserts the graph is
non-trivial (>300 modules, >1000 edges) and that every rule regex actually
matches source modules.

## Consequences

**Positive.** Drift becomes visible at authoring time. The three cycles cannot
return. Retired modules cannot be re-imported. New contributors locate safe
change boundaries from enforced rules rather than folklore.

**Negative.** One dev dependency added (dependency-cruiser, 47 transitive
packages, dev-only — it is not in the published `files` list and does not affect
install or startup for users). Type-only cycles are tolerated, which is a
documented, bounded compromise rather than a silent one.
