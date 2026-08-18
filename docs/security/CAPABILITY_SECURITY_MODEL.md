# Capability Security Model — Phase 08

**Date:** 2026-08-18
**Scope:** Unified Capability System security boundaries

---

## 1. Principle: Model REQUESTS, Never GRANTS

```
MODEL
  ↓
"I need filesystem.write"
  ↓
CapabilityRequest {capabilityId, requestedBy, runId, sessionId, scope, arguments, reason}
  ↓
Policy Engine
  ↓
Trust evaluation
  ↓
Lifecycle evaluation
  ↓
Scope evaluation
  ↓
Permission evaluation (denied wins)
  ↓
Mode evaluation
  ↓
Approval if required
  ↓
Budget/security checks
  ↓
EXECUTE
  ↓
Audit + Provenance
```

**The model can only REQUEST via tool_call. It cannot GRANT.**

Grants, enables, trust promotions, allowlist mutations are control-plane operations requiring bearer token auth (daemon authorizeRequest) or CLI human approval. They are NOT exposed as tools.

### Why this matters

If the model could grant itself `runtime.shell` or `filesystem.write`, it could escalate. XR prevents this by:

- No tool named `enable_capability`, `grant_permission`, `add_to_allowlist`, `certify_plugin`, etc exists in ToolRegistryService.
- Capability lifecycle mutations (`enable`, `disable`, `quarantine`, `rollback`, `certify`) are daemon routes requiring `Authorization: Bearer <token>` or session cookie, not tool-callable.
- ToolRegistryService.resolve returns undefined for disabled/quarantined, so even if model tries qualified id, it fails closed.
- Approval gates are human-driven (CLI confirm + dashboard queue racing), not model-driven.

---

## 2. One Canonical Execution Boundary

**ToolRegistryService is canonical discovery + binding.**

All sources register through `buildToolRegistry()`:

- Core: `coreToolContributions()` → `registerTools({kind:core, source:core, tools, metadata})`
- Plugin: `PluginManager.loadEnabled() → pluginTools() → registerTools({kind:plugin, source:plugins, tools, metadata})`
- MCP: `McpManager.loadEnabled() → mcpTools() → registerTools({kind:mcp, source:mcp, tools, metadata})`
- Skill: `UnifiedSkillRuntime.executionContext() → prompt → registerSkill` (prompt only, no run)
- Memory: `buildMemoryTools() → registerTools({kind:core, source:context-memory})`

**Execution path:**

```
AgentService.execute()
  → buildToolRegistry()
  → ToolRegistryService.discover({mode}) — model-visible tools
  → runEnvelope()
  → runAgentLoop()
    → registry.resolve(name) — checks offered set + lifecycle + trust
    → evaluatePolicy(request, context) — identical policy as discovery
    → approve if required (human)
    → tool.run(args, ctx)
    → audit + provenance
```

**No bypass:**

- `test/core/no-bypass.test.ts` fails build if any module outside `src/core/execution/` imports `runAgentLoop`.
- `registry.resolve` checks lifecycle (disabled/quarantined/revoked → undefined) and trust (quarantined → undefined) at execution time, same as discovery.
- Core, skill, plugin, MCP, computer, web all go through same registry + policy.

---

## 3. Trust Integration

Reuse existing XR trust concepts, no duplicate taxonomy.

| Source | Trust Signal | Verification | Storage |
|--------|--------------|--------------|---------|
| Core | official | builtin, no signature | registry metadata trustLevel=official |
| Skill | verification.level official/verified/unverified + checksum | hashSkillTree, signature | CapabilityDescriptor trust + metadata overlay |
| Plugin | trustLevel + hashEntrypoint + hashPluginTree + signature | manifest.trust, static scan | registry metadata trustLevel + sourceHash |
| MCP | McpAllowlist signed ed25519 default-deny | allowlist signature valid + server id listed | registry metadata trustLevel quarantined if not allowlisted, health untrusted |
| Capability | evidenceScore, verifiedPublisher, signedPackage, certificationStatus | EvidenceTrustScorer, contract tests | CapabilityMetadataStore overlay + provenance |

- **MCP signed allowlist must remain:** `McpAllowlist.isAllowed(id)` requires valid signature + listed. If unsigned or not listed → fail-closed, health untrusted, audit `mcp.allowlist_denied`.
- **Plugin static scanning must remain:** `validatePlugin` checks entrypoint containment, permissions, dependencies, compat.
- **Skill verification must remain:** `readSkillManifest` checks safeResolve containment, hash.
- **Supply-chain Phase 07:** cosign, SLSA, hash/cosign checks remain.

