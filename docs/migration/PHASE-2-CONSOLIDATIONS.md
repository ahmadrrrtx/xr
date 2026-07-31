# XR Phase 2 — Migration & Rollback Guide

**Applies to:** upgrading into XR 7.1.0 (Phase 2: Architecture Simplification)
**Audience:** operators, integrators, and anyone with out-of-tree code

Phase 2 removed duplicate engines. **No user-facing CLI or API surface was
removed**, and no user data was deleted. This document lists what changed, how
to roll back, and what is scheduled for removal later.

---

## TL;DR for users

Nothing you type changes. `xr run`, `xr memory`, `xr context`, `xr shell`,
`xr serve`, the Telegram bot and the voice pipeline all behave as before — with
three improvements you may notice:

1. **Shell, Telegram and Voice now assemble context and audit routing** exactly
   as the CLI always did. They previously did not.
2. **A tool-name collision is now explicit.** If a plugin contributes a tool
   named like a core tool, the core tool keeps the bare name and the plugin's is
   offered as `plugin:<id>:<name>`. Previously the advertised tool and the
   executed tool could differ.
3. **A restrictive locality policy is now honoured everywhere.** See
   "Behaviour change" below — this is the one change that can turn a previous
   (incorrect) success into a clear error.

---

## 1. Behaviour change you must know about: locality is now enforced

**Before:** with `intelligencePlane.localityPolicy` set to `no_cloud`,
`private_only` or `local_only`, the retired `ProviderRouter` had an unguarded
fallback. If routing found no candidate, it constructed
`defaults.provider` directly with **no policy check** — commonly a cloud
provider. Your data left the machine in the configuration that forbade it.

**After:** locality is enforced on selection, exhaustion **and** fallback. If no
compliant provider is available, XR raises `LocalityPolicyViolation`:

```
routing refused: workspace locality policy "no_cloud" forbids provider
"openai" (locality: cloud). No compliant provider is available. Start a local
runtime (e.g. `ollama serve`), or change intelligencePlane.localityPolicy if
this workspace may use it.
```

**If you now see this error**, XR was previously sending that traffic to the
cloud against your policy. Either start a local runtime, or — if the workspace
genuinely may use cloud — set `intelligencePlane.localityPolicy: "any"`.

Ambiguity denies: a provider XR cannot classify counts as `unknown` and is
refused under any restrictive policy.

---

## 2. memory → context (ADR-0006)

| | |
|---|---|
| **What moved** | `src/memory/` → `src/context/memory/`, re-exported from `context/index.ts` |
| **Data** | Every `user_memory` row is projected into `context_items` by reversible migration **2** (`memory_to_context_projection`) |
| **Your data** | **Untouched.** `up()` never mutates or deletes a legacy row |
| **`xr memory` CLI** | **Still works.** Kept as an alias (Art. XXVII) until no earlier than 8.0.0 |
| **Consent** | Legacy rows are `legacy_unknown` — never auto-approved. Re-affirm from `xr context` |

### Rollback

```bash
# Inspect the current schema version
xr doctor

# Roll the projection back (removes ONLY the projected rows;
# user_memory is left byte-identical)
bun -e 'import {WorkspaceStore} from "./src/state/workspace-store.ts";
        import {runMigrationsDown} from "./src/state/migrations.ts";
        runMigrationsDown(new WorkspaceStore(), 1)'
```

A downgraded database is still readable by the legacy memory engine — asserted
by `test/state/memory-to-context-migration.test.ts`.

**Why `user_memory` is not dropped:** dropping it would make `down()` lossy and
break the documented downgrade path. It is retained as the system of record and
scheduled for removal in 8.0.0 behind its own reversible migration.

---

## 3. workflow → execution (ADR-0007)

| | |
|---|---|
| **What moved** | `src/workflow/` → `src/execution/workflow/`, re-exported as `execution.workflow.*` |
| **Data** | **No migration.** `WorkflowRepo` and its DDL are byte-identical; only the module path changed |
| **Rollback** | Pure `git mv` — no data implications |

Out-of-tree code importing `src/workflow/...` should import
`src/execution/workflow/...` (or `execution/index.ts` and use the `workflow`
namespace).

---

## 4. Routing consolidation (ADR-0004)

| | |
|---|---|
| **Removed** | `src/providers/routing.ts` (`ProviderRouter`) |
| **Replacement** | `src/intelligence/routing-service.ts` (`RoutingService`) |
| **Config** | Unchanged. `providerEngine.routingStrategy`, `localModels.routing`, `intelligencePlane.*` all behave as before |
| **`FallbackProvider`** | Same class, same behaviour; imported from the new module |

Out-of-tree code:

```diff
- import { ProviderRouter, FallbackProvider } from "xr/src/providers/routing.ts";
+ import { RoutingService, FallbackProvider } from "xr/src/intelligence/routing-service.ts";
```

`RoutingService` has the same `resolve()` / `resolveWithDecision()` /
`getLastDecision()` surface.

---

## 5. Execution envelope (ADR-0002)

| | |
|---|---|
| **Removed** | `src/services/extensibility-bridge.ts` |
| **Renamed** | `runAgent` → `runAgentLoop` (the old name remains as a deprecated alias until 8.0.0) |
| **New entries** | `AgentService.execute()` and `executeOnSurface()` |
| **Compatibility** | `AgentService.runTask` / `runScopedTask` unchanged — they now delegate to `execute()` |

If you call `runAgent` from out-of-tree code it still works. Migrate to
`AgentService.execute()` before 8.0.0.

---

## 6. Tool registry (ADR-0003)

`AgentDeps.extraTools` is **deprecated but still honoured**, so out-of-tree
callers keep working. In-tree, tools come from `ToolRegistryService`.

If you contribute tools, nothing changes in your manifest. What changes is that
a name collision is now arbitrated explicitly instead of resolved by scan order.

---

## 7. Module relocations (ADR-0008)

Internal paths only — no public CLI/API path changed.

| Old | New |
|---|---|
| `src/trust/` | `src/runtime/trust/` |
| `src/capabilities/` | `src/platform/capabilities/` |
| `src/environment/` | `src/platform/environment/` |
| `src/deployment/` | `src/enterprise/deployment/` |
| `src/evaluation/` | `src/enterprise/evaluation/` |
| `src/baseline/` | `src/enterprise/baseline/` |

---

## 8. Removal schedule (dated)

| Item | Status | Removal |
|---|---|---|
| `services/extensibility-bridge.ts` | removed | Phase 2 ✔ |
| `providers/routing.ts` | removed | Phase 2 ✔ |
| `src/memory/` module | removed | Phase 2 ✔ |
| `src/workflow/` module | removed | Phase 2 ✔ |
| six phase-named modules | removed | Phase 2 ✔ |
| `runAgent` alias | deprecated | **8.0.0** |
| `AgentDeps.extraTools` | deprecated | **8.0.0** |
| `xr memory` CLI alias | supported | **no earlier than 8.0.0** |
| `user_memory` table | system of record | **8.0.0**, behind its own reversible migration |

---

## 9. Verifying your upgrade

```bash
bun run typecheck
bun test
bun run boundaries     # 0 dependency violations
bun run size-gate      # every module under 800 LOC or owned
bun run reliability:test
XR_HOME=$(mktemp -d) bun run golden-path   # expect {"ok":true, "chainValid":true}
```
