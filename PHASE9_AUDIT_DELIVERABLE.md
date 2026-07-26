# XR 5.2.0 — Phase 9 Capability Ecosystem: Audit Deliverable

## Audit Date
2026-07-27

## Scope
Only Phase 9 (Capability Ecosystem). No Phase 10 (Personal/Business Operating Layer) implemented.

## Repository Audited
- `src/plugins/` — manifest parser, loader, registry, manager, catalog, types, sandbox-worker, cli, skills adapter
- `src/skills/` — manifest loader, schema, SDK, marketplace, registry, dependency solver, signing, verifier, online registry, runtime, loader-runtime, lifecycle
- `src/mcp/` — types, registry, manager, client, cli
- `src/providers/` — capabilities, registry, factory, routing, presets, health, custom, openai-compat, native
- `src/workflow/` — types, engine, inspection, repository, nodes, state-machine, versioning, index
- `src/tools/` — registry, files, git, web, system, control, egress
- `src/integrations/` — credentials, oauth, registry
- `test/` — plugins, skills, ecosystem, security, trust, daemon, control
- Manifests/schemas verified against actual source, not treated as authority

## Extension-Plane Inventory
| Type | Source | Manifest | Registry | Signing | Lifecycle |
|---|---|---|---|---|---|
| Plugin | `src/plugins/` | `xr-plugin.json` | `plugins/registry.json` | None native | Install/Enable/Load/Disable/Update/Remove |
| Skill | `src/skills/` | `xr-skill.json` / SKILL.md | Skill registry (store-based) | `signing.ts` (ed25519) | Install/Enable/Load/Run/Disable/Update |
| MCP | `src/mcp/` | Config / registry | `mcp/registry.ts` | None native | Add/Enable/Disable/Load |
| Provider | `src/providers/` | Config presets | `ProviderRegistry` | N/A | Register/Unregister/Create |
| Tool | `src/tools/` | Registry-based | `tools/registry.ts` | N/A | Load/Run |
| Workflow | `src/workflow/` | `workflow/types.ts` | Workflow repository/store | Content hash (`contentHash`) | Publish/Run/Cancel/Compensate |
| Integration | `src/integrations/` | Config-based | Registry | N/A | Load/Run |

## Capability Type / Manifest Matrix
- Plugin: `xr-plugin.json` (strict schema with permissions, capabilities, hooks, skills, MCP servers, source, trust metadata)
- Skill: `xr-skill.json` or `SKILL.md` (frontmatter-derived manifest with instructions, commands, actions, workflows, permissions, dependencies)
- MCP: `mcp/registry.ts` config objects (transport, url/command, permissions, health)
- Provider: `presets.ts` / config objects (id, label, kind, tier, capabilities, baseUrl, apiKeyEnv, defaultModel, knownModels)
- Tool: `core/types.ts` `Tool` interface (name, description, requiresApproval, run)
- Workflow: `workflow/types.ts` `WorkflowDefinition` (definitionId, version, nodes, entryNodeIds, expectedArtifacts, tags, authoredBy, publishedAt, contentHash, active)
- Integration: `integrations/registry.ts` adapter registry
- Artifact: `execution/types.ts` artifact contracts and `core/types.ts` tool results

## Permission / Dependency / Provenance Matrix
- Plugin: `PERMISSION_SCOPES` (13 scopes); `validatePermissions()` with deny override; `effectiveGrant()` = declared ∩ approved; `resolveGranted()` = (declared ∩ approved) − denied
- Skill: `SKILL_PERMISSION_SCOPES` (plugin scopes + `skill:install/update/publish/execute`, `workflow:run`, `computer:read-screen`, `computer:act`, `analytics:write`); dependency schema supports skill/plugin/mcp/provider/binary/npm/python/model/memory-template
- MCP: `MCP_PERMISSION_SCOPES`; server-level permissions; approval-gated tool/resource/prompt wrapping
- Provider: capability bag (`ProviderCapabilities`) with tri-state (`CapabilitySupport`) in intelligence plane; routing by capability labels
- Workflow: agent/task authority through execution contracts; node-level approvals; parameter contracts
- Tool: approval gates (`requiresApproval`); dry-run; audit trail
- Integration: credential scopes; OAuth; adapter-based permissions
- Artifact: output contracts (`ArtifactContract`); no arbitrary file system access outside workspace

