# PHASE 08 — Capability Research

**Date:** 2026-08-18
**Author:** Phase 08 implementation engineer (AI Architect)
**Scope:** Unified Capability System audit, external comparison, recommendation

---

## 1. XR Current Architecture (Observed Facts)

### 1.1 ToolRegistryService — the canonical execution registry (Phase 02)

- **File:** `src/tools/registry-service.ts`
- **Types:** `src/tools/registry-types.ts`
- **Builder:** `src/tools/registry-builder.ts`
- **Contribution source:** `src/tools/registry.ts` (`coreToolContributions`)
- **Invariants enforced:**
  - I1 ONE PLACE: core/plugin/mcp/skill all arrive via `register*()`
  - I2 NAMESPACED IDENTITY: `core:shell`, `plugin:<source>:<name>`, `mcp:<server>:<tool>`, `skill:<id>`
  - I3 FAIL-CLOSED COLLISIONS: core keeps bare name, contested non-core bare names become null (neither wins)
  - I4 DISTINCT SEMANTICS PRESERVED: `kind` retained, `tool.run()` per-kind host
  - I5 NO STUBS: retired Phase 0 stubs refused

- **Discovery:** `discover(options: DiscoveryOptions)`:
  - mode filtering: agent gets everything, plan/ask gets READ_ONLY_CORE set only
  - allow/deny lists
  - Shadowed entries exposed under qualified id
  - **No trust, no lifecycle, no scope, no permission evaluation beyond mode**

- **Execution:** `resolve(nameOrId)`:
  - Qualified id direct lookup
  - Bare name via `bareNames` map, fail-closed if contested (null)
  - No lifecycle check, no policy check — those checks happen upstream in builder/managers

- **Assembly:** `buildToolRegistry()` in `registry-builder.ts`:
  - Order: core first, then plugins via `PluginManager.loadEnabled()`, then MCP via `McpManager.loadEnabled()`, then skills as prompt contribution, then memory tools
  - Best-effort: failures collected as diagnostics, never throw
  - Hosts optimization: when kernel booted, AgentService passes pre-resolved `pluginTools()`, `mcpTools()`, `skillContext()` so nothing constructed twice (single-writer, one-store law)

- **Agent loop integration:** `src/core/agent.ts`:
  - If `toolRegistry` supplied: `tools = registry.discover({mode, allow, deny})`, `resolveTool` checks `offered` set first (only offered names may resolve)
  - If not supplied: legacy `getTool + extraToolMap` (deprecated, kept for out-of-tree)
  - Execution: `tool.run(args, ctx)` where ctx includes `approve`, `audit`, `egressAllowlist`, `runIsolated`, `signal`, etc.

- **Envelope enforcement:** `src/core/execution/envelope.ts` + `runner.ts`:
  - Assembly: intent → plan → policy → placement → observation → evidence → outcome
  - `AgentService.execute()` is sole entry point (no-bypass test: `test/core/no-bypass.test.ts`)
  - Placement records registry + tools + collisions, audited as `tools.collision`

### 1.2 Capability Descriptor Plane — inventory & trust (Phase 5.2 / 7)

- **Files:** `src/platform/capabilities/{service, types, adapters, store, provenance, trust, authority, certification, manifest-security}`
- **Service:** `CapabilityService`:
  - `list()` aggregates descriptors from: PluginManager.health(), UnifiedSkillRuntime.list(), McpRegistry.list(), PRESETS + custom providers, core tools via `allTools()`, WorkflowRepository, CONNECTORS integration catalog, artifact transforms
  - Overlays from `CapabilityMetadataStore` (certification, quarantine, trust decisions)
  - Provenance indexing via `CapabilityProvenanceStore.indexDescriptors()` batched (single flush after loop, not per-descriptor)
  - `discover(query)` filters by type, requires, excludesPermissions, maxRiskTier, locality, trust, publisher, certified, installedOnly, enabledOnly, plus scoring (task terms, enabled, verified, signed, certification)
  - `inspect(id)` direct or ambiguous nativeId match
  - `permissions(id)`, `certify`, `enable`, `disable`, `quarantine`, `rollback`, `update`, `health`, `provenanceOf`, `whatWasUsed`, `explainTrust`, `rankEvidence`, `securityReport`, `authorityDiff`

- **Types:** `CapabilityDescriptor`:
  - Rich metadata: schemaVersion, id (`type:nativeId`), nativeId, type (plugin|skill|mcp|provider|tool|workflow|integration|artifact), name, version, description, publisher {id,name,verified,trustLevel}, provenance {source, sourceUrl, installedAt...}, package {sha256, signatureStatus}, compatibility, dependencies, permissions {declared, effective: AuthorityVector}, dataScopes, network, credentials, providerRequirements, placement, interfaces, certification, lifecycle {state, enabled, installed, quarantineReason... history}, trust {trustLevel, verifiedPublisher, signedPackage, evidenceScore...}, support, cost, security {sbom...}, tags, keywords

- **MetadataStore:** `metadata.json` under `~/.xr/capabilities/`:
  - Overlays per id: state, quarantineReason, trustDecision, certification, pendingReview, vulnerabilityStatus, maintenanceStatus, history
  - `upsert`, `record`, `setState`, `quarantine`, `clearQuarantine`, `setCertification`, `markPendingReview`

