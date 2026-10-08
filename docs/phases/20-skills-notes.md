# Phase 20 — Skills Store · study notes

> Build-agent study pass over the EXISTING engine before any UI code.
> Principle: this phase is INTEGRATION. `src/skills/` + `src/mcp/` + `src/plugins/`
> are the source of truth for listing, install, signatures, permissions and
> quarantine. The desktop renders what the engine says and never overrides trust.

## Engine map (as found on `main` @ e3e344e)

### `src/skills/` (~4060 lines)
- `schema.ts` (296L) — `SkillManifestSchema` (id/name/version/description/
  longDescription/publisher/license/homepage/repository/icon/categories/tags/
  keywords/compatibility/activation/content/contributions/tools/mcp/plugins/
  memoryTemplates/dependencies/permissions/settings/verification/sbom/skillType).
  - `SkillPermission { scope, reason, optional, dangerous, paths[], domains[] }`
  - `SKILL_TYPES` = executable | connector | prompt-pack | knowledge-pack | experimental
  - `SKILL_CATEGORIES` = developer business security research creative
    productivity data operations voice ui workflow memory mcp agent
  - `verification.level` = unverified | community | reviewed | verified | official
  - `SkillInstallation` has `grantedPermissions`, `pinned`, `favorite`, `rollback[]`
    — **no quarantine field** (added in this phase, engine-side).
  - `settings[]` declares typed config: string/number/boolean/enum/secret.
- `marketplace.ts` (526L) — `SkillCatalogEntry { manifest, dir, source:
  bundled|installed|local, installed, enabled, favorite, pinned, rating,
  downloads, runs }`. Installs into `~/xr/skills/`, package export/import
  (`.xrs`, tree sha256), `grantedFor()` — bundled skills auto-grant SAFE scopes
  only; third-party installs get an EMPTY grant unless `--grant` (default-deny).
- `marketplace-store.ts` (171L) — persisted installations + catalog extras.
- `marketplace-backend.ts` (192L) — online flow: resolve version → download
  (sha256 check) → **signature verify if present** (`verifySignatureIfPresent`:
  unsigned is a warning unless `requireSignedPackages` policy, signed-but-
  untrusted-key is an ERROR) → `importPackage` → record installed source.
  `checkUpdates()` compares semver vs registry; `updateOnline()`, `rollback()`.
- `marketplace-backend-types.ts` — `SkillRegistryEndpoint`, `SkillPublisherIdentity`
  (publicKeyPem/keyId/trustLevel), `OnlineSkillVersion` (signature/signingKeyId/
  packageSha256/changelog/yanked/downloads), `OnlineSkillRecord` (**featured?**,
  verified?), `OnlineSkillRegistryIndex`, `SkillUpdateCandidate`.
- `online-registry.ts` (145L) — fetch + zod-validate registry JSON, cache in
  `MarketplaceBackendStore`; `registryFileExists` for local mirrors.
- `download-engine.ts` (50L) — http(s) or file:// download → sha256; expected
  hash mismatch → error (never installs).
- `signing.ts` (50L) — Ed25519 keygen, `sha256File`, `signPackage`,
  `verifyPackageSignature(packagePath, publicKeyPem, envelope)`.
- `verifier.ts` (91L) — publisher-key verification helpers.
- `permissions.ts` (49L) — `SkillPermissionManager.report(manifest, installation)`
  → `{ safe[], dangerous[], missingApproval[] }` decisions with `needsApproval`.
- `runtime.ts` (93L) — `UnifiedSkillRuntime` — list/inspect/search/resolve/
  dependencyReport/permissionReport/executionContext/health.
- `registry.ts` + `search-index.ts` — local search index over unified records.
- `dependencies.ts` / `dependency-solver.ts` / `version-resolver.ts` /
  `semver.ts` / `compatibility.ts` — version + dep graph resolution.
- `validator.ts` (35L) — dir validation (manifest/docs/examples/tests present;
  dangerous-permission-without-reason warnings).
- `manifest.ts` (157L) — read/validate `xr-skill.json`, `hashSkillTree`,
  `safeResolve` (blocks `../` escape).
