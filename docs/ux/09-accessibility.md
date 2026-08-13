# 09 — Accessibility Standard

**Date:** 2026-08-13. Target: **WCAG 2.2 AA** across dashboard, TUI, CLI and
website. Existing assets: `test/a11y/` (contrast, axe sweep, auth server,
static), keyboard nav in TUI, contrast-tuned tokens, a11y disclosure
toggles. This doc closes the remaining gaps (F-11) and sets the gate.

## 1. Principles

1. **Every feature is keyboard-usable.** No mouse-only path.
2. **Every state is perceivable beyond color** (icon + text + color).
3. **Every dynamic change is announced** (aria-live) — streaming, tool
   events, approvals, toasts.
4. **No traps, no mystery** — focus is visible and logical; errors explain
   what happened and what to do.
5. **Reduced motion & transparency honored** everywhere.

## 2. Contrast matrix (must pass; enforced by `test/a11y/contrast.test.ts`)

| Pair | Ratio (target) | Token |
|---|---|---|
| text on bg / surface | ≥ 4.5:1 | `#F9FAFB` on `#0A0A0F` ✅ |
| text-dim on bg | ≥ 4.5:1 | `#9CA3AF` on `#0A0A0F` ≈ 7:1 ✅ |
| muted on bg | ≥ 4.5:1 | `#7A8FB0` on `#0A0A0F` ✅ (already raised) |
| border of interactive controls vs surface | ≥ 3:1 (1.4.11) | `#5C7194` `--border-strong` ✅ |
| cyan on navy (links/active) | ≥ 4.5:1 | `#00D4FF` on `#0A0A0F` ≈ 8:1 ✅ |
| green/amber/red as text on bg | ≥ 4.5:1 (use dark text on light chip when needed) | verify per case |
| focus ring vs adjacent | ≥ 3:1 + 2px | `--xr-focus` |

## 3. Keyboard map (GUI)

| Keys | Action |
|---|---|
| `Tab` / `Shift+Tab` | move focus in document order; visible ring |
| `Enter` / `Space` | activate |
| `Ctrl+K` / `⌘K` | command palette |
| `?` | shortcut help (dashboard + TUI) |
| `Esc` | close overlay / stop streaming (TUI parity: abort) |
| `Ctrl+Shift+M` | toggle sidebar |
| Arrows | navigate lists (palette results, sessions, tool cards) |
| `1–9` | jump to top-level sections (optional) |

TUI map exists (`?` help overlay) — keep in sync with GUI names.

## 4. Roles & live regions

| Element | Requirement |
|---|---|
| Streaming assistant message | container `aria-live="polite"`; avoid announcing every token (throttle) |
| Tool timeline | `role="list"`, cards `role="listitem"`; status change announced politely once per tool |
| Approval card | `role="alertdialog"` when it needs an immediate decision; focus moves to it |
| Toast | `role="status"` (polite) or `role="alert"` (errors) |
| Command palette | `role="dialog" aria-modal` + `combobox` + `listbox` + `aria-activedescendant` (partially exists) + focus trap |
| Sidebar disclosure | `button aria-expanded` (exists) |
| Progress (model pull) | `role="progressbar" aria-valuenow` |
| Status chips | `aria-pressed`/`aria-current` as applicable + text label (never dot-only) |

## 5. Focus management

- Visible focus everywhere via `--xr-focus` token; never `outline:none`
  without replacement.
- Palette/modal: trap focus, restore to trigger on close.
- Panel navigation: panel container `tabindex="-1"` + focus on entry
  (exists in markup).
- Streaming does not steal focus; Stop button is reachable.

## 6. Screen-reader text & labels

- All icon buttons: `aria-label` (e.g., "Open command palette (Ctrl+K)" —
  already present in markup).
- Avatar/logo: `role="img"` + `aria-label`; decorative duplicates
  `aria-hidden`.
- Suggested prompt buttons: full sentence labels.
- Forms: visible labels (placeholder-only is banned per ui-ux-pro-max).

## 7. TUI/CLI accessibility

- `NO_COLOR` / `XR_COLOR=mono|16|256` supported (exists) — verify mono still
  communicates state via symbols (`✓ ! ⚠ ✕` glyphs + words).
- Keep `?` help, predictable focus pane cycling (sidebar/main/inspector/
  composer), and `Ctrl+C`/`Esc` abort semantics.
- Minimum contrast in 16-color mode verified against tokens.

## 8. Tests & gates (per phase)

1. `bun run typecheck` + existing `test/a11y/` (axe, contrast) green.
2. New: streaming `aria-live` test; palette focus-trap test; keyboard-only
   walkthrough script (dashboard + TUI) run per phase.
3. Manual keyboard pass: no mouse, complete onboarding → first task.
4. Website: same axe sweep (`test/a11y/browser-axe.test.ts` covers live
   browser — extend to all major panels).

## 9. Known honest gaps (documented, not faked)

- Live-region throttling for high-speed streaming needs tuning (announce per
  sentence, not per token).
- Full keyboard map for every inspector control — completed during Phase C.
- Screen-reader experience of the bento matrix: add a textual summary
  (visually hidden) so the grid isn't 24 unlabeled numbers.
