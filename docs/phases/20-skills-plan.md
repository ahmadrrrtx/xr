# Phase 20 — Skills Store · implementation plan

Branch: `phase/20-skills-store`. Integration against the existing engine —
`SkillService` + `handleSkillsApi` remain the only runtime. See
`20-skills-notes.md` for the study map.

## 1. Engine additions (`src/daemon/skills-api.ts` + tiny schema/store plumbing)

All handlers delegate to `SkillService` (extended narrowly). New/changed:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/skills?category=&q=&installed=` | richer `publicRecord` (quarantine, rating, downloads, runs, skillType, settings, activation, signed/signingKeyId, installedAt/updatedAt, grantedPermissions, featured, updateAvailable, kind) |
| `POST /api/skills/install` `{id, quarantine, grantPermissions?, registryId?, versionRange?, fromUrl?, localPath?}` | starts an install JOB → `{jobId}`. Steps: download → verify signature → install → validate → ready. **Enforced server-side:** unsigned/unknown publisher ⇒ `quarantine` forced true (400 on `quarantine:false`); dangerous scopes not in `grantPermissions` are never granted. |
| `GET /api/skills/install/:jobId/stream` | SSE replay + live progress events `step/status/pct/message/error` (jobs kept in memory, replay buffer so late subscribers see all events) |
| `POST /api/skills/install-from-url` `{url?, localPath?}` | PREVIEW only: fetch/validate (`validator` + `manifest` + package sha256 + signature state) → `{preview, forceQuarantine, warnings, errors}`; install then runs through `POST /install` |
| `POST /api/skills/:id/promote` | lift quarantine: set `installation.quarantine = null`, re-grant previously approved scopes; audit payload returned |
| `POST /api/skills/:id/permissions` `{grant?, revoke?}` | explicit grant/revoke (bundled auto-grant rule preserved); reports back `SkillPermissionReport` |
| `POST /api/skills/:id/settings` `{settings}` | validated against the manifest `settings[]` declarations (type/enum/required), persisted to `~/xr/skills/<dir>/settings.json` |
| `POST /api/skills/:id/uninstall` | POST alias of `DELETE /:id/remove` (brief parity) |

Schema: `InstallationSchema` gains optional `quarantine?: { until: number;
reason?: string }` (additive; stored via marketplace-store). `publicRecord`
exposes it. Quarantine survives restarts (engine-side truth); `promote` is the
only way out; `grantedPermissions` for quarantined installs are capped to safe
scopes until promotion (dangerous grants park in `quarantine.pendingGrants`).

MCP + plugins endpoints exist and are reused verbatim (`mcp.routes.ts`,
`plugin-api.ts`) — no rebuild.

## 2. Bundled / offline catalog
Repo-root `skills/` (65 bundled `@xr-official` skills) already flows through
`SkillService.listUnified()` as `source:"bundled"` — no fabricated rows. The UI
labels source honestly: `bundled` → "bundled with XR", registry rows → registry
id. When the online registry is unreachable the screen shows the offline
banner ("Offline — showing installed & bundled skills only") and marketplace
`stats.registries` errors surface as "cached catalog from {time}" warnings.

## 3. Desktop modules

```
desktop/src/skills/
  core.ts        PURE wire types + mappers (unit-testable, no React):
                 SkillRecord/SkillUpdate types, CATEGORY_DEFS (icon+label+
                 engine-category mapping), PERMISSION_CHIP map (scope →
                 label/icon/why/danger), BRANDS map (~16 known integrations →
                 brand color + monogram), trust labels, quarantine copy,
                 query matcher, type badges, formatting helpers
  api.ts         engine client: fetchSkills(), fetchMarketplace(), sync(),
                 inspect(), install()/installStream (SSE pump), installFromUrl(),
                 promote(), setEnabled(), uninstall(), grantPermissions(),
                 saveSettings(), updates(), + MCP calls (list/add/remove/
                 enable/disable/health/pins/pin/diff) + plugin calls