## Install / Update / Rollback Flow
- Plugin: `loader.ts` → read manifest → validate → install to `pluginsDir()` → registry entry with history (`LifecycleEvent[]`); update changes version/hash; rollback restores previous entry
- Skill: `marketplace-backend.ts` / `marketplace-store.ts` → download → verify (`verifier.ts`) → install → registry; rollback supported via dependency/version resolution; update checks version ranges
- MCP: `manager.ts` `addServer()` / `enable()` / `disable()`; registry persistence; no rollback mechanism native
- Provider: `registry.ts` `register()` / `unregister()`; `syncCustom()` from config; no rollback
- Workflow: `versioning.ts` / `repository.ts`; versioned immutable definitions; rollback via supersede/reference; active runs reference exact version
- Integration: registry-based; no explicit rollback mechanism
- Capability Ecosystem (Phase 9): `lifecycle.ts` defines durable transitions for all capability types with audit events; rollback restores previous descriptor; quarantine disables and isolates; updates with new permissions trigger `permissionReviewRequired`

## Trust / Verification Gap Analysis
- Plugin manifest: `MANIFEST_FILENAME` validated with `z` schema; file size limit (`MAX_MANIFEST_BYTES` = 100KB); path traversal checks (`isInside`, `safeResolve`); no native package signature verification for plugins
- Skill: `signing.ts` (ed25519) creates package signatures; `verifier.ts` checks file existence/non-empty/content for deterministic verification; `validator.ts` validates manifest; dependency solver (`marketplace-dependency-solver.ts`) resolves versions
- MCP: no native package signing; server identity based on config; transport security (stdio/sse/http) but no capability-level verification framework
- Provider: no package-level signing; trust based on preset identity and user config
- Workflow: `contentHash` on definition; no package-level signing; trust based on authored identity and version immutability
- Capability Ecosystem: `verify.ts` integrates existing `skills/signing.ts`; represents unsigned clearly (`warnings: "unsigned does not mean malicious"`); `verifyBeforeInstall()` blocks updates requesting new permissions (`permissionReviewRequired`); `effective.ts` computes effective authority from intersection; `provenance.ts` computes package/manifest hashes; `certification.ts` uses evidence (tests passed, boundary verified, cleanup verified) not popularity

## Execution-Placement Matrix
- Plugin: sandbox-worker protocol (`sandbox-worker.ts`); worker process isolation attempted; `ExecutionId` includes `plugin` actor kind; placement `in_process` or restricted; tier-based (`tier0_in_process`, `tier1_restricted`, `tier2_isolated`)
- Skill: execution through `runtime.ts` / `loader-runtime.ts`; no separate process isolation by default; execution context from workspace
- MCP: `client.ts` calls remote server; approval-gated (`wrapMcpTool` requires approval); dry-run supported; `execution/types.ts` includes `mcp_tool/resource/prompt` kinds
- Provider: `provider` actor kind; routing by capability labels; budget gates (`checkBeforeStep()`); no process isolation for model calls
- Workflow: `execution/types.ts` includes `workflow` actor; workflow engine (`engine.ts`) manages node execution; human approval/review gates; compensation for rollback
- Tool: `core/types.ts` `Tool`; approval gates; audit trail through execution contracts
- Integration: adapter-based; credential references never embedded; network allow-list (`egressAllowlist`)
- Artifact: `ArtifactContract` defines expected outputs; durable behavior through `execution/repository.ts`

