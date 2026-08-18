# PHASE 08 — Unified Capability System Architecture

**Date:** 2026-08-18
**Status:** Design / Implementation
**Depends on:** Phase 07 Security Hardening (MCP allowlist signed default-deny, content-hash exec gate, trust handoff block, SSRF blocking, tool-output framing, audit hash-chained)

---

## 1. CURRENT ARCHITECTURE

### 1.1 Two co-existing systems

**System A — ToolRegistryService (execution)**

- Owner: `src/tools/registry-service.ts`
- Scope: callable tools (core, plugin, mcp, memory) + skill prompts (separate collection)
- Registration: `registerTools(contribution)` + `registerSkill`
- Discovery: `discover({mode, allow, deny})` → Tool[]
- Execution: `resolve(nameOrId)` → RegisteredTool | undefined
- Invariants: ONE PLACE, NAMESPACED IDENTITY, FAIL-CLOSED COLLISIONS, DISTINCT SEMANTICS, NO STUBS
- Lifecycle: none (shadowed enum only). Relies on managers loadEnabled filtering.
- Trust: none stored. Relies on McpAllowlist gate in McpManager.loadOne, PluginManager hash checks.
- Permissions: mode only (READ_ONLY_CORE). No effective authority evaluation.
- Audit: collisions audited via `tools.collision`, tool calls via `sessionStore.addStep act` + `tool.blocked` etc.
- Provenance: via AgentService onToolUse callback → CapabilityService.recordUse → provenance graph.

**System B — CapabilityService (inventory)**

- Owner: `src/platform/capabilities/service.ts`
- Scope: all capability types (plugin, skill, mcp, provider, tool, workflow, integration, artifact)
- Registration: aggregates from PluginManager.health(), UnifiedSkillRuntime.list(), McpRegistry.list(), PRESETS, allTools(), WorkflowRepository, CONNECTORS
- Discovery: `discover(query)` with rich filters (type, requires, excludesPermissions, maxRiskTier, locality, trust, publisher, certified, installedOnly, enabledOnly) + scoring.
- Execution: none — delegates enable/disable/quarantine/rollback to underlying planes.
- Lifecycle: `CapabilityLifecycleState` with detailed history via CapabilityMetadataStore overlays.
- Trust: trustLevel, verifiedPublisher, signedPackage, evidenceScore, certification, vulnerability, maintenance, via EvidenceTrustScorer.
- Permissions: declared + effective AuthorityVector with denied-wins.
- Audit: provenance graph (nodes, edges, events) + auditStore via store.audit.
- Provision: best-effort, metadata overlay not authoritative over install/enabled state.

**Problem:** Two sources of truth for "what can run". ToolRegistryService knows what it loaded, CapabilityService knows inventory + overlays, but they are not atomically consistent. A capability could be listed as enabled in metadata but not loaded due to manager failure, or vice versa. Discovery uses different filters: one mode-only, one rich. No single CapabilityRequest → Policy → Execution choke point.

### 1.2 Other capability sources tracing

- **Core tools:** registration coreToolContributions() → ToolRegistryService → discover → model tool exposure (name = exposedName) → tool call → checkAction (policy) → ctx.approve → ctx.runIsolated or direct run → audit + provenance. Safe path, but permission is boolean requiresApproval, not unified scope.
- **Skills:** manifest → verification (checksum) → SkillMarketplace install → UnifiedSkillRuntime resolve → executionContext prompt → ToolRegistryService.registerSkill prompt → model request via system prompt → no direct execution. Skill permission checking via SkillPermissionManager separate. Skill trust via verification.level. Provenance preserved. Cannot dynamically create execution authority (prompt only). Good.
- **Plugins:** verification (validatePlugin, hash, compat) → permission grant effectiveGrant → registration via PluginManager registry → discovery via health() → pluginTools() → ToolRegistryService → model request → policy via authorityProblem? Actually policy via granted check at load, plus requiresApproval at tool wrapper → approval → execution via pt.run in sandbox-worker → audit + provenance. Good, but permission check at load time only, not at execution time re-evaluated.
- **MCP:** signature (McpAllowlist signed ed25519) → allowlist check → trust health → tool discovery via client.listTools → capability registration → model request → policy via authorityProblem + allowlist gate + egress + scanMcpToolDescription → approval? → MCP execution via client.callTool → audit + provenance. Good, but allowlist check at load only, not at call time re-evaluated? Should re-check.
- **Computer control:** planner LLM → Action[] → classify → checkPermissionForAction → approval racing → execute via adapter → audit. Outer tool gated via ToolRegistry, inner actions via separate permission file. Nested authority, not unified.
- **Web:** fetch_url/web_search/check_package → core registration → discovery → model request → policy via hostAllowed + guardedFetch (DNS private-range/metadata blocking) + checkAction egress → execution → audit. Good, but egress allowlist from config, not capability permission.

