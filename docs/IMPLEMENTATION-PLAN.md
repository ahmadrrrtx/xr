# XR IMPLEMENTATION PLAN — v1.0 Final
## Phased agent-by-agent execution plan. One agent per phase.

**Owner:** Ahmad (ahmadrrrtx)
**Repo:** https://github.com/ahmadrrrtx/xr
**Working branch convention:** `phase/N-name` → PR to `main` after Ahmad's approval → merge.
**One agent per phase.** Fresh agent each time. Agent gets the phase handoff brief, the master docs, and the official assets. No agent carries context from previous phases except what's in the codebase and docs.

---

## THE STANDARD AGENT WORKFLOW (har phase mein yahi cycle follow hoga)

Har dedicated coding agent ko yeh 7-step ritual follow karna hoga. Ahmad approval ke bina push nahi hoga.

### Step 1 — STUDY (agent ka first kaam)
- Read the full phase brief (this doc ke relevant section se copy karke diya jayega).
- Read `/home/user/xr-DESIGN-SYSTEM.md` (design system).
- Read `/home/user/xr-THEME-SYSTEM.md` (5 themes ke tokens).
- Read `/home/user/xr-SCREEN-BRIEFS.md` ke relevant screen section.
- Read `/home/user/xr-DEEP-DIVE-ARCHITECTURE.md` ke relevant parts.
- Inspect official brand assets:
  - `/home/user/uploads/xr logo.png` (silver X + atomic ring + cyan core on black — logo hi final truth hai)
  - `/home/user/uploads/XR AVATAR .png` (front sentinel)
  - `/home/user/uploads/XR Aavatar side face 2 .png` + `/home/user/uploads/XR Avatar side face.png` (side references)
  - Reference preview for the screen from `/home/user/previews/NN-*.png`
- Inspect existing codebase code (git clone, `package.json`, folder structure).
- Agent ko apne phase ke alawa screens touch nahi karne — scope tight rakho.

### Step 2 — RESEARCH (agent apne aap relevant cheezein dekhega)
- Current latest versions of primary dependencies jo phase mein chahiye (Tauri v2 plugins, React libs, npm packages).
- Competitive products ke patterns (e.g. Chat screen ke liye: ChatGPT app, Claude desktop, Arc browser chat, Cursor; Builder ke liye: Lovable, bolt.new, v0, Cursor; Brain trace ke liye: Jaeger, Datadog traces, OpenTelemetry UI).
- FOSS library choices confirm kare (license check: MIT/Apache-2 preferred, AGPL alag subprocess mein isolate, CC-BY-NC avoid).
- Performance aur accessibility best practices for that specific surface.
- Platform specifics (macOS nspanel? Windows UIA? Linux landlock?) for that surface if relevant.
- Risks aur unknowns note kare.

### Step 3 — PLAN (agent likhega concise plan)
- Agent ek chhota plan document likhega (phase ke `.spec.md` file mein) covering:
  - File structure (which new files, which modified files).
  - Components list (naming, props, state).
  - Zustand stores needed.
  - Tauri commands / API endpoints / IPC events needed.
  - Data flow diagram (simplified).
  - Animations (specific Framer Motion values).
  - Edge cases (empty/loading/error/offline).
  - Test plan (manual test checklist).
  - Out of scope (kya nahi karna is phase mein).
- Plan concise hona chahiye (1-2 pages), formal doc nahi.
- Plan Ahmad ko briefly explain karo (10 lines summary in chat) before coding.

### Step 4 — PREVIEW GENERATE (agent image generate karega before coding)
- Agent `generate_image` tool call karke 1-3 refined preview shots banayega apne screen ke (previous preview ko reference pass karke official logo/avatar consistent rakho).
- Ye confirm karega ki visual direction Ahmad ko pasand hai (Ahmad feedback de sakte hain, agent adjust karega).
- **Note:** Splash, logo, Companion Orb, Onboarding already done — re-generate sirf if refinement chahiye.

### Step 5 — IMPLEMENT
- Code likho following the plan + design system tokens (always `var(--*)` never hardcoded hex except in theme token map).
- TypeScript strict mode, no `any` unless justified.
- Components shadcn/ui base pe extend karo; custom components `src/components/<screen>/` mein.
- Screen component `src/screens/<Name>/index.tsx`.
- Zustand stores in `src/stores/<name>.ts` (slim, single-responsibility).
- Tauri Rust commands in `src-tauri/src/commands/<name>.rs` when needed.
- Framer Motion animations as specified in screen brief.
- i18n keys (English first, Urdu later) where there's user-facing text.
- Keyboard shortcuts registered.
- a11y attributes (aria labels, roles, keyboard nav).
- Prettier + ESLint config already set up — pass lint.
- **Do NOT implement backend that doesn't exist yet** — use mock data / placeholder Zustand stores for cross-screen data that belongs to later phases (e.g. Chat screen pe sessions list mock data se chalayega; real backend later).
- Tauri v2 plugins only — no Electron.

### Step 6 — TEST + RUN SERVER
- `bun install` (or `npm install`) chalayega, `bun tauri dev` se app start karega.
- Manual test checklist run karega (all states: empty, loading, populated, error; all interactions: clicks, keyboard, resize; theme switching XR Native/Graphite/Midnight/Paper/Arctic).
- Console errors zero.
- TypeScript errors zero.
- Dev server background process start karega (`start_process`), live preview URL Ahmad ko dikhayega.
- Previews mein har state ka screenshot leke dikhayega (if possible).

### Step 7 — APPROVAL + PUSH
- Live preview Ahmad ko show karo (port expose kar ke URL do).
- Ahmad approves → `git checkout -b phase/N-name` → `git add . && git commit -m "feat(phase/N): <description>"` → `git push -u origin phase/N-name` → PR open karo to `main` with description linking the plan doc + screenshots.
- Ahmad rejects with feedback → agent fixes per feedback, re-previews, re-requests approval.
- **Never push directly to `main`.** PR must be reviewed/merged by Ahmad.

---

## PRE-PHASE: REPO CLEANUP + SCAFFOLD (Main khud/Ahmad ke saath, ya Agent 0)
**Goal:** Clean unnecessary docs out of xr/ repo, set up fresh scaffold with Tauri v2 + React + TS + Tailwind v4 + shadcn/ui + theme tokens, lock versions, establish folder structure.

**Scope:**
1. Clone fresh `ahmadrrrtx/xr` at current HEAD.
2. Remove/re-organize old docs in repo (current README needs updating, old random docs clean).
3. Move master docs (`xr-DESIGN-SYSTEM.md`, `xr-THEME-SYSTEM.md`, `xr-SCREEN-MAP.md`, `xr-SCREEN-BRIEFS.md`) into repo's `docs/` folder so version controlled.
4. Setup fresh Tauri v2 project (if not already proper):
   - React 18 + TypeScript + Vite
   - Tailwind v4 with Oxide engine + `@tailwindcss/vite`
   - shadcn/ui v4 (New York style, dark slate base, XR color tokens)
   - Framer Motion, Zustand v5, TanStack Query v5
   - Lucide React, Sonner toasts, cmdk
   - Inter + JetBrains Mono + Orbitron local fonts (no Google Fonts CDN)
   - Tauri plugins: autostart, clipboard, global-shortcut, notification, single-instance, store, dialog, os, stronghold, fs-watch, shell, updater, deep-link, sql
5. Define folder structure:
   ```
   src/
     screens/        # one folder per screen, e.g. Chat/
     components/
       ui/           # shadcn base
       brand/        # Logo, Avatar, Orb custom SVGs
       layout/       # Sidebar, Topbar
       chat/, brain/, builder/, ... (screen-local)
     stores/         # Zustand
     hooks/
     lib/            # utils, api client
     styles/
       themes.css    # CSS custom properties, 5 themes
     App.tsx
     main.tsx
     router.tsx      # React Router / TanStack Router
   src-tauri/
     src/
       main.rs
       commands/
       events.rs
       tray.rs
       permissions/
     Cargo.toml
     tauri.conf.json
   docs/             # all master docs versioned here
   ```
6. Implement theme system (CSS variables + `html[data-theme=...]` switching + Settings integration in a dev-only debug toggle for now).
7. Setup ESLint, Prettier, TypeScript strict.
8. Setup global error boundary + dev console banner.
9. Make sure `bun tauri dev` boots to a blank canvas with just theme applied and a placeholder "XR is starting..." screen.
10. Commit as `phase/0-scaffold`.

