# XR Phase 2 — STEP 1: Repository Audit Report

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


**Audited commit:** `c1c1831` (`main`, merge of PR #32 — Phase 1 reliability & persistence core)
**Audit date:** 2026-07-31
**Toolchain verified:** bun 1.3.14 (node-compat 24.3.0), TypeScript 5.9.3
**Method:** live repository inspection only. Reports (Phase 0/1 completion, Deep Audit, OSINT) treated as
historical evidence. Where this audit contradicts a report, **the repository wins**.

---

## 0. Baseline health (measured, not asserted)

| Signal | Command | Result |
|---|---|---|
| Typecheck | `bun run typecheck` (`tsc --noEmit`) | **PASS** (0 errors) |
| Test suite | `bun test` | **2033 pass / 0 fail**, 7402 expects, 136 files, 26.9 s |
| Source size | `find src -name '*.ts'` | **458 files, 122 292 LOC** |
| Module graph | `depcruise src` | **509 modules** |
| Dependency cycles | Tarjan SCC over the cruiser graph | **3 cycles, 8 modules** |
| Boundary tooling | grep for depcruiser/eslint config | **NONE** (hypothesis confirmed) |

This is the floor Phase 2 must not regress.

---

## 1. Phase 0 re-verification

| # | Phase-0 guarantee | Evidence in current `main` | Status |
|---|---|---|---|
| 1 | Unified version 7.0.1 | `package.json:3` = `7.0.1`; `src/core/version.ts:15` = `7.0.1`; `release:check` wired in CI `truth-gate` job | **VERIFIED** |
| 2 | Restart-safe credential vault (envelope encryption) | `src/integrations/credentials.ts` — v2 envelope `v2:<salt>:<iv>:<tag>:<wrappedDEK>:<dekIv>:<dekTag>:<ct>`, per-record persisted scrypt salt, `deriveKek()` @ L301, explicit legacy-undecryptable error @ L287 | **VERIFIED** |
| 3 | Workflow executor delegation | `src/workflow/engine.ts` — `WorkflowAgentRunner` interface @ L43, delegation @ L695 (`this.config.agentRunner.runAgentTask`) | **VERIFIED** |
| 4 | Stub removal | `src/computer/system-control.ts` — `SYSTEM_TOOLS` @ L186 (live tools only) and `REMOVED_STUB_TOOLS` @ L195 (retired names retained as a deny/inventory list) | **VERIFIED** |
| 5 | Shell `extraTools` bridge | `src/services/extensibility-bridge.ts` (`resolveExtensibility`), consumed by shell `app.ts:561`, telegram `bot.ts:177`, voice `pipeline.ts:154` | **VERIFIED** |
| 6 | Canonical policy gate | `src/security/guard.ts` — `checkAction()` @ L275, `fullyDecode` @ L93, `canonicalPath` @ L117, `isSecretPath` @ L164, `normalizeHost` @ L184 | **VERIFIED** |
| 7 | Container-aware bind | `src/daemon/server.ts` — `DEFAULT_LOOPBACK`/`CONTAINER_BIND` @ L63-64, `resolveBindHost()` @ L79, container markers `/.dockerenv`, `/run/.containerenv` | **VERIFIED** |
| 8 | Fail-closed reviewer | `src/services/review-decision.ts` — `failClosed()` @ L46 with 6 deny paths (empty, parse failure, non-object, missing field, unrecognised decision, approval without reason) | **VERIFIED** |

**Phase 0 verdict: 8/8 VERIFIED. 0 REGRESSED.**

## 2. Phase 1 re-verification

| # | Phase-1 guarantee | Evidence in current `main` | Status |
|---|---|---|---|
| 1 | Single-writer `WriteGate` | `src/state/write-gate.ts` — `BEGIN IMMEDIATE`, bounded retry+jitter, `executedOutsideTxn` invariant counter, `AuditChainCorruptedError` (fail-closed append) | **VERIFIED** |
| 2 | Max-1 RW connection per DB file | `src/state/workspace-store.ts:128-135` — process-wide gate map keyed by DB path | **VERIFIED** |
| 3 | busy_timeout + WAL checkpoint | `workspace-store.ts:8` (busy_timeout ≥ 3000 at open), `:1455-1465` `wal_checkpoint(RESTART)` w/ TRUNCATE fallback | **VERIFIED** |
| 4 | Serialized audit append + `xr audit repair` | `workspace-store.ts:883` (IMMEDIATE-locked append), `:973` repair semantics; CLI `src/commands/audit.ts:75` `case "repair"` | **VERIFIED** |
| 5 | Real `VACUUM INTO` backups | `workspace-store.ts:1476-1485`; consumed by `src/deployment/backup/service.ts:170` | **VERIFIED** |
| 6 | Reversible-migration framework | `src/state/migrations.ts` — `Migration{up,down}`, `runMigrationsUp/Down`, `schema_migrations` table, `LATEST_SCHEMA_VERSION` (currently **1**) | **VERIFIED** |
| 7 | `docs/adr/0001` | `docs/adr/0001-single-writer-durability-invariant.md` present | **VERIFIED** |
| 8 | Reliability suite in CI | `.github/workflows/ci.yml` job `reliability` → `bun run reliability:test`; also `mutation-gate` @ threshold 0.6 | **VERIFIED** |

**Phase 1 verdict: 8/8 VERIFIED. 0 REGRESSED.** No restoration work required. Phase 2 may proceed.

---

## 3. Duplicate-engine inventory (the Phase 2 debt)

### 3.1 Execution entry points — **surfaces DO bypass `AgentService`** (hypothesis CONFIRMED)

`runAgent` is exported from `src/core/agent.ts:125`. Production call-sites:

| Call-site | Line | Goes through `AgentService`? |
|---|---|---|
| `src/services/agent-service.ts` | 258 | ✅ canonical |
| `src/interfaces/shell/app.ts` | 564 | ❌ **direct `runAgent`** |
| `src/telegram/bot.ts` | 179 | ❌ **direct `runAgent`** |
| `src/voice/pipeline.ts` | 155 | ❌ **direct `runAgent`** |
| `src/execution/adapters/agent-adapter.ts` | 183 | ❌ direct (fabric wrapper) |

Phase 0's `extensibility-bridge.ts` deliberately bridged *tools only* — its own header states
"Phase 0 explicitly forbids unifying the execution envelope — that is Phase 2." The three interactive
surfaces still construct `AgentDeps` by hand (budget, pricing, memory, egress, session-summary), so
they can and do drift from the CLI. **T1 target.**

Also note the surfaces build `AgentDeps` with **different** defaults: shell passes `store:` (legacy
monolithic handle) while `AgentService` passes typed repos + `contextPackage`; only `AgentService`
performs routing-decision auditing and context assembly. That is observable behavioural divergence,
not just duplication.

### 3.2 Tool registries — **4 disjoint registration sites** (hypothesis CONFIRMED)

| Registry | Location | Population mechanism | Semantics |
|---|---|---|---|
| Core tools | `src/tools/registry.ts` — module-level `const ALL: Tool[]` | hardcoded array literal | in-process function |
| Plugins | `src/plugins/registry.ts:123` `PluginRegistry` + `manager.pluginTools()` | manifest + permission grant, worker sandbox | isolated executable |
| Skills | `src/skills/registry.ts:6` `SkillRegistry` + `runtime.executionContext()` | manifest; **returns a prompt, not a Tool** | prompt-pack / connector |
| MCP | `src/mcp/registry.ts:52` `McpRegistry` + `manager.mcpTools()` | JSON-RPC handshake over stdio/http | remote protocol tool |

There is **no** common discovery surface, **no** namespacing, and **no** collision policy: plugin and
MCP tools are concatenated into `extraTools` and `core/agent.ts` resolves a name by scanning core
first (`getTool`), so a plugin/MCP tool can shadow — or be shadowed by — a core tool depending on the
path taken. That is the collision-based privilege-confusion risk Part 8/T2 names. **T2 target.**
Note the semantics genuinely differ (Constitution Art. XIV/XV, Global Rule 6): unification is of
*registration & discovery*, never of runtime type.

### 3.3 Dual routers — **`providers/routing.ts` is already a delegating facade** (nuance found)

| Module | LOC | Role in current code |
|---|---|---|
| `src/intelligence/router.ts` | 578 | `IntelligenceRouter.route(config, request)` — capability/locality/credential/budget scoring, `routingDecisionToRecord` |
| `src/providers/routing.ts` | 375 | `ProviderRouter.resolveWithDecision()` — translates legacy strategy → `RouteRequest`, then **instantiates `IntelligenceRouter` @ L142** and delegates |

So model *selection* is already governed by `IntelligenceRouter`. But `ProviderRouter` remains a
**second authority** because it (a) re-derives locality itself (`routing.ts:126-138`) with a
*narrower* rule set than `intelligence/router.ts:49-132` — it only recognises `local-only`,
`intelligencePlane.localityPolicy==='local_only'` and `mode==='local_only'`, and **does not honour
`private_only` or `no_cloud`** — and (b) on `decision.unavailable` **falls back to constructing the
configured default provider directly** (`routing.ts:147-155`), bypassing the locality decision
entirely. That is the security-relevant locality-bypass ambiguity: a workspace configured
`no_cloud` can still be handed a cloud provider through the legacy fallback path. **T3 target — and
it is a real defect, not merely duplication.**

`ProviderRouter`/`FallbackProvider` also creates the cycle
`intelligence/index.ts → intelligence/service.ts → providers/routing.ts → intelligence/router.ts`.

### 3.4 Dual planners — **different output kinds, no shared service** (hypothesis CONFIRMED)

| Module | LOC | Output | Schema | Consumers |
|---|---|---|---|---|
| `src/agents/planner.ts` | 458 | `WorkflowRecord` (multi-agent workflow DAG: tasks + deps + audit) | hand-rolled TS types, **no runtime validation** | `services/multi-agent-service.ts`, `commands/agents.ts` |
| `src/control/planner.ts` | 156 | `Plan` = `Action[]` (computer-control steps) | **Zod** `ActionSchema` | `daemon/control-api.ts`, `daemon/routes/control.routes.ts`, `tools/control.ts` |

Two independent planning authorities with unrelated prompts, validation strength and error handling.
The control planner validates with Zod and fails closed; the workflow planner does not validate at
all. **T4 target** — one `PlanningService`, both output kinds, both schema-validated.

### 3.5 Memory vs Context — **two durable stores, overlapping tables** (hypothesis ~confirmed)

| Module | Files | LOC | Notes |
|---|---|---|---|
| `src/memory/` | 9 | 2 646 | `store.ts` alone is 1 166 LOC / 44 KB; owns table `user_memory` (+ `embedding` column); own CLI `memory/cli.ts` (20 KB) |
| `src/context/` | 15 | 6 679 | `repository.ts` 1 069 LOC; typed `ContextItem` model w/ consent/trust/provenance/freshness; own CLI `context/cli.ts` (21 KB) |

Both are reachable from the CLI (`xr memory|mem` and `xr context|ctx|knowledge` in
`src/cli/router.ts:143-147`), both are injected into the agent (`core/agent.ts` imports **both**
`memory/inject.ts` and `context/types.ts`), and `context/memory-adapter.ts` already maps
`MemoryEntry → ContextItem` with an honest `consentState: "legacy_unknown"` rule. 18 production
files import `memory/*`. **T5 target:** `context/` canonical, `memory/` retired after a reversible,
lossless migration.

### 3.6 Workflow vs Execution — **two engines, two state machines, two repos** (hypothesis CONFIRMED)

| Module | Files | LOC | Engine | State machine | Repository |
|---|---|---|---|---|---|
| `src/workflow/` | 8 | 3 436 | `WorkflowEngine` (`engine.ts:167`, 1 163 LOC) | `workflow/state-machine.ts` | `workflow/repository.ts` |
| `src/execution/` | 19 | 5 262 | `ExecutionService` (`service.ts:73`, 1 188 LOC) + 9 adapters | `execution/state-machine.ts` | `execution/repository.ts` |

`execution/` additionally owns leases, checkpoints, recovery and the durable-record fabric;
`workflow/` owns the DAG/node/versioning/human-approval model. They are complementary in *content*
but duplicative in *authority*: both define run lifecycle states, both persist run state, and
`execution/adapters/workflow-adapter.ts` already exists to bridge them. **T6 target.**

### 3.7 Giant files (current, measured)

| File | LOC | Threshold status |
|---|---|---|
| `src/daemon/dashboard.ts` | **3 619** | 4.5× over |
| `src/state/workspace-store.ts` | **1 609** | 2× over |
| `src/plugins/loader.ts` | **1 586** | 2× over |
| `src/interfaces/shell/app.ts` | **1 203** | over |
| `src/execution/service.ts` | **1 188** | over |
| `src/enterprise/types.ts` | 1 171 | over (types-only) |
| `src/memory/store.ts` | **1 166** | over (retiring in T5) |
| `src/workflow/engine.ts` | **1 163** | over (retiring in T6) |
| `src/security/shield.ts` | **1 134** | over |
| `src/context/repository.ts` | 1 069 | over |
| `src/config/config.ts` | **1 020** | over |

Proposed enforced threshold: **800 LOC** (with a declared, owned waiver list). 11 files ≥ 1 000 LOC today.

### 3.8 Phase-named top-level modules (hypothesis CONFIRMED — all 6 present)

| Directory | Files | LOC | True L0–L6 home |
|---|---|---|---|
| `src/baseline/` | 1 | 313 | L6 evidence tooling → fold into `evaluation`/scripts |
| `src/capabilities/` | 7 | 1 735 | L2 platform (capability descriptors) |
| `src/deployment/` | 12 | 4 639 | L6 enterprise deployment profiles |
| `src/environment/` | 16 | 2 600 | L2 environment-interaction providers |
| `src/evaluation/` | 24 | 9 256 | L6 certification evidence |
| `src/trust/` | 17 | 3 067 | L0/L1 authority + isolation primitives |

`src/` currently has **47 top-level entries** against a 7-layer constitutional model (Art. V:
"phases are not folders"). **T9 target.**

### 3.9 Boundary tooling — **absent** (hypothesis CONFIRMED)

No `.dependency-cruiser.*`, no ESLint config at all, no architectural test. Nothing prevents a new
cycle or a cross-layer import. CI runs typecheck/test/release-check/claim-lint/baseline/reliability/
mutation — **no structural gate**. **T8 target.**

---

## 4. Dependency-graph baseline

509 modules. **3 circular SCCs (8 modules):**

1. `intelligence/index.ts → intelligence/service.ts → providers/routing.ts → intelligence/router.ts → …`
   — the **dual-router cycle**; dissolved by T3.
2. `control/computer-use.ts ↔ control/service.ts ↔ environment/service.ts`
   — control/environment mutual recursion; broken in T9 via dependency inversion.
3. `evaluation/compatibility.ts ↔ evaluation/index.ts`
   — barrel-file cycle; broken by importing the concrete module instead of the barrel.

Target at exit: **0 cycles, enforced in CI.**

---

## 5. Discrepancies between this audit and the prompt's hypotheses

| Prompt hypothesis | Reality | Consequence |
|---|---|---|
| "does any surface still call `runAgent` directly bypassing `AgentService`?" | **Yes — 3 surfaces + 1 adapter.** Phase 0 bridged *tools*, not execution. | T1 is full scope, as specified. |
| "≥4 disjoint tool registries" | Exactly 4 (core/plugins/skills/MCP), plus `CommandRegistry` + `ServiceRegistry` (different concerns, out of scope). | T2 as specified. |
| "`providers/routing.ts` vs `intelligence/router.ts` — which governs?" | `IntelligenceRouter` governs **selection**; `ProviderRouter` retains an **independent locality derivation + an unguarded fallback**. | T3 must fix a real locality bypass, not just delete a file. |
| "`memory/` ~9 files vs `context/` 15" | Exactly 9 vs 15 (2 646 vs 6 679 LOC). | T5 as specified. |
| "giant files: dashboard, loader, workspace-store, shield, config" | All confirmed; `interfaces/shell/app.ts` (1 203) and `execution/service.ts` (1 188) also qualify. | T7 scope +2. |
| "boundary tooling: likely none" | Confirmed none. | T8 greenfield. |
| dependency-cruiser on Node 20 | **Fails** (requires ^22/^24/>=26). Bun 1.3.14 provides node-compat 24.3.0 and runs it. | CI gate must invoke the cruiser **via bun**, matching the repo's existing bun-only toolchain. |

---

## 6. Consolidation targets (quantified)

| Concern | Before | After (target) | Mechanism |
|---|---|---|---|
| Execution entry | 4 direct `runAgent` call-sites | 1 (`AgentService` → envelope) | T1 |
| Tool registries | 4 disjoint | 1 `ToolRegistryService` (4 preserved runtime kinds) | T2 |
| Routers | 2 authorities | 1 (`IntelligenceRouter`), `providers/routing.ts` deleted | T3 |
| Planners | 2 | 1 `PlanningService`, 2 validated output kinds | T4 |
| Context stores | 2 (`memory` + `context`) | 1 (`context/`), `memory/` deleted | T5 |
| Execution engines | 2 (`workflow` + `execution`) | 1 (`execution/`), `workflow/` deleted | T6 |
| Files ≥ 800 LOC | 11 ≥ 1000; more ≥ 800 | 0 unwaived | T7 |
| Dependency cycles | 3 | 0, CI-enforced | T8 |
| Phase-named modules | 6 | 0 | T9 |

---

*Audit performed against live code. Every line/LOC figure in this document was measured on
`c1c1831`, not copied from a report.*
