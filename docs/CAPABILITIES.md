# XR Capability Ecosystem (XR 5.2)

XR capabilities are inspectable units of functionality across plugins, skills, MCP servers, providers, tools, workflows, integrations, and artifact transforms.

## Quick commands

```bash
xr capabilities list
xr capabilities discover "summarize this repo" --max-risk tier1
xr capabilities inspect tool:read_file
xr capabilities permissions plugin:my-plugin
xr capabilities certify skill:research:deep
xr capabilities quarantine plugin:my-plugin --reason "bad signature"
xr capabilities rollback plugin:my-plugin --version 1.0.0
```

Every command supports `--json` where inspection output is intended for automation.

## Capability types

| Type | Meaning | Executes through |
|---|---|---|
| `plugin` | Code extension with `xr-plugin.json` | Plugin loader/host/worker and execution/trust wrappers |
| `skill` | Prompt/professional capability pack | Unified skill runtime and existing tool/workflow contracts |
| `mcp` | Model Context Protocol server | MCP manager/client and approval-gated wrappers |
| `provider` | Model/provider endpoint | Provider registry, budget, and credential gates |
| `tool` | Built-in XR tool | Execution Fabric and Trust service |
| `workflow` | Canonical workflow definition | Workflow engine/repository |
| `integration` | Optional connector metadata | Backing plugin/MCP/credential path |
| `artifact` | Artifact transformation metadata | Workflow/export artifact contracts |

## Declared vs effective authority

A manifest can request authority. It does not receive authority automatically.

Effective authority is the intersection of:

```text
declaration
∩ publisher/package policy
∩ workspace policy
∩ user grant
∩ agent/task grant
∩ trust/placement limits
− denied permissions
```

Denied permissions always win. If XR cannot determine effective authority, the capability must not run through that plane.

## Descriptor fields

A capability descriptor includes:

- publisher identity;
- source/provenance;
- package hash and signature status;
- dependencies;
- compatibility/runtime requirements;
- declared permissions;
- effective authority;
- data scopes;
- network/credential/provider requirements;
- placement/risk tier;
- interfaces;
- certification evidence;
- lifecycle history;
- quarantine/rollback/update state;
- support and cost hints;
- evidence-based trust signals.

## Certification statuses

| Status | Meaning |
|---|---|
| `unknown` | Not enough evidence yet |
| `self-tested` | Capability includes or passed self-declared tests |
| `xr-tested` | XR contract tests passed locally |
| `verified` | Publisher/trust evidence plus contract evidence supports verification |
| `quarantined` | Capability is blocked pending review/remediation |
| `legacy` | Older/adapter capability with limited evidence |

Certification is evidence-based, not popularity-based.

## Safe lifecycle behavior

- **Install** stages and verifies where the native plane supports packages.
- **Update** blocks newly requested permissions until reviewed.
- **Disable** unloads/turns off the native capability where supported.
- **Quarantine** disables and prevents enable/load.
- **Rollback** restores package files where supported but never restores authority silently; grants must be reviewed again.

## Configuration

XR 5.2 adds an additive config block:

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

Set `requireSignedPackages` to `true` to block unsigned remote/registry skill packages. Local packages remain inspectable but are clearly marked by signature status.

## Daemon API

All routes require the local daemon token except `/api/health`:

- `GET /api/capabilities`
- `GET /api/capabilities/health`
- `GET /api/capabilities/inspect?id=<capability-id>`
- `GET /api/capabilities/permissions?id=<capability-id>`
- `POST /api/capabilities/certify`
- `POST /api/capabilities/enable`
- `POST /api/capabilities/disable`
- `POST /api/capabilities/quarantine`
- `POST /api/capabilities/rollback`

## Developer guidance

- Use existing plugin, skill, MCP, provider, tool, or workflow APIs. Do not build a separate executor.
- Declare only the permissions actually needed.
- Include tests, examples, and compatibility metadata.
- Sign packages when publishing to a registry.
- Treat network domains and credential refs as user-reviewable requirements.
- Never assume manifest declarations are authority.

---

# Phase 7 — Capability Ecosystem Quality (descriptor + provenance + trust + updates)

## Provenance graph (what did the agent use?)

Every capability is a typed node in an append-only provenance graph
(`~/.xr/capabilities/provenance.json`): origin, versions, publisher,
permissions, dependencies, placement, data scopes, update history, and
**outcomes** per use. Distinct runtime semantics are preserved — a plugin
node is never confused with a skill or MCP node (Art. XIV.3).

```bash
xr capabilities provenance <type:id>      # full chain: node + edges + events + outcome summary
xr capabilities used                      # "what did the agent use?" (uses/outcomes per capability)
xr capabilities used --run <env_id>       # per-run filter
```

Recording is wired into the canonical execution envelope (every tool call
with its outcome) and into plugin/skill/MCP install/update/rollback/
quarantine/remove paths. Bounded (2k nodes / 8k events / 5k edges) and
best-effort: provenance recording can never break execution.

## TUF-style safe update/rollback

Capability updates are verified against signed, versioned update metadata
before anything is applied (`xr capabilities update <id> <source>
[--tuf-metadata <path>]`):

- **root** — trust anchor (key rotation requires the previous root's
  signatures ≥ threshold);
- **targets** — inventory of `capability@version` → sha256 + length;
- **snapshot** — pins every metadata file (mix-and-match protection);
- **timestamp** — freshness window (freeze protection);
- monotonic versions (rollback protection); size limits (endless-data).

Unsigned updates are refused by default; `--allow-unsigned` is an explicit
operator override. The authority diff is shown BEFORE the update applies,
and the plane's staged install + snapshot rollback makes it reversible and
workspace-safe. Local directory sources remain usable via the explicit
opt-in (installation is never trust — the operator overrides, the system
never self-approves).

## Evidence-based trust (why this ranks)

`xr capabilities rank [task] [--why]` ranks capabilities by evidence:

1. package signatures, 2. publisher verification, 3. provenance
completeness, 4. contract tests / certification (the independent
evaluator), 5. least-privilege permissions, 6. maintenance status,
7. measured outcomes.

**Popularity contributes at most 5% (log-scaled) and can never dominate** —
a high-download unsigned capability always ranks below a signed, tested one
(Art. XV.4). `xr capabilities trust <id>` explains every component.

## Manifest security (default-deny)

`xr capabilities security <type:id> [--strict]` reports the posture:
signed authorship (against the publisher key ring when configured),
publisher verification, SBOM reference, capability statement, dependency
locks, wildcard/auto-approve detection, and routing-safe descriptions.
Reject-level findings (invalid signature, wildcards, description-injection
markers, undetermined authority) block enable; `--force` after reading the
authority diff is the only override, and it is always an explicit operator
act. `xr capabilities diff <type:id>` renders the human-readable authority
diff (new/removed permissions, denied scopes, risk-tier and data-scope
changes) before enable/update (§10.2).

## Capability lifecycle + certification

One lifecycle: discover → inspect → verify → install → enable → use →
update (review on permission escalation) → rollback → quarantine →
uninstall, with every step recorded in the provenance graph. Contract
tests (`xr capabilities certify`) run the schema/authority/package/context/
durability/compatibility checks; failures quarantine. A crashing capability
is isolated (host survives — see test/capabilities/lifecycle.test.ts), and
CI runs `scripts/ci-capability-gate.ts` so no permissive or hijackable
bundled manifest lands on main.
