# XR 3.1A — Product Experience Audit
> Evidence-based audit of the current XR product surface.
> All findings are grounded in files in the `ahmadrrrtx/xr` repository (commit at time of audit, July 2026).

---

## 0. Audit methodology

Surfaces examined (code + live where possible):

1. **CLI entry and help** — `src/index.ts`, `src/commands/help.ts`, `src/interfaces/cli.ts`
2. **Onboarding** — `src/interfaces/onboard.ts`, `src/commands/install.ts`
3. **TUI** — `src/interfaces/tui.ts` (1,522 lines)
4. **Dashboard** — `src/daemon/dashboard.ts` (3,024 lines of inline HTML/CSS/JS)
5. **Daemon/API** — `src/daemon/server.ts`
6. **Website** — `website/app/page.tsx`, `website/app/marketplace/page.tsx`, `website/SPEC.md`, vercel deployment
7. **Design system** — `src/ui/theme.ts`, `src/ui/layout.ts`, `src/ui/brand.ts`, `src/ui/spinner.ts`
8. **README + changelog + stage docs** — `README.md`, `CHANGELOG.md`, `docs/XR-3.1-*.md`, `docs/planning/*`
9. **Extensions** — `extensions/vscode/extension.js`
10. **Brand assets** — `assets/logo.png`, `assets/avatar.png`
11. **Website live** — https://xr-gules.vercel.app (audited via fetch)

The repository is at version **3.1.5**. Roughly half of XR 3.1 (the "polish release") has been implemented as part of prior stages: TUI rewrite, boot fast-paths, onboarding refresh, and dashboard data-integrity fixes. What remains — and what this document specifies — is the **architectural coherence** that ties these surfaces into one product.

---

## 1. The good (do not regress)

Before enumerating problems, the following things work well and must be preserved:

1. **Truly remarkable backend breadth.** 12+ providers, local Ollama, multi-agent, skills runtime, MCP, plugins, voice, research, computer control, Telegram bot, Business OS — all in one codebase, one binary. This is XR's moat.
2. **Strong security story, honestly implemented.** Hard spend ceiling enforced before every model call (`src/cost/governor.ts`), SHA-256 hash chain audit log, injection defense lab, egress allow-list, approval gates. These are not marketing claims; they exist in code.
3. **Design token layer exists.** `src/ui/theme.ts` defines brand palette, ANSI tokens, CSS vars, spinner frames, layout constants — a real design system, not ad-hoc colors.
4. **Official brand assets are strong.** `assets/logo.png` (XR wordmark with cyan→violet gradient over shield) and `assets/avatar.png` (cybernetic guardian with visor glow) are distinctive, high-quality, and consistent with the "AI agent you can actually trust" positioning.
5. **TUI reboot is structurally right.** `src/interfaces/tui.ts` uses alternate screen, has a three-pane layout (sidebar / center / inspector), command palette, notification center, startup workspace picker, slash commands — the skeleton of a real terminal product is there.
6. **Dashboard is self-contained and offline-safe.** Zero external dependencies, single HTML string, CSP-locked, bound to localhost only with a bearer token. Correct security posture.
7. **CLI approval and budget prompts are well-designed.** `approvePrompt()` and `overBudgetPrompt()` in `src/interfaces/cli.ts` show context, tool name, reason, preview, and default clearly.
8. **Onboarding is four clean steps.** Mode → local model → cloud keys → security/budget. Good skeleton.

---

## 2. CLI surface audit

File of record: `src/index.ts`, `src/commands/help.ts`, `src/interfaces/cli.ts`, 27 command files in `src/commands/`.

### 2.1 Entry point
- ✅ `xr` (no args) now opens TUI — correct.
- ✅ `--version`, `help`, `serve` are fast-pathed (no kernel boot).
- ⚠️ `xr "<task>"` still boots the full kernel even for a single one-shot task. Perceived latency: kernel bootstrap + provider health check before any output.
- ⚠️ There is no single, canonical "run this task and stream output back to my shell without entering the TUI" flow that matches the ergonomics of `claude -p` or `aider --message`. The current one-shot goes through the full agent loop but outputs raw `say()` lines with no framed structure.

### 2.2 Command taxonomy
There are **29 top-level commands** registered in `registerCommands()`:

```
run (default), install, onboarding, doctor, status, repair, update, reset,
config, budget, providers, models, voice, speak, listen, control, research,
memory, plugins, plugin (run), mcp, skills, skill (alias), agents, shield, workspace
```

