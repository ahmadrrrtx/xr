# Local / Private Deployment Guide — XR 5.3

## Overview

XR 5.3 is local-first, self-hosted, BYOK, spend-capped, tamper-evident. Sensitive business/personal journeys operate locally/private where providers support it.

## Deployment Modes

- **Local:** `privacy.mode = local` — no cloud transfer, intelligence router local-only, context retrieval filtered local, no external integrations auto-triggered. Use ollama, local runtimes. Good for HR salary, meeting transcripts, credentials.
- **Private:** `privacy.mode = private` (default) — local + no external writes without elevated approval, restricted data never injected into cloud models, PII masked. Good for contacts, invoices, deals, calendar, meetings notes.
- **Hybrid:** `privacy.mode = hybrid` — allows cloud routing with policy/consent, sensitive fields still private. Good for research evidence report where web sources needed but salary still protected.

## Installation

```bash
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"; export PATH="$BUN_INSTALL/bin:$PATH"
git clone https://github.com/ahmadrrrtx/xr.git xr_repo
cd xr_repo
bun install
bun run typecheck
bun test
xr business init
xr business status --json
```

## Workspace Setup

Each workspace isolated SQLite file: `~/.xr/workspaces/<id>/xr.db` contains 42 tables (33 base + 9 operating layer) in same unified file.

Create organization/workspace:

- Via BusinessOS API: `orgs.create({ name, slug, ownerId })` creates org + default workspace
- Via CLI: `xr business init` ensures tables, `xr business status --workspace ws1` shows privacy mode

Set privacy mode:

```ts
biz.privacy.ensurePolicy(orgId, workspaceId, 'local'|'private'|'hybrid')
```

CLI: `xr business privacy --workspace ws1` shows policy.

## Provider Configuration

`~/.xr/config.json` or env:

```json
{
  "defaults": { "provider": "ollama", "model": "llama3" },
  "intelligencePlane": { "allowCloudFallback": false },
  "environment": { "enabled": true },
  "knowledge": { "enforceScope": true }
}
```

For local-only:

- Set `localModels.routing = local-only` or use `privacy.mode = local`
- Allowed providers: `['ollama','local']`
- Blocked: openai, anthropic, google etc.

Check:

```bash
xr providers route --task "research" --json
xr trust classify "shell ls"
```

## Sensitive Data Handling

- HR: `biz_employees` salary, time_off, members — marked restricted, policy deny external_write + isCloud
- Meetings: transcript confidential/restricted, context scope private, artifact sensitivity confidential, never injected into cloud unless approval
- Contacts: email/phone confidential, masked in audit metadata, requires approval for external_write cloud
- Invoices: confidential, requires approval for send (external_write)
- Credentials: `biz_credentials` restricted deny, CredentialVault encrypted, task_scoped refs only

## Execution Isolation

- Tier0 in_process fast path
- Tier1 restricted_process
- Tier2 namespace_sandbox (bubblewrap primary, fallback namespaces) or container, blocked if no backend — never silently downgraded
- TrustService classifies risk, policy selects placement, verification proves placement matches decision

## Backup / Restore

Backup: copy SQLite file `cp ~/.xr/workspaces/default/xr.db ~/backup/xr.db.$(date +%F)`

Restore: copy back + `xr business init` idempotent + `xr business audit verify --workspace ws1 --org org1` → auditValid true, mutationsValid true

## Rollback

- Checkout previous version `git checkout v5.2.0`
- Old code ignores new tables, audit chain still valid, worker enabled flag respected, no silent authority restoration
- Tests `bun test test/business/business.test.ts` still PASS with new tables present

## Daemon

```bash
xr serve --port 3141 # localhost-only, token auth
curl -H "Authorization: Bearer $TOKEN" http://localhost:3141/api/health
curl -H "Authorization: Bearer $TOKEN" http://localhost:3141/api/business/status?workspaceId=ws1
curl -H "Authorization: Bearer $TOKEN" http://localhost:3141/api/business/journeys
```

No Phase 11 cloud control plane, only local daemon.

## CLI Non-TTY / JSON

```bash
xr business status --json | jq
xr business journeys list --json
xr business outcomes list --workspace ws1 --json
xr business work-queue --json
xr business workers list --json
```

Machine readable, progressive disclosure, keyboard operation.

## Security Checklist for Local/Private Deployment

- [x] Workspace privacy mode set to local or private for sensitive workspaces
- [x] Provider routing local-only or local-first, allowCloudFallback false
- [x] Context enforcement before retrieval/injection (sensitivityMax)
- [x] Credential broker reference-only, no raw secrets in prompts, redaction
- [x] External writes require elevated approval + audit
- [x] Audit chain verification passes
- [x] Worker disabled cannot execute
- [x] Backup exists, restore tested

## Limitations

- No cloud backup sync (Phase 11+)
- No distributed multi-tenant (Phase 11+)
- Artifacts preview 1000 chars, large reports file path future
- No automated backup scheduling
- No visual workflow editor

## Release Validation

See RELEASE_VALIDATION.md for full procedure.

## Support

- `xr business help`
- `xr doctor --json`
- `xr trust` status
- Docs in docs/phase10/