desktop/src/stores/skillsStore.ts   Zustand — state + actions below
desktop/src/screens/SkillsStore/
  SkillsStoreScreen.tsx    head (h1 + subtitle + Install-from-URL + Check for
                           updates + "Installed: N" chip), search bar, sidebar,
                           featured hero, grid, dialogs/slide-over orchestration,
                           keyboard layer (/ ⌘K Esc arrows Enter I)
  components/
    CategorySidebar.tsx    200px / 80px collapsible rail (persisted
                           `xr.skills.rail`), categories + counts, Custom MCP row
    FeaturedBanner.tsx     80px hero (featured flag → first official fallback)
    SkillCard.tsx          all 5 states + permission chips + danger strip +
                           stagger (40ms, max 30) + hover/focus lift
    SkillGrid.tsx          responsive 3/2/1 grid + skeletons + empty/no-results
    InstallModal.tsx       role=alertdialog, focus-trap: trust row, permissions
                           manifest (reason per scope, High-risk marks),
                           quarantine toggle (ON default; FORCED for unsigned),
                           dependencies, advanced (location/auto-update/pin),
                           progress steps (SSE), success + "Test it"
    SkillDetail.tsx        480px slide-over: overview (long markdown),
                           permissions w/ grant toggles (dangerous → Shield
                           approval), versions + changelog, configure form
                           (auto from manifest settings), footer actions
    PermissionsList.tsx    shared permission manifest rows (modal + detail)
    TrustBadge.tsx / QuarantineBadge.tsx / StateChip.tsx
    ProgressSteps.tsx      download→verify→install→validate→ready + retry
    InstallFromUrlDialog.tsx  URL / local path → preview → install modal
    AddMcpDialog.tsx       stdio|sse|http|streamable-http form → api.mcpAdd →
                           health check; MCP cards in Installed w/ Pin/Drift
    QuickInstall.tsx       ⌘K palette: search + install without leaving screen
desktop/src/styles/skills.css   card/chip/banner/steps styles on theme tokens;
                           glow only dark themes; quarantine pulse 2s;
                           prefers-reduced-motion overrides (no stagger/spring/
                           pulse; fade-only)
