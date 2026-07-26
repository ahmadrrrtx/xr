# XR 5.2.0 — Phase 9 Architecture Design

## Objective
Make providers, tools, MCP servers, plugins, skills, workflows, integrations, and artifacts into a trusted, discoverable, testable, composable XR capability ecosystem.

## Constraints (Non-Negotiable)
- Only Phase 9. No Phase 10 (Personal/Business Operating Layer).
- No new business modules, no enterprise governance control plane, no remote execution fleet, no visual workflow editor, no new environment capabilities, no model routing redesign, no memory/context redesign.
- Use existing plugin/skill/MCP/provider/workflow/execution/trust/durable/intelligence/context contracts. No second registry. No second permission engine.
- Effective authority = declared ∩ publisher/package policy ∩ workspace policy ∩ user grant ∩ agent/task authority ∩ trust/placement limits. Denied always wins.
- Updates requesting new permissions require explicit review/re-approval.
- Certification is evidence-based (tests, boundaries, cleanup, compatibility, execution contract, context scope, durable behavior, permission honesty) — not popularity-based.
- Capability metadata (descriptor) cannot grant authority. Authority is computed.

## Module Design

### Common Descriptor (`src/capability/types.ts`)
Shared schema covering identity, publisher, provenance, declared/effective authority, dependencies, compatibility, certification, lifecycle, interfaces, cost, support.

### Descriptor Parser/Builder (`descriptor.ts`)
Reads `xr-capability.json`, `.capability.json`, or derives from existing `xr-plugin.json` / `SKILL.md` / `xr-skill.json`. Size-limited (`MAX_DESCRIPTOR_BYTES` = 256KB). Schema validated with `zod`.

### Provenance (`provenance.ts`)
Publisher identity, package hash (`sha256`), manifest hash (`sha256`), build timestamp, source reference, verification timestamp. Uses existing `skills/signing.ts` for signatures. No new cryptography.

### Effective Authority (`effective.ts`)
`resolveEffectiveAuthority(declared, policyIntersection)` computes granted permissions as intersection of all policy layers, with denied always winning. `requiresReReview()` detects new permissions or revoked permissions.

### Dependencies (`dependencies.ts`)
`resolveDependencies()` resolves against available registry; distinguishes required/optional; flags version conflicts. `checkCompatibility()` verifies `xrVersionMin/Max`, runtime/platform/capability requirements, conflicts.

### Discovery (`discovery.ts`)
Evidence-based ranking: task keywords, permission constraints, certification status, trust signals, compatibility, maintenance, official status. No download count ranking.

### SDK Lifecycle (`sdk.ts`)
`runSDKLifecycle()` creates descriptor, computes provenance, resolves effective authority, solves dependencies, checks compatibility, produces diagnostics. `inspectDescriptorDescriptor()` produces safe public inspection view.

### Verification (`verify.ts`)
`verifyCapability()` uses existing signing infrastructure. Represents unsigned clearly (`warnings`, not errors). `verifyBeforeInstall()` enforces workspace policy (`requireSigned`, `allowUnsigned`). Block updates requesting new permissions until reviewed.

### Certification (`certification.ts`)
`buildCertification()`, `addContractTest()`, `evaluateCertificationEvidence()` compute evidence score (tests passed, boundary verified, permission verified, execution verified, context verified, durable behavior verified, cleanup verified, compatibility verified). Status: unknown, self_tested, xr_tested, verified, quarantined, legacy.

### Lifecycle (`lifecycle.ts`)
Durable transitions with audit events: discover → inspect → verify → install → approve → enable → load → execute → disable → update → quarantine → rollback → remove. Updates trigger `permissionReviewRequired`. Quarantine disables. Rollback restores previous descriptor (stored in `state.ts`).

### Interoperability (`interop.ts`)
Interface definitions for plugin, skill, MCP, provider, tool, workflow, integration, artifact — without collapsing execution semantics.

### Registry (`registry.ts`)
`CapabilityCatalog` supports lookup (`get`), list, search, enable/disable, quarantine, rollback, removal. Does not replace existing registries; integrates with them through descriptor extraction.

### CLI (`cli.ts`)
`cliInspect()` and `cliListStatus()` expose descriptor inspection, permissions, provenance, dependencies, certification, lifecycle, and state.

### State (`state.ts`)
Additive versioned storage (`CAPABILITY_STATE_SCHEMA_VERSION = 1`). Migration preserves descriptors, quarantined IDs, rollback versions, certification history. `saveDescriptorToState()` updates descriptor and manages quarantine state. `recordRollback()` preserves previous descriptor.

## Integration Points (Existing Contracts Preserved)
- Plugin: uses `plugin/manifest.ts`, `plugin/loader.ts`, `plugin/registry.ts`; descriptor derived without modifying manifest.
- Skill: uses `skills/manifest.ts`, `skills/schema.ts`, `skills/sdk.ts`, `skills/signing.ts`; descriptor derived from manifest.
- MCP: uses `mcp/types.ts`, `mcp/registry.ts`, `mcp/manager.ts`; descriptor interfaces reference MCP config.
- Provider: uses `providers/registry.ts`, `providers/presets.ts`, `providers/capabilities.ts`; descriptor interfaces reference preset/config.
- Tool: uses `core/types.ts`, `tools/registry.ts`; descriptor interfaces reference tool contracts.
- Workflow: uses `workflow/types.ts`, `workflow/engine.ts`, `workflow/inspection.ts`; descriptor interfaces reference workflow definition.
- Execution: uses `execution/types.ts`, `execution/service.ts`, `execution/repository.ts`, `execution/checkpoint.ts`, `execution/recovery.ts`, `execution/state-machine.ts`; descriptor interfaces reference execution contracts (`CapabilityIdentity`, `ActorIdentity`, `Placement`).
- Trust: uses `trust/types.ts`, `trust/authority.ts`, `trust/service.ts`, `trust/policy.ts`; descriptor `effectiveAuthority` uses same permission scopes and placement tiers.
- Context: uses `context/types.ts`; descriptor `dataScopes` and `resourceRequirements` reference context tiers.
- Security: `security/shield.ts` preserved; descriptor permissions validated against same scopes.