### 1.3 Fragmentation evidence

- Duplicate permission systems: 5+ enums
- Duplicate trust taxonomies: 3+ levels
- Duplicate lifecycle: 3+ state machines
- Duplicate provenance: auditStore + provenanceStore (actually complementary, but duplication risk)
- Bypass potential: plugin tools not going through checkAction, computer control inner actions not through ToolRegistry, web via egress proxy separate.

---

## 2. TARGET ARCHITECTURE

### 2.1 Principles

1. **Preserve working architecture:** ToolRegistryService remains canonical registration/discovery for callable tools. Do not create independent CapabilityRegistry controlling execution.
2. **One semantic permission model:** One Permission type (string scope) with mapping from legacy enums, evaluation via AuthorityVector denied-wins.
3. **One trust model:** Reuse capability trust levels official/verified/community/unknown/quarantined + evidenceScore + signedPackage, stored per capability id.
4. **One lifecycle model:** Unified LifecycleStates: discovered, verified, installed, enabled, disabled, quarantined, revoked, rolled_back. Valid transitions defined.
5. **One provenance/audit model:** Existing hash-chained auditStore + provenance graph preserved, no new mechanism.
6. **One policy boundary:** CapabilityRequest → Policy evaluation (trust, permission, scope, lifecycle) → Approval → Budget → Shield/Security → Execution → Audit. Every source passes same boundary.
7. **Discovery safe + execution repeats:** Discovery hides capabilities not available, but execution re-authorizes.
8. **Model REQUESTS not GRANTS:** Model tool_call is request, never mutation. Lifecycle mutations require control-plane auth (bearer token).
9. **Deterministic collisions, no privilege escalation:** Existing NAMESPACE + bareNames arbitration preserved, enhanced with lifecycle awareness (disabled cannot shadow enabled).

### 2.2 Domain Concepts (Unified)

#### Capability

Atomic authorized action XR can expose to agent/model.

```ts
interface Capability {
  id: string; // namespace-qualified, globally unique: core:read_file, plugin:acme:deploy, mcp:github:create_issue, skill:writing, computer:desktop:click, web:fetch
  name: string; // bare name
  version: string;
  description: string;
  provider: CapabilityProvider; // who provides
  source: CapabilitySource; // where came from (builtin, local, git, url, registry, marketplace, config)
  permissions: CapabilityPermission[]; // required authorities
  effectivePermissions: AuthorityVector; // computed
  trust: CapabilityTrust;
  scope: CapabilityScope; // where authority applies
  lifecycle: CapabilityLifecycleState;
  provenance: CapabilityProvenance; // WHAT, WHO, WHEN, WHERE, version, hash, trust decision, policy decision, scope, runId
  execution: { kind: ToolKind; binding: Tool | Prompt }; // how to execute
  placement: Placement; // in_process, restricted_process, container, etc.
  riskTier: RiskTier; // tier0, tier1, tier2, blocked
}
```

Reuse existing CapabilityDescriptor fields where possible.

#### Provider

Who provides capability, unforgeable derived from kind.

- `core` (core tools)
- `skill:<id>` (skill packs)
- `plugin:<id>` (plugins)
- `mcp:<server-id>` (MCP servers)
- `computer:<backend>` (xdotool, playwright, etc)
- `web:<provider>` (searx, npm, pypi)
- `provider:<id>` (LLM providers)
- `workflow:<id>`, `integration:<id>`, `artifact:<id>`

Namespace prefix owned by kind, never from input (I2).

#### Permission

Single semantic permission scope string, with compatibility aliases.

Examples:

```
filesystem.read
filesystem.write
filesystem.delete
runtime.shell
network.fetch
browser.control
computer.input
computer.desktop
computer.browser
control.files_write
mcp.execute
provider.chat
memory.read
memory.write
```

Mapping:

