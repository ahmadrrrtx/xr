# XR — Design System ("XR Prism")

> New system; old dashboard styles are reference only. Direction: Premium · Minimal · Intelligent · Technical · Calm · Futuristic · Trustworthy · Developer-focused.
> Avoid: cyberpunk/gaming/crypto neon, excess gradients/glass, card-everything, dashboard clutter, decorative SVG noise.
> Brand source of truth: official logo (X+orb) and avatar renders (Asset Audit).

## 1. Brand mark system

- **Canonical mark:** vector X-blade + orbit ellipse + luminous orb, derived from `assets/logo.png` geometry; gradient `#00D4FF→#6048F8` at 45°; status dot `#00FF88` reserved for *alive/allowed* states. Replaces current divergent SVG geometry (BUG-002) while keeping its palette. [RECOMMENDED]
- **Lockups:** mark-only (tray/favicon/16-48px), horizontal (mark + "XR" wordmark, geometric sans, tight tracking), stacked (hero/onboarding w/ tagline "The AI Agent You Can Actually Trust").
- **Mono variants:** single-color ink/paper for CLI, tray template, print, disabled states.
- **Avatar usage:** presence only — voice orb, onboarding, empty states, approval requester. States via glow/eye treatment over official renders, never new characters.

## 2. Color

### Tokens (dark default; light parity required)
| Token | Dark | Light | Use |
|---|---|---|---|
| `--xr-bg` | #0A0A0F | #FAFAF7 | app ground |
| `--xr-surface-1/2/3` | #101018 / #14141D / #1A1A24 | #FFFFFF / #F4F4EF / #ECECE5 | elevation ladder |
| `--xr-border` / `-strong` | #23232E / #32323F | #E2E2DA / #CFCFC6 | hairlines |
| `--xr-text` / `-muted` / `-faint` | #ECECF1 / #9A9AA8 / #6C6C7A | #16161A / #55555E / #77777F | type ramp |
| `--xr-cyan` | #00D4FF | #0077A8 (AA) | XR presence, primary actions, links |
| `--xr-violet` | #6048F8 | #4A34D0 | intelligence/depth, secondary accent |
| `--xr-green` | #00FF88 | #007A4D | alive/allowed/success |
| `--xr-amber` | #FFB454 | #9A5B00 | caution/pending approval |
| `--xr-red` | #FF5470 | #B01030 | deny/error/risk-high |
| glow variants | 8-16% alpha of cyan/violet/green | none (shadows instead) | state aura only |

- Semantic mapping is law: cyan=presence, green=allowed/success, amber=waiting/caution, red=deny/risk, violet=agent-thinking/depth. No other hues. [RECOMMENDED]
- Contrast: all text ≥ WCAG AA; cyan on dark only for large/interactive; light mode swaps to deepened cyan/violet.

## 3. Typography

- **Sans:** Inter / system-ui stack (variable, tight optical sizes) — UI.
- **Mono:** JetBrains Mono / ui-monospace — code, terminal, IDs, hashes, costs.
- Ramp: 12/13/14/16/20/28/40; line-heights 1.2–1.5; letter-spacing -0.01em ≥20px.
- Mono for: run IDs, tool names, paths, tokens, budgets, audit hashes (trust legibility).

## 4. Space / grid / radius / elevation

- 4px base; spacing scale 4/8/12/16/24/32/48/64.
- Layout: 12-col fluid grid inside surfaces; panes snap to 8px.
- Radius: sm 6 (controls), md 10 (cards/sheets), lg 14 (panels), pill (chips); window 12.
- Elevation: dark = surface ladder + 1px border + inner top highlight (no blur); light = layered shadows. Glassmorphism banned except voice overlay scrim.

## 5. Motion

- Durations: 120ms micro, 200ms state, 320ms surface enter/exit; easing `cubic-bezier(.2,.8,.2,1)`.
- Presence motion: avatar glow breath 2.4s idle, 1.2s listening; orb pulse on working; single-shot ring on approval request.
- Respect `prefers-reduced-motion`: replace with opacity-only.
- No perpetual animation except presence states (calm rule).

## 6. Iconography

- New 24px grid, 1.5px stroke, rounded caps, 2px corner radii; optical alignment; mono ink by default, semantic color only for state.
- Sets required (~120): nav (home, work, workspace, agents, library, trust, runs, settings), actions (send, stop, approve, deny, retry, resume, duplicate, export), dev (file, folder, git-branch, terminal, diff, problem, preview), capability (skill, plug(mcp), puzzle(plugin), globe(integration)), presence (mic, mic-off, speaker, wave), risk (shield, shield-check, alert, lock, key), system (tray, bell, update, search).
- Favicon/tray: mono mark variants (dark/light/template).

## 7. Component inventory (spec highlights)

- **Composer:** auto-grow input, attach chips (file/folder/capability), mode pill (Careful/Balanced/Autonomous), model pill, budget meter inline, send/stop morph.
- **TaskCard / RunRow:** title, workspace chip, status dot (semantic), duration, cost (mono), approval badge; hover → quick actions (resume/open/duplicate).
- **ToolTimeline:** per-tool rows: icon, name (mono), target path (elided), duration, risk chip; expandable raw I/O (advanced).
- **ApprovalSheet:** what/why/changes(diff)/risk/agent/data-affected; actions Deny / Allow once / Always allow (scope shown); Details accordion (raw payload).
- **RunInspector drawer:** tabs Transcript/Plan/Files/Tools/Approvals/Cost/Artifacts.
- **AgentBoard:** role nodes w/ status ring, dependency edges, budget burn bar, failure halo; click → agent transcript.
- **CapabilityCard (skill/mcp/plugin):** icon, name, publisher trust chip, permission badges, health dot; detail sheet w/ examples + run.
- **Terminal pane:** xterm.js, theme-mapped tokens, bell→notification.
- **Editor:** CM6 theme on tokens; diff gutter semantic colors; AI gutter glyph (mark) for agent edits.
- **VoiceOverlay:** centered avatar orb + state label + waveform; interrupt hint; approval interrupts overlay (barge-in disabled).
- **ControlCockpit sheet:** app icon/name, current action verb, reason line, permission chips, STOP (red, always visible), screenshot thumb (redacted hints).
- **Toasts/notifications:** semantic left-border, mono ID, action button (Approve/Open run).
- **Empty states:** avatar line-art + one-sentence invitation + primary action (no clutter).
- **Loading:** skeleton rails + presence pulse; never spinners > 300ms without status text (honesty heritage).
- **Error states:** cause + retry path + audit link (trust heritage).

## 8. Accessibility & input

- WCAG 2.2 AA; full keyboard map (palette, g-jumps, ⌘. stop); focus rings cyan 2px; a11y CI (axe) extended to desktop; screen-reader labels for presence states.
- Density modes: comfortable/compact (dev users); type scale respects OS scaling.

## 9. Theming & platform

- Dark default; light parity; high-contrast variant; per-OS window chrome (macOS vibrancy off by default — calm).
- Token delivery: TS module + CSS vars generated from one JSON source; desktop + (future) web fallback share it.

## 10. Governance

- Visual regression snapshots per component; token change = PR w/ contrast report; icon additions via spec sheet; brand marks locked (Asset Audit rules).
