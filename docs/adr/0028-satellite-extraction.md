# ADR-0028 — Enterprise and Business OS become satellite packages

- **Status:** Accepted (Phase 5 · 2026-09)
- **Constitution:** Art. XVI (enterprise/business are governed extensions; kernel holds a thin contract), Art. XXIV (deletion budget), Art. V.1 (modules map to the boundary table), Art. XXVII (deprecation cycle), Cmdt 6
- **Audit finding:** F-18 (both audits) — corrected upward: enterprise is **22,010 LOC**, not the 14.3k both audits reported

---

## Context

XR is maintained by one person. The core repository carried **33,759 LOC of surface with no external users**:

| Tree | LOC | Users | Daemon routes | Public API ops | Agent tools |
|---|---:|---|---:|---:|---:|
| `src/enterprise` | 22,010 | none | 0 | 0 | 0 |
| `extensions/business-os` | 11,749 | none (default-off) | 7 (degraded-honest) | 7 | 0 |

Every line of it was review load, security-audit surface, CI time, and release-gate weight on a single maintainer — for capability nobody had asked for. Both audits independently identified this as the principal organisational risk to the project, and both proposed extraction.

### What the import census actually found

Before moving anything, a scripted census resolved all **4,263 relative import edges** in the repo against their targets. The result changed the plan in two places:

**1. `src/enterprise/baseline/status.ts` was not enterprise code.** 313 LOC of Phase-0 health/readiness helpers, consumed by `xr doctor`, `src/install/system.ts`, and four baseline scripts. Its own header describes it as *"local baseline status helpers… used by doctor, validation scripts, and tests."* Extracting it would have made **`xr doctor` — the product's central honesty command — depend on an optional enterprise package.** That is the exact inversion this phase exists to prevent. It was **repatriated to `src/install/baseline-status.ts`**, not extracted.

**2. `src/research` and `src/repo` are not sprawl.** The Phase 5 plan grouped them with enterprise. The census disagreed:

| | research | repo | enterprise |
|---|---|---|---|
| Agent tools in the arbitrated registry | **5** | **6** | 0 |
| Versioned `/api/v1` operations | **11** | 0 | 0 |
| Committed in `docs/api/openapi.json` | ✅ | — | ❌ |
| Wired into voice pipeline | ✅ | — | ❌ |
| Wired into agent context seeding | — | ✅ | ❌ |

Extracting research would remove 11 operations from a versioned contract whose `api-compat` gate defines BREAKING as *"operation removed"* — i.e. the extraction would have had to disable a correctness gate to land. **They stay in core**, and they are core capabilities, not a hedge.

---

## Decision

**Extract two packages. Repatriate one module. Keep research and repo.**

```
xr (core)                                     130,742 LOC   ← was 154,426
├── src/…                                     the runtime, research, repo
├── src/install/baseline-status.ts            ← repatriated from src/enterprise/baseline/
└── src/core/business-l0.ts                   L0 contract + structural views (core owns these)

satellites/
├── xr-enterprise/    @rrrtx/xr-enterprise     21,697 LOC + 634 tests
└── business-os/      @rrrtx/business-os       11,749 LOC +  65 tests
```

**Core imports zero satellite code. This is enforced three independent ways:**

1. `no-satellite-imports` in `.dependency-cruiser.cjs` (the `boundaries` CI gate, over resolved module edges)
2. `test/architecture/boundaries.test.ts` (same rule, over the in-tree graph)
3. `test/architecture/satellite-isolation.test.ts` (source scan across `src/` **and** `test/`, plus `package.json#files`)

Three enforcement points for one rule is deliberate: this property is what the whole phase is purchased with, and an extraction that is only a commit rots back within months.

### How the type-only coupling was severed

Two core files imported *types* from the extension tree (`BusinessOS` in `business.routes.ts`, `BusinessDatabase` in `credentials.ts`). Type-only imports are erased at compile time, so both audits and the boundary gate treated them as harmless — but they made **core unbuildable without the extension checked out beside it**. A real coupling wearing a type-only disguise.

