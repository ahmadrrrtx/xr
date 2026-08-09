# XR Architecture after Phase 2 — one substrate, not adjacent subsystems

**Applies to:** XR 7.1.0-dev and later
**Companions:** `docs/phase2/BOUNDARIES.md` (enforced rules),
`docs/developer/EXTENDING-XR.md` (how to add things), `docs/adr/0002`–`0008`

---

## What changed, in one table

| Concern | Before Phase 2 | After |
|---|---|---|
| Execution entry | **4** direct `runAgent` call-sites | **1** execution envelope |
| Tool registration | **4** disjoint registries, no namespacing | **1** `ToolRegistryService`, 4 preserved kinds |
| Routing | **2** authorities (one with a locality bypass) | **1** `RoutingService` |
| Planning | **2** planners, one unvalidated | **1** `PlanningService`, both kinds validated |
| Durable context | **2** stores (`memory/` + `context/`) | **1** (`context/`) |
| Run state | **2** engines (`workflow/` + `execution/`) | **1** (`execution/`) |
| Boundaries | none enforced, 3 runtime cycles | enforced in CI, **0** cycles |
| Structure | 47 top-level dirs, 6 phase-named | 41, **0** phase-named |

---

## 1. The execution envelope

Every consequential action flows through eight ordered phases:

```
  intent      what the human asked, and on whose authority
     ↓
  plan        provider + model + step budget (from the ONE routing authority)
     ↓
  policy      budget, pricing, egress, dry-run, approval hook — ambiguity denies
     ↓
  placement   the ONE tool registry, arbitrated; where the work runs
     ↓
  action      the agent loop (the ONLY caller is core/execution/runner.ts)
     ↓
  observation streamed output, budget escalation
     ↓
  evidence    session rows, audit entries, diagnostics — the durable trail
     ↓
  outcome     a typed, effect-bearing record
```

Two entry shapes, one path:

```
   CLI / daemon ─────► AgentService.execute() ─┐
                                                ├─► runEnvelope() ─► runAgentLoop()
   Shell / Telegram ─► executeOnSurface() ─────┘
   / Voice
```

`executeOnSurface` exists because those three surfaces own their
`WorkspaceStore` and deliberately skip kernel boot — booting a kernel per
keystroke would break the lazy-boot guarantee (Art. VI.4 / XII). It builds the
**same** envelope from the **same** registry and calls the **same** runner, so
it is not a second execution path.

**Enforced:** `test/core/no-bypass.test.ts` fails the build if any module
outside the runner imports the loop. The scan is static **and** dynamic-aware,
strips comments and string literals, and carries a seeded-violation control.

## 2. One tool registry, four preserved semantics

```
  core tools ──┐
  plugins ─────┼──► ToolRegistryService ──► discover(mode) ──► the model
  MCP ─────────┤         │
  skills ──────┘         └──► resolve(nameOrId) ──► exactly one entry, or nothing
```

| Kind | Identity | Runtime semantics |
|---|---|---|
| `core` | `core:<name>` | in-process function |
| `plugin` | `plugin:<id>:<name>` | permissioned code, worker sandbox |
| `mcp` | `mcp:<server>:<name>` | remote JSON-RPC |
| `skill` | `skill:<id>` | **prompt contribution — no `run()`, never invocable** |

Registration and discovery are unified; **runtime semantics are not**
(Art. XIV/XV). Collisions fail closed: core keeps its bare name, two non-core
claimants get neither, and shadowed entries are advertised under their qualified
id so the model is never shown a name that means something else.

## 3. One routing authority

`RoutingService` is the only code that turns a decision into a `Provider`.
Locality is enforced on **selection, exhaustion and fallback** — the retired
`ProviderRouter` checked none of the last two. Ambiguity denies; exhaustion
raises `LocalityPolicyViolation` rather than silently downgrading the user's
privacy guarantee.

## 4. One planner, two validated output kinds

```
PlanningService
├── planWorkflow() → WorkflowRecord  (DAG)     — Zod + referential integrity
└── planControl()  → Plan (Action[]) (steps)   — Zod, fail-closed
```

The workflow path previously had **no** runtime validation. Both now fail closed
(Art. IV.4). Planning proposes; it never executes.

## 5. One context store, one execution fabric

```
context/                          execution/
├── service.ts   (authority)      ├── service.ts     (durable records, leases,
├── repository.ts                 │                   checkpoints, recovery)
├── retrieval, assembler, …       ├── adapters/
└── memory/      (legacy engine,  └── workflow/      (nodes, DAG, state machine,
     system of record until 8.0.0)                    versioning, approval)
```

`execution/index.ts` re-exports the workflow substrate as an explicit
**namespace** (`export * as workflow`), not flattened — both modules define
run/state vocabularies and a flat re-export would silently collide two state
machines.

## 6. The layer map

```
  Surfaces   interfaces · cli · commands · daemon · telegram · voice · ui
      │  (may import anything; nothing may import them)
      ▼
  L6  enterprise/  (deployment · evaluation · baseline · certification)
      ▼
  L5  business/
      ▼
  L2  tools · plugins · skills · mcp · platform/{capabilities,environment}
      │   integrations · computer · automation · local · research
      ▼
  L1  execution/{,workflow} · context/{,memory} · intelligence · providers
      │   agents · control · runtime/trust · services · reliability
      ▼
  L0  core · state · security · config · util · cost
```

Dependencies point downward only. Enforced by `.dependency-cruiser.cjs` (CI) and
`test/architecture/boundaries.test.ts` (every `bun test`), from one rule set.

**Layer assignments that surprise people:** `core/agent.ts` is the agent *loop*
and therefore L1, not L0; `core/app.ts` + `core/providers.ts` are the
composition root and are exempt by Art. VI.1; `core/execution/*` is the envelope
and is L1.

## 7. What Phase 2 deliberately did NOT do

- **No isolation work.** Placement is *recorded*, not enforced. Phase 4.
- **No performance tuning.** Startup was measured as unchanged; nothing was
  optimised. Phase 3.
- **No new features.** Every change removed or unified something.
- **No irreversible migration.** The one data migration is reversible and its
  round-trip is tested; the legacy table is deliberately retained.
