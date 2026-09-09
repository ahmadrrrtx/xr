# XR — UX / PRODUCT EXPERIENCE AUDIT

**Brief:** "The system works in many places, but the UI/UX feels terrible, complicated, fragmented, and difficult to understand."
**Method:** every panel of the live dashboard exercised in a real browser (DOM + rendered text captured); CLI help/status/doctor/onboarding flows run; TUI shell driven through a PTY; competitive research against OpenClaw, Claude Code, Cursor, Raycast, Linear, Vercel, and 2026 agent-UX pattern literature.
All quotes below are **actual rendered output** from this audit session.

---

## PART A — WHAT THE USER ACTUALLY EXPERIENCES TODAY

### A1. First run (the first ten minutes)

1. `npm i -g @rrrtx/xr` → **dies** with `env: 'bun': No such file or directory` on Node-only machines (see NPM_AUDIT). For those who get past it:
2. `xr` (no args) → "XR: fullscreen Shell requires an interactive terminal." — fair fallback in CI, but on a real terminal the first thing the Shell shows is a **modal demanding a workspace selection** when only one workspace exists ("Select a workspace, then press Enter. Esc dismisses.").
3. `xr status` → a wall of 20 mixed ✓/!/✗ lines where the three most important facts for a new user (no model configured, no key stored, nothing can run yet) are buried between "Package manager ✓ bun" and "Voice tools ! ffmpeg=no, whisper=no, piper=no".
4. `xr "hello"` (no provider) → honest error + a genuinely good resume hint — **but** the same failure shows the model picker contradiction ("LM Studio (Local) → fallback Ollama (Local)" while status said "openai / gpt-4o-mini").
5. `xr serve` → dashboard opens on **Home: "XR Operating Console"** with a 12-tile "System Health Bento Matrix", a readiness banner, four KPI cards, a command palette hint, and a sidebar of **26 panels**. Onboarding wizard exists but is not the landing experience.

**Net first impression:** the tool works, but it presents itself as an air-traffic-control system for a problem the user hasn't got yet.

### A2. The model question — asked and answered four different ways

On the **same fresh install**, simultaneously:

- Dashboard header: `openai / gpt-4o-mini  OFFLINE`
- Dashboard Home bento tile 1: `PROVIDER STATUS — ollama — Active Route`
- Dashboard Home bento tile 2: `ACTIVE MODEL — phi3:mini`
- Dashboard Models panel: `ACTIVE MODEL PRIMARY openai / gpt-4o-mini · Primary route · local runtime ollama · routing hybrid`
- CLI `xr providers`: `active … ollama (qwen2.5:7b) · routing … hybrid · selected … ollama/qwen2.5:7b (automatic)`
- Run banner: `Mock/LM Studio (Local) → fallback Ollama (Local)`

Six answers. The routing "why" string reads like a debug log: *"difficulty=0.5 (standard): no task text — requirements-only estimate — tool-use required — difficulty=0.5 (standard) floor=0.60; class match: chat; quality from static prior (unmeasured); cost-weighted mode"*.

**This is the single largest source of the "feels terrible" verdict.** Everything else is secondary to fixing the model story.

### A3. Information architecture — the 26-panel flatline

The dashboard sidebar (flat, single level, no grouping):

> Home · Chat Sessions · Recent Sessions · Workspaces · Providers (BYOK) · Models (Local AI) · Memory · Research Runs · Voice Pipeline · Skills Marketplace · Sandboxed Plugins · Capability Ecosystem · MCP Servers · Business OS CRM · Computer Control · Shield (Security) · Audit Log · Cost & Budget · Files & Artifacts · Downloads Security · Devices Link · Scheduled Tasks · Webhooks API · Alerts Hub · Core Settings · About Build

Overlaps and confusions:

