# XR 5.2 — Phase 9 Architecture: Capability Ecosystem

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


## Mission

XR 5.2 makes every extension plane inspectable through a common capability descriptor while preserving the execution semantics and security boundaries of each plane. It is a metadata, verification, discovery, and lifecycle layer — not a second plugin system, not a new workflow engine, not a business/control-plane module.

## Core design rule

A descriptor can describe authority, but it cannot grant authority.

Effective authority is computed as:

```text
capability declaration
∩ publisher/package policy
∩ workspace policy
∩ user grant
∩ agent/task authority
∩ trust/placement limits
− denied permissions
```

If the effective authority cannot be determined, the capability must not be enabled/loaded/executed through the affected plane.

## New modules

| Module | Responsibility |
|---|---|
| `src/capabilities/types.ts` | Descriptor schema and common vocabulary for type, publisher, provenance, integrity, permissions, data scopes, network/credential requirements, placement, certification, lifecycle, trust signals, support, and cost. |
| `src/capabilities/authority.ts` | Deterministic effective-authority resolver and risk-tier classification helper. |
| `src/capabilities/certification.ts` | Contract-test evidence framework for schema, permission honesty, package integrity, trust placement, context scope, durability, cleanup, and compatibility. |
| `src/capabilities/store.ts` | Additive metadata overlay for certification results, review-required state, quarantine status, vulnerability/maintenance status, and lifecycle events. |
| `src/capabilities/adapters.ts` | Translation from existing plugin/skill/MCP/provider/tool/workflow/integration/artifact data into common descriptors. |
| `src/capabilities/service.ts` | Cross-plane list/discover/inspect/permissions/certify/enable/disable/quarantine/rollback API. |

## Descriptor shape

Each capability exposes:

- `id`, `nativeId`, `type`, `name`, `version`, `description`;
- `publisher` identity and verification level;
- `provenance` source, registry/url/ref, installed/updated/built timestamps;
- `package` hash/signature status and verification timestamp;
- `compatibility` runtime/API/provider/model/mode requirements;
- `dependencies` with type/id/version/hash/status;
- `permissions.declared` and `permissions.effective` as distinct objects;
- `dataScopes`, `network`, `credentials`, and `providerRequirements`;
- `placement` risk tier and requested placement;
- typed `interfaces` (tool/command/prompt/MCP/workflow/provider/UI/artifact/integration);
- `certification` evidence and status;
- `lifecycle` state/history/update/rollback/quarantine metadata;
- `trust` signals based on evidence, not popularity;
- `support` and `cost` metadata.

## Adapter model

Adapters are read-only views over existing systems:

- Plugin adapter reads `PluginManifest` + installed registry entry.
- Skill adapter reads unified runtime records + installation metadata.
- MCP adapter reads `McpRegistryEntry` including granted permissions.
- Provider adapter reads built-in/custom provider presets.
- Tool adapter infers permission/risk facts from core tool definitions.
- Workflow adapter reads immutable workflow definitions.
- Integration adapter exposes connector catalog metadata only.
- Artifact adapter exposes built-in artifact transform metadata only.

No adapter runs extension code. `inspect` is non-executing.

## Lifecycle

Phase 9 defines the lifecycle vocabulary:

```text
discover → inspect → verify → install → approve → enable → load → execute
                                             ↘ disable → update → review
                                             ↘ quarantine → rollback → remove
```

Persistence is split intentionally:

- Native state remains in the native registry (`plugins`, `skills`, `mcp`, workflow repo, provider config).
- Common overlay state lives in `~/.xr/capabilities/metadata.json` and records certification/quarantine/review evidence.

This avoids a second registry and prevents metadata from becoming authority.

## Install/update/rollback safety

### Plugins

- Install still stages/copies/validates/hashes before registry upsert.
- Update compares next declarations against current declarations; newly requested permissions cause review-required state and block update.
- Replacement creates rollback snapshots.
- Rollback revalidates the snapshot, restores package files, disables the plugin, and clears grants. Authority must be reviewed again.
- Quarantine unloads/disables and blocks enable/load.

### Skills

- Local install and package import intersect grants with declared permissions.
- Package import stages extraction, rejects unsafe paths, verifies tree hash, re-reads manifest, then swaps transactionally.
- Update/import detects new permission scopes relative to existing grants and requires explicit `--grant` review.
- Rollback restores snapshot but disables and clears grants.
- Online registry install enforces hash and signature checks; `capabilities.requireSignedPackages` can require signatures.

### MCP

- Registry rows now distinguish `declaredPermissions` from `grantedPermissions`.
- Enable/load fail closed if declared permissions are not granted or are policy-denied.
- Quarantine disables, marks untrusted, and unloads.

## Discovery

`CapabilityService.discover()` supports task and constraints:

- task/outcome query;
- capability type;
- required interfaces/permissions/tags;
- excluded permissions;
- max risk tier;
- locality;
- publisher/trust/certification;
- installed/enabled filters.

Ranking is evidence-weighted and explicitly does **not** use popularity/download count as authority. Evidence includes verified publisher, valid package signature, recorded hashes, and certification status.

## Certification

Contract tests currently cover:

1. descriptor schema;
2. declared-vs-effective permission honesty;
3. package integrity/signature status;
4. trust placement/risk determinability;
5. execution interface presence;
6. context/data-scope alignment;
7. lifecycle durability evidence;
8. quarantine/rollback cleanup evidence;
9. runtime compatibility evidence.

Statuses are distinct:

- `unknown`;
- `self-tested`;
- `xr-tested`;
- `verified`;
- `quarantined`;
- `legacy`.

## CLI / daemon / dashboard

### CLI

`xr capabilities` and `xr capability` expose:

- `list`;
- `discover`;
- `inspect`;
- `permissions` / `authority`;
- `certify`;
- `enable` / `disable`;
- `quarantine`;
- `rollback`;
- `health`;
- `--json` output.

### Daemon

Added token-auth localhost routes:

- `GET /api/capabilities`;
- `GET /api/capabilities/health`;
- `GET /api/capabilities/inspect?id=...`;
- `GET /api/capabilities/permissions?id=...`;
- `POST /api/capabilities/certify`;
- `POST /api/capabilities/enable`;
- `POST /api/capabilities/disable`;
- `POST /api/capabilities/quarantine`;
- `POST /api/capabilities/rollback`.

### Dashboard

The dashboard adds a Capability Ecosystem panel with totals, enabled/certified/quarantined counts, task discovery, effective authority display, inspection, and quarantine controls.

## Config migration

Config v17 adds:

```json
{
  "capabilities": {
    "enabled": true,
    "requireSignedPackages": false,
    "updateRequiresReview": true,
    "quarantineOnVerificationFailure": true,
    "deniedPermissions": [],
    "evidenceWeightedDiscovery": true
  }
}
```

The migration is additive and respects an existing `capabilities` block.

## Security invariants

- Descriptors cannot grant authority.
- Denied permissions always win.
- New permissions on update require explicit review.
- Quarantined capabilities cannot be enabled/loaded.
- Rollback never restores authority silently.
- Package extraction is staged and path-contained.
- Unsigned packages are visible and policy-governed.
- Existing execution/trust/durable/context/workflow contracts remain the only execution path.

## Non-goals honored

XR 5.2 does not add business modules, enterprise governance/control planes, remote execution fleets, visual workflow editing, new environment features, model-routing redesign, memory/context redesign, workflow-engine replacement, arbitrary unsafe extension execution, or popularity-only marketplace trust.