Problems:

- **Naming is inconsistent.** `providers` (plural noun) vs `plugin` (singular run) vs `memory` (singular noun) vs `control` (verb) vs `research` (verb). No consistent noun-vs-verb grammar.
- **Hidden surfaces.** "Chat" doesn't exist as a command; you reach it via `xr serve` + browser. "Dashboard" isn't a command; again `xr serve`. "TUI" is the default but not named anywhere in help as "shell."
- **Overloaded flags.** `--tui`, `--computer`, `--budget`, `--mode` are scattered across entry points. There is no `--chat`, `--web`, `--resume <session>`.
- **Help is long and not searchable from the terminal.** `xr help` dumps ~120 lines. Good reference, bad discovery.

### 2.3 Output grammar
CLI output uses three different "modes" depending on code path:

1. `xr "<task>"` → streams `say()` lines prefixed with `▸` / `◆` / checkmarks (via `core/agent.ts` and `cleanAgentLine`)
2. `xr providers list` etc. → uses `kv()` / `table()` / `box()` from `src/ui/layout.ts` (neat, framed)
3. `xr onboarding` → uses `StepTracker` + `kv()` + `banner()` (another visual dialect)

These three dialects use the same color tokens but **different spacing, framing, and rhythm**. A user running `xr status` followed by `xr "do something"` will feel like they're using two different tools.

---

## 3. TUI audit

File: `src/interfaces/tui.ts` (1,522 lines).

### 3.1 What works
- Alternate-screen lifecycle (`?1049h`/`l`) is correct.
- Startup overlay with official asset rendering is premium.
- Sidebar/center/inspector three-pane layout is the right skeleton.
- Command palette (Ctrl+K) exists.
- Notifications (Ctrl+N), quick actions (Ctrl+J), workspace picker (Ctrl+W) exist.
- Slash commands cover the main intents.

### 3.2 Problems

**P1 — Rendering model is a full-screen re-render on a 100ms ticker.**
`renderFrame()` rebuilds every line of the UI and writes `clearScreen + frame` every state change or tick. There is no damage region, no diffing, no throttling beyond the 100ms interval. On slower terminals (SSH, mosh, Windows conhost), this produces the signature "jitter" the current TUI is known for. Claude Code and Lazygit both use diff-based rendering (Ink, Ratatui, or hand-rolled).

**P2 — Composer is 2 rows with no real editor.**
Input is a single string buffer supporting printable chars, backspace, and up/down history. There is no:
- Cursor movement (left/right arrows move between sidebar items, not within input — see comment in handleData)
- Word-wise movement (Alt+B/Alt+F)
- Line kill (Ctrl+U), word kill (Ctrl+W)
- Paste bracketing
- Multiline composition (Shift+Enter is not handled)
- Tab completion of slash commands, files, skills

Compare to Claude Code which supports full readline, Ctrl+X Ctrl+E (edit in $EDITOR), Shift+Enter newlines, /-command tab completion, @-file mentions, and image paste.

**P3 — Chat view shows only the last 12 messages.**
`state.chat.slice(-12)` means history beyond 12 messages is invisible. No scrolling, no pagination, no search. This is a serious regression from "operating system" ambition.

**P4 — Inspector panel duplicates the activity timeline.**
Both the inspector and the activity view render `state.timeline`. Information is duplicated but presented with different densities. A single "what's happening" surface with proper severity filtering would be better.

**P5 — No live streaming of assistant output.**
`runTask()` calls `say()` with agent lines and routes them into chat via `updateOrAppendAssistantMessage()`, which accumulates the *final clean line* but doesn't stream tokens character-by-character into the chat bubble. Compare to Claude Code which streams tokens into the active block in real time, with a blinking cursor.

**P6 — Status bar is 1 line but doesn't update during async work consistently.**
The status bar shows spend/tokens/provider, but during `runTask()` it doesn't show per-step progress (e.g., "calling shell · ls -la").

**P7 — Confirm overlay Y/N handling is confusing.**
`handleEnter` always takes `defaultYes`, and the `n` key only works when the overlay is "confirm" and you press lowercase "n". Ctrl+C always exits. There is no arrow-key focus on Approve/Deny buttons.

