# ADR 0003 — One `ToolRegistryService`, Four Preserved Semantics

**Status:** Ratified (Phase 2, 2026-07-31)
**Applies to:** Registration and discovery of every tool XR can run
**Supersedes:** Four disjoint registration sites
**Constitutional basis:** Art. III "Compliant Designs" (*"A single
`ToolRegistryService` where core/plugins/skills/MCP register"*), Art. XIV/XV
(distinct extension semantics), Art. IV.4 (fail closed)

---

## Context

The audit confirmed four disjoint registries with no shared discovery surface,
no namespacing and no collision policy:

| Registry | Location | Population | Runtime semantics |
|---|---|---|---|
| Core | `tools/registry.ts` — module-level `const ALL: Tool[]` | hardcoded array | in-process function |
| Plugins | `plugins/registry.ts` + `manager.pluginTools()` | manifest + permission grant | worker sandbox |
| MCP | `mcp/registry.ts` + `manager.mcpTools()` | JSON-RPC handshake | remote protocol |
| Skills | `skills/registry.ts` + `runtime.executionContext()` | manifest | **prompt**, not a tool |

### The defect this closes

Plugin and MCP tools were concatenated into a flat `extraTools` array, and the
agent loop resolved a call with:

```ts
const tool = getTool(call.tool) ?? extraToolMap.get(call.tool);
```

Core first, contributions second — while advertising **both** to the model. A
plugin contributing a tool named `shell` was therefore *listed* to the model as
an available capability but silently executed the **core** `shell`. The reverse
ordering elsewhere (`[...coreTools, ...extraTools]` for advertisement) meant the
advertised set and the executable set disagreed. That is collision-based
privilege confusion: the model believes it is calling one thing and another
runs.

## Decision

**1. One registration and discovery authority.** `ToolRegistryService`
(`src/tools/registry-service.ts`). Core, plugin and MCP contributions register
through `registerTools()`; skills through `registerSkill()`.

**2. Namespaced, unforgeable identity.** Every callable entry has a qualified
id: `core:shell`, `plugin:acme:deploy`, `mcp:github:create_issue`. The namespace
is derived from the contribution *kind*, never from input, so a plugin cannot
register into the `core:` namespace.

**3. Fail-closed collision arbitration.**

| Situation | Outcome |
|---|---|
| Non-core claims a core bare name | Core keeps it; the contribution stays reachable **only** by qualified id |
| Core registers after a contribution | Core reclaims the bare name; the earlier entry is demoted |
| Two non-core claim one bare name | **Neither** wins it; both remain reachable by qualified id |

A contested bare name resolves to **nothing**. The caller reports "not
available" rather than guessing — the behaviour the old `??` chain lacked.
Shadowed entries are advertised to the model under their qualified id, so the
model is never shown a bare name that means something else. Collisions are
**audited** (`tools.collision`), not hidden.

**4. Distinct runtime semantics preserved (Global Rule 6).** `kind` is retained
on every entry and the behaviour behind `tool.run()` is whatever that kind's
host provides. **Skills are stored in a separate collection with no `run()` at
all** — a prompt-pack contributes system-prompt text and can never be invoked,
even by id, even when its manifest *declares* a tool name. The type system
prevents it from reaching a tool-call path.

**5. Retired stubs cannot re-enter.** Names in Phase 0's `REMOVED_STUB_TOOLS`
are refused registration — including from a plugin, which is the path that would
actually matter.

**6. One mode-scoping rule.** Least privilege is applied at discovery, in one
place: `agent` gets everything; `plan`/`ask` get the read-only **core** set and
no contributions. A plugin or MCP server cannot widen a read-only mode.

## Enforcement

`test/tools/semantics-contract.test.ts` — 23 tests, one contract block per kind.
The critical assertions are **effect-based**: the collision tests verify *which
`run()` actually executed*, not merely which label was returned, so a "green but
not true" pass is impossible.

## Consequences

**Positive.** The privilege-confusion vector is closed. One decision tree for
"where do I register a tool?". The `execution/adapters/agent-adapter.ts` gap —
whose own comments admitted *"native core tools invoked directly from runAgent
are NOT double-wrapped in this first pass"* — is **closed**, because every tool
now arrives through one arbitrated collection the adapter can wrap uniformly.

**Negative.** A shadowed tool is advertised under a longer, qualified name. That
is the intended cost: legibility over convenience when authority is ambiguous.

## Reversibility

The registry holds no persistent state — it is rebuilt per run from live
contributions. There is no schema to migrate and rollback is a code revert.

## Removal schedule

| Item | Status | Removal |
|---|---|---|
| ad-hoc `extraTools` concatenation in the envelope | **removed** in Phase 2 | done |
| `AgentDeps.extraTools` | deprecated; honoured for out-of-tree callers | **8.0.0** |
| `tools/registry.ts` helpers (`getTool`/`toolsForMode`/`allTools`) | retained as a core-only compatibility surface | reviewed 8.0.0 |