- **Provenance:** `provenance.json`:
  - Nodes per capability, edges (depends-on, used-by, updated-from...), events (install/update/enable/disable/use/outcome/rollback/quarantine/certify...)
  - Bounded: maxNodes 2000, maxEvents 8000, maxEdges 5000, per-cap maxEvents 500
  - Write-behind throttle: first mutation sync, then every 256 events or 1s
  - `indexDescriptors` batch, `recordEvent`, `recordUse`, `whatWasUsed` ordered by recency with outcome tallies

- **Trust:** `EvidenceTrustScorer` ranks by evidence (never popularity): publisher verified, package signature valid, hash recorded, certification status, outcome stats (uses/successes/failures), not downloads

- **Authority:** `authority.ts`:
  - `resolveEffectiveAuthority({declared, workspacePolicy{denied}, userGrant{allowed}, agentTaskGrant{allowed}, denied})` computes effective = (declared ∩ grant) − denied, undetermined flag, reason
  - Denied always wins

- **Security:** manifest-security gate: scan for reject-level findings block enable unless force; authority diff pre-enable display

- **Danmon routes:** `src/daemon/routes/capabilities.routes.ts`:
  - list, health, inspect, permissions, certify, enable, disable, quarantine, rollback
  - Query enum sanitization (A-6 seam fix): only schema literals pass

### 1.3 Skills

- **Engine:** `src/skills/{engine, loader, manifest, marketplace, runtime, permissions, tool-allowlist, verifier, ...}`
- **Manifest:** `xr-skill.json` with schemaVersion, id, name, version, description, publisher, categories, activation phrases, content {instructions, docs...}, tools, permissions [{scope, reason, dangerous}], verification {level: official|verified|unverified, signature, checksum}
- **Loading:** `readSkillManifest(dir)` via realpath, safeResolve containment check, hashFile, hashSkillTree
- **Runtime:** `UnifiedSkillRuntime`:
  - `registry.refresh()` scans installed skills, `resolver.resolve(task, limit=4)` selects relevant by phrases, `executionContext(task)` returns `{records, prompt}` where prompt is combined index + loaded relevant skills with tool allowlist, dependencies, permissions
  - `Tool-allowlist`: effectiveToolAllowlist from manifest.tools, default-deny
  - Permissions: SkillPermissionManager.report groups safe/dangerous/missingApproval, canUse checks granted
- **Non-regressive:** `SkillEngine.learn()` gated by verifiability (isVerifiable + verify passes), freezes immutable baseline + regression case, `runRegression`, `updateGuarded` auto-rollback if frozen wins regress
- **Does skill become ToolRegistryService capability?** No, it becomes prompt contribution via `registry.registerSkill({kind:skill, source:skills, prompt})`. No run(). Separate collection, type system prevents reaching tool-call path.
- **Can skill dynamically create execution authority?** No, it guides use of substrates but never bypasses safety; documented in runtime executionContext prompt: "A Skill may guide use of substrates, but it never bypasses XR safety..."
- **Trust enforced before registration?** manifest verification level checked, but skill selection is task-based; trust overlay from metadata store applies at capability descriptor level, not at ToolRegistry prompt registration (prompt always registered if resolved). Provenance recorded.

### 1.4 Plugins

- **Manager:** `src/plugins/manager.ts`
- **Manifest:** `xr-plugin.json` with id, name, version, description, permissions, capabilities, entrypoint, dependencies, mcpServers, skillPaths, uiHooks, etc.
- **Parser:** `manifest.ts` validates permissions, effectiveGrant = declared ∩ approved minus denied, resolveGranted, validateManifestPolicy checks mcp command injection, url scheme, duplicate caps, self-dependency, entrypoint containment, etc.
- **Lifecycle:** install (stage tmp → validation → renameSyncRetry with random suffix for uniqueness), enable (validate + check compatibility + dependencies), disable (check dependents), quarantine, rollback (snapshot .rollback/<unique>-<version>), update (new permission check → update_pending_review if escalation)
- **Loading:** `loadEnabled()` topoSort by dependencies, `loadOne(entry)` checks denied perms, hasPermission file cache TTL 5s, loads plugin via loader (hash check if requireTrust), wraps tools via adaptTool: fqName `plugin.<id>.<tool>`, hasSensitiveGrant → requiresApproval, approval via ctx.approve, audit `plugin.tool.call`, `plugin.tool.denied`
- **Does plugin expose capabilities/tools?** Yes via `pluginTools()` = contributions.tools + mcpTools + skills (separate)
- **Permission translation:** effectiveGrant intersection, denied override; stored in registry entry grantedPermissions
- **Bypass ToolRegistryService?** No, `buildToolRegistry` registers `manager.pluginTools()` as kind=plugin source=plugins
- **Trust preserved?** hashEntrypoint + hashPluginTree recorded, installedHash/treeHash compared if requireTrust
- **Disabled/quarantined still callable?** No, loadEnabled filters enabled && lifecycle !== quarantined; quarantined enable returns error

### 1.5 MCP