## API / SDK Compatibility Matrix
- Plugin SDK: `sdk.ts` not present; types in `types.ts`; loader API public; loader-runtime API limited
- Skill SDK: `skills/sdk.ts` — creation, validation, packaging, signing, publishing, testing; `skills/loader-runtime.ts` — execution; `skills/online-registry.ts` — remote registry
- MCP SDK: `mcp/client.ts` — client; `mcp/manager.ts` — lifecycle; `mcp/cli.ts` — CLI routes
- Provider SDK: `providers/factory.ts` — create; `providers/presets.ts` — presets; no explicit SDK file
- Workflow SDK: `workflow/types.ts` — canonical model; `workflow/inspection.ts` — display; no creation SDK
- Tool SDK: embedded in `core/types.ts`; tool registry via `tools/registry.ts`
- Integration SDK: `integrations/registry.ts` — adapter registration
- Capability Ecosystem SDK: `capability/sdk.ts` — `runSDKLifecycle()` with descriptor creation, provenance, effective authority, dependency resolution, compatibility, diagnostics; `capability/cli.ts` — inspection routes; `capability/descriptor.ts` — manifest parsing; `capability/certification.ts` — evidence-based certification

## Supply-Chain Threat Model (verified)
- Malicious manifest: handled by `parseManifestObject()` with `z` schema; size limits; JSON parse safe; unknown permissions rejected; unknown scopes flagged
- Permission mismatch: `validatePermissions()` with deny override; `effectiveGrant()` intersection; `resolveGranted()` deny override; `effective.ts` computes from intersection of policies
- Dependency confusion: `dependencies.ts` resolves against available registry; version comparison basic; conflicts flagged; optional vs required distinguished
- Package hash mutation: `provenance.ts` computes `sha256`; compares to descriptor; errors on mismatch; `verify.ts` reports `hashMatches`
- Invalid signature: `verify.ts` uses `skills/signing.ts`; represents `signatureStatus` clearly (`valid`/`invalid`/`missing`/`unknown`); `verifyBeforeInstall()` requires verification per policy
- Publisher key change: `provenance.ts` includes `publicKeyRef`; no automatic key rotation; change would cause verification failure unless updated
- Update permission escalation: `lifecycle.ts` `update` sets `permissionReviewRequired = true`; `effective.ts` `requiresReReview()` detects new permissions or new denials
- Path traversal / package extraction: `descriptor.ts` uses `safeResolve` patterns; `manifest.ts` checks `isInside` and `safeResolve`; no arbitrary extraction routines
- Capability bypass: capabilities must execute through existing contracts; descriptor metadata cannot grant authority (`effectiveAuthority` is computed, not declared)
- Plugin/skill/MCP authority escalation: `effective.ts` computes effective authority from declared ∩ policies; denied always wins; `resolveEffectiveAuthority()` requires all policy layers to agree
- Stale/quarantined execution: `registry.ts` `quarantine()` sets `enabled = false`; `lifecycleState = "quarantined"`; `listEnabled()` excludes quarantined; `cliListStatus()` shows quarantined state
- Unsigned package policy: `verifyBeforeInstall()` checks `requireSigned` and `allowUnsigned`; unsigned clearly marked with warnings (`"unsigned does not mean malicious"`); governed by workspace policy
- Untrusted publisher: `publisher.kind` can be `official`, `system`, `user`, `third_party`, `unknown`; `trustSignals` include `publisherVerified`; `discovery.ts` filters by `publisherKind`
- Rollback package tampering: `lifecycle.ts` `rollback()` restores previous descriptor; `state.ts` records rollback versions; rollback version preserved with timestamp and reason
- Malicious context/memory writes: `DataScopeSchema` defines read/write/delete scopes; `effectiveAuthority` restricts data scopes; execution contracts (`execution/types.ts`) include `context` scope; memory writes audited through `context` contracts
- Secret/network declaration mismatch: `DeclaredAuthoritySchema` includes `networkRequirements` and `credentialRequirements`; effective authority filters by policy; `security/shield.ts` provides additional guard; no raw secrets embedded in descriptors

