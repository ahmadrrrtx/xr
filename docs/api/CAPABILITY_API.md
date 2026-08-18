# Capability API — Phase 08

**Date:** 2026-08-18
**Base:** `/api/capabilities` and `/api/v1/capabilities`

---

## Overview

Capability API exposes coherent capability metadata for all XR extensibility planes (core tools, skills, plugins, MCP, providers, workflows, integrations, artifact transforms) through one consistent interface, regardless of origin.

All execution passes through `ToolRegistryService` (canonical discovery + binding). This API is inspection/management plane — it aggregates descriptors for dashboard/API but delegates enable/disable/quarantine/rollback to underlying managers which then affect the execution registry.

**Auth:** Daemon routes require `Authorization: Bearer <token>` or session cookie `xr_session`. Health endpoint `/api/health` open.

**Content-Type:** `application/json`, `cache-control: no-store`, CSP strict.

---

## Endpoints

### List

```
GET /api/capabilities
GET /api/v1/capabilities
```

Query params (all optional, enum-sanitized):

- `task`: string, task text for relevance scoring
- `type`: `plugin|skill|mcp|provider|tool|workflow|integration|artifact`
- `requires`: comma-separated permissions required (e.g. `filesystem.read,network.fetch`)
- `exclude`: comma-separated permissions to exclude
- `maxRisk`: `tier0|tier1|tier2`
- `locality`: `local|private|internet|any`
- `certified`: `1|true` — only certified (verified, xr-tested, self-tested)
- `installed`: `1|true` — only installed
- `enabled`: `1|true` — only enabled
- `limit`: number

Response:

```json
{
  "capabilities": [
    {
      "schemaVersion": "xr-5.2.0/capability-v1",
      "id": "tool:read_file",
      "nativeId": "read_file",
      "type": "tool",
      "name": "read_file",
      "version": "core",
      "description": "Read a file inside the working tree.",
      "publisher": { "id": "xr-core", "name": "XR Core", "verified": true, "trustLevel": "official" },
      "provenance": { "source": "builtin", "observedAt": 1234567890 },
      "package": { "signatureStatus": "unknown" },
      "compatibility": { "xr": "1.0.0" },
      "dependencies": [],
      "permissions": {
        "declared": [{ "scope": "filesystem.read", "reason": "Inferred", "declaredBy": "adapter" }],
        "effective": { "declared": ["filesystem.read"], "effective": ["filesystem.read"], "denied": [], "undetermined": false }
      },
      "dataScopes": [{ "kind": "filesystem", "access": "read" }],
      "network": { "required": false, "domains": [], "locality": "local" },
      "credentials": { "required": false, "refs": [] },
      "providerRequirements": { "providerIds": [], "modelCapabilities": [] },
      "placement": { "requested": "in_process", "riskTier": "tier0", "requiresHostAuthority": false },
      "interfaces": [{ "kind": "tool", "name": "read_file" }],
      "certification": { "status": "verified", "tests": [] },
      "lifecycle": { "state": "enabled", "enabled": true, "installed": true, "rollbackAvailable": false, "history": [] },
      "trust": { "trustLevel": "official", "verifiedPublisher": true, "signedPackage": false, "evidenceScore": 10, "evidence": ["publisher verified"] },
      "support": { "maintenance": "active" },
      "cost": { "cpu": "unknown" },
      "tags": ["tool", "filesystem.read"],
      "keywords": ["read_file", "filesystem.read"]
    }
  ],
  "health": {
    "total": 74,
    "byType": { "tool": 15, "plugin": 5, "skill": 20, "mcp": 10, "provider": 20, "workflow": 2, "integration": 2 },
    "installed": 74,
    "enabled": 70,
    "quarantined": 0,
    "certified": 74
  }
}
```

Notes:

- `permissions.declared` is the raw manifest-declared permissions.
- `permissions.effective` is computed AuthorityVector: declared ∩ granted ∩ workspacePolicy minus denied, denied wins.
- `lifecycle.state`: discovered, verified, installed, enabled, disabled, quarantined, revoked, rolled_back, removed, error, unknown.
- `trust.trustLevel`: official, verified, community, unknown, quarantined.
- Does NOT expose secrets, credentials, signing material, apiKeyEnv values.

---

### Health

```
GET /api/capabilities/health
GET /api/v1/capabilities/health
```