**Dependencies:** none.
**Deliverable:** Empty app booting successfully, all tooling locked, theme vars working, all master docs in `docs/`.
**Approval test:** Run `bun tauri dev`, toggle themes with `⌘+Shift+T` (debug shortcut for now), see theme vars change instantly.

---

## PHASE 1 — APP SHELL (Sidebar + Topbar + Routing + Theme Switch)
**Goal:** Permanent UI skeleton jo har screen pe dikhega — sidebar, topbar, routing, theme switching real, window chrome (traffic lights/drag region).

**Scope:**
- Left Sidebar (72px icon-only default, 240px expanded, toggle, collapse button, 14 nav items in fixed order, active indicator, XR logo top, XR wordmark in expanded mode, tooltip for collapsed icons).
- Topbar (52px tall: screen title + breadcrumbs left, cmdk trigger pill center, wallet widget + mic + notification bell + avatar right).
- Titlebar/drag region with macOS traffic lights (use Tauri `decorations: false` and build custom titlebar; Windows/Linux show min/max/close controls).
- React Router setup with routes for all 14 screens (placeholders for now — each renders a simple "Screen X coming soon" card).
- Real theme switch (Settings tab Appearance placeholder or dev toggle), persists to Tauri Store via Stronghold.
- App component wraps everything with framer-motion AnimatePresence for page transitions.
- Keyboard shortcuts: `⌘B` toggle sidebar, `⌘K` open cmdk (placeholder for now), `⌘⇧T` cycle themes.
- Sonner toast setup, positioned bottom-right.
- Notification bell popover (placeholder empty state).
- User avatar dropdown (profile, settings, quit — placeholders).

**Brief reference:** "GLOBAL APPLICATION SHELL" section in `xr-SCREEN-BRIEFS.md` lines 1-200. Also Sidebar/Topbar sections under Global.
**Preview reference:** `previews/01-chat-screen.png` (look at chrome, not chat area), `previews/17-settings.png` (sidebar), `previews/14-budget.png` (sidebar+topbar).

**Dependencies:** Phase 0 scaffold.
**Deliverable:** App launches, sidebar + topbar render on every screen, click nav routes work, theme switching works, sidebar collapse works.
**Approval test:** Navigate between all 14 placeholder screens via sidebar; expand/collapse sidebar; cycle all 5 themes and check chrome looks right each.

---

## PHASE 2 — XR AVATAR COMPONENT + BRAND ASSETS (shared component)
**Goal:** Reusable XR sentinel avatar component (7 states, 5 sizes) used across chat/voice/theater/orb/onboarding. Alag phase kyunki har screen pe use hoga.

**Scope:**
- `src/components/brand/Avatar.tsx` — React component, props: `size` (xs/sm/md/lg/xl = 16/24/40/80/200px), `state` (idle/listening/thinking/speaking/waiting-approval/error/sleeping), `variant` (head-only / bust / orb).
- 7 states render with: eye shape/brightness, chest core glow, energy trail intensity/pulse, orbital rings (for orb variant).
- Eyes: almond-shaped cyan slits, no pupils/iris (reference avatar images).
- Chest core: smooth circle (NO Iron Man segmentation) that brightens/pulses.
- Energy trails: SVG gradient strokes sweeping back from shoulders (animated when speaking/listening).
- SVG-based so it scales perfectly across sizes/themes.
- Color adapts to theme (via CSS vars: `--accent`, `--accent-glow`).
- `src/components/brand/Logo.tsx` — SVG logo (silver X + atomic ring + cyan core), wordmark "XR" in Orbitron, horizontal + stacked variants.
- `src/components/brand/CompanionOrb.tsx` — orb-only variant (the small desktop widget version with orbital ring tilt).

**Brief reference:** Design system "XR Avatar" section; theme adaptation table.
**Preview reference:** `previews/05-companion-orb.png` (orb style), `previews/02-voice-theater.png` (bust, lekin smooth core ho segmented nahi), `previews/16-voice-setup.png` (bust).
**Reference assets:** `/home/user/uploads/xr logo.png`, `/home/user/uploads/XR AVATAR .png`.

**Dependencies:** Phase 1 shell.
**Deliverable:** Avatar component rendered on a dev test page with all 7 states × 5 sizes visible for QA.
**Approval test:** See all 7 states animate correctly across all 5 themes; avatar looks like official reference (smooth, calm sentinel, not menacing, not cute).

---

## PHASE 3 — SPLASH SCREEN + ONBOARDING WIZARD (10 steps)
**Goal:** First launch experience. Boot splash → 10-step onboarding with hardware auto-detect → first chat <3 min target.

**Scope:**
- Splash window (Tauri separate window): centered logo, progress bar, status text, auto-close when main window ready. Logo + ring rotation animation.
- Onboarding modal/wizard (full-screen in main window first launch):
  1. Welcome (logo + tagline + Continue)
  2. Promise (3 value cards)
  3. **System Check** (real detection via Tauri: OS via os plugin, RAM/CPU, GPU via wgpu, mic via cpal, Ollama detection via shell `which ollama` + HTTP to localhost:11434)
  4. Model setup (install recommended OR BYO keys OR XR cloud)
  5. Model download progress (stream download of Ollama model via `ollama pull`, real progress)
  6. Voice setup (mic enumerate + test with volume meter)
  7. Voice selection (TTS voice picker with sample playback stub)
  8. Preferences (name input, theme swatch picker, default budget slider)
  9. Integrations quick-connect (OAuth buttons for Gmail/GitHub/Calendar — placeholders, connect flow later in Integrations phase)
  10. All set (greeting with Avatar, "Start chatting" button)
- Skip buttons for non-essential steps.
- Progress bar top.
- Onboarding completion sets `onboardingComplete = true` in Store; subsequent launches skip straight to splash → Chat.
- Name stored, used in greeting.

**Brief reference:** "OV-7 Splash" + "OV-8 Onboarding Wizard" sections.
**Preview reference:** `previews/06-onboarding.png` (perfect), `previews/21-splash-boot.png` (cinematic logo).

**Dependencies:** Phase 2 (Avatar + Logo components used in onboarding).
**Deliverable:** First launch shows splash → onboarding → reaches Chat screen. Model download actually works (calls Ollama if installed, offers download instructions if not).
**Approval test:** Fresh install (delete Store data), run through onboarding, verify system check detects real hardware, install a small model (or skip), reach "Start chatting". Time from launch to first chat screen should be < 1 min (excluding model download which depends on internet).

---

## PHASE 4 — CHAT SCREEN (core experience)
**Goal:** Main conversation screen. Sessions list + message stream + composer + tool-call cards + streaming.

**Scope:**
- Left sessions panel (260px, resizable, collapsible, new-chat button, search, date groups, session items with timestamp/model dot, active indicator, hover actions).
- Welcome/empty state (centered Avatar, greeting by name, 4 suggestion chips).
- Message list (user bubbles right-aligned, XR bubbles left-aligned with Avatar, markdown rendering with syntax-highlighted code blocks, tool-call inline cards expandable with status icons, citations superscript, streaming cursor).
- Composer (auto-grow textarea, attachment button, mic button, voice-theater button, send button, token counter near context limit, model picker chip below).
- Attachment strip (file previews).
- Auto-scroll behavior (scroll-to-bottom button when user scrolled up, load older messages on scroll-up).
- Streaming simulation (backend mock first — hook up real LLM later; use streaming SSE-like state with a mock response for now so UI shows streaming).
- Cancel generation button while streaming.
- New chat `⌘N`, focus composer `⌘/`, edit last message ↑, send Enter, newline Shift+Enter.
- Edit message (click edit on user message, re-send replaces follow-ups? Simple v1: edit creates new branch/re-sends).
- Session persistence to local (SQLite via Tauri sql plugin for now, no vector yet).

**Brief reference:** "SCREEN 1: CHAT" section.
**Preview reference:** `previews/01-chat-screen.png` (primary), theme variants `previews/themes/01a-chat-graphite.png` through `01d-chat-arctic.png`.

**Dependencies:** Phase 2 (Avatar component used in bubbles), Phase 3 (onboarding leads here).
**Deliverable:** User can create sessions, send messages, see streaming mock responses, switch sessions, edit, scroll, use in all 5 themes. Real model hookup NOT required yet (mock streaming acceptable for this phase, but the streaming infrastructure should be set up for SSE).
**Approval test:** Send message, see streaming response with cyan cursor, scroll up to load older, new chat creates new session, sidebar list updates, switch themes mid-chat, check empty state with suggestion chips work.

---