**P8 — Keybindings conflict with standard terminal muscle memory.**
- Ctrl+J (newline in most Emacs readline) opens Quick Actions
- Ctrl+N (next line / down) opens Notifications
- Ctrl+W (kill word) opens Workspace Picker
- Tab cycles views instead of completing input

This is a major discoverability problem. Power users expect readline to work. Claude Code preserves Ctrl+A/C/D/K/U/W readline behavior and uses Ctrl+Shift combos for global actions; Warp uses Cmd/Ctrl+K for palette but doesn't hijack Ctrl+W.

**P9 — "Home" view is a bento grid of boxes** that doesn't tell the user what to do next. It's a status dashboard, not a launch surface. There is no "resume last task," "start a new task," "run command," or "recent skills" entry point.

**P10 — No persistent terminal/shell access.**
The TUI is a chat + views shell. There is no panel that gives you a real shell (a`la Warp's blocks, or k9s's `:sh`). Users running XR for computer control want to see a live shell feed of what XR is doing.

**P11 — No multi-session visibility in chat.**
You can see sessions in the Sessions view, but you can't switch between them from within chat, or have two sessions in parallel. There is a single `state.chat` array.

**P12 — Colors are hardcoded to dark** and there's no provision for light themes, high-contrast, or 16-color fallback beyond the `!isTTY` branch that just doesn't render the TUI.

---

## 4. Dashboard audit

File: `src/daemon/dashboard.ts` (3,024 lines of inline HTML/CSS/JS in a tagged-template string).

### 4.1 What works
- 17 panels covering the full feature surface (dashboard, chat, sessions, status, budget, workspaces, providers, models, memory, research, plugins, skills/marketplace, voice, security/shield, audit, settings, control).
- Marketplace panel is visually strong: hero gradient, category sidebar, grid of cards, inspector pane. This is the highest-UI-density panel in XR and it looks intentional.
- Security/Shield sub-tabs (processes, startup, downloads, browser, lab) are a coherent mini-product.
- Command palette (⌘K) with fuzzy filtering.
- g+<key> Vim-style navigation.
- Live 30-second polling.
- Chat UI with markdown-ish formatting (code, bold, newlines).

### 4.2 Problems

**P1 — The HTML is a 3,000-line string with zero componentization.**
There is no way to test, reuse, theme, or evolve this safely. Every panel is a `<div class="panel" id="panel-…">` with hand-wired `onclick` attributes. This is the single biggest maintenance risk in the product surface. The design system documented later requires a proper component layer even if it stays inline (e.g., function components returning strings — this is Bun so SSR-style components are free).

**P2 — Chat streaming is fake.**
`/api/chat` in `server.ts` calls `provider.chat(messages, [])` (non-streaming) and returns a single SSE `data:` event with the full text when done. The UI uses a ReadableStream reader but receives the whole answer in one chunk. There is a typing indicator, but no token streaming. This is the #1 perceived-performance issue.

**P3 — 7 fetches on dashboard load, all independently spinnified.**
`loadDashboard()` does `Promise.allSettled` on 7 endpoints, and each card shows its own spinner if its promise rejects late. The user sees 3–4 spinners at different times. Compare to Linear/Vercel which render a skeleton shell immediately and fill cards as data arrives, never showing per-card spinners after first paint.

**P4 — Layout has two visual dialects on one page.**
The dashboard panels use `card` / `stat-row` / `grid` (sparse, muted, Inter). The Marketplace panel uses `mp-hero` / `mp-skill-card` / `mp-orb` (bright, gradient, animated). Dropping from Dashboard into Marketplace feels like opening a different product.

**P5 — Sidebar groups are 4 arbitrary sections with emoji icons.**
- Workspace: Dashboard 💬 Chat 🕘 Sessions ◎ Status 💰 Budget 🗂 Workspaces
- Configuration: ☁ Providers ⚙ Models 🧠 Memory
- Features: 🔬 Research ⚡ Plugins 🧩 Marketplace 🎤 Voice
- Trust: 🔒 Security 📜 Audit ⚙ Settings

Problems:
- "Status" is a sub-concern of Dashboard, not a peer.
- "Budget" is trust/control, not workspace state.
- Memory spans Configuration and Features and Trust.
- "Settings" is a dumping ground, not a trust section.
- Emoji icons are inconsistent in weight and don't match the brand language (XR's brand uses geometric/cybernetic glyphs, not smileys).
- The same section model is **not reflected in the TUI**, which uses `VIEW_ORDER = [home, chat, sessions, workspaces, context, activity, logs, settings]`. Different sections, different names, different order.

**P6 — Chat panel has no slash command parsing, no /mode, no /model, no /budget.**
The web chat has hint chips for `/plan /status /research /ask /memory /budget` but sending them sends literal text to the provider. They aren't interpreted. The TUI has real slash commands. This is a major feature parity gap.

**P7 — No file/context attachment in chat.**
The web chat has a textarea + Send button. No drag-drop, no @mention, no file attach, no image paste. Compare to Claude Code's Ctrl+V (image), ChatGPT's paperclip, Cursor's @file/@doc.

**P8 — No tool-call visualization.**
There's a `.msg-tool` CSS class but it's never populated. When XR calls a shell command or writes a file, the chat just shows the final answer. The TUI has a tool-call line; the dashboard doesn't.

**P9 — Topbar chips show state but don't act as controls.**
The provider chip says "ollama / qwen2.5:7b" but clicking it does nothing. You can only change providers in the Providers panel. Chips should be clickable to open a quick-switcher (like Warp's model picker, Claude Code's Option+P).

**P10 — Settings panel is read-only.**
It shows budget, egress, approval gates as text values. You can't change anything from Settings; you go to Budget, Providers, Models panels for changes. Settings should be the single place to change things, with grouped subsections.

**P11 — Audit log is a flat time-series list** with 50 entries loaded at once, no filtering by event type, no search, no per-session filter, no "copy hash chain proof" action.

**P12 — No deep linking.**
The URL is always `http://127.0.0.1:3141/?token=…`. You can't bookmark `…/chat`, `…/budget`, `…/sessions/<id>`. Changing panels doesn't update `location.hash`. This breaks refresh, shareability, and back-button behavior.

**P13 — Token is passed in query string on first load.**
`http://127.0.0.1:3141/?token=<hex>` leaks the bearer token to browser history, extensions, and local logs. It should be written to `sessionStorage` on first load and stripped from the URL immediately (the code comments acknowledge "low risk vs. DX" — this should be fixed).

**P14 — No websocket or SSE for state sync.**
Everything is 30s polling. Starting a task from TUI and opening the dashboard shows stale state for up to 30 seconds. There should be a `/api/events` SSE stream for state deltas.

**P15 — The CSS uses emoji as icons throughout** (💰 🛡 🧠 🎤 🔒 📜 ⚡ 🧩). These render at different sizes, different colors, across platforms. The brand needs a custom glyph set or a consistent vector icon library.

---

## 5. Website audit (`https://xr-gules.vercel.app` + `website/`)

### 5.1 What works
- Strong hero: avatar with rings, clear headline "The AI Agent You Can Actually Trust," three trust bullets, stats bar.
- One-command install with OS tabs is correct.
- "Why XR wins" comparison table is honest and persuasive.
- 12 providers shown as logo tiles.
- Marketing copy is consistent in voice — "You bring the key. We ship none."

### 5.2 Problems

**P1 — Website uses a different design system than the product.**
- Website body font is Plus Jakarta Sans; product dashboard uses Inter; TUI uses JetBrains Mono only.
- Website headings use Syne (geometric display); product uses system sans bold.
- Website uses `#020817` bg-primary vs product `#0A0A0F` bg; the cyans match but the neutrals don't.
- Website uses 24px border-radius glass; product uses 8–12px radius.
- Result: the website feels like a premium cybernetic product, the dashboard feels like an admin panel, the TUI feels like a CLI tool. They should be **the same product**.

**P2 — Marketplace page (`/marketplace`) duplicates the dashboard marketplace** with different layout.
Same skills data, two UIs. The website version is a marketing showcase; the dashboard version is an install/management tool. Good — but they don't share visual language.

**P3 — No live demo.**
For an "operating system," there is no browser-demo, no WebContainer, no simulated TUI, no sandboxed chat. You have to install to feel it. The install command is the only CTA. Cursor and Warp both offer web try-before-install.

**P4 — No documentation hub on the site.**
`/docs` doesn't exist. The README on GitHub is the documentation. For a product this broad, that's a ceiling on adoption.

**P5 — FAQ is thin, testimonials are fabricated.**
The three testimonial quotes are unattributed handles ("@dev_handle", "@power_user", "@sec_eng"). They don't build trust. Replace with real tweets/GitHub comments or remove.

**P6 — Website is disconnected from the product.**
It's a static Next.js site on Vercel. It doesn't pull latest version, latest skill count, latest star count, or real security test scores. All the stats ("58+ GitHub stars", "27 tests passing", "0 OS supported") are hardcoded and wrong (the website claims "0 OS Supported" in the hero stats — this is a live bug).

**P7 — The website hero says "v0.5 Local Model Intelligence"** but the package is at 3.1.5. Version drift is severe across surfaces.

---

## 6. Onboarding audit

File: `src/interfaces/onboard.ts` (347 lines).

### 6.1 What works
- 4-step structure (mode → local model → cloud keys → security/budget) is clean.
- Hardware detection (RAM/CPU/GPU/VRAM/disk) is great.
- Model recommendation with reason string is the right UX.
- API keys stored in OS keychain when available with file fallback warning.

### 6.2 Problems

**P1 — "Operating Mode" step frames the choice as 1/2/3 number entry.**
"1 Local-only · 2 BYOK Cloud · 3 Hybrid" — this is a CLI prompt style from the 1980s. Cursor/Raycast/Docker Desktop all use a **card picker** with arrow keys and a highlighted default. The user should see three cards, move with ↑/↓, press Enter.

**P2 — StepTracker is text-only** and doesn't render a real progress bar with current/remaining steps. Compare to `brew install` or `docker` first run.

**P3 — Ollama installation is outsourced to a web URL.**
If Ollama isn't installed, onboarding prints "Install from https://ollama.com then run xr models install." It should offer to run the install command for you (Docker Desktop does this for WSL2; Cursor offers to install CLI tools).

**P4 — "Next steps" prints 6 commands** at the end without context. It should print one primary next action ("Run `xr` to open the shell") and hide the rest behind a "Show all quick commands" toggle.

**P5 — Onboarding doesn't create the first workspace or run a smoke test.**
After setup, the user is dropped at a shell. Raycast opens a walkthrough. Cursor opens a "welcome editor" with an embedded AI chat. XR should create a default workspace, run `xr doctor` automatically, and offer a first-prompt suggestion.

**P6 — No re-onboarding/repair differentiation.**
`xr onboarding` always runs all 4 steps. There's no "fix my config" or "add another provider" mode. `xr doctor` is separate and prints raw kv lines, not a friendly repair flow.

---

## 7. Extension surface audit

### 7.1 VS Code extension (`extensions/vscode/extension.js`)
- 82-line file that registers a single "XR: Open" command and shells out to the `xr` binary.
- It does not contribute a chat participant, a sidebar panel, inline completions, or a command palette integration. Compare to the Continue.dev extension which contributes a full chat sidebar, slash commands, and model selection.
- There is no Xcode/Zed/Neovim/JetBrains extension mentioned. VS Code is the only one, and it is minimal.

### 7.2 Telegram bot (`src/telegram/`)
- Exists but not surfaced in onboarding, dashboard, or help as an equal-tier surface. It's a feature, not a surface.
- There is no mobile app. For a "JARVIS" claim, voice + Telegram is good but there's no cohesive remote story.

### 7.3 Voice (`src/voice/`)
- Voice exists as a CLI command and dashboard panel. No voice UI in TUI beyond a status chip. The TUI composer should support a hold-to-talk key.

---

## 8. Design system audit

Files: `src/ui/theme.ts`, `src/ui/layout.ts`, `src/ui/brand.ts`, `src/ui/spinner.ts`, inline CSS in `dashboard.ts`, inline Tailwind in `website/`.

### 8.1 What exists
- Terminal theme tokens with ANSI helpers ✓
- A CSS_VARS block with the web palette ✓
- Layout primitives (banner, divider, kv, box, table, badge, helpPanel, notify) ✓
- Two spinner frame sets (star-burst, dots) ✓
- Official ANSI rasterizations of logo and avatar ✓

### 8.2 Problems

**P1 — Tokens are not shared with the dashboard.**
`CSS_VARS` in theme.ts defines `--xr-primary`, `--xr-surface`, etc. But `dashboard.ts` re-declares its own `:root` variables with slightly different names (`--cyan`, `--bg`, `--surface`) and slightly different values (`#0A0A0F` vs theme `#0A0A0F` match, but `--border2` is `#2D3748` which theme.ts doesn't define). Theme drift waiting to happen.

**P2 — Website uses its own Tailwind palette.**
`website/tailwind.config.ts` was not fully inspected here but the SPEC defines `--bg-primary: #020817`, `--bg-card: #0F172A`, `--cyan-primary: #00D4FF` — the cyan matches but the bg doesn't. Three palettes where there should be one.

**P3 — No motion system.**
There is no definition for duration (fast/medium/slow), easing (standard/entrance/exit), or motion principles. The dashboard uses CSS transitions ad-hoc (`transition: background .12s`); the website uses Framer Motion with custom variants; the TUI uses a 110ms frame delay for startup animation. No shared motion spec.

**P4 — No typographic scale.**
There is no type ramp (h1–h6, body-sm/md/lg, mono-sm/md/lg). The TUI uses only one font size (the terminal's). The dashboard uses `font-size:11px/12px/13px/14px/15px/22px` ad-hoc. The website uses arbitrary Tailwind classes.

**P5 — No spacing scale.**
TUI uses 2-space prefix everywhere. Dashboard uses 4/6/8/10/12/16/20/24px ad-hoc. Website uses py-24/p-8/gap-6. No 4/8/12/16/24/32/48/96 scale.

**P6 — No elevation system.**
Shadows are hardcoded (`0 4px 24px rgba(0,0,0,.4)`) or left out. No z-index/elevation levels for overlays, panels, toasts.

**P7 — No icon system.**
Mixed emoji in dashboard, mixed Unicode glyphs in TUI (⬡ ☁ ⚙ 🔬 ⚡ 🧩 🎤 🔒 📜 🕘 💰 🗂 ◎ ↻ ↑ ↓), Lucide React on the website. Three icon systems.

**P8 — No component inventory.**
There is no list of "a XR button looks like X, has Y states, in TUI it renders as Z." `helpPanel`, `box`, `badge` in layout.ts are the closest thing, but they're TUI-only.

---

## 9. Performance audit (perceived)

Tested heuristically by reading startup paths and render loops:

| Surface | Target (from XR 3.1A standards) | Current (measured from code paths) | Gap |
|---|---|---|---|
| CLI cold start to first byte of output | <300 ms | ~50–150 ms (version/help fast-path); ~500–1500 ms (kernel boot) | kernel boot must lazy-init subsystems |
| TUI cold start to first paint | <500 ms | 6 × 110 ms = 660 ms (animated frames) + TUI construction; >1s perceived | Parallelize startup, don't block on workspace list |
| TUI input latency (keypress to paint) | <16 ms (1 frame) | up to 100 ms (ticker-bound) | immediate render on input, ticker only for animations |
| Dashboard first paint | <1 s | HTML is inline string → instant first paint; data fills in ~300–1000 ms | ✅ first paint is fast, but skeleton strategy needed |
| Dashboard chat first token | <200 ms after enter | full generation time + 1 SSE flush (often 2–15 s with no intermediate output) | must implement streaming |
| Website hero LCP | <2.5 s | Good (static page on Vercel) | ✅ |
| Onboarding to first "ready" | <30 s | Highly variable; Ollama pull of a 4GB model can take 5–15 minutes with no progress | Must add pull progress, defer heavy downloads |
| Command palette open | <50 ms | Instant in both surfaces (state toggle) | ✅ |

---

## 10. Accessibility (preliminary)

| Concern | Current state |
|---|---|
| Keyboard-only operation | TUI: ✅ keyboard-only (with the keybinding issues noted). Dashboard: partially keyboard (chips not focusable, no tab-traversal through panels, palette works but Escape focus management buggy). Website: standard browser keyboard, but hero CTA order matters. |
| Screen reader support | TUI: N/A (terminal). Dashboard: almost zero (no ARIA roles, no `aria-live` for chat, no label for inputs). Website: uses semantic HTML mostly but hero avatar has no alt. |
| Color contrast | Cyan (#00D4FF) on #0A0A0F = ~8:1 (passes). Green on bg = ~10:1 (passes). Amber #F59E0B = ~7:1 (passes). But `--textDim: #9CA3AF` on #0A0A0F = ~4.5:1 for 14px text (marginal). Small 11px text fails. |
| Color-only cues | Status uses dots + text (good). Error state relies on red (bad for protanopia — pair with icon). |
| Reduced motion | TUI has no reduced-motion check. Dashboard has no `prefers-reduced-motion` media query. Website uses Framer Motion which supports it but isn't configured. |
| Terminal 16-color fallback | TUI uses RGB ANSI (`\x1b[38;2;R;G;Bm`) exclusively. No fallback to 16-color palette for basic terminals. |
| Zoom / responsive | TUI uses a minimum 96×30 assumption but doesn't degrade well below that. Dashboard collapses to 1 column at 700px but many tables overflow. Website is mobile-responsive per Tailwind classes. |

---

## 11. Security UX audit

This is XR's biggest differentiator. It must *feel* trustworthy, not just be trustworthy.

| Signal | Current state |
|---|---|
| Approval gates | ✅ CLI prompts show tool, reason, args, default-Y confirmation |
| Budget overrun | ✅ CLI prompt shows meter, fail-closed default is "stop" |
| Audit visibility | ⚠️ Audit log is a panel of hashes with no explanation of what a hash chain is, how to verify it, or why it matters |
| Permission model | ⚠️ Plugins/skills list permissions but there is no "why this plugin needs file system" natural-language explanation modal (Compare to iOS permission prompts) |
| Egress allow-list | ⚠️ In Settings it says "unrestricted" by default — this is dangerous and isn't flagged with a warning state |
| Key storage | ⚠️ Dashboard says "OS keychain / encrypted file" but there is no per-provider key health indicator (red/yellow/green per provider based on storage state) |
| Local-first indicator | ⚠️ A single green dot shows local vs cloud. It doesn't explain what "local" means (data stays on machine? or model runs locally? both?) |
| Shield scan results | ⚠️ "Threats" are generated by stub logic in `shield.ts`. The UX is serious-red ("CRITICAL") but the underlying detection needs to be trustworthy before the UX invokes that level of alarm. |

---

## 12. Cross-surface coherence scorecard

| Dimension | CLI | TUI | Dashboard | Website | Coherent? |
|---|---|---|---|---|---|
| Primary color | cyan | cyan | cyan | cyan | ✅ |
| Accent colors | green/amber/red | green/amber/red | green/amber/red | green/amber/red | ✅ |
| Background | terminal | #0A0A0F (fallback) | #0A0A0F | #020817 | ❌ drift |
| Brand wordmark | ASCII `▀▄▀ █▀█` | ASCII + ANSI logo | data-URI PNG | PNG | ⚠ okay |
| Vocabulary ("workspace") | ✅ | ✅ | ✅ | ❌ (not used on website) | ❌ |
| Vocabulary ("session") | implicit | ✅ | ✅ | ❌ | ❌ |
| Vocabulary ("mode: agent/plan/ask") | --mode flag | composer | hint chips only | not mentioned | ❌ |
| Primary entry point | `xr "<task>"` | `xr` | `xr serve` | install curl | ❌ no single primary |
| Command palette | N/A | Ctrl+K | ⌘/Ctrl+K | none | ❌ |
| Slash commands | ✅ (limited) | ✅ (20+) | hint chips only (fake) | N/A | ❌ |
| Status bar | PS1-like | bottom bar | topbar chips | N/A | ❌ different positions, different content |
| Notifications | stderr toasts | Ctrl+N center | toast-wrap | N/A | ❌ |
| Version shown | `xr --version` | nowhere visible | nowhere visible | "v0.5" (wrong) | ❌ |

**Coherence score: 4 / 13.** The foundation (colors, brand) is there; the shared mental model (vocabulary, navigation, status) is not.

---

## 13. Root-cause synthesis

XR does not feel slow or fragmented because of any single bug. It feels slow and fragmented because of three architectural omissions:

1. **There is no Experience Kernel.**
   There is a backend kernel (`src/core/kernel.ts`) that boots services, but no single *state object* that represents "what is XR doing right now" in a way every surface can render from. The TUI keeps a `TuiState` object; the dashboard re-fetches from 17 endpoints; the CLI ad-hoc prints. No shared shape.

2. **There is no Streaming Substrate.**
   The provider interface supports streaming in theory but `/api/chat` and the TUI composer both aggregate and emit at line/answer boundaries. Users perceive AI agents as *slow* whenever they cannot see the agent think. Streaming is a perception feature, not a performance feature.

3. **There is no shared Design System compiled to each surface.**
   Theme tokens exist only as code. There is no source-of-truth document (this doc suite fixes that), no Figma library, no generated web/TUI/website CSS from one token file, no icon set, no motion spec. Each surface was built by a different pass at "cybernetic dark mode."

The 12 documents in this XR 3.1A suite fix all three.