Core now declares the shapes it consumes at L0 (`BusinessOsView`, `BusinessSqlDatabase` in `src/core/business-l0.ts`) and the extension satisfies them **structurally** — no `implements`, no import in either direction. Core depends on its own contract.

### The runtime edge the census caught

`business.routes.ts` was loading `JOURNEY_DEFINITIONS` **directly from the extension source at request time**, behind a dynamic `import()`. Once the extension left the repo, `GET /api/business/journeys` would have thrown a module-not-found 500 — in a file otherwise scrupulous about answering honest 503s. The route now reads the catalogue from the loaded extension and answers `{journeys: [], count: 0}` when it is absent, which is the truthful description of a core-only install (Cmdt 2).

Likewise `src/core/providers/business.ts` resolved a hardcoded relative path. It now resolves the **package specifier only** — deliberately with no sibling-checkout fallback, because a path fallback would reintroduce the coupling (and the isolation test correctly failed the build when a fallback was first attempted). Contributors use `bun link`, which exercises the same code path a real user takes.

---

## Consequences

**Positive**
- Core shrinks **23,684 LOC (−15.3%)**; the audited security surface shrinks with it, with **zero enforcement removed**.
- `xr doctor` no longer depends on anything optional.
- The satellites are independently releasable and independently ownable — the surface a single maintainer must hold in their head is smaller and truer.
- The npm tarball never contained `extensions/`; now it never contains enterprise either.

**Negative / accepted**
- Core test count drops **3,628 → 2,921** (−707: 634 enterprise/evaluation/deployment, 65 business, 8 RPO/RTO). Those tests are not deleted — they run in the satellites. Published honestly rather than quietly.
- Two type-only imports became structural interfaces that must be kept in sync by hand. Accepted: the satellite's own typecheck fails against these interfaces if it drifts, and the alternative is a build-time edge.
- `xr enterprise` / `xr evaluate` / `xr business` now print a relocation notice and **exit 2**. A moved feature must not look like a working one (Cmdt 2).

---

## Migration

| Surface | Behaviour | Removal |
|---|---|---|
| `xr enterprise …`, `xr ent …` | relocation notice + install line, exit 2 | 2.0.0 |
| `xr evaluate …`, `xr eval …` | relocation notice + install line, exit 2 | 2.0.0 |
| `xr business …`, `xr biz …` | relocation notice + install line, exit 2 | 2.0.0 |
| `/api/v1/business/*` | unchanged — honest empty/503 when the extension is absent (as before) | — |
| Business OS config gate | unchanged — default-off, effect-verified, fail-closed | — |

No migration is required for core users, because **core users were never using these**. That is the definition of the sprawl.

---

## Alternatives considered

**Delete instead of extract.** Rejected: the code works and is unit-tested. Art. XXIV's deletion budget is satisfied by moving a concern out of core; destroying working capability is not required and would be a worse trade.

**Leave it and add a lint.** Rejected: the cost was never the imports, it was the 33,759 LOC of review, audit, and release-gate surface. A lint does not reduce that by one line.

**Extract research and repo too (as the plan specified).** Rejected on evidence — see Context. This is the decision memo the plan itself called for.

**Git submodules.** Rejected: submodules would keep the trees in the same clone and the same CI, preserving exactly the maintenance load the extraction is meant to remove, while adding a notoriously sharp workflow.

---

## Evidence

- Import census: `docs/historical/phase-5/import-census.txt` (4,263 edges resolved)
- LOC census: before/after in `docs/historical/phase-5/loc-census.md`
- `test/architecture/satellite-isolation.test.ts` — 7 invariants
- `bun run boundaries` — 567 modules (was 621), 0 violations
- `satellites/xr-enterprise/`, `satellites/business-os/` — packaged, with their own `package.json`, `tsconfig.json`, tests and READMEs