```

### skillsStore shape
```ts
{
  // listing
  records: SkillRecord[]; mcpServers: McpServer[]; plugins: PluginInfo[];
  loading: boolean; error: string | null; offline: boolean; catalogNote: string | null;
  query: string; category: CategoryId;          // featured|installed|updates|<engine cat>
  counts: Record<CategoryId, number>;
  // detail / dialogs
  selectedId: string | null;
  install: { open: boolean; id: string | null; mode: 'install'|'update'|'from-url';
             quarantineOn: boolean; advanced: boolean; forceQuarantine: boolean;
             step: Step; pct: number; error: string | null; done: boolean;
             preview: FromUrlPreview | null; jobAbort: (() => void) | null };
  addMcp: { open: boolean; …form };
  // actions
  load(), sync(), search(q), selectCategory(c), openInstall(id|'url'), closeInstall(),
  install(opts), update(id), uninstall(id), toggleEnabled(id), promote(id),
  grantPermissions(id, scopes, grants), saveSettings(id, settings),
  installFromUrl(url|path), addMcpServer(form), mcpHealth(), pinMcp(id), mcpDiff(id),
  openDetail(id), closeDetail()
}
```

## 4. Field → UI mapping (engine is truth)
- `verification.level` → TrustBadge: official/verified (cyan ✓), reviewed,
  community ("community" muted), unverified → **"Unsigned — use caution"** red.
- `permissions[]` → chips from `PERMISSION_CHIP` (scope → short label + icon);
  `dangerous` → red-tinted chip + ⚠ prefix + "Review permissions" strip with
  consequence copy ("Can run shell commands on your computer").
- `quarantine` → QUARANTINED red pulse chip + per-invocation approval + copy
  block (no FS outside ~/xr/scratch, no shell, logged-proxy egress, no
  credentials, approval every invocation).
- `skillType` → type badge (connector/executable/prompt-pack/…).
- `settings[]` → auto-form (string/number/boolean/enum/secret inputs).
- `activation.slashCommands/phrases` → "Get started" rows + Chat slash menu.
- `dependencies[]` → list w/ missing warnings (`dependencyReport`).
- `updateAvailable` / `updates[]` → UPDATE chip (yellow) + Updates category +
  changelog in the modal.
- icon: `manifest.icon` file if declared, else BRANDS monogram for known
  services, else category-colored square + Lucide icon.

## 5. Quarantine flow (Phase 7 approval seam)
- Install with quarantine → `installation.quarantine = { until: now+48h }`;
  Toast: "{name} is quarantined — you'll be asked before every action."
- Skill invocation while quarantined → `approvalStore` request (ApprovalModal):
  "Quarantined skill {name} is requesting {scope}… Allow once / Always allow
  this session / Promote out of quarantine / Deny." (wired via a
  `requestQuarantineApproval` helper; chat slash/menu activation goes through it).
- Skill detail: "Promote from quarantine" (confirm) → `POST /:id/promote` →
  Shield audit + toast. Manual trigger ships in P20; the 48h auto-prompt reads
  `quarantine.until` and offers promote/keep/uninstall from the detail view.

## 6. Cross-surface wiring
- **Shield** — `appendAudit` on install/uninstall/promote/grant/revoke
  (action names in AUDIT_VOCABULARY style: `skill.install`, `skill.promote`…);
  dangerous permission toggles open the approval gate first.
- **Budget** — skill installs/invocations already priced by the engine; no new
  spend paths introduced.
- **Brain** — invocations are engine runs already traced; Test-it creates a
  real chat turn (visible in Brain).
- **Agents** — AgentEditor gains a "Skill capabilities" multiselect (enabled
  skills → `skill:<id>` tool entries; engine schema accepts free-form tool
  strings; desktop validation accepts `skill:` names).
- **Chat** — `?prompt=` seed param (composer prefill) for Test-it CTAs;
  Composer `/` menu lists skill slash commands (activation).
- **Palette** — ⌘K quick-install dialog on /skills + "Skills" entries in the
  global palette (open store / install skill…).
- **HUD/Orb/Voice** — existing "Open Skills" nav paths resolve to /skills
  (route already registered); voice intent hand-off via `?via=voice` label.

## 7. Keyboard & a11y checklist
- `/` focus search · Esc closes modal/slide-over or clears search · ⌘K quick
  install · arrows move card focus · Enter opens detail · I opens install ·
  Tab order: search → categories → cards → card actions.
- Install modal `role="alertdialog"` + focus trap + Esc + Enter confirm;
  progress `aria-live="polite"` + `aria-valuenow/min/max`; quarantine badge
  `aria-label="Skill is quarantined, requires approval for each use"`;
  dangerous permissions carry icon + "High risk" text (never colour alone);
  permission toggles are labeled checkboxes; ≥32px hit targets; focus-visible
  rings ≥2px; SR announcements on install success/fail/promote.
- Reduced motion: fade-only cards, no spring/scale, static quarantine badge,
  progress jumps, static spinner circle.

## 8. Theme rules
Token-only styling (no hardcoded hex): cards `bg-bg-raised` + `border-subtle`
(12px radius), chips tint with `color-mix(in oklab, var(--danger) 15%,
transparent)` etc. Glow (`--accent-glow` shadows) only under dark themes
(`html[data-theme='xr-native'|'graphite'|'midnight']`); paper/arctic use
shadows only. Stars amber (`--warning`), verified check `--accent`, quarantine
`--danger` gentle 2s opacity pulse.

## 9. Tests / verification
- `test/skills-api.test.ts` — install job steps, forced quarantine for unsigned,
  permission grant default-deny, promote clears quarantine, settings validation.
- `test/desktop/skills-core.test.ts` — category mapping, permission chips,
  brand monogram determinism, query matcher, trust labels.
- Manual: `bun run engine` + `bun run dev` → /skills run-through per §21
  acceptance; screenshots to `previews/implementation/phase-20/`.
- `bun run typecheck` (root + desktop), `bun test`, desktop `eslint`.

## 10. Out of scope (per brief §22)
Payments, review submission, skill IDE, video, recommendations, shared configs,
version diff viewer, plugin code internals, per-skill analytics dashboards.