- Plugin PermissionScope `fs:read` → `filesystem.read`
- Skill `fs:write` → `filesystem.write`
- `shell` → `runtime.shell`
- `net` → `network.fetch`
- `control` → `computer.input` etc.
- Tool requiresApproval → maps to permission requiring approval

Evaluation: AuthorityVector effective = (declared ∩ grant) − denied (denied wins). From authority.ts.

#### Trust

How trustworthy provider/capability:

- Levels: `official` (XR core, publisher verified, signed), `verified` (marketplace verified), `community` (unverified but hash recorded), `unknown` (first seen), `quarantined` (security alert)
- Signals: verifiedPublisher bool, signedPackage bool, signatureStatus valid/invalid/unsigned/unverified/unknown, certificationStatus unknown/self-tested/xr-tested/verified/quarantined, vulnerabilityStatus none-known/unknown/flagged/quarantined, maintenanceStatus active/unknown/deprecated/abandoned, evidenceScore number, evidence string[]
- Preservation: existing XR trust/verification concepts reused (skill verification.level, plugin trust.signature, MCP allowlist signature)

#### Scope

Where authority applies:

- `workspace` (file tools via safePath containment)
- `session` (runId, envelopeId)
- `agent` (agent role, memory scope)
- `shared` (provider API, web)
- `host` (computer control desktop actions)

Use existing XR scope semantics (projectScopeFromCwd, AgentDeps agentRole).

#### Lifecycle

- `discovered` (found but not installed)
- `verified` (signature/hash verified)
- `installed` (manifest exists)
- `enabled` (active, can be discovered)
- `disabled` (installed but not active, cannot execute)
- `quarantined` (security alert, cannot execute, requires review)
- `revoked` (removed, hash revoked)
- `rolled_back` (restored from snapshot, disabled pending permission review)

Valid transitions:

```
discovered → verified → installed → enabled ↔ disabled
enabled → quarantined → disabled
enabled → revoked → removed
installed → rolled_back → disabled (permissions require review)
disabled → enabled (if not quarantined)
quarantined → disabled (clearQuarantine) → enabled (after review)
```

Only trusted control-plane operations may transition (CLI, daemon routes with bearer token). Model cannot.

Every transition audited via `store.audit` hash-chain + provenance `recordEvent`.

#### Provenance

Every grant/change records:

- capabilityId, provider, version, source, sourceHash, trustLevel, previousState, newState, actor, timestamp, scope, reason, runId/sessionId, policy decision

Use existing CapabilityProvenanceStore (single-writer atomic tmp+rename) + AuditRepo hash-chained. No new audit mechanism.

#### Execution Binding

- core: in-process Tool.run
- plugin: sandbox-worker Tool.run with granted scopes
- mcp: remote JSON-RPC via McpClient.callTool
- skill: prompt contribution (no run, guidance only)
- computer: executor via adapter + approval racing
- web: guardedFetch + egress proxy

Distinct semantics preserved (Art XIV/XV, Global Rule 6).

---

### 2.3 Unified Registration

```
                              ┌──────────────────┐
                              │ Capability Model │
                              │ (unified types)  │
                              └────────┬─────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
      Core                           Skill                          Plugin
        │                              │                              │
        └──────────────────────────────┼──────────────────────────────┘
                                       │
                                      MCP
                                       │
                              Computer Control
                                       │
                                   Web (fetch, search, etc)
                                       │
                                       ▼
                           ┌──────────────────────┐
                           │ ToolRegistryService  │
                           │ Canonical Capability │
                           │ Discovery + Binding  │
                           │ + lifecycle map      │
                           │ + trust map          │
                           │ + permission map     │
                           │ + scope map          │
                           └──────────┬───────────┘
                                      │
                                      ▼
                              Capability Request
                                      │
                                      ▼
                               Policy Boundary
                                      │
                           ┌───────────┼──────────┐
                           │           │          │
                        Trust      Permission  Scope
                           │           │          │
                           └───────────┼──────────┘
                                      │
                                   Lifecycle
                                      │
                                    Approval
                                      │
                                     Budget
                                      │
                                   Security/Shield
                                      │
                                      ▼
                                   Execute
                                      │
                                      ▼
                                     Audit
                                      │
                                      ▼
                                  Provenance
```

**Implementation:**