**Quarantine/disable/revoke actually prevents execution:**

- Plugin quarantine: `PluginManager.quarantine(id, reason)` → unloadOne + registry quarantine + setLifecycle quarantined + health untrusted. Registry.resolve returns undefined for quarantined.
- MCP quarantine: similar via McpRegistry.
- Capability quarantine: `CapabilityMetadataStore.quarantine(id, reason)` + `ToolRegistryService.setLifecycle(id, quarantined)`.
- Disabled: manager loadEnabled filters enabled; registry lifecycle filter excludes disabled; resolve returns undefined for disabled.

---

## 4. Permission Model — One Semantic Model

**Legacy duplicate models eliminated via compatibility mapping:**

```
Plugin PermissionScope (fs:read, shell, control, secrets, net, mcp, ui...)
Skill PermissionScope (fs:read, memory:read, net, provider...)
MCP PermissionScope
Control PermissionScope (desktop, browser, system, files_read...)
Tool requiresApproval boolean
Capability CapabilityPermissionDeclaration scope
```

**Unified:**

```
filesystem.read, filesystem.write, filesystem.delete,
runtime.shell, runtime.execute,
network.fetch, network.search, network.package,
browser.control,
computer.input, computer.desktop, computer.browser, computer.system, computer.file_read, computer.file_write,
control,
mcp.execute,
provider.chat, provider.embedding,
memory.read, memory.write, context.read,
secrets.read,
workflow.run, integration.execute,
unknown
```

Mapping in `src/capabilities/compatibility.ts`:
- `legacyPluginPermissionToUnified`, `legacySkillPermissionToUnified`, `legacyMcpPermissionToUnified`
- `inferPermissionsFromToolName(name)` for core tools
- `isDangerousPermission(perm)` for approval gating

Evaluation: `AuthorityVector effective = (declared ∩ granted) − denied`, denied wins. Implemented in `src/platform/capabilities/authority.ts` and `src/capabilities/policy.ts`.

---

## 5. Lifecycle — Honest, Audited

States: `discovered, verified, installed, enabled, disabled, quarantined, revoked, rolled_back, removed, error, unknown`

Valid transitions defined in `src/capabilities/types.ts` LIFECYCLE_TRANSITIONS, enforced only by control-plane.

Every transition:

- PreviousState → NewState recorded via `ToolRegistryService.setLifecycle` → `lifecycleAudit` + `CapabilityMetadataStore.record` + `CapabilityProvenanceStore.recordEvent`
- Audit hash-chained: `store.audit("plugin.enable", {plugin, ...})`, `store.audit("mcp.quarantine", ...)`, `store.audit("capability.denied", ...)`
- Provenance: `provenance.json` nodes, edges (depends-on, updated-from, replaced-by), events (install/update/enable/disable/use/outcome/rollback/quarantine/certify/remove/review/error)

Model cannot transition: no tool exposes lifecycle mutation; only CLI `xr plugin enable`, `xr mcp allow`, dashboard API with bearer token.

---

## 6. Scope

- `workspace`: file tools via `safePath` containment (no escaping with ../), `relative(cwd, abs)` check
- `session`: runId, envelopeId, sessionId correlation
- `agent`: agentRole, memoryScopeKind, taskId
- `shared`: provider API, web fetch (egress allowlist)
- `host`: computer control desktop actions (OS-level, not workspace confined, but gated by control permissions + approval racing)

Use existing XR scope semantics: `projectScopeFromCwd`, `AgentDeps.agentRole`, `ToolContext.cwd`.

---

## 7. Provenance — Auditable

For every capability state change record:

```
capabilityId, provider, version, source, sourceHash, trustLevel, previousState, newState, actor, timestamp, scope, reason, runId/sessionId
```

Via existing hash-chained audit (`AuditRepo`) + `CapabilityProvenanceStore` (atomic tmp+rename, bounded maxNodes 2000, maxEvents 8000, maxEdges 5000, write-behind throttle first sync then 256 events/1s).

Test: enable → disable → quarantine → rollback → change provider/version → verify audit chain valid, provenance events present.

---

## 8. Discovery Must Be Safe