- `lifecycle.ts` / `loader*.ts` / `engine.ts` / `autolearn.ts` / `adapters.ts`
  / `counts.ts` / `tool-allowlist.ts` (`manifest.tools` ENFORCED, default-deny).

### Facade + HTTP
- `src/services/skill-service.ts` (83L) — ONE facade over marketplace + backend
  + SDK + runtime. Use this from routes; never instantiate modules ad hoc.
- `src/daemon/skills-api.ts` (156L) — `handleSkillsApi(req, url, path)` prefix
  adapter mounted by `extensions.routes.ts` on canonical `/api/skills`.
  Existing endpoints: `GET /api/skills(?q=)`, `GET|POST /api/skills/pins|pin`,
  `GET /api/skills/health`, `GET /api/skills/marketplace(?q=)` (merged local +
  online + updates + stats), `POST /api/skills/marketplace/sync`,
  `GET /api/skills/marketplace/updates`, `POST /api/skills/marketplace/install`,
  `GET /api/skills/:id/(inspect|permissions|dependencies)`,
  `POST /api/skills/:id/(enable|disable)`, `DELETE /api/skills/:id/remove`.
  **Missing (this phase):** install-with-quarantine + SSE progress, promote,
  permissions grant/revoke, settings save, install-from-url/preview, uninstall
  POST alias.
- `src/daemon/plugin-api.ts` (69L) — `GET /api/plugins`, `GET /api/plugins/catalog`,
  `/:id/(inspect|enable|disable|remove|permissions)` — complete enough.

### `src/mcp/` (~2542 lines)
- `manager.ts` — registry CRUD (`~/.xr/mcp/registry.json`), enable/disable,
  `healthCheck()`, `inspect()` → live tool defs.
- `types.ts` — `MCP_TRANSPORTS` = stdio | sse | http | streamable-http,
  `MCP_TRUST_LEVELS`, `MCP_HEALTH_STATES`, `McpServerConfigInput`.
- `pins.ts` — SEC-01 contract pinning: `pin/unpin/diff` → `PinDrift`
  `{ status: unpinned|match|drift, changed[], added[], removed[] }`.
- `src/daemon/routes/mcp.routes.ts` (206L) — GET /api/mcp, POST add|remove|
  enable|disable, GET health, GET pins, GET pins/diff/:id, POST pin|unpin.
  `buildInput` accepts dashboard form `{ id, name, transport, cmd|command,
  args[], url, enabled }` — id charset `[a-z0-9_-]`.

### `src/plugins/` (~3874 lines)
- `sandbox-worker.ts` (799L) — worker isolation; `manager.ts` enable/disable/
  remove + permission grants; `plugin-api.ts` exposes them. Plugin sandbox copy
  informs quarantine UX ("sandboxed" badge).

## Desktop map
- `desktop/src/engine/transport.ts` — `engineFetch/engineJson/enginePost` with
  sidecar-or-dev-proxy resolution (`/api/v1` base), `EngineDown`, `EngineHttpError`.
- `desktop/src/engine/sse.ts` — `readSse(res, onPayload, signal)`.
- `desktop/src/research/api.ts` — the pattern for a per-screen engine client.
- `desktop/src/router.tsx` — `/skills` ALREADY routes to
  `screens/SkillsStore` (currently `PlaceholderScreen`). Nav item `skills`
  ("Skills Store", `ShoppingBag`, phase 20) already in `lib/nav.ts`.
- `desktop/src/components/ui/` — shadcn set (alert-dialog dialog button badge
  checkbox switch select tabs tooltip skeleton slider input kbd popover…).
- Themes: `styles/themes.css` maps `html[data-theme]` tokens
  (`--bg-void/ink/raised`, `--accent`, `--accent-glow`, `--danger`,
  `--warning`, `--success`, `--text-primary/secondary/tertiary`, borders).
  Tailwind v4 `@theme inline` maps tokens to utilities (`bg-bg-ink`,
  `text-text-secondary`, `text-danger`…). 5 themes: xr-native, graphite,
  midnight, paper, arctic. Light themes must not glow.