| Cluster | Panels | Problem |
|---|---|---|
| Sessions | Chat Sessions · Recent Sessions | Two panels for one table; "Chat Sessions" is the chat, "Recent Sessions" is the history — names don't say that |
| Model config | Providers (BYOK) · Models (Local AI) | One question ("which model?") split across two panels with different vocabularies; Providers panel also contains "Local Models" section (a third place) |
| Extensions | Skills Marketplace · Sandboxed Plugins · Capability Ecosystem · MCP Servers | **Four systems** for "add capabilities"; a normal user cannot say what differs between a skill, plugin, capability, or MCP server |
| Security | Shield (Security) · Audit Log · (trust lives in Settings) | "Shield" (host hygiene/EDR) vs audit (action log) vs trust (isolation) — three true concepts, one named panel, jargon everywhere |
| Files | Files & Artifacts · Downloads Security | The second is a link to a Shield sub-scanner |
| Devices/integrations | Devices Link · Webhooks API | Both are marketing placeholders (see A5) |
| Fake/empty | Business OS CRM · Voice Pipeline · Downloads Security · Alerts Hub | Dead weight in primary navigation |

**Rule violated:** an IA must answer "where do I do X?" in one hop. Today, "change my model" has three entry points, "see what the agent did" has three, "add a capability" has four.

### A4. Dead, fake, and broken panels (trust killers)

Verified during this session:

1. **MCP Servers** — always "No Model Context Protocol connections registered." even when one is registered via CLI (API 404s, error swallowed).
2. **Audit Log** — every entry renders `ts: Invalid Date`.
3. **Business OS CRM** — fresh install shows "CUSTOMER PIPELINES 12 · INVOICES AUDITED $4,850 · WORKFLOWS TRIGGERED 84" for a feature that moved to a satellite package.
4. **Webhooks API** — "127.0.0.1:3141/api/webhook — Status: Listening" for a server that does not exist; its "Integrate Port" button fires a toast that says "VS Code API port listening on 127.0.0.1:3141".
5. **Home bento** — "MCP HEALTH: Healthy" (dead API) and "COMPUTER USE: Authorized · Jarvis permissions" (never authorized; "Jarvis" is leftover codename copy).
6. **Models** — local runtimes list shows Ollama at `http://127.0.0.1:1`, Jan/LocalAI at Ollama's port.
7. **Automation** — instructs the user to run `xr cron add …`, a command that does not exist.
8. **Voice Pipeline** — honest placeholder, but occupies a top-level nav slot.
9. **Devices Link** — pure marketing copy ("Integrate Termux prompt on Android devices to access models, CRM, and files remotely via Telegram") with an "Integrate Port" toast button.

A user who hits two of these in the first session rationally downgrades their trust in *every* green checkmark on screen — including the ones that are real (audit chain, budget caps, approvals). **In a product whose tagline is "the agent you can actually trust", a fake "Listening" badge is worse than a missing panel.**

### A5. The chat surface (the most important screen)

What's good: streaming works (SSE, status chips, tokens); slash-command hints (`/status /budget /memory /plan`); attachment picker; mode chips; workspace indicator; "Esc interrupt".

What confuses:

- **Default mode is `ask`** (read-only) while the CLI defaults to `agent`. A first-time dashboard user asks "refactor this file" and the model *can't act* — and nothing on screen explains that the mode chip is why.
- Sidebar chips: `MODELS PROVIDERS SKILLS MEMORY SECURITY BUDGET RAG MEMORY ⌁ CONTROL` — two different "memory" chips (`MEMORY` and `RAG MEMORY`), a glyph-only chip (`⌁ CONTROL`).
- The sessions feed shows a synthetic "Primary conversation thread · 0 messages · 1s ago" placeholder that looks like real state.
- **Tool activity lives inside the transcript** ("TOOL TIMELINE — No tool executions recorded yet" in the sidebar, while runs stream in the middle). There is no dedicated activity view per run — the 2026 agent-UX consensus is exactly the opposite (activity timeline **separate** from the conversation).
- **Approvals**: the durable approval store exists and works cross-process — but the dashboard approvals widget read "No pending authorizations" while an approval raised by a CLI run was live. The killer feature (approve from anywhere) is built in the backend and not surfaced.

### A6. CLI UX