- **Manager:** `src/mcp/manager.ts`
- **Registry:** `src/mcp/registry.ts` entries with id, transport (http/stdio), url/command, declaredPermissions, grantedPermissions, enabled, health, tools/resources/prompts, trustLevel, checksum, lifecycleState
- **Allowlist:** `src/mcp/allowlist.ts` McpAllowlist signed ed25519 default-deny, atomic rename, fail-closed. `isAllowed(id)` requires valid signature + id listed. Operator generates key pair via generateKeyPairSync ed25519, signs canonicalServers JSON (sorted ids, generatedAt=0) sha256.
- **Signed-server verification:** allowlist gate in loadOne: if config mcp.allowlist.enabled === false explicitly disabled, else isAllowed must ok else setHealth untrusted, record allowlist_denied, audit mcp.allowlist_denied. Enabled necessary not sufficient.
- **Tool discovery:** client.listTools() → toolDefs → wrapMcpTool with client, entry.id. ScanMcpToolDescription for injection signatures, audit if poisoned, prepend warning.
- **Invocation:** wrapMcpTool run() calls client.callTool?
- **Permissions:** authorityProblem checks declared vs granted vs denied (from config capabilities.deniedPermissions and mcp.deniedPermissions)
- **Does MCP bypass policy?** No, via registry builder; plus tool output framing (GAP-003) scanUntrusted + delimiter
- **Disabled/quarantined callable?** No, listEnabled filters enabled, quarantine unloads, loadOne checks authorityProblem and allowlist gate
- **Description poisoning:** scanned, warning prepended, cannot change authority (permissions live in checkAction, McpAllowlist, capability system)

### 1.6 Computer Control

- **Tool:** `src/tools/control.ts` computerControlTool: name computer_control, requiresApproval true, run asks planner LLM to turn natural-language task into Action[], runs every action through v0.8 safety pipeline (classify → approve → execute → audit)
- **Why single tool?** keep budget tight, existing runAgent approval gate handles top-level, per-action approvals inside service, inherits dryRun
- **Backend:** `src/control/service.ts` runAction, classify, execute, adapter detectCapabilities, approvals racing CLI confirm + dashboard queue, memory rememberPlan
- **Permissions:** `src/control/permissions.ts` hasPermission file cache TTL 5s, granted list, checkPermissionForAction maps action.type → scope (desktop, system, browser, files_read, files_write...), files_write special
- **Does it register as normal capability?** Yes via coreToolContributions ALL includes computerControlTool; ToolRegistryService registers as core:computer_control
- **Is mouse/keyboard/screen access represented as permissions?** Yes via control scopes: desktop, browser, system, files_write; but not via unified permission model — separate file cache
- **Does it bypass normal tool authorization?** No, top-level requiresApproval, then per-action approvals inside service (second layer). But inner actions (app launch, type, click) do not go through ToolRegistryService again; they go through control permissions (hasPermission). So there IS a nested authorization that is not the same as tool policy boundary. However outer tool is gated.
- **Are dangerous operations independently gated?** Yes, risk assessment safe/sensitive/destructive, destructive requires explicit confirm, dry-run mode blocks, isDisabled checks XR_CONTROL_DISABLED or config.control.enabled
- **Does it respect session/workspace/agent scope?** workspace via Store singleton reused (Store.lastOpened()), not new Store(). But control actions themselves run on host OS (xdotool, etc) — not scoped to workspace dir. So scope is host-level, not workspace-confined, which is expected but needs audit.
- **Provenance/audit?** Yes audit computer_control.plan_error, computer_control.summary, control.* events via auditPlanned, auditExecuted, auditDenied, auditDisabled; plus toolCtx.audit
- **Trust:** not via MCP allowlist; via local binary presence, capability detection

### 1.7 Web Capabilities

- **Tools:** `src/tools/web.ts` fetch_url, web_search, check_package
- **Egress gating:** hostAllowed suffix check cheap first gate + centralized egress proxy `guardedFetch` in `src/security/egress-proxy.ts`: DNS resolution, private-range/metadata blocking (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7, fe80::/10, 169.254.169.254), redirect revalidation, connection pinning, byte caps, audit event
- **Policy context:** `checkAction` scans URL-ish strings, canonicalizes via WHATWG URL parser, normalizeHost (dotted-quad hex/octal/int forms), denied schemes set (file:, data:, blob:, javascript:, gopher:, ftp:, etc), secret paths via canonicalPath (realpath + lexical fallback), dangerous shell patterns
- **Is web a tool, capability, provider, special subsystem?** It's a tool (core kind) with network authority, but egress proxy is a security plane service, not a provider. It ultimately follows same authorization boundary: tool discovery via ToolRegistry, execution via ToolContext egressAllowlist + guard, plus budget/audit
- **Does it bypass?** No, but egress allowlist originates from config.security.egressAllowlist passed through EnvelopePolicy → ToolContext. So policy is enforced at tool run time, not at discovery.

### 1.8 Fragmentation Matrix (Observed)