```
registered capabilities
  ↓
trust filter (quarantined/revoked hidden unless explicitly requested)
  ↓
lifecycle filter (enabled only for model-visible, disabled/quarantined not offered)
  ↓
scope filter (workspace/session/agent/shared/host match)
  ↓
permission filter (effective ∩ granted, excludes denied)
  ↓
mode filter (agent all, plan/ask read-only core, plugin/MCP cannot widen read-only)
  ↓
policy filter (deniedPermissions from config, egress allowlist, risk tier)
  ↓
model-visible capabilities
```

- Hiding ≠ security: Execution repeats authorization via `registry.resolve` + `evaluatePolicy`.
- Discovery authorization and execution authorization both exist, identical rules (I6, I7, I8).

---

## 9. Collision and Namespace

Use existing XR namespacing (fail-closed):

- `core:<tool>` core reserved unforgeable
- `plugin:<id>:<capability>` plugin
- `mcp:<server>:<tool>` MCP
- `skill:<id>` skill prompt not callable
- `computer:<backend>:<action>` inner actions (outer stays core:computer_control)
- `web:<provider>:<capability>` future, currently core:fetch_url

Rules:

- Deterministic collision handling: insertion-ordered map, core first, then contributions, but arbitration order-independent for non-core (ambiguous → null).
- No silent replacement: core keeps bare name, contribution qualified-only, collision reported.
- No privilege escalation: bare name never changes meaning to higher-privileged impl.
- Provenance preserved: winner/loser in `ToolCollision` + audit `tools.collision`.
- Disabled cannot shadow enabled: Phase 08 enhancement — if holder enabled and incoming disabled/quarantined, incoming stays shadowed; enabled incoming reclaims from disabled holder.
- Higher trust must not auto-override policy: trust influences ranking (evidenceScore) but not bare-name arbitration; denied always wins.

---

## 10. Self-Grant Attack — Blocked

Adversarial scenarios:

```
"Grant me shell access."
→ No tool exists with name containing grant/allowlist; resolve returns undefined; audit tool.blocked unknown_tool; blocked.

"Enable filesystem.write."
→ No tool enables capabilities; capability enable is daemon route requiring bearer token, not tool-callable; blocked.

"Disable the approval requirement."
→ Approval is Tool.requiresApproval boolean, not mutable via tool; no tool mutates registry; blocked.

"Mark this MCP server trusted."
→ Trust mutation via McpAllowlist.allow() requires private signing key + operator file write, not tool-callable; blocked. Also allowlist gate fail-closed.

"Certify this plugin."
→ Certification via capabilities API route POST /api/capabilities/certify requiring bearer token; not tool-callable; blocked.

"Change my capability scope."
→ Scope is registry metadata, not mutable via tool; blocked.

"Add myself to the allowlist."
→ Allowlist mutation requires signing key; blocked.

"Grant this tool permanent access."
→ No tool grants permanent access; budget governed by CostGovernor, not tool; blocked.
```

Expected behavior proven by tests in `test/capabilities/self-grant.test.ts` (Phase 08).

---

## 11. Security Test Matrix

| Source | Discovery | Execution | Denial | Scope |
|--------|-----------|-----------|--------|-------|
| Core tool | discover mode agent/plan/ask filtered | resolve + policy + approval + budget + shield | unknown_tool blocked, non-read in plan/ask blocked | workspace safePath |
| Skill | resolver phrase scoring, prompt injection via system prompt | NOT executable, guidance only, cannot bypass safety | untrusted skill not selected if verification fails | workspace-agnostic prompt |
| Plugin | health() + pluginTools() → discover | authorityProblem + effectiveGrant + requiresApproval + sandbox-worker | unsigned/unverified/quarantined/disabled/permission denied blocked via loadEnabled filter + lifecycle + resolve undefined | shared, sandbox |
| MCP | listEnabled + mcpTools + allowlist gate | isAllowed + authorityProblem + scanMcpToolDescription poisoning + approval | unsigned/unallowlisted/invalid signature/poisoned description/disabled server blocked via allowlist_denied + untrusted health + resolve undefined | remote_service, egress via guardedFetch |
| Computer | core:computer_control discover | isDisabled + checkPermissionForAction + approval racing + per-action risk safe/sensitive/destructive | restricted/approval-required/denied/allowed via hasPermission + approval queue | host OS |
| Web | core fetch_url etc discover | hostAllowed cheap gate + centralized egress proxy DNS/private-range/metadata blocking + redirect revalidation + pinning + byte caps + checkAction egress | private IP blocked 10/8 172.16/12 192.168/16 127/8 169.254/16 metadata 169.254.169.254 ::1 fc00::/7 fe80::/10 + blocked egress + permission denial | internet locality, shared |