## PHASE 5 — HUD COMMAND PALETTE (global overlay)
**Goal:** `⌘K` in-app palette + global-shortcut HUD floating window (Raycast style).

**Scope:**
- In-app cmdk palette (over main window, `⌘K`): search commands + sessions + agents + navigate screens.
- Global HUD floating Tauri window (separate window, frameless, blurred, always-on-top, 640×480 default), triggered by global shortcut `⌘+Space` (configurable, detects conflict with Spotlight).
- HUD can ask quick questions and stream responses without opening main app (uses same chat backend once Chat is ready).
- Prefix filters: `/` commands, `@` agents, `>` actions, `?` web search.
- Avatar icon (24px) left of input.
- Result groups, keyboard nav (↑↓→←, Enter, Ctrl+N/P).
- Dismiss on Escape or click outside.

**Brief reference:** "OV-1 HUD Command Palette" + "OV-6 cmdk" sections.
**Preview reference:** `previews/07-hud-palette.png`.

**Dependencies:** Phase 1 shell, Phase 2 (small Avatar).
**Deliverable:** `⌘K` opens in-app palette; global shortcut opens HUD even when app is hidden; quick-ask streams answer in the palette.
**Approval test:** Trigger global shortcut from any app; type, navigate results, open a session from palette, ask quick question and see response stream.

---

## PHASE 6 — COMPANION ORB (desktop widget window)
**Goal:** The floating orb always visible on desktop — listens, responds, opens XR.

**Scope:**
- Separate Tauri window: 120×120, frameless, transparent, always-on-top, draggable, bottom-right default (position persisted).
- Canvas-rendered orb (or high-quality SVG + CSS animation for the 7 states: idle/listening/thinking/speaking/waiting/sleeping/error).
- Orbital ring tilt, slow rotation.
- Clicks: left = toggle listening, right = context menu (Open XR, Start voice, Approvals, Settings, Quit), double-click = open main app.
- State syncs with backend (e.g. when XR is thinking, orb shows thinking).
- Sound wave rings emanate outward when listening/speaking.
- Auto-hide after 30m inactive (sleeping state).

**Brief reference:** "OV-3 Companion Orb" section.
**Preview reference:** `previews/05-companion-orb.png` (PERFECT — exactly match this).

**Dependencies:** Phase 2 (Avatar component; orb is a variant).
**Deliverable:** Orb floats on desktop, draggable, right-click menu works, states animate correctly.
**Approval test:** Launch app, orb appears bottom-right, drag it somewhere, right-click menu works, click toggles listening (visual state), double-click opens/focuses main app.

---

## PHASE 7 — APPROVAL MODAL + NOTIFICATIONS (cross-surface trust)
**Goal:** XR Shield approval UI — the permission required dialog that appears across surfaces.