| Source | Registration | Discovery | Permission | Trust | Policy | Approval | Execution | Audit | Scope |
|---|---|---|---|---|---|---|---|---|---|
| Core (read_file...) | src/tools/registry.ts coreToolContributions → ToolRegistryService.registerTools kind=core | ToolRegistryService.discover mode=agent|plan|ask + allow/deny | requiresApproval boolean per tool; guard checkAction for dangerous patterns; no unified permission scope | Implicit official (core), no signature check; no trust level stored in registry | checkAction (egress, secret path, dangerous shell) + policy.egressAllowlist | ctx.approve via approval queue | tool.run() in agent loop, with optional runIsolated via TrustService | sessionStore.addStep act, auditStore audit tool.* + security.untrusted_content, provenance recordUse | workspace via cwd safePath containment; some tools host-level (system_apps) |
| Skill | SkillMarketplace + UnifiedSkillRuntime.executionContext → ToolRegistryService.registerSkill as prompt (not callable) | SkillRegistry.search via resolver (task phrase match), ToolRegistry skillPrompt() injects into system prompt | tool-allowlist effectiveToolAllowlist (declared tools), SkillPermissionManager safe/dangerous/missingApproval | verification.level official|verified|unverified, package hash, signature?, certification overlay, provenance firstSeen | capability authority diff + manifest-security gate on enable/update (scans, TUF) | per-permission approval for dangerous scopes (via SkillService lifecycle?) | NOT execution — guidance only; cannot bypass safety | skill.frozen, skill.update.ok/rolled_back, provenance install/update/enable... | workspace-agnostic prompt, but memory/tools within scope |
| Plugin | PluginManager commitInstall → registry.upsert + health + audit → loadEnabled → adaptTool → ToolRegistryService.registerTools kind=plugin | PluginRegistry.list() + PluginManager.pluginTools() → registry.discover, plus CapabilityService.list via descriptorFromPlugin | effectiveGrant declared ∩ approved − denied; SENSITIVE_PERMISSIONS hasSensitiveGrant → requiresApproval; permission file .xr/control-permissions.json for control but plugin own | hashEntrypoint + hashPluginTree, requireTrust check, trustLevel official/verified/community/unknown, signature via manifest.trust.signature, quarantine on security | validateManifestPolicy (cmd injection, url scheme, entrypoint containment...), manifest-security gate, TUF update gate, checkCompatibility, dependency check | requiresApproval true for sensitive or pt.requiresApproval !== false; dashboard approval queue + CLI confirm racing | adapted tool run → pt.run(args) → audit plugin.tool.call, provenance record | audit plugin.install/enable/disable/quarantine/rollback/load_error, provenance events | workspace dir via safePath? plugin tools run in worker sandbox (sandbox-worker) with granted perms |
| MCP | McpRegistry.newEntry + upsert → McpManager.loadEnabled → client.listTools → wrapMcpTool → ToolRegistryService.registerTools kind=mcp | McpRegistry.list() + McpRegistry.listEnabled() + manager.mcpTools() → registry.discover, plus descriptorFromMcp | declared vs granted vs denied (config capabilities.deniedPermissions + mcp.deniedPermissions), authorityProblem, McpAllowlist isAllowed requires signed allowlist entry | McpAllowlist signed ed25519 default-deny atomic rename fail-closed; trustLevel; checksum; health untrusted/error; quarantine | hostAllowed + guardedFetch + checkAction (same as web) + scanMcpToolDescription poisoning scan + manifest-security | requiresApproval? MCP tools generally not approval-gated unless sensitive? Original mcp tool wrapper? Check — likely approval via policy? | client.callTool via MCP JSON-RPC, provenance recordUse, audit mcp.* | audit mcp.add/enable/disable/quarantine/tool_description_poisoned..., provenance | remote service, host not workspace |
| Computer Control | coreToolContributions → ToolRegistryService core:computer_control | same as core | control.permissions hasPermission scopes desktop/system/browser/files_write + isDisabled check + per-action risk safe/sensitive/destructive | binary presence (xdotool...), not signed; trust via local; no provenance signature | classify → assess risk → checkPermissionForAction → approval racing | top-level requiresApproval + per-action approval (CLI confirm + dashboard queue) | src/control/executor execute action via adapter (xdotool, Playwright...), auditPlanned/Executed/Denied, memory rememberPlan | audit computer_control.*, control.*, provenance use | host OS level, not workspace confined |
| Web | coreToolContributions fetch_url, web_search, check_package → ToolRegistryService core | core discovery | egress allowlist domains + allowedHosts raw IP explicit allow; guardedFetch policy allowlist + allowedHosts + audit callback | official core, no signature; egress proxy as trust boundary | hostAllowed cheap gate + centralized egress proxy DNS/private-range/metadata blocking + redirect revalidation + pinning + byte caps; checkAction egress blocked scheme/host + secret path | requiresApproval false for fetch_url/web_search, but trustRequest networkTrustRequest triggers TrustService evaluate for placement? | guardedFetch with policyFor(ctx) = {allowlist, allowedHosts, audit}, htmlToText, audit fetch_url, provenance recordUse | audit fetch_url, web_search, security events | network locality internet, workspace via cwd? |

**Key fragmentation points identified:**

1. **Two registries controlling execution:**
   - ToolRegistryService owns registration/discovery/resolution for callable tools
   - CapabilityService owns inventory, lifecycle (enabled/disabled/quarantined/rolled_back), trust, certification, provenance, but does NOT own execution — it delegates enable/disable to underlying managers (PluginManager, McpRegistry, SkillMarketplace). However ToolRegistryService does NOT consult CapabilityMetadataStore overlays; it consults manager's loaded state. So there are two sources of truth for "enabled": manager registry vs capability metadata overlay. They are kept in sync by CapabilityService.enable calling PluginManager.enable, but ToolRegistryService itself does not read overlays.

2. **Duplicate permission models:**
   - Plugin: PermissionScope enum (shell, control, browser, secrets, fs:read/write, net, mcp, ui...)
   - Skill: SkillPermissionScope (fs:read, fs:write, net, secrets, memory:read/write, provider...)
   - MCP: McpPermissionScope
   - Capability: CapabilityPermissionDeclaration scope string + AuthorityVector
   - Tool: requiresApproval boolean + trustRequest (not a scope)
   - Control: PermissionScope desktop/system/browser/files_read/files_write (different enum)
   These are conceptually same but typed differently.

3. **Duplicate trust taxonomies:**
   - ToolRegistry: no trust stored
   - Capability: trustLevel official/verified/community/unknown/quarantined + verification.level + publisher.verified + evidenceScore
   - Plugin manifest trustLevel, Mcp trustLevel, Skill verification.level
   - MCP Allowlist signed but separate from capability trust