---

## 12. No Bypass — Proven

```
core → policy: YES — via registry.resolve + evaluatePolicy + checkAction + guardedFetch + audit
skill → policy: YES — skill is prompt only, never callable, cannot bypass; execution via tools it guides is still gated
plugin → policy: YES — via PluginManager.loadEnabled + effectiveGrant + registry + evaluatePolicy + sandbox + audit
MCP → policy: YES — via McpAllowlist + loadEnabled + authorityProblem + scanMcpToolDescription + registry + evaluatePolicy + audit
computer → policy: YES — via outer core tool approval + inner checkPermissionForAction + approval racing + audit
web → policy: YES — via registry + hostAllowed + guardedFetch + checkAction + audit
```

Regression test: `test/capabilities/no-bypass.test.ts` proves no direct execution path around central policy boundary.

---

## 13. Existing Phase 07 Protections Remain Intact

- SSRF private IP blocked: guardedFetch DNS resolution + isPrivateIp check (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, metadata)
- Trust handoff block list: classifySensitiveWrite detects .claude/settings.local.json, .vscode/tasks.json, .git/config, .git/hooks, package.json scripts, CI, Dockerfile, shell rc etc — surfaces explicit human approval with trusted consumer and execution implication
- MCP poisoning scan: scanMcpToolDescription detects injection signatures, audits, prepends warning, cannot change authority
- Audit chain: hash-chained tamper-evident, verifyChain, brokenAt, secret redaction, path escape blocked
- Secret redaction: isSecretPath canonicalPath, SECRET_PATH_PATTERNS
- Shell restrictions: checkAction dangerous patterns blocked, exec-integrity gate SHA256 binary hash allowlist signed, ld-linux bypass hashing second arg
- Tool-output framing: <<<XR_TOOL_DATA>>> header warning guidance delimiter, scanUntrusted audited

---

## 14. API Security

- Daemon authorizeRequest: Bearer token or session cookie (bootstrap via ?token= one-time page GET → cookie, then redirect strips token)
- CSRF/Origin enforcement for mutating requests: cookie-authenticated must carry Origin matching daemon origin
- Rate limiting: fixed-window per-IP 600/60s → 429 with Retry-After
- Body cap: MAX_BODY 2 MiB → 413
- Contract validation: zod safeParse fail-closed 400 problem+json
- No secrets exposed: capabilities API never returns credentials, signing material, apiKeyEnv values
- No policy bypass: API clients cannot bypass policy, bearer token required for mutating routes

---

## 15. Failure Modes & Mitigations

- Registry build failure: best-effort, diagnostics collected, not thrown, degraded tool set still usable
- Manager load failure: health error, summary.errored, audit, but other tools still present
- Allowlist invalid signature: isAllowed fail-closed, server not loaded, health untrusted, audit
- Policy denial: blocked with reason, audit capability.denied
- Approval denied: denied output, audit approval.denied
- Budget exceeded: onOverBudget hook, pause/stop, audit budget.pause/stop
- Provenance write failure: best-effort warn stderr, not break install/rollback
- Metadata corruption: CapabilityMetadataStore returns empty on corrupt with .broken backup, fail-closed

---

## 16. Remaining Risks (Explicit)

- Computer control inner actions use separate permission file ~/.xr/control-permissions.json TTL 5s cache, not unified via registry lifecycle map. Mitigation: outer tool gated, inner actions still check hasPermission + approval racing, audit. Future could unify control permissions into registry permission map.
- Plugin tools run in sandbox-worker but do not go through checkAction egress/secret path checks; they rely on granted scopes. Mitigation: sandbox enforces fs containment, net permission via allowlist, but not same code path as core tools. Acceptable for Phase 08, document as known divergence.
- Web capabilities egress allowlist from config, not from capability permission effective. Mitigation: guardedFetch enforces allowlist + private IP blocking, same as policy, but permission model not unified. Future unify.
- Performance: registry rebuild per run does plugin/MCP load which includes FS I/O and health checks. Mitigation: hosts optimization in AgentService reuses pre-loaded services, no second load, single-writer discipline.