**Scope:**
- Approval Modal component (as specified: shield icon, body details, risk badge, justification, remember checkboxes, DENY/APPROVE buttons, countdown auto-deny).
- Approval queue Zustand store (`useApprovalStore`) with `add()`, `decide()`, `pending[]`.
- Approvals can come from anywhere (chat, builder, CLI, bot, voice) via Tauri event `approve:request`.
- Bell popover shows last 20 notifications, "Mark all read", "Open Control Room" link.
- Sonner toast integration (toast for each approval request when modal isn't in front).
- OS-level notification (Tauri notification plugin) when XR is unfocused.
- Remember rules: "Always allow X to Y for Z", "Allow for 1h", "Allow once", "Deny permanently" — rules persisted in SQL store.

**Brief reference:** "OV-4 Approval Modal" + "OV-5 Notifications" sections.
**Preview reference:** `previews/19-approval-modal.png`.

**Dependencies:** Phase 1 shell, Phase 2 (shield icon), Phase 4 (chat can trigger approvals).
**Deliverable:** Approvals can be triggered (dev helper button for test), modal appears, DENY/APPROVE works, remember rules persist, bell popover shows history.
**Approval test:** Trigger test approval via dev menu, verify modal appears centered, APPROVE closes and logs decision, DENY same, remember rules persist across app restart.

---

## PHASE 8 — SETTINGS SCREEN (full)
**Goal:** All 8 settings categories functional, including appearance (real theme picker with 5 swatches).

**Scope:**
- Two-pane macOS System Settings layout, left category sidebar, right content.
- **General:** profile (name, avatar, email), startup toggles, defaults (model/budget/workspace), language.
- **Appearance:** 5 theme swatches functional (click applies instantly), Match system toggle, sidebar/ density/ font size/ animation/ glassmorphism controls.
- **Models & Providers:** local Ollama auto-detect, provider API key entry (masked, Stronghold-stored), download model progress.
- **Keyboard Shortcuts:** list all commands, record new shortcut, conflict detection, reset defaults.
- **Notifications:** master toggle + per-event toggles, quiet hours, sounds.
- **Voice & Audio:** links to Voice screen, audio input/output device selection, sound volume.
- **Privacy & Data:** data toggles, telemetry opt-in, PII redaction, data export/import, reset.
- **Updates:** check for updates button, channel selector (stable/beta), auto-update toggle.
- **About:** logo, version, links, dev tools toggle.
- Tauri Store persistence; secure keys in keychain.
- Remove dev debug toggles once this is done (theme switcher is now real in Settings).

**Brief reference:** "SCREEN 14: SETTINGS" section.
**Preview reference:** `previews/17-settings.png`.

**Dependencies:** Phase 1 (shell/chrome), Phase 2 (Logo used in About).
**Deliverable:** All settings render, toggle/slider/dropdown inputs work, theme switcher replaces dev toggle, API keys save masked, shortcuts re-bindable.
**Approval test:** Switch theme via Settings → Appearance swatches (no dev toggle needed), add a test API key (masked), rebind a shortcut, verify all persist after restart.

---

## PHASE 9 — BRAIN / AGENT RUN TRACE
**Goal:** OTel-style live trace tree + Gantt chart for a single agent run.

**Scope:**
- Run header (ID, title, agent, model, status dot, live duration, live token/cost counters, Stop/Restart/Export buttons).
- Tabs (Trace / Timeline / Events / Cost / Logs).
- Left indented tree view with virtualization, category color-coding (LLM cyan, tool purple, file orange, network green, shell red, approval yellow), expand/collapse, running-node pulse, auto-follow toggle.
- Right side: top Gantt chart (colored bars on time axis), bottom detail panel (Inputs/Outputs/Metadata/Error tabs with JSON highlighting).
- Live events stream via SSE/Tauri events; new nodes appear with animation.
- Resizable split divider.
- Recent runs list when no runId specified.

**Brief reference:** "SCREEN 2: BRAIN" section.
**Preview reference:** `previews/08-agent-brain.png`.

**Dependencies:** Phase 1 (shell), Phase 4 (chat can show "view trace" link), runs data model defined.
**Deliverable:** Tree + Gantt render with mock run data; live updates simulate; clicking a node shows details; expand/collapse works; time range zoom.
**Approval test:** Generate a mock run with 20+ nodes (mixed types + nested), verify tree indentation, Gantt bar sizing, live ticking counters, color coding per category, detail panel JSON syntax highlight.

---

## PHASE 10 — WORKSPACES
**Goal:** Launch pad grid, templates, multi-window.

**Scope:**
- Workspace grid with cards (gradient header strip, emoji icon, name, path, stack chips, last opened, hover actions, favorite star).
- "+ New workspace" card, template strip (Python/Web/Research/Custom/Git Clone), view toggle grid/list, search + filters.
- Multi-window select + launch (Tauri WebviewWindowBuilder for selected workspaces, spawns separate windows at remembered positions).
- Backend: workspace CRUD (SQL), template definitions (JSON), git clone flow (shows progress).
- Workspace settings (name/path change, delete with confirm undo-toast).

**Brief reference:** "SCREEN 3: WORKSPACES" section.
**Preview reference:** `previews/09-workspaces.png`.

**Dependencies:** Phase 1 shell.
**Deliverable:** Workspaces screen shows grid, create/delete/favorite works, template picker opens flow, multi-window actually spawns new Tauri windows.
**Approval test:** Create workspace from template, favorite it, select 2 workspaces, click "Launch 2 windows" — verify 2 new XR windows open. Delete via hover menu + undo via toast.

---

## PHASE 11 — RUNS / CONTROL ROOM
**Goal:** Table of all runs across surfaces, emergency stop, history.

**Scope:**
- Tabs (All/Running/Completed/Failed/Killed) with counts.
- Virtualized data table with columns: Status (color dot), ID, Agent, Workspace, Model, Started, Duration, Tokens, Cost, Actions.
- Live updates for running rows (ticking counters, status changes).
- Filters: search, date range, export CSV.
- Aggregate stats row (runs today, tokens, cost, running count, failed count).
- Bulk "STOP ALL" with confirmation, per-row kill button.
- Charts section (stacked area + runs bar + donut) collapsible.
- Click row → opens `/brain/:runId`.
- Right-click menu (open trace, open workspace, copy ID, retry).

**Brief reference:** "SCREEN 9: RUNS" section.
**Preview reference:** `previews/18-runs-control-room.png`.

**Dependencies:** Phase 9 (Brain detail), runs data model.
**Deliverable:** Table renders mock runs, live running rows tick, stop button triggers confirm, export CSV downloads file.
**Approval test:** 50+ mock runs load (virtualized no lag), filter tabs work, search works, kill button stops mock run, "STOP ALL" stops all running mock runs with confirmation.

---

## PHASE 12 — SHIELD / TRUST CENTER
**Goal:** Security dashboard — status, approvals queue, audit log, settings.

**Scope:**
- **Status tab:** hero shield icon (state changes: protected/attention/compromised), 4 stat tiles (blocked/pending/auto-approved/quarantined), recent activity feed.
- **Approvals tab:** full approvals list (pending/approved/denied), bulk actions, remember-rule checkboxes integrated with Phase 7 modal store.
- **Audit Log tab:** virtualized table of all actions (time, actor, skill, action, resource, decision, cost, rule), filters, click for details, export JSON/CSV.
- **Security Settings tab:** toggles (egress proxy, auto-approve low-risk, constitution strictness slider, quarantine new skills, biometric approval, shell exec, PII redaction, data sharing), egress domain allow/block lists, "Run health check" button, emergency "Revoke all approvals and pause agents" red button.
- Ed25519 audit chain (stub for now; verify signature in health check once real skill installs exist).

**Brief reference:** "SCREEN 8: SHIELD" section.
**Preview reference:** `previews/03-shield-trust.png`.

**Dependencies:** Phase 7 (approval modal exists; wire to this screen), Phase 11 (runs feed audit).
**Deliverable:** All 4 tabs render with mock data; pending approvals interact with real approval queue; settings toggles persist; health check runs basic validations.
**Approval test:** Trigger a test approval → appears as pending in Approvals tab → approve/deny → moves to approved/denied; toggle egress proxy OFF → verify chat surface warns about offline; export audit log downloads JSON.

---

## PHASE 13 — BUDGET (spend governor UI)
**Goal:** Spend overview, charts, model breakdown, settings, hard cap enforcement UI.

**Scope:**
- 6 tabs: Overview, Spend History, Models, Agents, Workspaces, Settings.
- Overview: stat tiles (this month/today/avg/tokens), stacked area chart (Recharts), horizontal model spend bars, quick settings (sliders + toggles for monthly limit, hard cap, circuit breaker, downshifting, reserve), emergency Pause button.
- Spend history: virtualized table of spend events, filters.
- Models tab: model grid (local + cloud), cost/token, latency, strengths, set default, add API key link, "Test model" button.
- Agents/Workspaces tabs: per-agent/workspace bar charts + per-entity budget caps.
- Settings: monthly slider, notification thresholds, billing (Pro stub).
- **Code-side enforcement (Rust governor):** pre-call budget check, circuit breaker at threshold, model downshifting, finalization reserve. This phase must wire UI to actual enforcement (mock LLM calls count against budget to demonstrate governor works).

**Brief reference:** "SCREEN 11: BUDGET" section.
**Preview reference:** `previews/14-budget.png`.

**Dependencies:** Phase 8 (Settings shows defaults), Phase 11 (Runs feed spend data).
**Deliverable:** Budget UI renders with mock spend data; charts animate; sliders change caps; hitting hard cap blocks mock calls with inline "Budget limit reached" message.
**Approval test:** Set monthly limit to $0.10, fire 20 mock LLM calls until hit cap → verify calls block with clear message, red banner appears; raise limit → calls resume.

---

## PHASE 14 — REAL LLM HOOKUP (backend foundation)
**Goal:** Chat se actual LLM baat kare — local Ollama aur cloud providers (OpenAI/Anthropic/Google). Ye foundation phase hai; baad ke screens isi ko reuse karenge.

**Scope:**
- Rust core agent runtime (slim v1): message send → model stream → tokens back to UI via SSE/Tauri events.
- Provider adapters: Ollama (local HTTP), OpenAI-compatible endpoint (covers OpenAI, Groq, OpenRouter, Together), Anthropic SDK, Google Gemini SDK.
- API keys read from Stronghold keychain (set in Phase 8 Settings).
- Streaming token counts live (updates Budget governor in Phase 13).
- System prompt per agent (default: XR Constitution 12 laws from master plan).
- Message history storage in SQLite (sessions table, messages table).
- Cancel in-flight request (AbortController).
- Fallback logic: if primary model fails / budget hit, auto-switch to fallback model (if downshifting enabled).
- `/api/chat/stream` SSE endpoint in Rust, Tauri events.

**Dependencies:** Phase 4 (Chat UI already built, was using mock stream), Phase 8 (Settings configures keys), Phase 13 (Budget governor enforcement wired).
**Deliverable:** Chat screen par actual LLM se baat ho — local Ollama + at least one cloud provider (OpenAI-compatible). Tokens count against budget. Cancel works.
**Approval test:** Set local model, send message, see real streaming response, observe token counter and cost estimate. Switch to cloud provider, send message, verify API call succeeds, budget decrements. Hit cancel mid-response → stream stops.

---

## PHASE 15 — VOICE SETUP + STT/TTS
**Goal:** Mic capture, wake word, speech-to-text, text-to-speech. Voice tab in Settings functional.

**Scope:**
- Microphone enumeration + selection + live volume meter via cpal.
- Wake word: openWakeWord (local, "Hey XR" default), sensitivity, wake sound toggle.
- STT: Whisper.cpp local (downloadable model), or cloud (whisper-1) if user enables.
- TTS: Piper local voices (Ahmad/Nova/Atlas/Sage variants built from free voice models) OR cloud (ElevenLabs/OpenAI TTS). Sample playback per voice. Speed/pitch sliders.
- Voice loop: mic → STT → agent (same as chat) → TTS → playback.
- "Start voice session" button triggers Voice Theater window (phase 16).
- Voice model downloads show progress (similar to Phase 3 onboarding).
- Accessibility: subtitles always visible, volume sliders keyboard accessible.

**Brief reference:** "SCREEN 13: VOICE SETUP" section.
**Preview reference:** `previews/16-voice-setup.png`.

**Dependencies:** Phase 8 (Settings hosts some voice prefs), Phase 14 (LLM backend used for voice loop).
**Deliverable:** Voice setup screen functional; test mic → volume meter moves; test STT → transcribes 3s clip; pick TTS voice → hears sample; voice session can be started from chat topbar mic button (plays response aloud even if theater not open).
**Approval test:** Say "Hey XR" from desktop (orb listening if Phase 6 done), ask a short question, hear response. If orb not done yet, use mic button in chat composer.

---

## PHASE 16 — VOICE THEATER (immersive window)
**Goal:** Full-screen immersive voice experience with sentinel avatar, stars, concentric voice rings.

**Scope:**
- Separate Tauri window (frameless, can go full-screen, can move to second monitor).
- Deep space `#03070D` background always (theme override, cinematic), canvas star field (WebGL particles slowly drifting, parallax).
- Avatar (bust variant, Phase 2 component, size 280px) centered above vertical middle, animated through states (idle/listening/thinking/speaking/waiting/error).
- Voice rings: concentric cyan rings emit from chest core when speaking (scale + opacity, proportional to volume).
- Transcript panel bottom (translucent glass, last few turns, current phrase karaoke highlight as XR speaks).
- Exit button top-right, mic mute, settings gear.
- Auto-exit on silence (30s configurable).
- Reduced motion: static stars, simpler ring animation.
- Escape closes window; fade transitions.

**Brief reference:** "OV-2 Voice Theater" section.
**Preview reference:** `previews/02-voice-theater.png` (feel), `previews/16-voice-setup.png` (avatar style — smooth core).

**Dependencies:** Phase 2 (Avatar bust variant), Phase 15 (voice loop).
**Deliverable:** "Start voice session" opens theater; speaking shows rings + transcript; user voice turns avatar to listening; exit via Esc/button.
**Approval test:** Start session, speak to XR → avatar goes listening → thinking → speaks (rings emit, transcript highlights words) → exit with Esc. On second monitor test if available.

---

## PHASE 17 — BUILDER (3-pane IDE)
**Goal:** Lovable/Cursor/v0-style code builder with live preview. Big phase.

**Scope:**
- Top bar (breadcrumbs, branch chip, Deploy/Save/Push buttons, preview target).
- Left pane: chat (same chat components as Chat screen, compact, with [Apply diff]/[Explain]/[Copy] buttons below XR messages; inline unified diff previews with accept/reject per hunk).
- Middle pane: Monaco editor via `@monaco-editor/react`, tab bar (open files, close, new), file tree sidebar toggle (togglable 240px), syntax highlighting across themes (auto-generated Monaco theme per app theme), minimap, code lens ("XR: fix suggested"), status bar, diagnostics from TypeScript language server (LSP via sidecar later — v1 uses basic TS diagnostics from `typescript` npm package).
- Right pane: live preview iframe pointing to sidecar dev server, browser bar (back/forward/reload, open-external, device size toggle, console toggle), console panel (slide-up, shows iframe injected logs).
- Sidecar: Rust/Node process that auto-detects project type (npm/pnpm/cargo/python), installs deps if needed, starts dev server, streams stdout/stderr to UI.
- Diff apply: XR returns unified diff; backend applies patch safely (never blind overwrite).
- Git integration (status badges, commit, push via isomorphic-git or git CLI).
- File operations via Tauri fs plugin, sandboxed to workspace root.

**Brief reference:** "SCREEN 4: BUILDER" section.
**Preview reference:** `previews/04-builder.png`.

**Dependencies:** Phase 10 (Workspace opens Builder for that workspace), Phase 14 (LLM backend used for chat/code generation), Monaco, Tauri shell plugin.
**Deliverable:** Open a workspace → Builder shows 3 panes → chat generates code → accept diff → Monaco updates → preview iframe refreshes (or shows "installing deps" then renders).
**Approval test:** Create a new React workspace from template, open Builder, ask XR to add a counter button, see code apply, preview hot-reload showing the button, click counter increments.

---

## PHASE 18 — RESEARCH (deep research agent)
**Goal:** Perplexity-style deep research with source panel.

**Scope:**
- Left control panel (query input, depth selector chips: Quick/Standard/Deep/Academic, source filters, progress bar during research, stats when done, follow-up chips).
- Center report view (markdown rendered, inline citation superscripts, tables, contradiction callouts if sources disagree, sources-cited list at end).
- Right sources panel (list of source cards with favicon/domain/title/relevance bar, collapsible full-text view, PDF viewer via pdf.js, citation click scrolls + highlights source).
- Research agent pipeline (planner → searcher → reader → synthesizer → fact-checker → citation linker).
- Web search provider abstraction (SearXNG/Brave/SerpAPI; respects egress proxy).
- Streaming updates: SSE events for steps/sources/tokens/citations.
- Save report to workspace as markdown.

**Brief reference:** "SCREEN 5: RESEARCH" section.
**Preview reference:** `previews/10-research.png`.

**Dependencies:** Phase 14 (LLM backend), egress proxy from Phase 12, basic skill for web fetch (Tauri shell plugin curl or Rust reqwest in sidecar).
**Deliverable:** Run a Standard-depth research query, see live sources appear and report stream, citations link to sources, contradiction callout renders when detected, save markdown to workspace.
**Approval test:** Research "best Rust web frameworks 2026", see 8+ sources in panel, report with [1]..[N] citations, click citation → source panel highlights that source, export markdown creates file.

---

## PHASE 19 — AGENTS (prebuilt + custom + workflows)
**Goal:** Agent gallery, custom creator, DAG workflow canvas.

**Scope:**
- 3 tabs: Prebuilt (7 agent cards with colored icons — Coder/Researcher/Writer/Analyst/Designer/Ops/General), My Agents (custom agents list + create card), Workflows (React Flow canvas).
- Prebuilt agents click → opens Chat pre-wired with that agent's system prompt + tools + budget preset.
- Custom agent creator (modal): name, emoji/avatar, description, system prompt textarea, tools multi-select chips, model picker, budget cap slider, Constitution overrides, avatar emoji picker, save/test/delete/duplicate. Agents saved as TOML/JSON in `~/xr/agents/`.
- Workflows canvas (React Flow/xyflow): node palette (LLM, Tool, Branch, Human check, Sub-agent, Input, Output, Loop), bezier connections with marching-ant animation when running, right inspector panel, top save/test-run/zoom/mini-map controls, drag-pan-scroll-multiselect-undo-redo, copy/paste.
- Workflow runner: interprets DAG topologically, each node a span in Brain trace.

**Brief reference:** "SCREEN 6: AGENTS" section.
**Preview reference:** `previews/11-agents.png`.

**Dependencies:** Phase 9 (Brain trace for workflow runs), Phase 14 (LLM backend).
**Deliverable:** Prebuilt grid renders; create custom agent saves; build a small 3-node workflow (Input → LLM → Output), test-run it, trace appears in Brain.
**Approval test:** Pick Coder prebuilt → chat opens with Coder system prompt active. Create a custom agent, save, start chat with it. Build workflow Input → LLM (reverse string) → Output, run "hello" → output "olleh".

---

## PHASE 20 — SKILLS STORE + QUARANTINE
**Goal:** Install/uninstall MCP server skills with quarantine-first flow.

**Scope:**
- Category sidebar + featured hero + 3-column grid of skill cards (icon, name, publisher, description, permission chips, install count, INSTALL/INSTALLED/UPDATE/QUARANTINED badge).
- Custom MCP install (URL/path form).
- Install flow modal: permission manifest, publisher trust score, quarantine checkbox default ON, advanced options.
- Quarantine enforces: fs restricted to `~/xr/scratch/`, no shell, egress via proxy with logging.
- Skills registry client (signed Ed25519 packages, downloaded to `~/xr/skills/<id>/`, run as isolated subprocesses communicating via stdio JSON-RPC — MCP protocol).
- Promote (exit quarantine) / uninstall flows.
- Skills automatically become available as tools in Chat/Builder/Agents after install.

**Brief reference:** "SCREEN 7: SKILLS STORE" section.
**Preview reference:** `previews/12-skills-store.png`.

**Dependencies:** Phase 12 (Shield records installs, enforces quarantine), Tauri shell plugin for subprocess.
**Deliverable:** Skills grid loads from local registry JSON (mock registry for now, later real); install a test skill (e.g. filesystem skill or an HTTP fetch skill) with quarantine; agent can call it (with approval); promote out of quarantine → auto-approved.
**Approval test:** Install a test "echo" skill quarantined, invoke from chat → approval modal shows quarantine warning → approve → see skill output → promote out of quarantine → next call auto-approved. Uninstall removes it.

---

## PHASE 21 — MEMORY EXPLORER
**Goal:** Long-term memory list + force graph, editable.

**Scope:**
- List tab: search (fuzzy + semantic), type filters, entries list (icon/name/snippet/time), detail panel (fields edit inline, linked memories, provenance).
- Graph tab: React Flow force-directed graph (node color/size by type/importance, edges = relationships, hover highlight connected nodes, physics layout, mini-map, zoom controls), click node → detail panel.
- Vector storage backend (VelesDB embedded 70µs vector search or sqlite-vss).
- Memory written by Constitution agent post-conversation (auto-memory toggle in Settings).
- Memory CRUD, undo-delete toast (10s).
- Semantic search across conversations, files, entities.

**Brief reference:** "SCREEN 10: MEMORY EXPLORER" section.
**Preview reference:** `previews/13-memory-explorer.png`.

**Dependencies:** Phase 14 (conversation data exists to seed memory).
**Deliverable:** After a few conversations, entities appear in list/graph; edit a memory → saves; semantic search finds related facts; delete + undo works.
**Approval test:** Chat about "my colleague Sarah who works at Acme", after conversation verify Sarah appears in Memory list as an entity with relationship "colleague" and correct company. Search "Acme" → finds Sarah via semantic search. Delete one memory → undo restores.

---

## PHASE 22 — INTEGRATIONS (OAuth-connected apps)
**Goal:** OAuth-gated Gmail/GitHub/Slack/Drive/Calendar connections.

**Scope:**
- Grid of integration cards (Google/Microsoft/Dev/Comm/Social/Media/Cloud/Data), status (Connect/Connected/Re-auth), hover scope summary.
- OAuth flow: Tauri opens system browser, deep link `xr://oauth/callback` returns to app, token exchange, tokens stored in OS keychain.
- Connected apps appear as MCP skills automatically after connection (reuses Phase 20 MCP runner).
- Settings popover per integration (scopes, sync now, disconnect, delete data).
- Custom MCP server form (command + args + env).
- Re-auth flow when tokens expire.

**Brief reference:** "SCREEN 12: INTEGRATIONS" section.
**Preview reference:** `previews/15-integrations.png`.

**Dependencies:** Phase 8 (Settings already shows some integration prefs), Phase 20 (MCP skill runner), Tauri deep-link plugin.
**Deliverable:** Connect GitHub via OAuth (or mock OAuth in dev), verify token stored, integration shows "Connected", a "github" skill appears and can list repos from chat. Disconnect removes it.
**Approval test:** Click Connect on GitHub → browser opens → authorize → redirect back → card shows Connected → from chat ask "list my repos" → (approval required to read GitHub) → approve → see repos. Disconnect → card returns to "Connect" state.

---

---

## PHASE 23 — CLI PACKAGE `@rrrtx/xr` (full npm package phase)
**Goal:** Alag phase dedicated to the open-source CLI. Publishable to npm. Not the desktop.

**Scope:**
- Node.js 18+ package, published as `@rrrtx/xr` (bin `xr`), Bun compatible.
- Project scaffolding outside Tauri (separate repo or `cli/` workspace in monorepo? Recommend `cli/` folder in same repo for shared types, but published as its own package).
- Commands: `auth login/logout/status/whoami`, `chat`, `run <agent>`, `agents`, `skills`, `approve`, `deny`, `budget`, `models`, `model <name>`, `memory`, `history`, `resume`, `workspace`, `init <template>`, `deploy`, `status`, `config`, `update`, `version`, `help`.
- Visual identity: ANSI colors (cyan accent, no emoji by default, unicode box banner, braille spinner `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`, progress blocks `██░░`, check/cross unicode).
- Interactive REPL (`xr chat` no args when TTY): streaming output, tool calls inline, approval prompts `? Allow X [y/N/a/1h]`, slash commands (/help /model /clear /exit).
- Pipeable mode: `cat error.log | xr "explain"` non-interactive, stdout only, no spinners/color if not TTY or `--no-color`/`NO_COLOR`.
- JSON mode (`--json`) for machine-readable.
- Daemon connection: if XR desktop daemon running on localhost, CLI talks to it (shares state/history/budget); else standalone using its own `~/.xr/config.toml`.
- Auth: OAuth device-code flow (opens browser), tokens in OS keychain via `keytar`.
- `xr init <template>` scaffolds new project (templates: Python, React+Vite, Node API, Research).
- `xr deploy` auto-detects Vercel/Netlify/Railway and runs appropriate CLI (with approval).
- No Electron/Tauri dependency. Pure Node.
- README + docs for CLI (in `cli/README.md`).
- Self-update via `npm install -g @rrrtx/xr` (with `xr update` convenience command).
- Homebrew formula + curl install script optional (post v1).

**Brief reference:** CLI section in `xr-SCREEN-BRIEFS.md`.
**Preview reference:** `previews/20-cli-terminal.png`.

**Dependencies:** Phase 14 (agent runtime; CLI either talks to daemon or runs its own lightweight agent in Node using same model config), Phase 13 budget enforcement (CLI must respect same spend caps).
**Deliverable:** `npm install -g @rrrtx/xr` (local path install for dev) works; `xr chat` enters REPL; `xr "one-shot question"` outputs answer; `xr auth login` works; `xr run build <dir>` runs agent; approval prompts show inline; `--json` works for piping.
**Approval test:** Install CLI globally via `npm link`, log in, run `xr chat` → REPL works with streaming, ask a question, tool call prompt appears, approve/deny works. Pipe `cat README.md | xr summarize` → summary prints to stdout non-interactive. Test `NO_COLOR=1 xr --json models` → JSON output no color.

---

## PHASE 24 — TELEGRAM BOT
**Goal:** Chat with XR from Telegram, inline approval buttons.

**Scope:**
- Telegram bot integration (long polling for self-host, optional webhook mode).
- Account linking: first `/start` shows link code, user enters in XR Settings → Integrations → Telegram to pair.
- Messages route to same agent system (chat model/budget/rules/memory).
- Approvals as inline keyboards [APPROVE]/[DENY] (times out in 60s).
- Voice messages transcribed via STT.
- Attachments (photos/files) → skill-driven analysis (respects Shield rules).
- `/budget`, `/status`, `/model`, `/stop`, `/help` commands.
- Runs as part of desktop daemon (if XR is running on your machine) OR as a relay (XR cloud for paid users; v1 is local-only — bot only responds when desktop is online).

**Brief reference:** "Telegram specifics" under Bot Surfaces.
**Preview reference:** `previews/22-bots-telegram.png`.

**Dependencies:** Phase 14 (agent backend), Phase 7 (approval routing across surfaces — approval pops up in desktop AND sends inline button to Telegram), Phase 22 (Integrations hosts the connect flow).
**Deliverable:** Connect a Telegram bot (dev token) via Integrations; message bot from phone → XR responds; approvals show inline buttons and sync across surfaces.
**Approval test:** Connect bot, send "send an email to test@example.com", see approval in Telegram as inline buttons AND desktop modal, approve on phone → email skill proceeds. Voice message → transcribed and answered.

---

## PHASE 25 — VS CODE EXTENSION
**Goal:** XR sidebar panel, inline code lens, Copilot-chat style experience inside VS Code.

**Scope:**
- VS Code extension (TypeScript, `@vscode/extension-ts`), packaged as `.vsix`.
- Activity bar icon (XR sentinel as SVG, matches official avatar).
- Side panel webview (React) with compact chat UI (same message rendering as desktop but compact, themed to VS Code colors).
- Code lens: `XR: explain`, `XR: fix`, `XR: improve`, `XR: add tests` above functions.
- Inline chat: select code, command → inline popover.
- Right-click context menu items.
- Diagnostics provider (XR warnings/suggestions inline).
- Status bar item: model + cost today.
- Connects to XR desktop daemon over localhost WS (if running) else standalone (config/keys shared from `~/.xr/`).
- Theme respects VS Code Dark+/Light+ (tokens mapped to VS Code theme variables, not forced XR dark).
- Commands: `xr.openChat`, `xr.askSelection`, `xr.explainSelection`, `xr.fixSelection`, `xr.switchModel`, `xr.showBudget`, `xr.toggleInlineSuggestion`.
- Optional: ghost-text inline suggestions (Tab-to-accept) — can be off by default to avoid conflict with Copilot.

**Brief reference:** "VS CODE EXTENSION" section.
**Preview reference:** `previews/23-vscode-extension.png`.

**Dependencies:** Phase 14 (daemon running for best experience).
**Deliverable:** Extension loads in VS Code Extension Development Host, panel opens, chat works, code lens appears above functions, status bar shows model/cost.
**Approval test:** F5 launch extension host, open a TS file, see XR code lens, click "explain" → panel opens with explanation. Select code → "Ask XR" → response appears. Switch model via status bar.

---

## PHASE 26 — DISCORD + WHATSAPP BOTS
**Goal:** Discord (slash commands + DMs) and WhatsApp (linked device) integration.

**Scope:**
- **Discord:** slash commands `/xr ask`, `/xr budget`, `/xr agents`, DMs 1:1 with XR, server channels opt-in, ephemeral messages for private info, button interactions. Bot application configured via Discord developer portal; connect in XR Integrations.
- **WhatsApp:** pair via QR code (WhatsApp Web Multi-Device), send/receive text/voice/images, quick-reply buttons [APPROVE]/[DENY]. Pairing flow inside Integrations → WhatsApp (show QR, scan with phone WhatsApp → Linked Devices).
- Same approval/budget/memory system as Telegram.
- Messages use platform-native formatting (Discord markdown, WhatsApp plain text).

**Dependencies:** Phase 24 (bot framework already built in Rust core for Telegram; generalize to Discord/WhatsApp). Phase 22 (Integrations UI for connect).
**Deliverable:** Discord bot responds in DMs with slash commands; WhatsApp paired device receives/sends messages with approvals as quick replies.
**Approval test:** Connect Discord, DM bot a question → response. Connect WhatsApp, send a message → XR replies, approve/deny via quick replies.

---

## PHASE 27 — UPDATER + CRASH RECOVERY + TRAY
**Goal:** Polished production bits — auto-update, crash recovery, menu bar tray, global shortcuts.

**Scope:**
- **System tray icon (always alive):** tray icon (small XR logo), menu (Open XR, New Chat, Start Voice, Pause Agents, Approvals, Quit). Click opens app.
- **Global shortcuts registered:** Toggle HUD `⌘+Space`, Push-to-talk `⌘.`, Screenshot+Ask `⌘⇧X`. Conflict detection.
- **Auto-update:** Tauri updater plugin, Ed25519 signed updates, release channel (stable/beta/nightly), update available modal with release notes + "Install & restart", download progress.
- **Crash recovery:** dirty flag on startup, recovery screen (Resume sessions / Start fresh / Send crash report), previous in-flight runs marked killed.
- **macOS specifics:** NSWindow customization (traffic lights, hidden titlebar for traffic-light-style, dock menu, NSPanel for HUD if appropriate).
- **Windows specifics:** MSIX installer, AppContainer sandbox where possible, UIA accessibility, system theme detection.
- **Linux specifics:** AppImage/Flatpak/deb packaging, Landlock/bwrap sandbox for skills, PipeWire audio, desktop entry.
- **Touch bar (macOS, optional):** shortcut buttons if Mac has touch bar.
- **App menu (standard macOS menus):** XR (About, Settings, Check for Updates, Hide, Quit), File (New Chat, New Workspace, Close), Edit (Undo/Redo/Cut/Copy/Paste/Select All), View (Themes, Sidebar, Zoom), Window (Minimize, Zoom, Bring All to Front), Help (Documentation, Report Bug).

**Dependencies:** Phase 0 scaffold has Tauri; tray/updater/shortcuts plugins already added; wiring them into real UX here.
**Deliverable:** Tray icon shows menu, global shortcuts work, updater checks against local dev manifest, crash recovery works (simulated crash shows recovery screen), macOS menu bar items correct.
**Approval test:** Close main window → app runs in tray; click tray → opens; trigger `⌘+Space` globally → HUD appears; trigger a simulated crash (dev menu) → relaunch shows recovery screen.

---

## PHASE 28 — MOBILE PWA (companion)
**Goal:** Phone companion for chat, approvals, budget, voice. Not a coding surface.

**Scope:**
- React + Vite PWA, same Tailwind tokens + theme (light/dark sync with OS, XR Native/Arctic mobile).
- Bottom tab bar (4 tabs: Chat, Voice, Approvals, Settings).
- Stack navigation, iOS-style slide transitions, mobile touch targets min 44px.
- Chat list + conversation (full-width on mobile, no sidebar).
- Voice tab: big orb center, talk to XR, hands-free.
- Approvals tab: list of pending approvals with Approve/Deny buttons (push notifications via Web Push).
- Budget quick-view.
- Settings: theme, model, logout.
- Offline: service worker caches last conversations, queues sends.
- Push notifications (Web Push, end-to-end encrypted via relay).
- Connects to desktop daemon over LAN (when same WiFi) or via XR cloud relay (e2e encrypted, paid-tier or self-hosted).
- Install to home screen (PWA manifest), standalone display, splash screen.

**Dependencies:** Phase 14 (backend daemon exposes WSS for LAN connections), Phase 7 (approvals).
**Deliverable:** PWA runs in mobile browser, installs to home screen, chats sync when on same LAN, push notifications for approvals.
**Approval test:** Run XR desktop, open PWA on phone (same WiFi), send chat message → desktop+mobile both show; approve via phone → desktop approves; disable WiFi → offline mode shows cached chats; send message queued; re-enable → syncs.

---

## PHASE 29 — MULTI-WINDOW + WORKSPACES POLISH
**Goal:** Multiple main windows for different workspaces (one window per workspace).

**Scope:**
- Tauri multi-window spawn (from Workspaces screen "Launch multi-window" button — already wired in Phase 10; this phase deepens it).
- Each window has its own sidebar (but shared state) and can be on different screens/workspaces.
- Drag a tab/session out to a new window (like browser tab tear-off) — optional v1 polish.
- Window positions remembered per workspace.
- Cross-window IPC (approvals in one window show toasts in all; theme change applies to all windows instantly).
- macOS: windows play nicely with Spaces/Full Screen; Windows: taskbar per window grouping.

**Dependencies:** Phase 10 (basic multi-window), Phase 5 (HUD works across windows), Tauri WebviewWindow.
**Deliverable:** Launch 2 workspace windows simultaneously, interact with both, theme change applies to all, approve from any window, close one doesn't kill others.
**Approval test:** Launch 2 workspaces, move one to second monitor, interact in each, verify states don't conflict. Close one window → other stays alive and retains state.

---

## PHASE 30 — BUSINESS TIER (SSO, admin, compliance, team memory)
**Goal:** Paid $15/user/month tier. Team features.

**Scope:**
- Auth modes: Personal (free, MIT-licensed, local models + BYOK) vs Team (paid, managed cloud, SSO).
- SSO (SAML/OIDC: Google Workspace, Okta, Azure AD).
- Admin console: invite members, enforce budgets per user, audit log export for compliance, data retention policies, egress proxy team-wide rules.
- Team shared memory (workspace-scoped knowledge base).
- Managed cloud models (XR pays API costs, bills team).
- Compliance logging (SOC 2 roadmap, encrypted audit logs).
- Billing via Stripe, invoicing, per-seat monthly.
- License key enforcement tied to account (no DRM, honest payment).
- Paywall UI in Settings → Billing: upgrade card with features comparison, "Upgrade to Pro" button, manage subscription.
- Free tier keeps full Jarvis-local experience (cripples nothing local, just no team/managed cloud).

**Dependencies:** All core phases (features exist for personal first). Backend account system (XR cloud) needed for team/auth.
**Deliverable:** Team can sign up, invite members, SSO login, shared workspace memory, enforced budgets, billing page works in sandbox.
**Approval test:** Create a team, invite a test user, set per-user budget $10, log in as test user via SSO, share a workspace → test user sees shared memory, verify budget enforcement, view admin audit log.

---

## POST-V1 (after all 30 phases ship v1.0)
- Performance profiling + fixes (time to interactive <1.5s, memory <200MB idle).
- Community skills registry (publish/browse/review).
- Plugin SDK for third-party skills/agents.
- Mobile native apps (React Native or Swift/Kotlin — PWA is good enough for v1).
- Fine-tuning UI (custom LoRA training on your data locally).
- Browser extension (companion for page summaries).
- Extensive i18n (Urdu RTL, Spanish, French, Arabic, Chinese, Japanese).
- Accessibility audit by external tester.
- Plugin signature audit + skill safety review program.
- Homebrew/Snap/Flathub/AUR/WinGet packages.
- Docs site (https://docs.xraget.com or similar).

---

## PHASE AGENT HANDOFF TEMPLATE
### (Yeh text copy karke har naye agent ko phase shuru karne se pehle do)

```
You are the dedicated coding agent for XR Phase N: <PHASE NAME>.
You work one-phase-only. Do NOT touch code outside your scope.
Your mission is to complete Steps 1-7 below, in order. When done, Ahmad will
approve and you push a PR to branch phase/N-name. After that your job ends.

## STEP 1 — STUDY (do this first, before writing code)
Read these files IN ORDER. All paths relative to /home/user:
- /home/user/xr-IMPLEMENTATION-PLAN.md (this file, especially your phase section)
- /home/user/xr-DESIGN-SYSTEM.md
- /home/user/xr-THEME-SYSTEM.md
- /home/user/xr-SCREEN-BRIEFS.md (find the section for your screen)
- /home/user/xr-DEEP-DIVE-ARCHITECTURE.md (relevant portions)
Inspect these official brand assets (they are the source of truth for look/feel):
- /home/user/uploads/xr logo.png         (silver X, atomic ring, cyan core, black)
- /home/user/uploads/XR AVATAR .png      (front sentinel — smooth black helmet,
                                          almond cyan eyes no pupils, smooth cyan
                                          chest core, cyan-blue plasma energy
                                          trails, NO Iron-Man segmentation)
- /home/user/uploads/XR Aavatar side face 2 .png
- /home/user/uploads/XR Avatar side face.png
Preview your screen reference: /home/user/previews/<NN>-*.png
Then CD into the repo (/home/user/xr), git pull, open the current codebase,
inspect package.json, folder structure, existing components. Understand what's
already built from previous phases. Do NOT duplicate effort.

## STEP 2 — RESEARCH
Do targeted web research (3-6 queries) on:
- Latest stable versions of dependencies you need (Tauri plugins, npm libs).
- Competitive product UIs (name specific apps in the brief).
- FOSS library choices (license check: MIT/Apache-2 preferred, AGPL isolate in
  subprocess, CC-BY-NC avoid).
- Platform specifics (macOS / Windows / Linux) if your surface touches OS.
- Performance + accessibility best practices specific to your surface.
Take notes; summarize research briefly. Do NOT install anything yet.

## STEP 3 — PLAN
Write a concise plan to docs/phases/N-<name>.plan.md. Include:
- Files you'll create / modify
- Components list (name, props, state)
- Zustand stores needed
- Tauri commands / API events needed
- Data flow (short)
- Animations (exact Framer Motion values)
- Edge cases (empty/loading/error/offline)
- Manual test checklist
- What is explicitly OUT OF SCOPE (don't build other screens)
Summarize your plan to Ahmad in 10 lines chat and wait for any feedback before coding.

## STEP 4 — PREVIEW GENERATE
Generate 1-3 refined preview images for your screen with the generate_image tool.
ALWAYS pass 2-3 reference images from /home/user/previews/ (choose: chrome/
sidebar/topbar reference like 01-chat-screen.png, plus any relevant existing
preview of your screen) to keep logo, avatar, colors and chrome consistent with
the rest of the app. Use the OFFICIAL avatar style (smooth black helmet, almond
cyan eyes no pupils, smooth cyan circular chest core — not segmented).
Show Ahmad the preview. Wait for feedback. If Ahmad wants tweaks, regenerate.
Once approved visually, proceed.

## STEP 5 — IMPLEMENT
Code in the repo. Rules:
- Always use CSS custom properties (var(--accent) etc.) — never hardcode hex
  colors except in src/styles/themes.css token map.
- TypeScript strict mode. No `any`.
- shadcn/ui base components; extend; put screen-local components in
  src/components/<screen>/.
- Screen in src/screens/<Name>/index.tsx.
- Zustand stores slim, single-responsibility, in src/stores/.
- Tauri Rust commands in src-tauri/src/commands/ when needed.
- Framer Motion per design system spring defaults (stiffness 380 damping 28).
- i18n string keys for all user-facing text (English first).
- Keyboard shortcuts registered.
- A11y: aria labels, roles, keyboard nav, focus traps on modals.
- Pass lint (`bun run lint`), pass type-check (`bun run tsc --noEmit`).
- If a backend isn't ready yet, use mock data + placeholder Zustand stores
  marked with // TODO: real data — Phase N. Do NOT block on later phases.
- Tauri v2 only. NO Electron.

## STEP 6 — TEST + RUN
- bun install (if deps changed)
- bun tauri dev — start the dev server. Wait for it to boot.
- Run through your manual test checklist.
- Toggle all 5 themes; check your screen looks right in each.
- Resize window; check responsiveness.
- Keyboard tab through all interactive elements; confirm focus visible.
- Console should have zero errors, zero warnings (beyond unavoidable).
- Take screenshots of key states (empty, loading, populated, error) and save
  to /home/user/previews/implementation/phase-NN/.
- Start the dev server as a background process (start_process tool) so Ahmad
  can see a live preview URL.

## STEP 7 — APPROVAL + PUSH
- Present live preview URL + screenshots to Ahmad.
- If Ahmad requests changes: implement them, re-test, re-present.
- Once approved:
    git checkout -b phase/N-<name>
    git add .
    git commit -m "feat(phase/N): <short description>"
    git push -u origin phase/N-<name>
    Open a PR to main with: description linking to docs/phases/N-<name>.plan.md,
    before/after screenshots, summary of what changed.
    Tell Ahmad PR is ready. NEVER merge yourself.
- After that, your job is done. Thank you.

## OUT OF BOUNDS (do not do)
- Do NOT redesign the chrome/sidebar/topbar unless your phase specifically
  requires it (Phase 1 is the shell phase).
- Do NOT add themes beyond the 5 defined.
- Do NOT introduce new dependencies without explaining why (in plan).
- Do NOT use AGPL libraries in linked code (subprocess isolate only).
- Do NOT add confetti, emojis in desktop UI, fake loaders, or artificial delays.
- Do NOT push directly to main.
- Do NOT work on screens outside your phase.
```

---

## PHASE QUICK-REFERENCE TABLE

| # | Phase Name | Depends On | Rough Size | Key Deliverable |
|---|---|---|---|---|
| 0 | Repo cleanup + scaffold | — | S | `bun tauri dev` boots, theme vars, folder structure |
| 1 | App shell (sidebar/topbar/router) | 0 | M | 14 placeholder screens nav works, theme switch |
| 2 | Avatar + Logo components | 1 | S | Reusable sentinel in 7 states × 5 sizes |
| 3 | Splash + Onboarding (10 steps) | 2 | L | Fresh install boots → onboarding → chat <3min |
| 4 | Chat screen | 2, 3 | XL | Sessions list + streaming messages + composer |
| 5 | HUD command palette | 1, 2 | M | Global shortcut opens floating palette |
| 6 | Companion Orb | 2 | S | Draggable orb on desktop with 7 states |
| 7 | Approval modal + notifications | 1, 2, 4 | M | Trust modal works across surfaces |
| 8 | Settings (all tabs) | 1, 2 | L | Full macOS-style pref pane, theme switch real |
| 9 | Brain / Agent Trace | 1, 4 | L | Tree + Gantt live, virtualized |
| 10 | Workspaces + templates + multi-window | 1 | M | Grid + templates + spawn windows |
| 11 | Runs / Control Room | 9 | M | Virtualized table, live ticking, STOP ALL |
| 12 | Shield / Trust Center | 7, 11 | L | 4 tabs, approvals queue, audit log, toggles |
| 13 | Budget (UI + governor) | 8, 11 | L | Charts, sliders, hard cap enforcement on mock calls |
| 14 | Real LLM hookup | 4, 8, 13 | XL | Local Ollama + cloud providers streaming, real chat |
| 15 | Voice STT/TTS + wake word | 8, 14 | L | Mic, Whisper, Piper, voice loop |
| 16 | Voice Theater (immersive) | 2, 15 | M | Full-screen sentinel + rings + transcript |
| 17 | Builder (3-pane + Monaco + live preview) | 10, 14 | XL | Chat/Monaco/iframe with hot-reload sidecar |
| 18 | Research (deep) | 14, 12 | L | Sources panel + synthesized report + citations |
| 19 | Agents (prebuilt + custom + workflows) | 9, 14 | L | Grid + creator + React Flow DAG runner |
| 20 | Skills Store + quarantine | 12 | L | Registry, install flow, MCP subprocess runner |
| 21 | Memory Explorer | 14 | L | List + force graph + vector search |
| 22 | Integrations (OAuth) | 8, 20 | M | OAuth connect flow, connected skills live |
| 23 | CLI `@rrrtx/xr` npm package | 14, 13 | L | Standalone Node CLI published to npm |
| 24 | Telegram bot | 14, 7, 22 | M | Inline approval buttons, voice, attachments |
| 25 | VS Code extension | 14 | M | Side panel + code lens + status bar |
| 26 | Discord + WhatsApp bots | 24 | M | Slash commands + QR pairing |
| 27 | Tray + global shortcuts + updater + crash rec | 0-6 | M | Polished production chrome, auto-update |
| 28 | Mobile PWA companion | 14, 7 | L | iOS/Android home screen, push approvals |
| 29 | Multi-window polish | 5, 10 | S | Per-workspace windows, cross-window IPC |
| 30 | Business tier (SSO/admin/billing) | all core | XL | $15/user/mo paid features |

**Size guide:** S=1-2 days, M=2-4 days, L=4-8 days, XL=1-2 weeks (for a focused coding agent).
**Total rough estimate (Block 0 through M2 personal edition):** Phases 0-22 ≈ 8-12 weeks of agent-time for a competent agent, depending on how fast Ahmad approves. CLI + bots + VS Code ext (23-26): additional 3-4 weeks. Production polish (27-29): 2 weeks. Business tier (30): 4+ weeks.

---

## START HERE

Ahmad, to kick off, reply with "**Start Phase 0**" and I'll spin up the first dedicated agent with the full handoff brief (copy of the template above filled for Phase 0). Agent will study, research, plan, show preview, scaffold the repo, run the dev server, then present live preview for your approval before pushing the `phase/0-scaffold` PR.

After Phase 0 merges, say "**Start Phase 1**" for the next agent, and so on. Har phase ke liye naya agent, naya handoff, fresh context — koi bhi agent pichli phases ka context leak nahi karega except jo code/docs mein hai. 🔥