4. **Duplicate lifecycle:**
   - ToolRegistry: no lifecycle; shadowed enum only
   - Plugin: RegistryEntry lifecycleState enabled/disabled/quarantined/update_pending_review + health state
   - MCP: entry.enabled + health healthy/error/untrusted/disabled + lifecycleState quarantined
   - Skill: enabled bool + health healthy
   - Capability: CapabilityLifecycleState discovered/inspected/verified/installed/approved/enabled/loaded/disabled/update_pending_review/quarantined/rolled_back/removed/error/unknown

5. **Bypass paths investigated:**
   - Model → direct subsystem → execution? Check: Agent loop resolves via toolRegistry.resolve only if offered set contains name. So if a capability is not in registry.discover, it cannot be resolved even by qualified id. That's safe. But does computer control inner actions bypass? Yes, inner actions (click, type, etc) go through control service directly, not via tool registry. However they are gated by control permission check and approval racing. So there's a secondary policy boundary, but it's still a policy check. Does it reuse same egress/policy? Partially. For file actions inside computer control, hasPermission files_write is separate.
   - Plugin tools: adaptTool requiresApproval true if sensitive; runs pt.run inside sandbox-worker (PluginManager loader). The execution does NOT go through checkAction (which checks secret paths, egress). So a plugin tool could potentially do file read/write without going through safePath check. However plugin sandbox (loader.ts) presumably enforces fs containment? Need verify loader.ts checks path containment. Looked: validatePlugin checks skillPaths containment but not runtime FS containment of plugin tool execution? Plugin tools are loaded as JS modules; they run in worker? sandbox-worker.ts likely isolates. But NOT same as checkAction. So there is a separate permission enforcement (granted scopes). Not unified.
   - Web capabilities: fetch_url uses guardedFetch which enforces private IP blocking, but checkAction also would block secret paths. So two checks, but both in same tool.

6. **Discovery vs execution policy divergence:**
   - Discovery: mode filtering only (READ_ONLY_CORE). No trust filter, no lifecycle filter (except via loadEnabled), no scope filter, no permission filter beyond mode.
   - Execution: resolve checks offered set (mode) but does NOT re-check lifecycle or trust. It relies on registry not containing disabled entries. However capability service's quarantine sets overlay state quarantined + calls PluginManager.quarantine which unloads, so registry won't contain it. So execution respects lifecycle indirectly via manager state, not via registry's own lifecycle map. Discovery and execution share same underlying manager state, but not identical policy rules (discovery doesn't check trust, execution doesn't either beyond allowlist gate in McpManager.loadOne).

7. **No CapabilityRequest abstraction:**
   - Currently ToolContext contains approve, audit, egressAllowlist etc, but there is no typed CapabilityRequest {capabilityId, requestedBy, runId, sessionId, scope, arguments, reason} that goes through Policy Engine → Trust → Permission → Approval → Budget → Security → Execution → Audit. Instead, policy checks are scattered: checkAction in guard.ts for shell, egressOk + guardedFetch in web tools, hasPermission in control, authorityProblem in mcp manager, effectiveGrant in plugin manager.

8. **Model self-grant:**
   - Currently model can request tool via tool_call, but cannot mutate registry, permissions, trust, lifecycle because those APIs require control-plane operations (PluginManager.enable, etc) which are CLI/daemon routes, not tool-callable. However need to verify if any tool exposes enable/disable capability. Search: is there a tool that enables plugins? No, core tools list does not include enable. Capabilities routes require bearer token auth (daemon authorizeRequest). So model cannot self-grant via tool. But need adversarial test.

---

## 2. Claude Code Comparison

**Research method:** docs, blog, codebase observations, community notes.

**Architecture observed:**