- Enhance `src/tools/registry-service.ts` with maps: `lifecycle: Map<id, CapabilityLifecycleState>`, `trust: Map<id, CapabilityTrust>`, `permissions: Map<id, string[]>`, `scope: Map<id, CapabilityScope>`, `provenance: Map<id, CapabilityProvenance>`
- Methods: `setLifecycle(id, state, reason)`, `getLifecycle(id)`, `setTrust(id, trust)`, `setScope(id, scope)`, `setPermissions(id, perms)`
- Discovery pipeline: registered → trust filter (quarantined filtered out unless explicitly requested) → lifecycle filter (only enabled) → scope filter (workspace match) → permission filter (effective ∩ granted) → mode filter (existing READ_ONLY_CORE) → policy filter (future)
- Execution repeat: `resolve()` checks lifecycle == enabled, trust != quarantined, scope allowed for current run.

- Keep `src/tools/registry-builder.ts` as sole assembler: core first, plugins via loadEnabled, mcp via loadEnabled, skills via executionContext, memory tools. It will also populate lifecycle/trust maps from managers.

- CapabilityService remains as **inspection/management plane**, not execution plane: it aggregates descriptors for dashboard/API, and its enable/disable calls delegate to managers which then affect ToolRegistryService's loaded set + lifecycle map.

### 2.4 Discovery Must Be Safe

```
registered capabilities
        ↓
trust filter (quarantined, revoked → hidden; unknown requires? allowed but low score)
        ↓
lifecycle filter (enabled only for model-visible; disabled/quarantined not offered)
        ↓
scope filter (workspace/session/agent match)
        ↓
permission filter (effective permissions subset of granted? plus mode)
        ↓
mode filter (agent gets all, plan/ask read-only core)
        ↓
policy filter (deniedPermissions from config, egress allowlist etc)
        ↓
model-visible capabilities
```

- Hiding ≠ security: Execution repeats authorization.
- Discovery authorization and Execution authorization both exist, using identical policy rules (lifecycle, trust, scope, permission).

### 2.5 Collision and Namespace Design

Use existing XR namespacing:

- `core:<tool>` (core namespace reserved, unforgeable)
- `plugin:<id>:<capability>` (plugin)
- `mcp:<server>:<tool>` (mcp server)
- `skill:<id>` (skill prompt, not callable)
- `computer:<backend>:<action>` (computer control inner actions? but outer tool stays core:computer_control)
- `web:<provider>:<capability>` (future: fetch via searx etc, but currently core:fetch_url)
- `provider:<id>`, `workflow:<id>`, etc for capability inventory

Rules:

- Deterministic: registration order core first, then insertion order, but collision arbitration is order-independent for non-core (ambiguous → null).
- No silent replacement: if non-core claims core bare name, core keeps it, non-core qualified-only, collision reported.
- No privilege escalation via collision: bare name never changes meaning to higher-privileged impl.
- Provenance preserved: winner/loser recorded in collisions list, audited `tools.collision`.
- Disabled provider cannot shadow enabled: new rule — if existing holder is enabled and new entry's source is disabled/quarantined, new entry stays shadowed ambiguous/core_reserved but does not demote holder. Implementation: check lifecycle map before demote.
- Higher trust must not auto-override security policy: trust influences ranking (evidenceScore) but not bare-name arbitration. Denied always wins.

### 2.6 Trust Integration

- Skill verification: verification.level official/verified/unverified → trustLevel mapping, checksum hash
- Plugin trust: manifest.trust.signature + hashEntrypoint + hashPluginTree + trustLevel → CapabilityTrust signedPackage, signatureStatus
- MCP signatures: McpAllowlist signed allowlist default-deny → trust verified publisher, signedPackage
- Capability certification: runCapabilityContractTests → certification status verified/xr-tested/self-tested/quarantined
- Quarantine: CapabilityMetadataStore.quarantine → overlay state quarantined → ToolRegistryService lifecycle map + manager unload
- Marketplace verification: publisher.verified via SkillMarketplace
- Provenance: firstSeen, lastSeen, version, hash, trust decision, policy decision

Do not remove stronger verification: MCP signed allowlist, plugin static scan, skill verification, supply-chain SLSA must remain.

### 2.7 Lifecycle

States: discovered, verified, installed, enabled, disabled, quarantined, revoked, rolled_back, removed, error, unknown (reuse existing set).