## Migration Strategy
- Existing plugin installations preserved: `descriptorFromPluginManifest()` derives descriptor from `xr-plugin.json` without changing file.
- Existing skill installations preserved: `descriptorFromSkillManifest()` derives descriptor from `xr-skill.json` / `SKILL.md` without changing file.
- Registry updates are separate (`globalCatalog`); existing `plugin/registry.json` and skill registry untouched.
- State storage (`state.ts`) is separate; no existing database schema changed.

## Security Enforcement Summary
All security requirements from the phase specification are implemented in code:
- Malicious manifest: descriptor schema validation (`types.ts`), size limits (`descriptor.ts`), path checks (`descriptor.ts` patterns from `manifest.ts`).
- Permission mismatch: `effectiveAuthority` computed from declared ∩ policies (`effective.ts`), deny override (`resolveEffectiveAuthority`).
- Dependency confusion: `dependencies.ts` resolves against registry; conflicts flagged.
- Package hash mutation: `provenance.ts` computes `sha256`; `verify.ts` compares.
- Invalid signature: `verify.ts` uses `skills/signing.ts`; `signatureStatus` clearly reported.
- Publisher key change: `provenance.ts` includes `publicKeyRef`.
- Update permission escalation: `lifecycle.ts` `permissionReviewRequired = true` on new permissions; `effective.ts` `requiresReReview()` detects changes.
- Path traversal / package extraction: descriptor parsing uses `safeResolve` patterns; no arbitrary extraction routines.
- Capability bypass: descriptor metadata (`types.ts`) does not grant authority; `effectiveAuthority` computed externally (`effective.ts`).
- Plugin/skill/MCP authority escalation: `effective.ts` intersection requires all policy layers to agree; denied always wins.
- Stale/quarantined execution: `registry.ts` `quarantine()` sets `enabled = false`; `listEnabled()` excludes quarantined; `cliListStatus()` shows quarantined state.
- Unsigned package policy: `verifyBeforeInstall()` enforces `requireSigned`/`allowUnsigned`; unsigned clearly marked (`verify.ts` warnings: `"unsigned does not mean malicious"`).
- Untrusted publisher: `publisher.kind` (`official`, `system`, `user`, `third_party`, `unknown`); `trustSignals.publisherVerified`.
- Rollback package tampering: `lifecycle.ts` rollback; `state.ts` rollback versions with timestamp and reason; rollback never restores authority silently (rollback triggers review if authority changed).
- Malicious context/memory writes: `DataScopeSchema` (`types.ts`) defines read/write/delete scopes; `effectiveAuthority` restricts scopes; execution contracts (`execution/types.ts`) enforce scope.
- Secret/network declaration mismatch: `DeclaredAuthoritySchema` (`types.ts`) includes `networkRequirements` and `credentialRequirements`; `effectiveAuthority` filters by policy; `security/shield.ts` preserved.

## Certification Evidence Model
Evidence score (`certification.ts`) computed from:
- Contract tests passed (`securityBoundaryVerified`, `permissionHonestyVerified`, `executionContractVerified`, `contextScopeVerified`, `durableBehaviorVerified`, `errorCleanupVerified`, `versionCompatibilityVerified`)
- Tests count / pass rate
- Boundary verified
- Cleanup verified
- Compatibility verified
- Certification status derived from evidence score: >= 0.8 = `verified`; >= 0.5 = `xr_tested`; >= 0.2 = `self_tested`; else = `unknown`.
- No popularity/download count used.

## Release Readiness
- All capability types have common descriptor (`plugin`, `skill`, `mcp`, `provider`, `tool`, `workflow`, `integration`, `artifact`).
- Effective authority distinct from declared authority (`declaredAuthority` vs `effectiveAuthority` in descriptor).
- Installation/update/rollback verified and auditable (`verifyBeforeInstall`, `lifecycle` audit events, `state` rollback records).
- New permissions require explicit review (`permissionReviewRequired`).
- Provenance/signature/dependency status visible (`descriptor.provenance`, `cliInspect`).
- Capabilities execute through existing contracts (`execution/types.ts`, `interop.ts` interfaces).
- Capability failures do not corrupt XR (lifecycle transitions fail safely; registry/quarantine preserves installations; rollback restores previous descriptor; errors collected, never crash).
- Discovery by task and trust constraints (`discovery` filters by keywords, permissions, certification, trust, compatibility; no download ranking).
- Certification evidence-based (`certification` uses tests and boundary checks, not downloads).
- Official/existing capabilities migrate safely (`descriptorFromPluginManifest`, `descriptorFromSkillManifest`, `buildDescriptor` safe defaults; existing installations preserved).
- Prior phases remain green (`execution`, `trust`, `durable`, `intelligence`, `context`, `workflow`, `environment` contracts not broken).
- Local-first operation complete (all new modules work locally; no remote control plane).
- No Phase 10+ capabilities introduced (no business modules, no governance control plane, no remote fleet, no visual editor, no new environment features, no routing redesign, no memory redesign).
