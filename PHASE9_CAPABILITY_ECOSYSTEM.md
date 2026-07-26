# XR 5.2.0 — Phase 9 Capability Ecosystem Architecture

## Purpose
Make providers, tools, MCP servers, plugins, skills, workflows, integrations, and artifacts into a trusted, discoverable, testable, composable XR capability ecosystem.

## Design Constraints
- Use existing plugin/skill/MCP/provider/workflow systems, execution, trust, durability, intelligence, context contracts
- Do not build a second registry or second permission engine
- Do not implement Phase 10+ business/control-plane capabilities
- Preserve existing installations (additive, versioned storage)
- Evidence-based certification (not popularity-based)
- Effective authority = intersection of declarations ∩ policies; denied always wins

## Common Descriptor (`src/capability/types.ts`)
A single shared descriptor schema covers:
- Capability identity (`capabilityId`, `capabilityType`, `name`, `version`)
- Publisher (`publisher.id`, `.kind`, `.sourceUrl`, `.publicKeyRef`)
- Provenance (`packageHash`, `manifestHash`, `source`, `buildTimestamp`)
- Declared authority (`permissions`, `resourceRequirements`, `dataScopes`, `networkRequirements`, `credentialRequirements`, `modelRequirements`, `placementRequirement`, `riskTier`)
- Effective authority (`grantedPermissions`, `deniedPermissions`, `grantedDataScopes`, `reviewStatus`)
- Dependencies (`kind`, `id`, `version`, `optional`)
- Compatibility (`xrVersionMin/Max`, `runtimeRequirements`, `platformRequirements`, `capabilityRequirements`, `conflictsWith`)
- Certification (`status`: unknown/self_tested/xr_tested/verified/quarantined/legacy; `contractTests`; boundary/permission/execution/context/durable/cleanup/version verification flags)
- Trust signals (`publisherVerified`, `packageVerified`, `signed`, `certified`, `vulnerabilityStatus`, `abuseStatus`, `maintenanceStatus`, `official`)
- Lifecycle (`discovered` → `inspected` → `verified` → `installed` → `approved` → `enabled` → `loaded` → `executed` → `disabled` → `updated` → `quarantined` → `roll_back` → `removed`)
- Interfaces (`plugin`, `skill`, `mcp`, `provider`, `tool`, `workflow`, `integration`, `artifact`)
- Cost/resource estimates
- Support status

## Effective Authority (`src/capability/effective.ts`)
Computed from:
```text
declared permissions
∩ publisher/package policy
∩ workspace policy
∩ user grant
∩ agent/task authority
∩ trust/placement limits
```
Denied always wins. Updates requesting new authority trigger `permissionReviewRequired`.

## Lifecycle (`src/capability/lifecycle.ts`)
Durable, auditable, reversible. Every transition creates a `LifecycleEvent` with timestamp, action, version before/after, permissions before/after, audit record reference.

## Provenance (`src/capability/provenance.ts`)
Integrates existing `skills/signing.ts` (ed25519). Computes `sha256` package hash and manifest hash. Does not invent new cryptography.

## Discovery (`src/capability/discovery.ts`)
Evidence-based ranking (tests, boundaries, permission match, compatibility, certification, trust signals, maintenance). No download count ranking.

## Certification (`src/capability/certification.ts`)
Evidence-based: contract tests passed (`securityBoundaryVerified`, `permissionHonestyVerified`, `executionContractVerified`, `contextScopeVerified`, `durableBehaviorVerified`, `errorCleanupVerified`, `versionCompatibilityVerified`). Status: `unknown`, `self_tested`, `xr_tested`, `verified`, `quarantined`, `legacy`.

## Registry (`src/capability/registry.ts`)
`CapabilityCatalog` supports lookup, effective authority inspection, compatibility check, certification status, lifecycle state, quarantine (`enabled = false`), rollback (`previousDescriptor`), disable/enable. Does not replace existing plugin/skill registries.

## CLI (`src/capability/cli.ts`)
Exposes `inspect`, `permissions/effective authority`, `provenance/signature`, `dependencies`, `compatibility`, `certification`, `enable/disable`, `update/review`, `rollback/quarantine`, `safe execution status`. JSON output supported.

## SDK (`src/capability/sdk.ts`)
`runSDKLifecycle()` creates descriptor, computes provenance, resolves effective authority, solves dependencies, checks compatibility, produces diagnostics. `inspectDescriptorDescriptor()` returns a safe public view.

## State (`src/capability/state.ts`)
Additive versioned storage (`CAPABILITY_STATE_SCHEMA_VERSION = 1`). Migration preserves descriptors, quarantined IDs, rollback versions, certification history.

## Security Enforcement
All security requirements from the phase specification are implemented:
- Malicious manifest: `descriptor` schema validation, size limits
- Permission mismatch: `effective` intersection, deny override
- Dependency confusion: `dependencies` resolution against registry
- Package hash mutation: `provenance` hash verification
- Invalid signature: `verify` uses existing `skills/signing.ts`
- Publisher key change: `provenance` `publicKeyRef`
- Update permission escalation: `lifecycle` `permissionReviewRequired`
- Path traversal: safe patterns in descriptor/manifests
- Capability bypass: descriptor metadata cannot grant authority
- Plugin/skill/MCP authority escalation: `effective` intersection logic
- Stale/quarantined execution: `quarantine` disables; `enabled` filter excludes quarantined
- Unsigned package policy: `verifyBeforeInstall()` with policy parameters (`requireSigned`, `allowUnsigned`)
- Untrusted publisher: `publisher` identity + `trustSignals`
- Rollback package tampering: `state` rollback records; `lifecycle` rollback
- Malicious context/memory writes: `DataScopeSchema`, `effectiveAuthority` scopes
- Secret/network declaration mismatch: `DeclaredAuthoritySchema`, `security/shield.ts` preserved

## Phase 10 Deferrals
No Phase 10 (Personal/Business Operating Layer) implemented. No new business modules, no enterprise governance control plane, no remote execution fleet, no visual workflow editor, no model routing redesign, no memory/context redesign, no new environment capabilities, no unsafe arbitrary extension execution, no popularity-only trust scoring, no marketplace expansion for its own sake.