Valid transitions enforced in UnifiedCapabilityService (or CapabilityMetadataStore wrapper).

Every transition: previousState → newState recorded with actor, timestamp, reason, runId, via audit hash-chain + provenance events.

Model cannot transition: only control-plane (CLI commands plugin enable/disable, mcp allow/revoke, skill enable/disable, capabilities API routes with bearer token). ToolContext does not expose setLifecycle.

### 2.8 Provenance / Audit

- Use existing CapabilityProvenanceStore (atomic tmp+rename, bounded) for graph: nodes, edges (depends-on, updated-from, replaced-by), events (install/update/enable/disable/use/outcome/rollback/quarantine/certify/remove/review/error)
- Use existing AuditRepo hash-chained tamper-evident for `store.audit(event, detail, sessionId)`
- For every capability state change record: capabilityId, provider, version, source, sourceHash, trustLevel, previousState, newState, actor, timestamp, scope, reason, runId/sessionId

Test: enable, disable, quarantine, rollback, change provider/version — verify audit chain valid, provenance events present.

---

## 3. MIGRATION STEPS

### Step 1: Create unified capability types

- File: `src/capabilities/types.ts`
- Define: Capability, CapabilityProvider, CapabilityPermission, CapabilityTrust, CapabilityScope, CapabilityLifecycle, CapabilityProvenance, CapabilityRequest, CapabilityDecision, unified enums
- Reuse existing CapabilityDescriptor fields where possible
- Map legacy permission enums to unified via compatibility layer: `legacyToUnified(scope: string) => CapabilityPermission`

### Step 2: Enhance ToolRegistryService

- Add maps: lifecycle, trust, scope, permissions, provenance per id
- Add methods: setLifecycle, getLifecycle, setTrust, getTrust, setScope, setPermissions, setProvenance
- Modify `registerOne`: after arbitration, set default lifecycle enabled if not set, trust official for core etc.
- Modify `discover(options)`: add optional filters for lifecycle (default enabled only), trust (exclude quarantined), scope, permission
- Modify `resolve(nameOrId)`: check lifecycle == enabled and trust != quarantined, else return undefined (fail-closed)
- Ensure collision demote respects lifecycle: disabled cannot demote enabled

### Step 3: Capability discovery pipeline

- New file: `src/capabilities/discovery.ts`
- Implements safe discovery: registered → trust → lifecycle → scope → permission → mode → policy → model-visible
- Uses ToolRegistryService as source

### Step 4: Capability request + policy boundary

- File: `src/capabilities/request.ts`
- `CapabilityRequest { capabilityId, requestedBy, runId, sessionId, scope, arguments, reason, mode, workspaceId }`
- `CapabilityDecision { allowed: boolean, reason?, requiredApproval?, riskTier?, trust?, effectivePermissions? }`
- File: `src/capabilities/policy.ts`
- `evaluatePolicy(request, context: {registry, config, trust, lifecycle}) => CapabilityDecision`
- Checks: lifecycle must be enabled, trust not quarantined, scope allowed, permissions effective contains required, mode allows, deniedPermissions not blocking, egress allowlist for network etc.
- This is the single choke point — all execution passes through it.

### Step 5: Execution integration

- File: `src/capabilities/executor.ts`
- `executeCapability(request, context)` → runs policy eval → if denied return blocked, if approval required ask via approve → budget check → shield/security → execution via registry.resolve → audit + provenance
- Agent loop `runAgentLoop` should call policy evaluation before tool.run (currently does via offered set + checkAction; need to integrate)

### Step 6: Adapt registry-builder to populate metadata

- In `buildToolRegistry`, after registering each contribution, populate trust/lifecycle maps:
  - Core: trust official, lifecycle enabled
  - Plugins: trust from manifest trustLevel, lifecycle from entry.enabled ? enabled : disabled, quarantine if entry.lifecycleState quarantined
  - MCP: trust from entry.trustLevel + allowlist gate, lifecycle enabled/disabled/quarantined
  - Skills: trust from verification.level, lifecycle enabled/disabled

### Step 7: UnifiedCapabilityService wrapper (optional but recommended)

- File: `src/capabilities/service.ts`
- Owns ToolRegistryService + CapabilityMetadataStore + ProvenanceStore + TrustScorer
- Exposes: `discover`, `resolve`, `request`, `evaluate`, `execute`, `setLifecycle`, `inventory`