- `shield/api.ts` — `appendAudit(input: AuditInput)` + `QuarantinedSkill`
  type already exists in `shield/types.ts` (Shield plane records quarantine).
  The Shield security policy already has `quarantineNewSkills: true` default.
- `stores/agentsStore.ts` — Zustand pattern (no local fallbacks; honest
  engine-down states). `stores/settingsStore.ts` persists UI prefs
  (`readSettingJSON/writeSettingJSON` keys like `xr.sidebar.collapsed`).
- Agents screen (Phase 19) — `xa-card` CSS classes in `styles/agents.css`,
  stagger via `--i` custom property. Skill cards will follow this vocabulary.
- Chat hand-off: `/chat?agent=` + `/chat?workspace=` intents consumed once.
  No composer prefill exists yet → add `?prompt=` seed (small diff).
- Command palette (`components/palette/`) has no skills entries yet.
- `ApprovalModal` (Phase 7, `components/approvals/`) + `approvalStore` —
  quarantine per-invocation approvals reuse this modal.

## Docs
- `docs/SCREEN-BRIEFS.md` §SCREEN 7 SKILLS STORE — layout/brief authority.
- `docs/IMPLEMENTATION-PLAN.md` §PHASE 20 — quarantine-first, deliverables.
- `docs/SKILLS-MARKETPLACE.md` — permissions are declarations, not authority;
  tool allow-lists enforced; auto-approve REMOVED; description-injection guard.
- `docs/DESIGN-SYSTEM.md` — radius-lg 12px cards, text-xs 11px meta,
  shadow-card, glow only on dark themes; "INSTALL is the brightest thing".
- `docs/THEME-SYSTEM.md` — 5 themes, token swap via data-theme.

## Live response shapes (from `skills-api.ts`)
- `GET /api/skills` → `{ health, skills: publicRecord[] }` where publicRecord =
  `{ id, name, version, description, categories, tags, publisher, verification,
  kind, source, enabled, installed, health, permissions, dependencies, commands,
  voiceIntents, workflows, errors, warnings }`.
- `GET /api/skills/marketplace` → `{ health, registries, updates, stats:
  { installed, verified, updates }, skills: [...] }`; online rows add
  `downloads`, `updatedAt`, `changelog`, `updateAvailable`.
- `GET /api/skills/:id/inspect` → `{ skill, permissions: SkillPermissionReport,
  dependencies: SkillDependencyReport }`.

## Bundled catalog (offline honesty)
Repo-root `skills/` holds **65 real bundled skills** (`@xr-official`
publishers, full manifests with permissions/activation/settings). They flow
through `marketplace.catalog()` as `source: "bundled"` — this IS the offline
catalog. No fabricated marketplace rows are needed; the UI must label bundled
vs registry rows honestly ("bundled with XR" vs registry id), and when the
online registry is unreachable show the offline banner per the brief.

## Security invariants (do not weaken)
1. Signature verification stays in `marketplace-backend.installVersion` — UI
   never installs around it. Mismatch → error surfaced verbatim.
2. Unsigned / unknown-publisher packages → quarantine FORCED ON server-side
   (install API rejects `quarantine:false`).
3. Dangerous permissions never auto-grant; grants are explicit lists.
4. Quarantine state lives on the engine's `SkillInstallation` (additive
   `quarantine` field) — client cannot clear it except via `POST /:id/promote`.
5. Path containment: `manifest.safeResolve` + install dir under `~/xr/skills/`.
6. Every install/uninstall/promote/grant emits a Shield audit entry (desktop
   seam) with publisher + hash + permissions.

## Gaps this phase fills (see 20-skills-plan.md)
- Engine: quarantine field + install jobs w/ SSE progress + promote +
  permissions grant/revoke + settings + install-from-url/preview + uninstall alias.
- Desktop: everything under `screens/SkillsStore/`, `skills/api.ts`,
  `skills/core.ts`, `stores/skillsStore.ts`, `styles/skills.css`; Chat
  `?prompt=` seed; Composer slash-command menu for skill commands; palette
  skills group; AgentEditor skill capability toggles; Shield audit writes.