- Skills: directory-based prompt packs (`~/.claude/skills/`), manifest via frontmatter in SKILL.md? Progressive disclosure: skill index listed, details loaded only when relevant (similar to XR's skill resolver limit 4). Invocation via /skill or automatic selection based on task phrases.
- Plugins: marketplace via JSON, extension lifecycle: installed, enabled, disabled, local vs marketplace. Permissions: tools allowlist, sandbox file pattern, network.
- MCP: first-class extension, JSON config `mcp.json`, stdio/sse, discovery via ListTools, lifecycle same as plugins. Permission model: deny/ask/allow precedence (deny-wins), tool groups, per-tool ask.
- Permission model: settings.json `permissions.allow`, `deny`, `ask` arrays, evaluated in order: deny > ask > allow. Tool groups (Read, Write, Edit, Bash, MCP). Mode filtering: Plan mode read-only.
- Tool groups: grouping for permission inheritance; e.g., Read includes read_file, list_dir, fetch.
- Deny-wins behavior: explicit deny overrides any allow.
- Capability discovery: tools offered to model filtered by permission + mode + trust; disabled/quarantined not offered.
- Lifecycle: discovered → installed → enabled → disabled → quarantined?
- Trust boundaries: marketplace verification, signed? Tool descriptions trusted? Has sanitization?
- What XR does better: XR's ToolRegistryService has explicit namespace-qualified ids, fail-closed collision arbitration, retired stub refusal, hash-chained audit, provenance graph with outcomes, evidence-based trust scorer, content-addressed artifact transforms, deterministic envelope.
- What XR missing vs Claude: simpler mental model for user (allow/deny/ask lists in one file), tool groups for bulk permission management, suggestion mode.

**Principles to borrow:**
- Allow/Deny/Ask tri-state + deny-wins (already partially via effectiveAuthority denied wins)
- Tool groups (filesystem.read grouping) for permission inheritance

**What NOT to copy:**
- Prompt-based trust (XR uses kernel-enforced boundaries)
- Tool description implicitly trusted (XR already scans)

---

## 3. Goose Comparison

- MCP-first: 70+ extensions, 3000+ ecosystem, extensions dynamic load per-run composition, recipe YAML params extensions dynamic load.
- Extension lifecycle: install, enable, disable, update; config `~/.config/goose/config.yaml` lists extensions, each with enabled flag, tool allowlist
- Recipe system: YAML recipe declares task, extensions, params, prompts — similar to XR workflow definitions
- Dynamic capability exposure: extensions loaded per-run, not globally
- Extension isolation: each extension in own process (stdio), failure isolates
- What XR better: XR's capability descriptors richer, provenance graph, trust scoring, content-hash exec gate, single-writer store
- What XR missing: recipe params dynamic composition, per-run extension composition (XR does per-run via buildToolRegistry hosts optimization, similar), but Goose's recipe YAML is more portable
- Borrow: per-run dynamic composition with params (XR workflow already has parameters), extension isolation via worker (XR plugin sandbox-worker similar)

---

## 4. OpenClaw Comparison

- Tool groups: similar to Claude, groups like `filesystem:read`, `filesystem:write`, `shell` etc. Permission inheritance hierarchical.
- Permission inheritance: deny-wins, parent deny blocks child
- Capability exposure: model sees only enabled, trusted, within scope
- Sandboxing: per-agent sandbox, file-based memory
- What XR better: XR's namespace-qualified ids prevent shadowing, collision reporting, audit chain
- What XR missing: explicit tool group inheritance config (XR has READ_ONLY set but not hierarchical groups)
- Borrow: explicit deny-wins, tool group inheritance.

---

## 5. Agent Skills Standard (Open)

- Manifest: `xr-skill.json` vs open standard `SKILL.md` frontmatter (name, description, version, triggers, tools, permissions). XR supports both: readSkillManifest reads xr-skill.json or SKILL.md frontmatter.
- Progressive disclosure: index of skills (name, description, category) always injected, full body only when selected — XR does this via executionContext index + loaded relevant.
- Invocation: slash command or auto-selection via phrases. XR uses resolver phrase scoring.
- Metadata: category, tags, keywords, dependencies, compatibility.
- Dependencies: skill can depend on other skills/plugins/mcp (XR SkillDependencyResolver)
- Portability: standard aims to be portable across agents (Claude, XR, Goose). XR already supports SKILL.md generic.
- Should XR expose its skills in standards-compatible manner? Yes, keep SKILL.md support, ensure manifest schema compatible with open standard, provide export to .xrs package (SkillMarketplace.importPackage)
- What's missing: standard tool to publish to registry, version resolver.

---

## 6. MCP Comparison

- Current MCP spec: client-server JSON RPC stdio/SSE/Streamable HTTP, ListTools, CallTool, ListResources, ReadResource, ListPrompts, GetPrompt. Tool metadata: name, description (attacker-controlled), inputSchema JSON Schema.
- Server identity: id, transport, trust via allowlist, not auto-trusted.
- Permissions: not in spec, host must enforce.
- Trust: server can provide any tool name, description — host must namespace, sanitize.
- Execution: host wraps call, enforces allowlist, permissions, audit.
- XR current: McpAllowlist signed default-deny, loadOnly enabled + allowlisted, scanMcpToolDescription poisoning, authorityProblem, wrapMcpTool, audit, provenance.
- What's missing: immutable tool definitions (MCP server could change tool list between ListTools and CallTool); XR could cache definitions at discovery and verify at call time.
- What XR better: signed allowlist, tool-description poisoning scan, provenance, quarantine.

---

## 7. LangGraph Relevant Patterns

- StateGraph: TypedDict shared state, nodes edges conditional cycles — durable execution.
- Checkpointer: after every node, MemorySaver dev, SqliteSaver PostgresSaver prod; Store cross-thread; middleware trim.
- Durable execution survives restart; human-in-the-loop interrupt/resume; Studio visual.
- What relevant for XR: checkpoint after every tool (XR already does: ExecutionEnvelope evidence + sessionStore + audit), retention cron, Store cross-thread, lease prevents duplicate execution, startupRecovery.
- Borrow: state snapshot versioning (XR has envelope), typed state (XR has EnvelopeIntent/Plan/Policy...), human-in-the-loop interrupt/resume (XR has approval queue).

---

## 8. What XR Already Does Better (Evidence-Based)

- **Single canonical tool registry with namespaced identity and fail-closed collision arbitration:** Prevents privilege confusion via bare name shadowing (I3). Verified by semantics-contract tests.
- **Retired stub refusal:** No-Op success guard assertNoNoOpSuccess + REMOVED_STUB_TOOLS set.
- **Execution envelope:** One entry point AgentService.execute(), eight phases, no bypass (no-bypass.test), collision transparency audited.
- **Provenance graph:** Tamper-evident nodes/edges/events, whatWasUsed query, outcome stats, bounded, batched indexing (fixed Windows write amplification).
- **Supply-chain:** cosign SLSA provenance, npm OIDC, SHA256SUMS HTTPS-only, hashEntrypoint/treeHash, allowlist signed ed25519, manifest policy checks (cmd injection, url scheme, containment).
- **Security plane:** Tool-output framing <<<XR_TOOL_DATA>>> + scanUntrusted, egress proxy centralized DNS/private-range/metadata blocking, guard canonical path + normalized host, trust handoff block list, content-hash exec gate (application-level), MCP description poisoning scan.
- **Memory Phase6:** progressive lifecycle hybrid retrieval, integrity gate, conflict resolution, undo, measured recall, local-only one-store guards.
- **Performance budgets:** constitutional ceilings, host baseline cache ratchet-down, GATE_VERSION marker.
- **Non-regressive skills:** verifiability gate, frozen baseline, regression suite auto-rollback.

---

## 9. What XR Is Missing (Gaps for Phase 08)

1. **Unified permission model:** duplicate enums, no single Permission type, no single evaluation point. Tool requiresApproval boolean disconnected from Capability AuthorityVector.
2. **Unified trust model:** ToolRegistry no trust, Capability trust not consulted at execution, MCP allowlist separate from capability trust.
3. **Unified lifecycle:** ToolRegistry shadowed only, not enabled/disabled/quarantined. Lifecycle enforced in managers, not in registry. Discovery doesn't filter by trust/lifecycle/scope/mode in one place.
4. **CapabilityRequest abstraction:** no typed request object {capabilityId, requestedBy, runId, sessionId, scope, arguments, reason} going through Policy → Trust → Permission → Approval → Budget → Security → Execution → Audit. Instead scattered checks.
5. **Discovery and execution policy divergence:** discovery mode filter only, execution resolve checks offered set but not re-evaluates policy. Quarantined/disabled prevented via manager not loaded, but not via registry lifecycle map.
6. **Computer control nested authority:** inner actions bypass tool registry, use separate permission file.
7. **Web capabilities:** egress allowlist from config, not from capability permission; no scope.
8. **Model self-grant prevention tests:** not explicit adversarial tests proving model cannot grant.
9. **No bypass test proving core→policy, skill→policy, plugin→policy, mcp→policy, computer→policy, web→policy.**
10. **Capability inventory deterministic:** existing capability inventory? No inventory.json.
11. **Scope enforcement:** workspace/session/agent/shared not explicitly modeled in registry.

---

## 10. What Should NOT Be Copied (Anti-patterns)

- **Copying proprietary implementation of Claude/Goose:** Borrow principles, not code.
- **Collapsing runtime semantics:** Skill prompt-pack must never be invokable (Art XIV/XV, Global Rule 6). Keep distinct kind collections.
- **Prompt-based trust:** XR uses kernel-enforced boundaries, not prompt instructions.
- **Popularity-based ranking:** XR deliberate no download-count boost, evidence only.
- **Auto-trust on install:** XR default-deny, quarantine on security gate, explicit force.
- **Tool description as authority:** Authority lives in checkAction, McpAllowlist, capability system, never in description string.
- **Creating duplicate registries:** Do not create CapabilityRegistry independent of ToolRegistryService controlling execution.

---

## 11. Recommended Architecture (Target)

```
┌─────────────────────────────────────────────────────────────┐
│ Capability Model (unified types)                            │
│  id, name, version, description, provider, source,          │
│  permissions (declared, effective, denied), trust, scope,   │
│  lifecycle, provenance, execution binding, placement, etc.  │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
      Core           Skill          Plugin
        │              │              │
        └──────────────┼──────────────┘
                       │
                      MCP
                       │
              Computer Control
                       │
                    Web (fetch, search)
                       │
                       ▼
            ┌──────────────────────┐
            │ ToolRegistryService  │  ← Canonical capability discovery + binding
            │ + Lifecycle map      │  (preserved, enhanced)
            │ + Trust map          │
            │ + Permission map     │
            │ + Scope map          │
            └──────────┬───────────┘
                       │
                       ▼
               Capability Request
              {capabilityId, requestedBy, runId, sessionId, scope, args, reason}
                       │
                       ▼
                Policy Boundary (single choke point)
                       │
            ┌──────────┼──────────┐
            │          │          │
          Trust    Permission  Scope
            │          │          │
            └──────────┼──────────┘
                       │
                  Approval if required
                       │
                      Budget
                       │
                     Security/Shield
                       │
                       ▼
                    Execute
                       │
                       ▼
                     Audit + Provenance
```

**Key decisions:**

- **Preserve ToolRegistryService as canonical execution boundary.** Enhance it with lifecycle, trust, scope, permission metadata. Do NOT create separate CapabilityRegistry that independently controls execution.
- **Introduce unified capability types** in `src/capabilities/types.ts` reusing platform/capabilities types where possible, but slim for runtime (avoid heavy descriptor construction per tool call).
- **CapabilityProvider:** `core`, `skill:<id>`, `plugin:<id>`, `mcp:<server-id>`, `computer:<backend>`, `web:<provider>` — unforgeable, derived from kind.
- **Permission:** single enum-like string set `filesystem.read, filesystem.write, filesystem.delete, runtime.shell, network.fetch, browser.control, computer.input, mcp.execute, control.desktop...` with mapping from existing enums preserved via compatibility layer.
- **Trust:** reuse existing trust levels `official, verified, community, unknown, quarantined` + evidenceScore, publisher verified, signedPackage, signatureStatus.
- **Scope:** `workspace, session, agent, shared` — workspace enforced via safePath, session via runId, agent via tool context.
- **Lifecycle:** `discovered, verified, enabled, disabled, quarantined, revoked, rolled_back` — valid transitions defined, only control-plane can mutate, every transition audited via hash-chained audit + provenance.
- **Provenance:** WHAT, WHO, WHEN, FROM WHERE, WHICH version, hash/signature, trust decision, policy decision, scope, runId/sessionId — via existing provenance store.
- **Execution binding:** tool.run() per kind's host, preserved.
- **Discovery:** safe discovery pipeline: registered → trust filter → lifecycle filter → scope filter → permission filter → mode filter → policy filter → model-visible capabilities.
- **Execution authorization repeats:** discovery hiding ≠ security; execution repeats authorization.
- **Collision/namespacing:** deterministic, no silent replacement, no privilege escalation, provenance preserved, disabled cannot shadow enabled, higher trust must not auto-override policy. Use existing NAMESPACE + bareNames map + shadowed reason.

---

## 12. Compatibility Risks

- **Tool names:** Changing exposedName would break existing scripts, model prompts, TUI, CLI. Must preserve aliases: bare name stays when unshadowed, qualified id when shadowed. If unified capability id scheme changes (e.g., core:filesystem.read vs read_file), need compatibility aliases via exposedName.
- **Skill IDs, plugin IDs, MCP IDs:** Must remain stable; capabilityId `type:nativeId` already stable.
- **Capability APIs:** list, health, inspect, permissions, certify, enable, disable, quarantine, rollback must remain compatible; response shape additive only.
- **Dashboard/TUI/CLI:** They consume tool list via registry.discover; changing shape breaks UI. Keep Tool[] shape, add optional capability metadata via separate field.
- **Audit chain:** Must remain hash-chained valid; new capability events must use existing audit method `store.audit(event, detail, sessionId)` and provenance recordEvent.

---

## 13. Security Risks

- **Model self-grant:** If capability mutation APIs (enable/disable) were exposed as tools, model could grant itself. Must ensure they remain control-plane only (daemon routes require bearer token, not tool-callable). Add test.
- **Trust escalation via name collision:** Higher trust must not auto-override policy. Existing fail-closed collision prevents. Need to ensure disabled provider cannot shadow enabled provider — current demote logic does: if holder exists and new entry tries to claim bare name, winner logic checks core reservation and ambiguity, but does not check lifecycle. Disabled provider currently not loaded, so cannot shadow. But if we add lifecycle map, need rule: disabled cannot shadow enabled bare name.
- **Quarantine/disable bypass:** Ensure resolve() checks lifecycle and refuses if not enabled. Currently relies on manager not loading. After unified lifecycle map, resolve must check map.
- **Egress bypass:** Web tools must still go through guardedFetch + allowlist; plugin tools must not bypass via direct fetch. Plugin sandbox should enforce net permission via allowlist.
- **Computer control bypass:** Inner actions must still check hasPermission and approval racing. Keep.

---

## 14. Migration Strategy

1. **Phase A — Research & Audit (this doc):** Done.
2. **Phase B — Architecture doc:** Create docs/architecture/PHASE_08_UNIFIED_CAPABILITY_SYSTEM.md with current/target, migration steps, compatibility, security, failure modes, rollback.
3. **Phase C — Types:** Create src/capabilities/ directory with unified types (Capability, Provider, Permission, Trust, Scope, Lifecycle, Provenance, Request, Decision) reusing platform/capabilities types.
4. **Phase D — Enhance ToolRegistryService:** Add lifecycle/trust/scope/permission maps, setLifecycle, getLifecycle, setTrust, etc., and make discover() apply trust+lifecycle+scope+permission+mode+policy filters; make resolve() enforcement check.
5. **Phase E — Unified Capability Service wrapper:** Create UnifiedCapabilityService that owns ToolRegistryService + CapabilityMetadataStore + Provenance + TrustScorer and exposes discovery + execution request path.
6. **Phase F — Policy boundary:** Introduce CapabilityRequest → policy evaluation (trust, permission, scope) → approval → budget → security → execution → audit single function.
7. **Phase G — Integration:** Update registry-builder to populate capability metadata (provider, trust, lifecycle) from managers; update agent loop to use Policy boundary.
8. **Phase H — Discovery safety + collision + namespace design:** Update collision handling to respect lifecycle (disabled cannot shadow enabled).
9. **Phase I — Provenance/audit:** Ensure every lifecycle transition audited via hash-chain + provenance.
10. **Phase J — Self-grant + security tests:** Add adversarial tests, security matrix, no-bypass tests.
11. **Phase K — Inventory:** Generate capabilities/inventory.json deterministic.
12. **Phase L — Performance:** Measure before/after, no regression.
13. **Phase M — Docs:** security model, API docs.
14. **Phase N — Final verification & report.**

**Rollback:** Each phase commit. If any phase fails, revert to previous commit. Feature flag XR_UNIFIED_CAPABILITY=0 can disable new filters and fall back to old mode-filter-only discovery.

---

## Appendix: Source-code Evidence References

- ToolRegistryService invariants: src/tools/registry-service.ts:5-74
- Capability descriptors: src/platform/capabilities/types.ts, adapters.ts, service.ts
- Plugin manager lifecycle: src/plugins/manager.ts enable/disable/quarantine/rollback
- MCP allowlist: src/mcp/allowlist.ts isAllowed fail-closed
- Computer control permission: src/control/permissions.ts hasPermission cache
- Guard: src/security/guard.ts checkAction canonicalPath + normalizeHost + private IP blocking
- Egress proxy: src/security/egress-proxy.ts guardedFetch
- Agent loop: src/core/agent.ts resolveTool checks offered set
- Envelope: src/core/execution/envelope.ts + runner.ts sole entry
- Provenance: src/platform/capabilities/provenance.ts batched indexDescriptors

