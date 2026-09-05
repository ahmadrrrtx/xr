# XR — The Enforced Architectural Boundary Table

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


**Status:** Enforced in CI since Phase 2 (7.1.0-dev)
**Rule source:** `.dependency-cruiser.cjs` — the single source of boundary truth
**Enforced by:** `bun run boundaries` (CI job *Architecture*) **and**
`test/architecture/boundaries.test.ts` (every `bun test`)

This document explains the rules. It does not *define* them — the config does,
and duplicating rule definitions in prose would create a second source of truth.

---

## 1. The layer map

Dependencies point **inward/downward only**. A lower layer may never import a
higher one. Surfaces may import anything; nothing may import a surface.

| Layer | Directories | May depend on |
|---|---|---|
| **L0 Kernel** | `core/` (except the exemptions below), `state/`, `security/`, `config/`, `util/`, `cost/` | L0 only |
| **L1 Runtime** | `execution/` (incl. `execution/workflow/`), `context/` (incl. `context/memory/`), `intelligence/`, `providers/`, `agents/`, `control/`, `runtime/trust/`, `services/`, `reliability/` | L0, L1 |
| **L2 Platform** | `tools/`, `plugins/`, `skills/`, `mcp/`, `platform/capabilities/`, `platform/environment/`, `integrations/`, `computer/`, `automation/`, `local/`, `research/` | L0, L1, L2 |
| **L3 Plugins / L4 Skills** | packaged out-of-tree; their **hosts** are L2 | via the host |
| **L5 Business** | `business/` | L0–L2 |
| **L6 Enterprise** | `enterprise/` (incl. `deployment/`, `evaluation/`, `baseline/`, `certification/`) | L0–L5 |
| **Surfaces** | `interfaces/`, `cli/`, `commands/`, `daemon/`, `telegram/`, `voice/`, `ui/`, `i18n/`, `export/`, `install/`, `update/`, `index.ts` | anything |

### Layer assignments that surprise people (and why)

These were verified against the code, not inferred from folder names:

- **`core/agent.ts` is L1, not L0.** It is the agent *loop*, which §2.2 places in
  Runtime. It lives under `core/` for historical reasons. Its access is
  constrained by a stricter rule instead (see §3).
- **`core/app.ts` and `core/providers.ts` are the composition root.** Art. VI.1
  makes wiring every service their job, so the kernel-purity rule exempts them.
  A composition root forbidden from naming its collaborators cannot exist.
- **`core/execution/*` is the execution envelope** — L1 Runtime by the same table.

## 2. The enforced rules

| Rule | Severity | What it forbids |
|---|---|---|
| `no-circular` | **error** | Any runtime dependency cycle |
| `no-circular-type-only` | warn | A cycle closed only by `import type` (erased at compile time — see §4) |
| `kernel-stays-kernel` | **error** | L0 importing L1+ |
| `runtime-not-above` | **error** | L1 importing L5/L6/surfaces |
| `platform-not-above` | **error** | L2 importing L5/L6/surfaces |
| `business-not-enterprise` | **error** | L5 importing L6/surfaces |
| `no-one-imports-surfaces` | **error** | Any non-surface importing a surface |
| `no-retired-modules` | **error** | Importing anything retired in Phase 2 |
| `only-runner-imports-agent-loop` | **error** | Any module but the envelope runner importing `core/agent.ts` |
| `no-orphans` | warn | A module nothing imports |
| `not-to-dev-dep` | **error** | Production code importing a devDependency |
| `no-deprecated-core` | **error** | `punycode`, `domain`, `sys`, `querystring` |

## 3. Retired modules — importing any of these fails the build

Phase 2 retired these to establish one authority per concern. The ban exists so
a duplicate authority cannot silently return.

| Retired path | Replacement | ADR |
|---|---|---|
| `src/memory/` | `src/context/` (engine at `context/memory/`) | 0006 |
| `src/workflow/` | `src/execution/workflow/` | 0007 |
| `src/providers/routing.ts` | `src/intelligence/routing-service.ts` | 0004 |
| `src/services/extensibility-bridge.ts` | the execution envelope | 0002 |
| `src/trust/` | `src/runtime/trust/` | 0008 |
| `src/capabilities/` | `src/platform/capabilities/` | 0008 |
| `src/environment/` | `src/platform/environment/` | 0008 |
| `src/deployment/` | `src/enterprise/deployment/` | 0008 |
| `src/evaluation/` | `src/enterprise/evaluation/` | 0008 |
| `src/baseline/` | `src/enterprise/baseline/` | 0008 |

## 4. Type-only cycles: why they are warned, not failed

`import type` is **erased by the compiler**. A loop closed only by type edges
cannot exist at run time and cannot cause a partially-initialised module.

XR uses this deliberately. `src/core/tokens.ts` says so in its own header:

> *"All service-type imports below are `import type` (erased at compile time),
> so this file has zero runtime dependency on the services it catalogues. That
> keeps tokens.ts at the bottom of the graph, free of import cycles."*

Failing the build on erased edges would force a worse design — stringly-typed
tokens and `any` parameters — to satisfy a tool. So the hard rule runs with
`tsPreCompilationDeps: false` (real edges), and type-only loops are surfaced at
`warn` and bounded by the architectural test.

**Runtime cycles today: 0.**

## 5. Declared exceptions (each owned, each dated)

| Edge | Why | Owner | Review |
|---|---|---|---|
| `config/config.ts → providers/presets.ts` | Config validates provider ids against the preset catalogue. The catalogue is **data**, not runtime logic. | config | 8.0.0 |
| `state/workspace-store.ts → context/repository.ts` | `WorkspaceStore` owns the baseline schema for **every** table, including context's. | state | 8.0.0 |
| `* → interfaces/cli.ts` | Shared prompt/colour primitive (`confirm()`, `colors`). A utility that happens to live in the interfaces folder. | interfaces | 8.0.0 |
| `enterprise/evaluation/compatibility.ts → cli/catalog.ts` | The catalogue is the CLI's declarative **contract**; L6 evidence must read it to prove every promised command still exists. Inspecting a contract ≠ depending on presentation logic. | enterprise/evaluation | 8.0.0 |
| `execution/adapters/*` | Adapters bridge L1 to other layers by definition; that is their job. | execution | 8.0.0 |

## 6. Module size

`scripts/size-gate.ts` enforces **800 LOC**, with owned plans in
`docs/phase2/SIZE-WAIVERS.json`. Art. V.3 permits an over-threshold module *with
an owned plan*, so the gate fails on:

- an over-threshold module **not** in the register;
- a waived module that **grew** past its recorded size;
- a waiver missing owner, reason, plan or ISO review date;
- a **stale** waiver for a module now under threshold.

A waiver is permission to be big today, never permission to get bigger.

## 7. Running the gates

```bash
bun run boundaries        # dependency-cruiser against .dependency-cruiser.cjs
bun run size-gate         # module size + owned split plans
bun test test/architecture/   # the same rules, natively, with seeded-violation controls
bun run boundaries:graph  # emit a DOT graph for visualisation
```

## 8. Adding a module

1. Decide its layer from §1. If it does not fit, that is a signal — an ADR is
   required to add a top-level module (Art. V.4).
2. Check the direction: may it import what it needs, and may its consumers
   import it?
3. Run `bun test test/architecture/` before pushing.
4. If it will exceed 800 LOC, add a waiver **with an owner and a plan** — or
   split it now.
