# 10 — Component Architecture

**Date:** 2026-08-13. Mission §6: reusable tokens/components, no one-off
styling per screen. Constraint: the dashboard is a **dependency-free,
no-build single-page app** (one HTML + one CSS + one JS served by the daemon)
— the component architecture must respect that (no React, no bundler). The
TUI has its own primitives (`src/ui/primitives.ts`). Both share tokens.

## 1. Layering

```
tokens.ts ──► cssVarsBlock() ──► dashboard styles.ts (:root + component classes)
   │                                 │
   ├─► theme.ts (ANSI) ──► TUI primitives
   └─► website (Tailwind var refs)
```

**Refactor target (F-2):** dashboard styles.ts consumes the same token
source; no hand-maintained divergent `:root`.

## 2. Web component inventory (dashboard) — grouped by slot

### Primitives (design-system level, reused everywhere)
`Button` (primary/secondary/ghost/danger, sizes, loading), `Chip`/`StatusChip`
(provider, audit, budget, locality), `Card`, `Panel`, `Input`, `Select`,
`Toggle`, `Tooltip` (`title` + custom), `Toast`, `Modal`, `Dialog`,
`ProgressBar`, `Spinner`, `EmptyState`, `Badge`, `AvatarChip` (logo or
avatar), `SectionHeader`, `StatRow`, `Kbd`.

### Shell
`Sidebar` (groups, disclosure, provider pill), `Topbar` (breadcrumb, chips,
palette trigger), `Inspector` (memory peek, approvals, runtime summary),
`CommandPalette` (combobox + results), `Breadcrumbs`.

### Chat (mission §8)
`MessageList` (streaming container, `aria-live`), `Message` (user/assistant/
system; flat full-width), `Composer` (multiline, autosize, attachments, mode
chip, locality badge, model chip, budget meter, context meter, voice button),
`ToolTimelineCard` (icon, verb, status, duration, expandable body),
`ApprovalCard` (WHAT/WHY/RISK + Allow/Deny), `ArtifactCard` (code/docs with
copy/export), `SuggestionChips` (empty state), `SessionList`/`SessionDetail`.

### Data panels (real API-backed)
`BentoHealthMatrix` (12 cells, textual summary for SR), `ProviderCard`,
`ModelCard` (locality, price, capability badges), `LocalModelCard`
(hardware summary, download size/progress), `MemoryList` (+ undo),
`ResearchReport`, `SkillCard`, `PluginCard`, `McpCard`, `CapabilityBadge`
(WORKS-NOW/SETUP-REQUIRED + why), `AuditTable`, `BudgetMeter`, `FileRow`,
`DownloadRow`, `ApprovalList`, `AutomationRow`, `WebhookRow`,
`NotificationList`, `SettingsGroup`.

### Voice (Phase E)
`VoiceOrb` (avatar + state ring), `VoiceStateLine`, `VoiceSettings`
(backends, wake word, offline note).

## 3. Rendering strategy (no-build constraint)

- Component = **pure function → HTML string**; idempotent re-render of its
  container; event delegation via `data-xr-action` (existing pattern in
  `client-script.ts`) — keep and formalize.
- `render()` per panel; `refreshAll()` already exists.
- New components live in the same single-file client OR a split module
  imported via `<script type="module">` only if it remains build-free
  (ESM relative imports — feasible with `type="module"`; decide in Phase A
  to keep CSP `script-src 'self'` intact — external assets already shipped
  for CSS/JS, so module scripts are CSP-safe).

## 4. TUI component parity

Same logical components in ANSI: status bar, palette, mode overlay, model
overlay, confirm, notifications, quick actions, tool cards in timeline.
Rule: a concept's visual vocabulary (icons → glyphs, chips → bracketed
labels, status dots → colored `●`) maps 1:1 so the identity reads the same.

## 5. Icon set (F-4 fix)

Centralize all icons as inline SVG in `src/ui/icons.ts` (web-ready strings)
+ a dashboard icon map. Replace emoji icons (🎤 🛡 ⌘ 🔬 etc.) with:
mic, shield, command, flask/search, plus the needed line icons (spark,
database, terminal, folder, key, wallet, sliders, bell, bolt, globe,
cpu, book, puzzle, plug, file, download, device, clock, webhook).

## 6. Naming & ownership

- Web components: `xr-` class prefix (already used), documented in this file.
- Each component lists: tokens used, data source (API path), states
  (loading/empty/success/error/offline — `11-ui-state-model.md`), a11y
  requirements, and its TUI equivalent.

## 7. Anti-patterns

- One-off CSS per screen (banned); component bloat (each component must
  justify reuse); inline event handlers instead of delegation; duplicated
  icon SVG strings; mixing token sources (F-2); building a second component
  system for the website that doesn't map to tokens.