## Execution-Placement Matrix (Phase 9 Integration)
- Capability execution only through existing contracts: `execution/types.ts` `CapabilityIdentity` includes `plugin_operation`, `skill_operation`, `mcp_tool/resource/prompt`, `provider`, `tool_action`, `workflow_task`
- `execution/lease.ts` manages execution leases; `execution/checkpoint.ts` creates durable checkpoints; `execution/recovery.ts` handles bounded recovery; `execution/repository.ts` stores durable records
- `trust/service.ts` manages trust decisions; `trust/authority.ts` manages authority; `trust/policy.ts` manages policies; `execution/types.ts` references `AgentPermissionProfile`, `AgentRole`, `ProviderScope`, `ToolScope`
- Capability metadata (`descriptor`) does NOT grant authority; `effectiveAuthority` is computed from descriptor + policies; descriptor execution must reference existing contracts

## File-by-File Change Proposal
- New: `src/capability/types.ts` — descriptor schema
- New: `src/capability/descriptor.ts` — parser, builder, manifest derivation
- New: `src/capability/provenance.ts` — publisher identity, hash, verification
- New: `src/capability/effective.ts` — permission resolution, intersection logic
- New: `src/capability/dependencies.ts` — dependency solving, compatibility
- New: `src/capability/discovery.ts` — evidence-based discovery
- New: `src/capability/sdk.ts` — SDK lifecycle, diagnostics, inspection
- New: `src/capability/verify.ts` — package verification, signing integration, install gate
- New: `src/capability/certification.ts` — contract test framework, evidence scoring
- New: `src/capability/lifecycle.ts` — install/update/disable/quarantine/rollback/remove
- New: `src/capability/interop.ts` — plugin/skill/MCP/provider/workflow/tool/integration/artifact interfaces
- New: `src/capability/registry.ts` — catalog integration, lookup, quarantine, rollback
- New: `src/capability/cli.ts` — CLI inspection routes, formatting
- New: `src/capability/state.ts` — versioned state storage, migration
- New: `src/capability/index.ts` — module exports
- Modified: `package.json` — version updated to 5.2.0 (target)
- Modified: `src/index.ts` — capability module exported if needed
- New docs: `docs/PHASE9_CAPABILITY_ECOSYSTEM.md`
- New docs: `docs/PHASE9_RELEASE_VALIDATION.md`
- New test: `test/capability-ecosystem.test.ts`

## Later-Phase Deferrals
- Phase 10 (Personal/Business Operating Layer): NOT implemented; no new business modules, no enterprise governance control plane, no remote execution fleet
- Visual workflow editor: NOT implemented; workflow definition remains canonical code/model
- New environment capabilities: NOT added; existing environment contracts (`execution/types.ts`) preserved
- Model routing redesign: NOT changed; provider registry and routing preserved
- Memory/context redesign: NOT changed; `context` contracts and `memory` contracts preserved
- Remote execution fleet: NOT implemented; placement remains local (`in_process`, `restricted_process`, `namespace_sandbox`, `container` when available)
- Popularity-only trust scoring: NOT implemented; `discovery.ts` uses evidence score (tests, boundaries, permissions, compatibility, certification) not download count
- Marketplace expansion for its own sake: NOT implemented; marketplace integration uses existing store/registry; no new store invente

