# Extending XR — where things go, and why

**Applies to:** XR 7.1.0 and later (post Phase 2)
**Companion:** `docs/phase2/BOUNDARIES.md` (the enforced layer rules)

Phase 2 reduced XR to **one contract per concern**. This is that contract.

---

## 1. Where do I register a tool?

One decision tree. There is exactly one registry —
`ToolRegistryService` (`src/tools/registry-service.ts`) — but **four distinct
runtime kinds**, and the kind you pick determines the semantics you get.

```
Is it a prompt / knowledge pack — guidance, not an action?
└── YES → a SKILL. registry.registerSkill({ kind: "skill", ... })
          Contributes system-prompt text. Has NO run(). Can never be invoked,
          even by id, even if its manifest names a tool.

Does it run outside this process, over a protocol?
└── YES → an MCP TOOL. Registered by McpManager as kind: "mcp".
          Identity: mcp:<server>:<name>. Remote, protocol-bound.

Is it third-party code that must be permissioned and isolated?
└── YES → a PLUGIN TOOL. Registered by PluginManager as kind: "plugin".
          Identity: plugin:<id>:<name>. Manifest-declared permissions,
          worker sandbox.

Is it a first-party capability XR must always have?
└── YES → a CORE TOOL. Add it to src/tools/*.ts and export it from
          coreToolContributions(). Identity: core:<name>. In-process.
          Adding one needs a strong justification: the core set is the
          smallest thing XR needs to be XR.
```

### Rules the registry enforces for you

- **Namespaced identity.** Ids are derived from the *kind*, never from input, so
  a plugin cannot register into `core:`.
- **Fail-closed collisions.** If a non-core tool claims a core bare name, core
  keeps it and yours stays reachable by qualified id. If two non-core tools
  claim one name, **neither** gets it. A bare name never silently changes
  meaning. Collisions are audited (`tools.collision`).
- **Mode scoping in one place.** `agent` gets everything; `plan`/`ask` get
  read-only **core** tools only. A contribution cannot widen a read-only mode.
- **Retired stubs stay retired.** Phase-0 `REMOVED_STUB_TOOLS` names are refused.

**Never** build your own tool list. `buildToolRegistry()` is the only assembler.

## 2. How do I add a surface?

Every surface reaches execution through the **execution envelope** (ADR-0002).
Nothing calls the agent loop directly — `test/core/no-bypass.test.ts` fails the
build if you try.

Two entry shapes:

**A. Kernel-booted (CLI, daemon, commands)**

```ts
const agent = registry.resolve(Tokens.Agent);
const outcome = await agent.execute({
  task, mode: "agent", surface: "cli",
});
```

**B. Surface-owned store (Shell, Telegram, Voice)**

For long-lived surfaces that own a `WorkspaceStore` and deliberately skip kernel
boot — booting a kernel per interaction would break the lazy-boot guarantee
(Art. VI.4 / XII):

```ts
import { executeOnSurface } from "../services/surface-execution.ts";

const outcome = await executeOnSurface({
  task, mode: "agent", surface: "shell",
  store, provider, modelId,
  budget, pricing,
  approve: async (req) => askTheHuman(req),
  onDiagnostic: (note) => showWarning(note),
});
```

This is **not** a second execution path: it builds the same envelope, from the
same registry, and calls the same `runEnvelope`.

### The eight phases

`intent → plan → policy → placement → action → observation → evidence → outcome`

You populate intent/plan/policy/observation; the envelope handles the rest.
`EnvelopeOutcome` is a superset of the old `AgentResult`, so `.stopped`,
`.finalMessage`, `.steps` and `.meter` read exactly as before.

Adding a genuinely new surface means adding one value to `SurfaceId`.

## 3. How do I change routing?

One authority: `RoutingService` (`src/intelligence/routing-service.ts`).
`src/providers/routing.ts` is deleted (ADR-0004).

- Model selection scoring → `intelligence/router.ts`, `scorer.ts`, `evaluator.ts`.
- Turning a decision into a `Provider` → `RoutingService` only.
- **Locality is enforced on every path** — selection, exhaustion and fallback.
  Ambiguity denies: an unclassifiable provider is refused under any restrictive
  policy. If no compliant provider exists, the call raises
  `LocalityPolicyViolation` rather than silently downgrading the user's privacy
  guarantee.

If you add a code path that constructs a `Provider`, it must go through
`RoutingService` or it is a second authority.

## 4. How do I produce a plan?

One authority: `PlanningService` (`src/services/planning-service.ts`), two
schema-validated output kinds.

```ts
planningService.planWorkflow({ goal, cwd });        // → WorkflowRecord (DAG)
await planningService.planControl({ provider, task }); // → Plan (Action[])
```

Both are Zod-validated; the workflow kind additionally gets a referential-
integrity check (a dangling task dependency would deadlock the executor, so it
is refused). `agents/planner.ts` and `control/planner.ts` are `@internal`
strategies — a test asserts no production call-site uses them directly.

**Planning proposes. It never executes.** Authority ≠ intelligence (P5).

## 5. Where does durable context go?

One store: `src/context/` (ADR-0006). `src/memory/` is retired.

- New durable-context work → `ContextService`.
- The legacy memory engine lives at `context/memory/` and still serves the
  `user_memory` table, because the migration is lossless and reversible and a
  downgraded database must remain readable.
- **Never fabricate consent.** Legacy rows are `legacy_unknown`, never
  `approved` (Art. IV.5, Inviolable P5).

## 6. Where does run state go?

One fabric: `src/execution/` (ADR-0007).

- `ExecutionService` — *what ran, durably*: records, leases, checkpoints, recovery.
- `execution/workflow/*` — *how a multi-step run is shaped*: nodes, DAG, state
  machine, versioning, human approval.

The workflow engine delegates agent work through its injected
`WorkflowAgentRunner`. It must never re-implement the loop.

## 7. Boundaries and size

Read `docs/phase2/BOUNDARIES.md`. Before pushing:

```bash
bun run typecheck
bun test
bun run boundaries
bun run size-gate
```

Dependencies point inward/downward. Nothing imports a surface. No runtime
cycles. Modules stay under 800 LOC or carry an **owned, dated** split plan.

## 8. Ownership map

| Subsystem | Owner | Key ADR |
|---|---|---|
| Execution envelope, agent loop | core / runtime | 0002 |
| Tool registry | tools | 0003 |
| Routing authority | intelligence | 0004 |
| Planning | services | — |
| Context + memory engine | context | 0006 |
| Execution fabric + workflow | execution | 0007 |
| State, WriteGate, migrations | state | 0001 |
| Boundaries + size gates | architecture | 0005 |
| Structure / layer map | architecture | 0008 |

## 9. Things Phase 2 makes impossible (by construction)

- Calling the agent loop from a surface.
- Registering a tool anywhere but the one registry.
- A plugin silently shadowing a core tool.
- Invoking a prompt-pack skill as a tool.
- Constructing a `Provider` that violates the locality policy.
- Importing a retired module.
- Introducing a runtime dependency cycle.
- Landing a module over 800 LOC without an owner and a plan.

Each is enforced by a test with a **seeded-violation control**, so a green
result means the gate actually works.