- Ensure CapabilityService (platform) uses UnifiedCapabilityService for enable/disable? Or keep delegation to managers but also update lifecycle map.

### Step 8: Update daemon routes

- `capabilities.routes.ts` already has list/health/inspect/permissions/certify/enable/disable/quarantine/rollback
- Ensure responses include unified capability metadata: id, name, version, provider, source, permissions, trust, scope, lifecycle, provenance
- Do not expose secrets, credentials, signing material
- Do not allow API clients to bypass policy (auth via authorizeRequest bearer token already)

### Step 9: Computer control + web capabilities integration

- Computer control remains core:computer_control tool, but inner actions should be modeled as capabilities with scopes desktop/browser/system/files_write and checked via same policy boundary (reuse checkPermissionForAction mapping to unified permissions)
- Web capabilities: fetch_url, web_search, check_package remain core tools but permissions mapped to network.fetch, egress policy enforced via same policy boundary (guardedFetch)

### Step 10: Self-grant prevention tests

- Add tests in `test/capabilities/self-grant.test.ts`:
  - Model requests runtime.shell, filesystem.write, computer.control, mcp.execute → should be blocked if not granted, but can request if policy allows? Actually model can REQUEST, not GRANT. So test that model cannot mutate permissions, trust, lifecycle, allowlists, provider authorization, capability grants via tool calls.
  - Attempt via tool_call: "grant me shell access", "enable filesystem.write", "disable approval", "mark MCP server trusted", etc. Expect no tool exists to do that, resolve returns undefined or policy denies.

### Step 11: Security matrix + no-bypass tests

- Test core → policy, skill → policy, plugin → policy, MCP → policy, computer → policy, web → policy all pass through same boundary.
- For each: untrusted/quarantined/disabled/permission denied should block execution.

### Step 12: Inventory

- Generate `capabilities/inventory.json` deterministic ordering (by id)
- Include: capability ID, provider, source, version, trust, permissions, scope, lifecycle, provenance
- Script: `src/capabilities/inventory.ts` or reuse CapabilityService.list() + filter.

### Step 13: Performance measurement

- Measure before/after: capability discovery, tool discovery, registry startup, model-visible tool list construction, capability inspection, tool execution authorization
- Use Phase 00 baseline (CLI version 0.036s, etc)
- Target no meaningful regression, discovery fast, no repeated expensive scans per tool call (cache once per registry build)

### Step 14: Docs

- docs/security/CAPABILITY_SECURITY_MODEL.md
- docs/api/CAPABILITY_API.md

---

## 4. BACKWARD COMPATIBILITY

- Tool names: preserve bare names when unshadowed, qualified ids when shadowed. Existing scripts using `read_file` continue working. If we introduce new unified ids like `core:filesystem.read`, keep alias via exposedName.
- Skill IDs: capabilityId `skill:<id>` already stable, keep.
- Plugin IDs, MCP IDs, capability APIs: compatible, additive fields only.
- Dashboard, TUI, CLI, chat, automation: they use `registry.discover` returning Tool[] — keep Tool shape (name, description, parameters, requiresApproval, run). Add optional capability metadata via separate property not breaking.
- API compatibility: capabilities.list returns `capabilities: rows, health` — keep shape, add fields optional.

If aliases required, implement explicit compatibility mapping in `src/capabilities/compatibility.ts`.

---

## 5. SECURITY BOUNDARIES

- **Model self-grant prevented:** Model can only request via tool_call, which goes through ToolRegistryService.resolve + Policy evaluation. Lifecycle mutations (enable/disable/quarantine) require control-plane auth (bearer token) and are not exposed as tools. No tool named `enable_capability` etc exists.
- **Trust enforced:** MCP allowlist gate fail-closed in McpManager.loadOne + resolve check; plugin hash verification; skill verification level; capability overlay quarantine.
- **Scope enforced:** workspace via safePath, session via runId, agent via agentRole, host via control permissions.
- **Lifecycle enforced:** quarantine/disable/revoke prevents execution because manager not loaded + registry lifecycle map blocks resolve.
- **Phase 07 protections remain:** SSRF private IP blocked via guardedFetch, trust handoff block list via classifySensitiveWrite, MCP poisoning scan, tool-output framing <<<XR_TOOL_DATA>>>, content-hash exec gate, audit hash-chained, secret redaction, path escape blocked, egress allowlist.
- **No bypass:** Every execution passes CapabilityRequest → policy → approval → budget → shield → execution → audit.