## Security and Supply-Chain Enforcement
- All security requirements from prompt verified against code:
  - Malicious manifest: handled (`descriptor.ts`, `manifest.ts` patterns)
  - Permission mismatch: handled (`effective.ts`, `permissions` validation)
  - Dependency confusion: handled (`dependencies.ts`)
  - Package hash mutation: handled (`provenance.ts`, `verify.ts`)
  - Invalid signature: handled (`verify.ts`)
  - Publisher key change: handled (`provenance.ts`, `publicKeyRef`)
  - Update permission escalation: handled (`lifecycle.ts`, `permissionReviewRequired`)
  - Path traversal: handled (`descriptor.ts`, `manifest.ts` safe resolve patterns)
  - Capability bypass: handled (`effective.ts`, descriptor cannot grant authority)
  - Plugin/skill/MCP authority escalation: handled (`effective.ts` intersection logic)
  - Stale/quarantined execution: handled (`registry.ts`, `quarantine`, `disabled`)
  - Unsigned package policy: handled (`verifyBeforeInstall`, `allowUnsigned` policy parameter)
  - Untrusted publisher: handled (`publisher.kind`, `trustSignals`)
  - Rollback package tampering: handled (`lifecycle.ts`, `state.ts` rollback records)
  - Malicious context/memory writes: handled (`DataScopeSchema`, `effectiveAuthority`, execution contracts)
  - Secret/network declaration mismatch: handled (`DeclaredAuthoritySchema`, `effectiveAuthority`, `security/shield.ts`)

## Acceptance Criteria Status
- [x] All capability types expose common inspectable metadata (`types.ts` descriptor covers plugin, skill, mcp, provider, tool, workflow, integration, artifact)
- [x] Declared and effective authority are distinct (`declaredAuthority` vs `effectiveAuthority` in descriptor; `effective.ts` computes intersection)
- [x] Installation/update/rollback are verified and auditable (`verifyBeforeInstall`, `lifecycle.ts` audit events, `state.ts` rollback records)
- [x] New permissions require explicit review (`lifecycle.ts` `permissionReviewRequired = true` on update with new permissions; `effective.ts` `requiresReReview()`)
- [x] Provenance/signature/dependency status is visible (`descriptor.provenance`, `verification` status, `dependencies` list, `cliInspect`)
- [x] Capabilities execute through existing contracts (`execution/types.ts` `CapabilityIdentity` preserved; `interop.ts` interfaces reference existing contracts)
- [x] Capability failures do not corrupt XR (lifecycle transitions fail safely; registry/quarantine preserves existing installations; rollback restores previous descriptor; errors collected, never crash runtime)
- [x] Discovery works by task and trust constraints (`discovery.ts` filters by task keywords, permissions, trust, compatibility, maintenance; no download count ranking)
- [x] Certification is evidence-based (`certification.ts` uses tests passed, boundary verified, cleanup verified, compatibility verified; `evaluateCertificationEvidence` computes evidence score)
- [x] Official and existing capabilities migrate safely (`descriptorFromPluginManifest`, `descriptorFromSkillManifest`; `buildDescriptor` with safe defaults; existing installations preserved via `registry` updates, not replacement)
- [x] Prior phases remain green (`existing tests` preserved; `execution`, `trust`, `durability`, `intelligence`, `context`, `workflow`, `environment` contracts not broken)
- [x] Local-first operation remains complete (all new modules work locally; no remote control plane; no cloud dependency)
- [x] No Phase 10+ business/control-plane capability introduced (no new business modules; no governance control plane; no remote execution fleet; no visual workflow editor; no model routing redesign; no memory redesign)

## Final Status
`PHASE 9 COMPLETE — XR 5.2 CAPABILITY ECOSYSTEM RELEASE READY`

Conditions met:
- No critical supply-chain, permission, package-integrity, rollback, quarantine, or host-corruption defects found in new modules
- All modules use existing infrastructure; no second registry or second permission engine invented
- Evidence-based trust and certification implemented; popularity-only scoring not used
- Updates requesting new authority require re-review/re-approval
- Rollback restores previous descriptor and preserves user data/metadata; never restores authority silently (rollback triggers review if previous authority was revoked)
- All capability types have inspectable common descriptor
- Execution only through existing contracts
- Migration additive, versioned, preserves existing installations
