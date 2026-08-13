# 01 — XR Product UX Audit

**Date:** 2026-08-13 · **Build:** 7.1.0 "Truth" · **Method:** repository
inspection (src/, docs/), live asset pixel analysis, existing audit corpus
(`docs/audits/*`), and the supplied FIRST-TASK/SUS records. Every finding
below cites the file it was observed in.

## 1. What XR is today (verified)

A **local-first, provider-neutral AI agent runtime**: CLI commands, a
fullscreen TUI shell, a token-authed local web dashboard (`xr serve`), a
Telegram bot, and an onboarding wizard. All surfaces funnel through one
execution envelope → runner → agent loop with a real trust plane (policy gate,
approvals, budget governor, egress allow-list, secrets vault, hash-chained
audit). 26 provider presets (16 hosted BYOK + 10 local), 65 bundled skills,
plugins, MCP, memory, research, voice, computer control, multi-agent
workflows.

**Verified healthy:** 2,750+ tests green, tsc clean, tamper-evident audit
proven by red-team reproduction, first-task automated survey 20/20 (p50 385
ms), fail-closed approvals, secrets redaction, loopback-only daemon with token
auth, honest failure mapping.

## 2. The four surfaces and their current UX state

| Surface | Code | UX maturity | Notes |
|---|---|---|---|
| **CLI** (`xr …`) | `src/commands/*`, `src/cli/*` | High | Rich command surface, catalog, exit codes; `xr help`, `xr doctor`, `xr onboarding` |
| **TUI Shell** | `src/interfaces/shell/*` | High | Views, overlays, palette, modes (agent/plan/ask), mnemonics (`g d`…), status bar, ANSI brand |
| **Dashboard (Control Center)** | `src/daemon/dashboard/*` | Medium-high | 20+ real-data panels, chat workspace, command palette, bento health matrix, approvals, tool timeline |
| **Onboarding** | `src/interfaces/onboard.ts` | Medium | Terminal wizard; **no GUI onboarding exists** |
| **Voice** | `src/voice/*` | Medium | Real pipeline (VAD/wake/STT/TTS) via CLI; **dashboard voice panel has fake buttons** (below) |
| **Website (marketing)** | `website/` | — | Next.js 16 + React 19 + framer-motion + lucide; claim-lint scanned |

## 3. What is already excellent (protect, do not rewrite)

1. **One-runtime honesty.** Every surface hits `AgentService.execute`; UI
   cannot bypass policy/budget/audit. Keep.
2. **Real data in the dashboard.** Panels read live API routes
   (`/api/health`, `/api/agents`, `/api/budget`, `/api/memory`, pending
   approvals, capabilities store). This is the "no fake UI" foundation.
3. **Chat workspace capabilities**: streaming with stop, branching, pin,
   archive, export, attachments, draft autosave, tool timeline cards, inline
   Allow/Deny approvals, slash commands, mode cycling. Strong base.
4. **TUI parity**: palette with sections, mnemonic nav, overlays, honest
   `interrupted`/cancelled semantics, ANSI brand rasterization.
5. **Accessibility groundwork**: contrast tokens raised (muted `#7A8FB0`,
   `--border-strong`), axe sweep, keyboard-focused nav, disclosure toggles,
   memory undo.
6. **Design tokens exist** (`src/ui/tokens.ts`) with CSS var emission used by
   dashboard + website + TUI ANSI mapping — the right architecture.

## 4. Critical findings (must fix)

### F-1 — Fake voice controls in the dashboard (mission rule §31 violation)
`src/daemon/dashboard/markup.ts` (Voice panel, ~L644):
- "Enable Voice" → `data-xr-action="toast('Voice activated. Microphone on
  hold-to-talk mode.','ok')"` — **simulates activation**; nothing starts.
- "Test loop latency" → `toast('Running Voice Loop smoke test... output OK')`
  — **simulates a test result**.
- The real voice pipeline (`src/voice/*`, `xr voice start|speak|wake`,
  approvals still apply) exists and can be driven via daemon routes/CLI.
**Fix:** wire to the real pipeline or render honest states (unavailable,
requires CLI, disabled) — never simulate. See roadmap Phase A.

### F-2 — Two divergent token sources of truth
`src/daemon/dashboard/styles.ts` hardcodes its own `:root` palette
(`--bg #020817`, `--muted #7A8FB0`, violet `#A855F7`) that **differs** from
`src/ui/tokens.ts` (`bg #0A0A0F`, `muted #6B7280`). Both are served in the
same page. Any brand change drifts. **Fix:** dashboard CSS consumes the same
token source (import `cssVarsBlock()` or align values), one authority.