Response:

```json
{
  "total": 74,
  "byType": { "tool": 15, "skill": 20, "plugin": 5, "mcp": 10, "provider": 20 },
  "installed": 74,
  "enabled": 70,
  "quarantined": 0,
  "certified": 74
}
```

---

### Inspect

```
GET /api/capabilities/inspect?id=<capabilityId>
GET /api/v1/capabilities/inspect?id=<capabilityId>
```

Query: `id` required, can be qualified (`tool:read_file`, `plugin:acme`, `mcp:github`) or bare nativeId if unambiguous (`read_file`).

Response: single CapabilityDescriptor or 404:

```json
{ "error": "capability not found or ambiguous" }
```

---

### Permissions

```
GET /api/capabilities/permissions?id=<capabilityId>
```

Response:

```json
{
  "id": "tool:shell",
  "type": "tool",
  "declared": [{ "scope": "runtime.shell", "reason": "...", "declaredBy": "adapter" }],
  "effective": { "declared": ["runtime.shell"], "effective": ["runtime.shell"], "denied": [], "undetermined": false },
  "riskTier": "tier2",
  "placement": { "requested": "restricted_process", "riskTier": "tier2" }
}
```

---

### Certify

```
POST /api/capabilities/certify
POST /api/v1/capabilities/certify

Body: { "id": "plugin:acme" }
```

Runs capability contract tests (manifest, permission, execution, trust, context, durability, cleanup, compatibility, security). Sets certification overlay.

Response:

```json
{
  "ok": true,
  "id": "plugin:acme",
  "state": "enabled",
  "descriptor": { ... },
  "reason": "verified"
}
```

- `ok: false` if quarantined, status 400.

---

### Enable

```
POST /api/capabilities/enable
Body: { "id": "plugin:acme" }
```

- Checks manifest-security gate: reject-level findings block enable unless force (see rollback notes).
- Delegates to PluginManager.enable / SkillMarketplace.enable / McpRegistry.setEnabled / metadataStore setState for tool/provider.
- Records provenance enable event + audit.

Response:

```json
{ "ok": true, "id": "plugin:acme", "state": "enabled" }
```

Errors:

- 400 if not found, quarantined, permission denied, new permissions require review, manifest security reject.

---

### Disable

```
POST /api/capabilities/disable
Body: { "id": "plugin:acme" }
```

Delegates to managers. Sets lifecycle disabled.

Response same shape.

---

### Quarantine

```
POST /api/capabilities/quarantine
Body: { "id": "plugin:acme", "reason": "manual quarantine" }
```

- Disables first, then sets quarantine overlay, health untrusted, trustLevel quarantined.
- PluginManager.quarantine unloads, McpRegistry patch health untrusted.
- Records provenance quarantine event.

Response:

```json
{ "ok": true, "id": "plugin:acme", "state": "quarantined", "reason": "manual quarantine" }
```

---

### Rollback

```
POST /api/capabilities/rollback
Body: { "id": "plugin:acme", "version": "1.0.0" } // version optional
```

- Plugin: rollback to snapshot dir, re-validate, disabled pending permission review, rollbackAvailable false until new snapshot.
- Skill: marketplace rollback.
- Tool/provider: not supported → 400.

Response:

```json
{ "ok": true, "id": "plugin:acme", "state": "rolled_back" }
```

---

## Unified Capability Fields (Phase 08 additions)

Every descriptor now includes coherent fields for unified model:

- `id`: qualified, globally unique
- `name`: bare name
- `version`
- `description`
- `provider`: via publisher + providerId
- `source`: builtin, bundled, local, git, url, registry, marketplace, plugin, mcp, config, manual, unknown
- `permissions`: declared + effective vector
- `trust`: trustLevel, verifiedPublisher, signedPackage, signatureStatus, evidenceScore, certificationStatus, vulnerabilityStatus, maintenanceStatus, evidence[]
- `scope`: workspace, session, agent, shared, host (via placement.requested mapping)
- `lifecycle`: state, enabled, installed, quarantineReason, rollbackAvailable, history[]
- `provenance`: source, sourceUrl, installedAt, updatedAt, observedAt + via provenance graph node/event
- `placement`: requested, riskTier, requiresHostAuthority
- `riskTier`: tier0, tier1, tier2, blocked, unknown
- `interfaces`: tool, command, prompt, mcp_tool, etc
- `tags`, `keywords`, `cost`, `support`, `security` (SBOM, dependencyLocks, capabilityStatement)