- `xr --help` = ~100 lines, 9 sections, ~40 verbs, including commands that print "MOVED to @rrrtx/business-os". Help is a system map, not a getting-started path. (The top "Quick start" 5-liner inside it is good — it should *be* the default help.)
- Terminology mismatch across surfaces: "Control Center" (CLI) vs "XR Control" (dashboard header) vs "XR Unified AI OS Control Center" (About panel) vs "Mission Control" (website `<title>`).
- Errors: best-in-class when pre-mapped ("Why / Fix / See" template, e.g. unknown triggers subcommand) — worst-in-class when unmapped (raw zod JSON from `mcp add`; "Retry the command" as the fix for a syntax error).
- Exit codes inconsistent (`ask` 0 on failure, `run` 1).

### A7. TUI shell

- Startup modal (workspace picker) blocks every launch.
- Session list inside the modal shows error/failed one-shots with no filter/clear.
- The state model (views: home/chat/sessions/research/notifications/settings + palette + agent detail + notices + timeline) is dense; the "letter shortcuts navigate" affordance is power-user-only.
- Good bones: slash commands, Alt+P model switch, status bar with live model. Fixable within the existing design.

### A8. Visual system

- Dark-first, cyan brand accent, consistent stat-card grid — genuinely coherent CSS-token system (`style-tokens.ts`).
- Density is high everywhere (bento tiles use 2-line microcopy per tile: "Citation planning", "Jarvis permissions", "RAG semantic db").
- Typography/spacing consistent. Light theme "planned" (About panel admits dark-first).
- The 1.34MB page (1.25MB inlined brand images) is a perceptible first-load cost even on localhost.
- Mobile: no evidence of responsive design intent beyond viewport meta; panels are desktop grids. About panel lists planned features but not responsive behavior.

### A9. Accessibility