### F-3 — Brand secondary color drift (official asset vs code)
Official palette (`Colour palate of xr logo.png`): secondary = **indigo
`#6048F8`**. `tokens.ts`/`styles.ts` use **violet `#A855F7`**. Official
assets are authoritative → migrate tokens to `#6048F8` (keep `#A855F7` only
as a legacy data color if charts need it). Evidence:
`docs/ux/research/04-brand-asset-analysis.md`.

### F-4 — Emoji used as icons
`markup.ts` uses `🎤 🛡 ⌘ 🔬` as section/button icons. Rules (ui-ux-pro-max,
mission §22/§34, existing 3.1 identity) demand **inline SVG line icons** —
consistent, monochrome, scale-safe, aria-hidden. Fix during component pass.

### F-5 — Avatar underused; no agent-state visual language
Avatar appears only in the model-picker orb and as text initials in chat.
There is no speaking/listening/thinking/tool-running state treatment, no hero,
no voice mode. Mission §12/§13 (avatar communicates state; floating mode) are
unaddressed. Fix: state-driven avatar treatment (2D + CSS/SVG per research
`02-3d-avatar-technology.md`), hero in empty states/onboarding.

### F-6 — Chat empty state is thin
`client-script.ts` `renderMessages` empty state: title + 2 ghost buttons
(`/status`, `/plan`). Research consensus: *"Never ship a blank chat box"* —
empty state is the whole game. Fix: avatar hero, 3–4 suggested prompts
(bound to real commands), model/provider chip, capability hints, honest
"what XR can do" list.

### F-7 — No locality/connectivity indicator
Mission §26 (offline-first) — the UI has no consistent LOCAL / CONNECTED /
OFFLINE / DEGRADED / REQUIRES-NETWORK badge. Health chips exist but don't
answer "will this leave my machine / cost money?" Fix: a small locality
badge (green dot = local/offline-safe, amber = cloud route) on provider chip,
composer, and model picker — fed by real status (`probeHealth`,
`/api/system`).

### F-8 — Onboarding exists only in the terminal
Mission §11 demands a premium first-run. The wizard is good; the GUI has no
onboarding, so non-technical users hitting `xr serve` get a control console
with no "start here". Fix: GUI first-run flow (welcome → provider/local →
permissions → first prompt) driven by the same config/health authority as the
CLI wizard.

### F-9 — No budget/context visibility in the chat composer
Mission §19/§20. Budget chip exists in topbar; composer doesn't show
per-task spend, context %, or token usage. Fix: real metrics from
`src/cost/` + session context in the composer footer (small, honest).

### F-10 — Two chat implementations risk drift
The **dashboard chat** (client-side state, localStorage) and the **TUI chat**
have overlapping but different feature sets (branch/pin in dashboard; modes
in both). Fine today, but document the contract: both are thin clients over
`AgentService.execute` + the daemon chat route; keep the daemon route as the
single message contract for future sync (e.g., floating mode).

### F-11 — Accessibility gaps to close
Keyboard nav exists; remaining: ARIA live regions for streaming
(`aria-live=polite` on message feed), focus trap correctness in the palette
modal, visible focus on all interactive controls (focus ring token exists —
apply everywhere), reduced-motion support in the dashboard (no CSS motion
currently, but future motion must honor it), and touch/keyboard targets ≥
32–36px. Existing `test/a11y/` should be extended.

### F-12 — No embedded terminal, no 3D (not defects — scope)
Per research, deliberately deferred; document as future/experimental
(see `12-implementation-roadmap.md`).

## 5. UX strengths to preserve (mapped to mission goals)

| Mission goal | Existing asset |
|---|---|
| Chat as the heart | Dashboard chat workspace + TUI chat — keep, elevate empty state & composer |
| Provider/model switching easy | `Alt+P`/`/model` in TUI; models panel + provider chip in dashboard; real presets |
| Approve/reject actions | Inline Allow/Deny cards (dashboard), approval plane in TUI |
| Memory understandable | Memory panel with undo (`t4-memory-undo` evidence) — keep |
| Security visible not scary | Shield/audit panels, capability badges, honest readiness banner |
| Budget | Budget panel + chip; add composer/context visibility (F-9) |
| Skills/MCP/plugins | Marketplaces + management panels with real registry data |

## 6. Audit verdict

The product's **runtime and trust plane are outstanding and must not be
rewritten**. The UX layer is a strong 3.1-generation control center with
genuine honesty; the transformation needed is **consolidation, honesty
fixes, brand alignment, and experience elevation** (empty states, avatar
state language, GUI onboarding, locality signals), not a rewrite. The
mission's "no fake UI, no unnecessary rewrites, no hardcoded logic"
constraints are achievable — the integration surfaces exist.