**Never exposed:** secrets, apiKeyEnv values, private keys, signing private material, credentials, token.

---

## Compatibility

- Existing tool names (`read_file`, `write_file`, `shell`, etc) remain stable via `exposedName`.
- Skill IDs, plugin IDs, MCP IDs stable via `capabilityId` `type:nativeId`.
- API response additive only: new fields added, old fields kept.
- Dashboard/TUI/CLI continue working: they consume `discover` returning Tool[] with same shape, capability metadata via separate API.
- No breaking change to `capabilities.list` shape: `{capabilities, health}`.

If aliases required, implemented via `exposedName` and compatibility layer `src/capabilities/compatibility.ts`.

---

## Security

- Auth: bearer token required for all except health? Actually all except `/api/health` open. Capabilities routes require auth.
- CSRF: cookie-authenticated mutating requests must carry Origin matching daemon origin, else 403.
- Rate limiting: 600/60s per IP+path → 429.
- Body cap: 2 MiB → 413.
- Contract validation: zod safeParse fail-closed 400.
- Manifest-security gate: reject-level findings block enable, require explicit force.
- Quarantine actually prevents execution: resolve returns undefined for quarantined, lifecycle filter excludes, allowlist gate blocks.
- Audit: every enable/disable/quarantine/rollback/certify recorded via `store.audit` hash-chain + provenance `recordEvent`.

---

## Examples

### List all enabled tools

```bash
curl -H "Authorization: Bearer $XR_TOKEN" http://127.0.0.1:3141/api/capabilities?enabled=1&type=tool
```

### Inspect specific capability

```bash
curl -H "Authorization: Bearer $XR_TOKEN" "http://127.0.0.1:3141/api/capabilities/inspect?id=tool:shell"
```

### Enable plugin

```bash
curl -X POST -H "Authorization: Bearer $XR_TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"plugin:acme"}' http://127.0.0.1:3141/api/capabilities/enable
```

### Quarantine MCP server

```bash
curl -X POST -H "Authorization: Bearer $XR_TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"mcp:github","reason":"suspicious description injection"}' \
  http://127.0.0.1:3141/api/capabilities/quarantine
```

### Rollback plugin

```bash
curl -X POST -H "Authorization: Bearer $XR_TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"plugin:acme","version":"1.0.0"}' \
  http://127.0.0.1:3141/api/capabilities/rollback
```

---

## Inventory Endpoint (Local)

File: `capabilities/inventory.json` (repo root) and `~/.xr/capabilities/inventory.json`

Generated via:

```ts
import { buildToolRegistry } from "./src/tools/registry-builder.ts";
import { writeInventoryFile } from "./src/capabilities/inventory.ts";
const { registry } = await buildToolRegistry({ store, task: "" });
writeInventoryFile(registry);
```

Content:

```json
{
  "generatedAt": "2026-08-18T...",
  "total": 74,
  "capabilities": [
    { "id": "core:read_file", "name": "read_file", "exposedName": "read_file", "kind": "core", "source": "core", "provider": "core", "version": "core", "lifecycle": "enabled", "trust": "official", "scope": "workspace", "permissions": ["filesystem.read"], "riskTier": "tier0", "shadowed": "none" }
  ]
}
```

Deterministic ordering by id.

---

## Troubleshooting

- **Capability not found or ambiguous:** id may be ambiguous bare name contested by multiple providers. Use qualified id (`plugin:acme:deploy` not `deploy`).
- **Enable blocked by manifest security gate:** Run `GET /api/capabilities/permissions?id=...` and `securityReport` to see rejects. Use force only after review.
- **Quarantined capability cannot enable:** Must clear quarantine first via disable? Actually quarantine → disabled via clearQuarantine, then enable after review.
- **MCP server not loading despite enabled:** Check allowlist: `xr mcp allow <id>` requires signing key. Check `McpAllowlist.verifyFile()` and `isAllowed`. Health untrusted means allowlist gate denied.
- **Plugin permission denied:** Check `requestedPermissions` vs `grantedPermissions` vs `deniedPermissions` from config. Grant via install with approved perms.