Real, creditable effort: skip link, aria-current nav, palette as combobox/listbox with focus trapping tests, WCAG 2.2-tagged axe suites (19 a11y tests exist but **skip** when a browser isn't available — and the panels that broke (MCP, audit timestamps) are exactly what those suites would have caught if they ran in CI).

---

## PART B — ISSUE REGISTER (CURRENT EXPERIENCE / WHY BAD / CONFUSION / BETTER PATTERN / PRIORITY)

Format: **[P0–P3]** · area — issue.

1. **[P0] Model identity** — six different answers to "which model is active?" (A2). *Confusion: "what is running my task and what will it cost?"* → **Pattern:** one `ActiveModelCard` (provider, model, cost/hr estimate, why-selected in one human sentence) rendered identically in dashboard header, chat composer, CLI status bar, TUI status bar; everything else links to the model picker. Priority: **P0 — fix before any visual redesign.**

2. **[P0] First-run path** — install can die (Bun), first screens are status walls and bento matrices. → **Pattern:** OpenClaw-style single onboarding: (1) pick a model (local autodetect / paste key / custom URL) → (2) one test call with visible success/failure → (3) set budget → (4) land in **Chat**. The dashboard already has an onboarding wizard — it must be the default landing when `needsSetup=true` (the API already returns `needsSetup: true`).

3. **[P1] 26-panel flat nav** (A3). → **Pattern:** ≤7 grouped areas (see §D): Chat, Runs, Extensions, Guardrails, Memory & Context, Files, Settings. Everything else is a tab, drawer, or palette destination.

4. **[P1] Four extension concepts** (skills/plugins/capabilities/MCP). *Confusion: "I installed a skill and it's also a capability? Is an MCP server a plugin?"* → **Pattern:** one **Extensions** area with `kind` badges (Skill / Tool / Connector / MCP), one install flow, one permission dialog, one marketplace list. Keep the four engines under the hood.

5. **[P1] Fake/dead panels** (A4). → **Pattern:** no panel without live data; delete or gate behind "experimental" flags; lint rule banning literal metrics in templates.

6. **[P1] Approval experience** — CLI preview starved of args ("(no path in args)"); dashboard approvals widget blind to live approvals; no "yes-always for this tool/dir" memory; `(auto-deny in 300s)` text that actually denies instantly headless. → **Pattern (Claude Code):** permission modes + per-action `Yes / Yes-always / No / Edit`; **Pattern (2026 agent UX):** approval queue with full context (what's done, what's next), batch review, risk-tier coloring; typed-confirm for tier-2 stays.

7. **[P1] Chat default mode trap** (`ask` default). → **Pattern:** default `agent` with the approval gate (that's XR's differentiator!), mode switcher as a prominent segmented control on the composer, first switch shows a one-screen explainer.

8. **[P1] Activity invisible** — tool calls blur past inside the transcript; "TOOL TIMELINE" sidebar shows session-scoped history only. → **Pattern:** per-run **Activity timeline** (status chips already exist in the event stream: `provider_selection → generating → tool_running → awaiting_approval → done`) + "jump to artifact" links + collapsible verbosity. XR's backend already emits every event needed.

9. **[P2] Status/doctor duplication + wall-of-checks** (A1.3). → **Pattern:** doctor = diagnostics (expert surface, `--json`, exit codes); status = one glanceable card: *Ready to work? Yes/No + the single blocker + model + budget.* Everything else behind `-v`.

10. **[P2] Routing "why" is machine prose** (A2). → **Pattern:** one sentence + expandable detail: "Using LM Studio (local, free) because no cloud key is set. → Change". Keep the debug string behind a "details" disclosure.

11. **[P2] Providers panel double dropdown** — the 26-provider list rendered twice as raw `<select>`s. → **Pattern:** searchable command-palette-style picker (type-ahead over provider+model), favorites, "test" inline.

12. **[P2] Budget panel vocabulary** — "HIGHEST MODEL SPEND: Ollama (Local) → fallback LM Studio (Local)"; per-task vs monthly vs daily caps scattered across Budget panel, Settings, onboarding. → **Pattern:** one Spend view: current task meter (live), this month bar, caps editor; model names as model names.

13. **[P2] Terminology inventory** (rename or hide): Capability Ecosystem→(hide), placement backends→(hide), trust tiers→"isolation", Shield→"Host Safety", Dojo→"Injection Test Lab", Bento Matrix→(gone), Control Center/XR Control/Mission Control→**one name**, "WORKS-NOW/SETUP-REQUIRED/DISCOVERED"→status chips with tooltips, "⌁ CONTROL"→label.

14. **[P2] Session/run confusion** — "Chat Sessions" vs "Recent Sessions" vs `xr session` vs `xr execution` (durable-execution recovery status — its own CLI command!). → **Pattern:** one concept: **Run** (a task execution with status); chat threads group runs. `xr execution` becomes "xr runs --durable" detail.

15. **[P2] Empty states that lie** — MCP "No servers" (dead API), webhook "Listening" (fake), chat "0 messages · 1s ago" placeholder. → **Pattern:** every empty state states the *action* that fills it ("No MCP servers yet — Add one" wired to a working dialog).

16. **[P2] Payload/perf** — 1.34MB HTML + 580KB CSS + 157KB JS + 256KB/724KB API payloads on panel open. → **Pattern:** external cached assets, gzip, paginate, lazy-load panels, drop inlined brand art (logo SVG, not 1.25MB PNG).

17. **[P3] Keyboard** — palette exists (⌘K / "?"), letter shortcuts in TUI; dashboard lacks: `/` focus chat, `j/k` lists, `?` cheatsheet, Esc discipline. → **Pattern:** Linear/Raycast keyboard map, documented in one place.

18. **[P3] Copy tone** — "Jarvis permissions", "The AI Agent You Can Actually Trust" inside status output, "EDR endpoint checking". → **Pattern:** plain, security-serious copy; the trust story lives in the audit chain, not adjectives.

19. **[P3] Accessibility rungap** — a11y suites skip without browser; palette focus-trap tests skipped. → **Pattern:** run the browser suite in CI (Playwright already a dev dep); axe on every panel in PR checks.

20. **[P3] Mobile** — no responsive story. → **Pattern:** declare desktop-first, but make Chat + Approvals usable on a phone width (the two surfaces a remote user needs; XR even has a Telegram path for this).

---

## PART C — COMPETITIVE RESEARCH (what "good" looks like in 2026)

### C1. OpenClaw (the stated benchmark)

OpenClaw's gateway ships a dashboard on the same single port as its WebSocket API; third-party dashboards are a cottage industry. What to copy (patterns, not pixels):

- **Four core areas** — Agents, Conversations, Channels, System — vs XR's 26 panels. The discipline is the lesson: OpenClaw's surface maps to the *user's* mental model, not the codebase's module chart.
- **One command = one UI page** philosophy (community dashboards): every CLI verb reachable visually, no orphan UI (XR's dead MCP panel is the anti-pattern).
- **Operational honesty knobs**: read-only dashboard mode, hideable sections, prefixed gateway tokens (`ogt_…`), session timeouts as config. XR has the token part; section visibility/read-only are cheap wins for teams.
- **Live system strip**: always-on host/runtime health with threshold coloring; smart alerts banner for cost spikes/failed crons. XR has the data (shield, budget) but spreads it over 4 panels.
- **Ecosystem posture**: OpenClaw treats the dashboard as replaceable; XR's 157KB string-concatenated client is monolithic. A documented API + thin client enables the same ecosystem.

### C2. Claude Code (permission UX gold standard)

- **Permission modes**: `plan` / `default` / `acceptEdits` / `auto` / `bypassPermissions` — a *mode dial*, not per-prompt fatigue. XR already has modes (agent/plan/ask) but they're conflated with read-only-ness; XR's approval tiers (tier0/1/2) are actually finer-grained than Claude Code's — they're just invisible.
- **Per-action choices**: `yes / yes-always / no` (+ edit). XR's durable approval store is *more* capable (cross-process, TTL, audited, argsHash-ready) but exposes **none** of it: no yes-always, no queue, no batch.
- **Plan mode as a product surface** (approve the plan → then execute) maps perfectly onto XR's `plan` mode + approval store; today `xr plan` just prints steps.

### C3. Cursor / Raycast / Linear / Vercel

- **Cursor**: model picker as a first-class, always-visible control with per-task override; XR equivalent = the unified ActiveModelCard + palette command.
- **Raycast**: command palette as the *primary* navigation surface; sparse chrome; every action searchable; "type `>` for commands". XR already built a palette — demote the sidebar and promote the palette.
- **Linear**: density without clutter (36px rows, no decorative chrome); keyboard-first; state colors reserved for meaning only. XR's stat-card grids are dense but noisy (2-line microcopy, decorative glyphs); cut the microcopy.
- **Vercel**: progressive disclosure done honestly — summary up top, logs one click deep, empty states that teach. XR's bento is the opposite (everything at once, half of it fake).

### C4. Agent-UX pattern literature (2026)

Consensus patterns XR should adopt wholesale:

1. **Activity timeline separate from the conversation** — conversation is for intent/feedback; activity is an auditable log of tool calls, decisions, artifacts. (XR has every event; no UI.)
2. **Permission gate queue** — pending approvals with full context, sorted by risk, batch-approvable, destructive ops visually distinct.
3. **Receipts** — every consequential action leaves a reviewable artifact (XR's audit chain *is* the receipt system; surface it per-run, not as a global 50-row table).
4. **Progressive delegation** — remember approval patterns; suggest "you've approved write_file in this dir 9 times — always allow here?" (XR's argsHash was built for exactly this and is fed `sha256:none`.)
5. **Human checkpoints as designed gates** (approve plan / approve execution / approve exceptions) rather than interrupts.
6. **Structured errors: what/why/next** — XR's CLI does this when errors are pre-mapped; make it the universal format, including dashboard toasts.
7. **Maturity model**: chat-only → guided agent (taskboard+timeline+controls+gates) → trusted autonomy. XR's backend is level-3; its UX is level-1.

---

## PART D — RECOMMENDED UX ARCHITECTURE

### D1. One mental model

> **XR runs Tasks. A Task is a conversation with an agent that may use tools under your rules. Everything else — models, extensions, memory, budgets, audits — is configuration or evidence about Tasks.**

### D2. Navigation (dashboard) — 7 areas

```
Chat                 default landing; composer + activity timeline + receipts per run
Runs                 all executions (incl. durable/checkpointed), statuses, resume
Extensions           one marketplace: Skills | Tools/Plugins | Connectors | MCP (+ permissions)
Guardrails           Approvals (queue+history) · Budget (live meters) · Audit (per-run receipts) · Host Safety (Shield)
Memory               durable memory browser + context inspection (merged)
Workspaces / Files   workspace switcher + read-only browser (kept, with node_modules hidden)
Settings             model & routing (the ONE picker), providers/keys, general, advanced (trust/env — collapsed)
```

Deleted as nav items: Business CRM, Voice (moves to Settings→Voice), Downloads (Guardrails→Host Safety tab), Devices (Settings→Integrations), Webhooks (Settings→Integrations; hidden until a real route exists), Alerts (toast center + Guardrails), About (Settings→About).

### D3. The four screens that matter

1. **Chat** — composer with mode segmented control, ActiveModelCard inline, streaming transcript, right rail = live activity timeline for the current run; approval cards render inline with Yes/Yes-always/No and full structured diff (once P1-1 fixed).
2. **Run detail** — timeline, every tool call with args/result/duration, cost meter, artifacts, "verify receipt" (audit link), resume/branch actions.
3. **Model picker** (one, everywhere, Alt+P / ⌘K → "model") — searchable: local runtimes (with detected status), presets (with live pricing), custom endpoints; one-click test; the routing strategy as three plain-language options (Prefer local / Prefer cloud / Exactly this) with the "why" one-liner.
4. **Approvals** — queue (pending, sorted by risk), history (searchable, from the durable store), rules ("always allow X in workspace Y" — the progressive-delegation pattern).

### D4. Component system

Keep the existing CSS-token discipline; add:

- `ActiveModelCard` (single source of routing truth, rendered everywhere)
- `RunTimeline` (event stream → vertical timeline; chips from `ux-status.ts` vocabulary — already canonical)
- `ApprovalCard` (risk-tiered, structured preview, batch selection, typed-confirm for tier2)
- `StatCard` (one number, one label, one delta — kill the two-line microcopy)
- `EmptyState` (icon + one sentence + primary action, never fake data)
- `ErrorBanner` (what/why/next, from the CLI's error template)
- `CommandPalette` (promote to primary nav; fuzzy over panels+actions+models+skills)
- `KeyHint` layer + `?` cheatsheet modal

### D5. CLI/TUI harmonization

- Default `xr` help = the 5-line quick start + "run `xr help --all` for the system map".
- One name for the web UI everywhere ("XR Dashboard").
- Consistent verbs: `add/remove/list/status` for extensions; `create/list/pause/resume` for triggers (kill the `cron` alias mismatch with dashboard copy).
- Exit-code contract documented in `xr help --exit-codes`.
- TUI: skip single-workspace modal; `/` palette parity with dashboard; status bar = ActiveModelCard.

### D6. Accessibility & responsiveness

- Run the skipped browser/axe suites in CI (they would have caught the MCP/audit-panel bugs).
- Keyboard map documented once; palette focus trap already tested — keep.
- Responsive floor: Chat + Approvals usable at 375px (remote-approval is a real XR scenario via Telegram already).

---

## PART E — PRIORITY SUMMARY

| Priority | Theme | Items |
|---|---|---|
| **P0** | Truth | Unified model card (kills the 6-answers problem); onboarding as landing; kill fake panels |
| **P0** | Trust | Approval args + queue + yes-always; chat default mode |
| **P1** | Structure | 26→7 nav; Extensions unification; Runs+receipts; activity timeline |
| **P1** | Correctness | exit codes, flag hygiene, error template everywhere |
| **P2** | Speed | payload diet, caching, pagination |
| **P2** | Voice | terminology pass, copy tone, empty states |
| **P3** | Reach | responsive floor, keyboard cheatsheet, light theme |

**The goal restated:** OpenClaw-level usability means: *one port, one dashboard, ≤7 areas, every panel truthful, the model story in one card, approvals as a designed surface, and the audit chain visible as receipts on every run.* XR's backend already has 80% of what this needs — the work is composition and deletion, not new machinery.