---

## 6. FAILURE MODES

- **Registry build failure:** Best-effort, diagnostics collected, not thrown; degraded tool set still usable.
- **Manager load failure:** Plugin/MCP load error recorded as health error, summary.errored incremented, audit, but registry still contains other tools.
- **Trust verification failure:** Allowlist invalid signature → isAllowed returns fail-closed, server not loaded, health untrusted, audit mcp.allowlist_denied.
- **Policy denial:** Returns blocked with reason, audited as tool.blocked or capability denied.
- **Approval denied:** Returns denied output, audit.
- **Budget exceeded:** onOverBudget hook, pause/stop, audit budget.pause/stop.
- **Provenance write failure:** Best-effort, warns on stderr, does not break install/rollback (registry authoritative).
- **Metadata corruption:** CapabilityMetadataStore read() returns empty on corrupt (with .broken backup), fails closed.

---

## 7. ROLLBACK PLAN

- **Commit per step:** Each migration step commit, can revert via git.
- **Feature flag:** `XR_UNIFIED_CAPABILITY=0` disables new lifecycle/trust/scope filters, falls back to mode-only discovery.
- **No irreversible migrations:** Workspace store migrations idempotent, metadata store optional, provenance additive. No schema changes that delete data.
- **If performance regresses:** Disable caching? Actually new code should not add expensive scans per tool call; if it does, revert and add cache TTL.
- **If security regression:** Immediately rollback to Phase 07 baseline, audit chain integrity.

---

## 8. PERFORMANCE TARGETS

- Capability discovery: <50ms for 200 capabilities (currently tool discovery ~ few ms)
- Tool discovery: <10ms for core set
- Registry startup (buildToolRegistry): <500ms including plugin+MCP load (currently plugin load maybe 100ms, MCP maybe 200ms)
- Model-visible tool list construction: <20ms
- Capability inspection: <100ms
- Tool execution authorization: <5ms per call

Use Phase 00 baseline for comparison.

---

## 9. FILES TO CHANGE (Provisional)

- `src/capabilities/` (new): types.ts, discovery.ts, request.ts, policy.ts, executor.ts, service.ts, inventory.ts, compatibility.ts
- `src/tools/registry-service.ts`: enhance with lifecycle/trust/scope/permission maps, discovery filters, resolve enforcement
- `src/tools/registry-types.ts`: add CapabilityProvider, CapabilityTrust, CapabilityScope, CapabilityLifecycle, unified Permission type
- `src/tools/registry-builder.ts`: populate metadata maps from managers
- `src/skills/` : ensure permissions map to unified, trust mapping
- `src/plugins/manager.ts`: ensure lifecycle/trust exposed for registry population
- `src/mcp/manager.ts`: ensure lifecycle/trust exposed
- `src/daemon/routes/capabilities.routes.ts`: ensure coherent metadata output, auth preserved
- `src/core/agent.ts`: integrate policy evaluation before tool execution (optional, but should call capability policy)
- `src/control/` : map control scopes to unified permissions
- `src/tools/web.ts` : keep but ensure egress policy via unified boundary
- Tests: `test/capabilities/` new tests for self-grant, bypass, security matrix, lifecycle, provenance

---

## 10. OPEN QUESTIONS (Resolve before coding)

- Should UnifiedCapabilityService replace CapabilityService or wrap it? Decision: wrap/enhance, not replace, to preserve dashboard API compatibility. CapabilityService remains inventory plane, ToolRegistryService remains execution plane, but they share lifecycle/trust maps via unified types.
- Should computer control inner actions be modeled as separate capabilities? Decision: yes, but keep outer tool as core:computer_control; inner actions tracked as capability uses with scopes, recorded as provenance events, but not as separate model-visible tools (they are governed by control permissions).
- Should web capabilities become provider:web or core? Keep core:fetch_url etc, but provider field = core, source = builtin, permission = network.fetch.

---

## 11. SUCCESS CRITERIA (Exit)

- All questions in Final Verification answered with source-code evidence true.
- Phase 08 exit criteria met.
- Typecheck, boundaries, full test suite pass.
- No bypass paths.
- Model self-grant blocked.
- Performance no regression.
- Compatibility preserved.

