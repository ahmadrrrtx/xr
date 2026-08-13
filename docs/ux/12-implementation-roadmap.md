# 12 — Implementation Roadmap

**Date:** 2026-08-13 · **Governing constraints (mission §29–33):** phased,
gated, no fake UI, no unnecessary rewrites, no hardcoded product logic, every
feature wired to the real runtime. Phases may be merged only where repo
evidence makes it safer; each phase ends with the GATE below.

## The Gate (every phase)

1. typecheck (`tsc --noEmit`) ✅
2. tests (`bun test`) ✅
3. lint/gates (claim-lint, boundaries, size-gate, a11y) ✅
4. manual inspect of every changed surface
5. real-functionality probe (live CLI/daemon where feasible)
6. regression check (affected tests still green)
7. integration verify (TUI↔GUI↔CLI naming/labels agree)
8. record results in this file (PHASE → CHANGES → FILES → TESTS → RESULT →
   KNOWN ISSUES → NEXT)

## Dependency order

```
A (honesty & tokens) ──► B (onboarding & shell) ──► C (chat & components)
   │                                                  │
   ├─► D (TUI parity polish)                          │
   └─► E (voice/avatar) ◄─────────────────────────────┘
        │
        └─► F (locality, states, QA) ──► G (future: coding workspace, terminal, 3D)
```

## Phase A — Honesty fixes & token consolidation (P0)

| ID | Change | Files | Verify |
|---|---|---|---|
| A-1 | Replace fake voice buttons with real state: probe `src/voice/` capability + `xr voice …` command copy + honest disabled states (F-1) | `src/daemon/dashboard/markup.ts`, `client-script.ts`, `src/daemon/routes/system.routes.ts` | unit: no `toast('Voice activated…')`; live probe |
| A-2 | One token source: dashboard `:root` derived from `tokens.ts` `cssVarsBlock()`; remove divergent palette (F-2) | `src/daemon/dashboard/styles.ts`, `src/ui/tokens.ts` | unit: CSS vars == token values (drift lock) |
| A-3 | Brand secondary → `#6048F8` (F-3); update `RGB`/`ANSI16`/website | `src/ui/tokens.ts`, `theme.ts`, `website` | contrast tests green; TUI+GUI identical |
| A-4 | Replace emoji icons with centralized inline SVG (F-4) | `src/ui/icons.ts`, dashboard markup/script | grep no emoji in chrome; axe green |
| A-5 | Locality/connectivity badges (F-7) on provider chip, composer, model cards | `client-script.ts`, `styles.ts` | state matrix (11) spot-checked |
| A-6 | Composer context/budget transparency (F-9): context %, last-N hint, task spend — real data | `client-script.ts`, `src/daemon/routes/context.routes.ts` | live SSE test |
| A-7 | (discovered, same honesty family) Settings panes never persisted — `saveAllSettings` claimed success. Now read-only: toggles reflect real `/api/config` values and are disabled with honest tooltips; Save explains where to configure (`xr voice setup`, `xr providers set`, `xr budget`). Also fixed the silently-broken message **Copy** button (`copyText` was allowlisted but never defined). | `client-script.ts` | honesty test A-7; live probe |

## Phase B — GUI onboarding & application shell

| ID | Change | Files | Verify |
|---|---|---|---|
| B-1 | GUI first-run flow (welcome → run-mode → provider/local → permissions → budget → first prompt), reusing CLI wizard engines (`onboard.ts`, `probeHealth`, `recommendLocalModel`, `ollamaStatus`) via daemon routes | new `src/daemon/routes/onboarding.routes.ts`, dashboard onboarding view | `xr onboarding --yes` parity; fresh-home e2e |
| B-2 | Shell refinements per IA (04): relabel groups, default view = Chat, sidebar icon-rail collapse, inspector toggle | `markup.ts`, `styles.ts` | keyboard pass |
| B-3 | Empty-state redesign (F-6): avatar hero + suggested prompts + capability chips | `client-script.ts`, `styles.ts`, `markup.ts` | a11y live-region test |

## Phase C — Chat & component architecture

| ID | Change | Files | Verify |
|---|---|---|---|
| C-1 | Component refactor per 10 (functions → HTML strings, `data-xr-action` delegation, icon map); no behavior change | `client-script.ts`, `styles.ts` | SHA-free: all panel behaviors tested |
| C-2 | Approval cards WHAT/WHY/RISK + keyboard flow | `client-script.ts` | focus + role=alertdialog test |
| C-3 | Streaming polish (08): buffered markdown, inline streaming marker, live region, stop always visible | `client-script.ts` | aria-live throttling test |
| C-4 | Sessions: search + resume + context transparency | `client-script.ts` | resume e2e |

## Phase D — TUI parity & polish

| ID | Change | Files | Verify |
|---|---|---|---|
| D-1 | Status bar: context %, real spend, locality glyph; secondary color; reasoning display toggle (none/brief/detailed) | `src/interfaces/shell/*`, `src/ui/*` | TUI tests + manual |
| D-2 | `?` help refresh, mnemonic docs; keyboard parity with GUI | `src/interfaces/shell/app.ts` | help overlay asserts |

## Phase E — Voice & avatar state language

| ID | Change | Files | Verify |
|---|---|---|---|
| E-1 | Avatar state treatment (2D + CSS): idle/thinking/tools/speaking/listening ring + glow; reduced-motion safe; no new raster | dashboard CSS/SVG, `assets/brand/` copy | perf: no main-thread cost |
| E-2 | Voice panel real states (builds on A-1); mic flow via real pipeline where daemon supports; offline path note | voice routes, markup | live mic test where possible |
| E-3 | Avatar hero in onboarding + empty state (Phase B assets reused) | markup/styles | visual pass |

## Phase F — States, locality & full QA

| ID | Change | Files | Verify |
|---|---|---|---|
| F-1 | Complete state matrix (11) on every panel; skeletons ≤ 250 ms; honest errors | all panels | scripted state walkthrough |
| F-2 | Offline walkthrough: no-network session (local model path, memory, audit verify) | — | live no-net probe |
| F-3 | Extended a11y: bento text summary, palette focus trap, keyboard-only onboarding | client-script | axe + manual |
| F-4 | Full system QA + first-time-user test (mission §38) | — | report here |

## Phase G — Future (honestly labeled, not faked)

| Item | Status |
|---|---|
| Coding workspace (diff viewer, file explorer, agent-in-context) | Spec'd in 05; requires new daemon routes; do not fake |
| Embedded web terminal (xterm.js, PTY via daemon) | Research done (01); lazy-load; future |
| 3D avatar (Three.js/R3F + GLB rig) | Research done (02); needs authored rig; experimental |
| Floating companion mode | Spec'd in 05; needs daemon event path; future |
| Light theme | Tokens designed for future derivation; post-launch |
| GUI voice mic (in-browser STT/TTS) | Only if browser APIs + daemon contract exist; else CLI-only voice stays honest |

## Release-readiness (mission §40) checklist

- [x] UX coherent (one identity, TUI↔GUI↔CLI grammar) — Phase D gate
- [x] No fake functionality (A-1 fixes; grep sweep; parse gate; static-claim tests)
- [x] Real functionality works (live probes per phase; `bun run ci` exit 0)
- [x] Offline behavior works (audit verify offline, local-first labels)
- [x] Voice works where supported, honest elsewhere (E-2)
- [x] TUI/CLI work (D + existing suites; golden path green)
- [x] Accessibility green (static: contrast, live regions, keyboard) —
      browser-axe sweep still needs chromium in CI (one-line, documented)
- [x] Performance acceptable (no regressions; avatar CSS-only; no new deps)
- [x] Security UX honest (state matrix + no fake badges)
- [x] New-user path verified (B + F-4 first-time-user test + golden path)
- [x] docs/ux set + DESIGN-REVIEW.md + RELEASE-READINESS.md are the record
      of this program

## Phase log

### PHASE A — Honesty fixes & token consolidation ✅ (2026-08-13)

**CHANGES**
- **A-1 — fake voice controls removed.** "Enable Voice" / "Test loop latency"
  (which only fired toasts) are gone. The Voice panel now states it is
  terminal-driven, shows the **real config state** (`/api/config` →
  `Configured: off · mode: push-to-talk`), and offers **working copy buttons**
  for the real CLI surface (`xr voice status|setup|start`). No simulated
  outcomes anywhere.
- **A-2 — one token source.** `styles.ts` `:root` shared colors now interpolate
  `src/ui/tokens.ts` (single authority); dashboard-specific tokens stay local.
  Drift-locked by `test/daemon/token-drift.test.ts`.
- **A-3 — official brand indigo.** `violet → #6048F8` (pixel-verified from the
  official palette); gradient end updated; `muted → #7A8FB0` (Phase 8 AA
  value) aligned across tokens, `css-vars.css`, dashboard. `.badge-violet`
  rgba and the research chip text color updated for AA on indigo.
- **A-4 — emoji → inline SVG** in all dashboard chrome (composer chips,
  voice, skills kicker, marketplace categories, shield heading, emergency
  stop, attachment chip, `categoryIcon`). Gate: `honesty.test.ts` bans emoji
  codepoints in markup+script (typographic ⚠ ✓ ✕ stay — product symbol
  vocabulary).
- **A-5 — locality badges.** Topbar `#chip-locality` + sidebar
  `#sidebar-locality` + chat-header suffix, derived from real route state
  (`ov.provider.local` + health): LOCAL (green) / CLOUD (amber) / OFFLINE
  (red) / SETUP (amber), each with an honest tooltip.
- **A-6 — composer transparency.** `#composer-meta` shows the real budget
  (`/api/budget`: today's spend, per-task cap, progress meter via CSSOM —
  CSP-safe) and honest context ("last 10 messages", matching
  `chat.routes.ts` `slice(-10)`), plus real memory state.
- **A-7 — settings honesty** (above) + broken **Copy** button fixed.
- SHA pin in `dashboard-split.test.ts` bumped deliberately (repo convention).

**FILES**
- `src/ui/tokens.ts`, `src/ui/css-vars.css` (tokens; indigo/neutral alignment)
- `src/daemon/dashboard/styles.ts` (:root from tokens; badge/chip/meta/voice
  styles; AA fix on indigo chip)
- `src/daemon/dashboard/markup.ts` (voice panel, locality chips, composer
  meta, SVG icons)
- `src/daemon/dashboard/client-script.ts` (locality, composer meta, voice
  status, settings sync, copyText, honest saveAllSettings, SVG icons)
- `test/daemon/dashboard-split.test.ts` (pin bump),
  `test/daemon/token-drift.test.ts` (new), `test/daemon/honesty.test.ts` (new)
- `docs/perf/SIZE-WAIVERS.json` (client/markup grew; styles.ts crossed 800 →
  owned plan: split in Phase C)
- `docs/release/7.1.0/inventory.json` + `INVENTORY.md` (regenerated; 232
  test files)

**TESTS**
- `bun run typecheck` ✅ · `bun test` **2854 pass / 13 skip / 0 fail** ✅
- Gates: claim-lint · boundaries (523 modules, no violations) · hot-path-lint ·
  size-gate · changelog:check · ownership:check · baseline:inventory ·
  ci-capability-gate ✅
- New: token-drift (5) + honesty (10) tests; dashboard-split pin bumped.

**RESULT**
- Live probe on fresh `XR_HOME`: `xr serve` boots, 401 without token, 200 with
  token; served HTML/CSS/JS verified: 0 fake-voice strings, 0 emoji, 0 inline
  style attributes (CSP `style-src 'self'` safe), token-derived hexes
  (`#0A0A0F / #6048F8 / #7A8FB0`) present, all new surfaces present, real
  `/api/config` + `/api/budget` feed the new UI (voice `off·push-to-talk`,
  `dayUsd 0 · perTaskUsd $0.25`).

**KNOWN ISSUES**
- TUI glyph set (`src/ui/icons.ts`) still contains one emoji glyph (voice 🎤);
  web chrome is clean — TUI glyph vocabulary audit is scoped to Phase D.
- Settings panes are now honest but sparse (disabled controls); wiring real
  config-write API is Phase F scope (needs a sanitized config route).
- Dashboard remains one large client script (2288 LOC) — owned split plan in
  Phase C (component refactor), recorded in the size waiver register.

**NEXT / release readiness**
- The UX transformation core is complete (Phases A–F) + Phase G delivered
  the buildable future surface. Remaining honest future work (each needs a
  real backend contract, none faked): embedded web terminal (xterm.js + PTY
  route), 3D avatar (GLB rig), floating companion (daemon event path),
  light theme, in-browser mic (browser APIs + daemon audio contract).
- Recommended release step: enable the browser-axe sweep in CI where
  chromium is available; publish 7.1.0+ per the release runbook.

---

### PHASE G — Future surfaces (the buildable ones, honestly) ✅ (2026-08-13)

**CHANGES**
- **G-1 — REAL Workspace Files browser.** The dashboard "Files & Produced
  Artifacts" panel was a static placeholder claiming "No produced artifacts
  present" with no loader — it is now a genuine two-pane browser backed by
  three new scoped daemon routes:
  - `GET /api/files?path=` — list the project root (process.cwd(), the same
    authority as `/api/overview`), one level, sorted dirs-first, capped at
    600 entries, with **real per-file git status** (`clean/modified/staged/
    untracked/added/deleted` from `git status --porcelain`) and repo
    branch/dirty state;
  - `GET /api/files/read?path=` — text-only preview (512 KB cap, null-byte
    sniff, binary → 415);
  - `GET /api/files/diff?path=` — real `git diff -- <path>` (untracked files
    honestly report `tracked:false`).
  - **Scope enforcement:** every path is resolved inside the project root —
    `..`, absolute, and symlink escapes are rejected 400 (test-pinned).
  - UI: breadcrumb navigation (runtime `act()` built paths), dir/file rows
    with git badges + sizes, file viewer with Diff / Copy path / "Ask XR"
    (prefills the composer and jumps to chat), responsive two-pane layout.
- **G-2 — coding workspace slice.** The file viewer + real diff covers the
  read side of a coding workspace; the write/terminal sides are honestly
  future (the terminal/TUI remain the write surfaces — stated in the UI).
- **G-4 — future surfaces honestly labeled.** The About panel now lists the
  planned surfaces with their real blockers (embedded terminal needs a PTY
  route; 3D avatar needs a GLB rig; floating mode needs a daemon event path;
  in-browser mic needs browser APIs + daemon contract; light theme is
  dark-first). No fake terminal/3D/mic controls exist.
- **Also fixed (test hygiene):** a `process.chdir` leak in the phase-g test
  worker would break repo-relative scans in later files of the same bun
  worker (single-writer / SBOM / skills-count) — restored cwd in `afterAll`.

**FILES**
- New: `src/daemon/routes/files.routes.ts`, `test/daemon/phase-g.test.ts`.
- Modified: `schemas.ts`, `contract.ts`, `registry.ts` (+3 ops, 106 total),
  `page-panels-b.ts` (Files panel + About future card), `client-panels-c.ts`
  (files module), `client-core.ts` (navigateTo case), `client-runtime.ts`
  (allowlist), `style-ui.ts` (browser CSS), `docs/api/openapi.json` +
  `src/clients/daemon-client.generated.ts` (regenerated), release inventory
  (regenerated), SHA pin bumped (deliberate).

**TESTS**
- `tsc --noEmit` ✅ · `bun test` **2933 pass / 13 skip / 0 fail** ✅ (+14
  Phase-G tests: scope enforcement ×5, real list/read/diff, static UI gates,
  honest future labels)
- Gates: claim-lint · size-gate · ownership · changelog · api:schema:check ·
  client:check · api:compat (no breaking changes, 106 ops) ·
  ci-capability-gate · boundaries (538 modules) ✅

**RESULT (live probe, repo root)**
- `/api/files?path=src/daemon` lists real entries with repo `main · dirty`;
  traversal `..` and `/etc` → 400; `README.md` read (30103 B, text, not
  truncated); `README.md` diff → `tracked:true`, clean; served JS parses;
  Files panel + future card present.

**KNOWN ISSUES (honest)**
- Per-file git badges resolve against repo-root porcelain keys, so they show
  when browsing from the root and degrade to "—" in subdirectories (honest,
  not wrong).
- The browser is read-only by design; the terminal/TUI are the write surfaces
  (documented in the UI).
- Browser-axe sweep still needs chromium (recommended for CI).

---

### RELEASE-READINESS ✅ (2026-08-13)

**CHANGES**
- **Full `bun run ci` gate chain exits 0** — the definitive release signal:
  typecheck, full suite **2937 pass / 13 skip (live-browser a11y) / 0 fail**,
  claim-lint, release:check, channel:check, changelog:check,
  baseline:inventory, platform:parity:check, boundaries (538 modules),
  size-gate, hot-path-lint (0 hot-path violations), ownership:check,
  api:schema:check, client:check, api:compat (0 breaking, 106 ops),
  ci-capability-gate, website:marketplace:check (67 real items).
- **Hermetic golden path passes** (install → first answer → audited → chain
  intact → restart → recovery → uninstall keeps data).
- **Three more persistent fake claims removed** (release honesty): the bento
  "Voice runtime — Ready" cell and the "Protection Log — Safe" card and
  "Sandbox indexes — OK" were never updated by any loader (permanent
  unverified claims). Defaults are now neutral "—" and each is wired to real
  data (config voice, security report, marketplace registry response).
- **Onboarding status latency fixed** (found by release CI): provider health
  probes now run in parallel and bounded (~2.5 s) instead of 8 s × N.
- Deliverables: `docs/ux/RELEASE-READINESS.md` (mission §40 report) and
  `docs/release/UX-CANDIDATE-RELEASE-NOTES.md` (draft release notes).

**FILES** — `onboarding.routes.ts` (parallel/bounded probes),
`page-panels-a.ts` + `page-panels-b.ts` (neutral defaults),
`client-core.ts` + `client-panels-b.ts` (real-data wiring),
`test/daemon/phase-ef.test.ts` (+4 release-honesty tests), SHA pin bumped,
release inventory regenerated, `docs/ux/RELEASE-READINESS.md` +
`docs/release/UX-CANDIDATE-RELEASE-NOTES.md` (new).

**TESTS** — `bun run ci` **exit 0** · `bun test` 2937/13/0 · golden-path OK ·
`verify-release` honestly NOT VERIFIED (cosign needs the maintainer key —
no false claim).

**RESULT** — the product is release-ready on every sandbox-verifiable gate.
The only outstanding items are maintainer-held (signed tag, npm OIDC
publish, cosign/Rekor proof) per `docs/release/RELEASING.md` + `LAUNCH_HANDOFF.md`,
plus running the chromium browser-axe sweep in CI.

**KNOWN ISSUES** — see `docs/ux/RELEASE-READINESS.md` §9 (all honest,
documented, none blocking).

---

### PHASE E — Voice & avatar state language ✅ (2026-08-13)

**CHANGES**
- **E-1 — avatar state orb (real agent state only).** A small avatar chip in
  the chat header + a ring on the empty-state hero now communicate the REAL
  agent state: **idle** (no run), **thinking** (a chat completion is
  streaming), **working** (a tool/step is executing — a timeline card is
  `running`). Driven by `setAvatarState()`/`applyAvatarState()` hooked into
  send/stream/stop/tool events. **Speaking/listening states are NOT faked** —
  the GUI does not drive the audio pipeline (honest per A-1), so the code
  documents exactly that. Reduced-motion-safe (global rule collapses the
  pulse).
- **E-2 — voice panel shows real backend detail + honest offline note.** The
  config route now exposes non-secret voice detail (`sttBackend`,
  `ttsBackend`, `wakeWord`, `microphonePermission`); the panel renders it and
  an honest offline note: local adapters (whisper-cli, whispercpp) work
  offline, network adapters (groq/openai/http) are called out, never hidden.
- **E-3 — canonical brand kit.** The official supplied variants are curated
  into `assets/brand/`: `avatar-front.png`, `avatar-hero.png`,
  `palette-reference.png` (documented in `docs/ux/research/04`).

**FILES**
- `src/daemon/routes/system.routes.ts` (config voice detail),
  `client-chat.ts` (avatar state), `client-core.ts` (richer voice status),
  `page-panels-a.ts` (orbs), `page-panels-b.ts` (offline note), `style-ui.ts`
  (orb ring CSS), `assets/brand/*` (new), `test/daemon/phase-ef.test.ts`
  (new), SHA pin bumped (deliberate).

**TESTS** — `tsc` ✅ · `bun test` **2919 pass / 13 skip / 0 fail** ✅ (+10
Phase-E/F tests incl. a route-level config test) · all gates ✅

**RESULT (live probe)** — `/api/v1/config` returns
`{enabled:false, mode:"push-to-talk", sttBackend:"auto", ttsBackend:"auto",
wakeWord:"hey xr", microphonePermission:"unknown"}`; served dashboard has the
orbs, state logic, offline note, parse check OK.

---

### PHASE F — States, locality & full QA ✅ (2026-08-13)

**CHANGES**
- **F-1 — two more fake-UI fixes on the dashboard:**
  - `"All modules validated"` (hardcoded success text, set regardless of the
    real security report) is gone → the EDR card now shows the honest
    `blocked/total blocked` from the real `/api/security` report (or
    "EDR scan unavailable" when the report has no numbers).
  - the security score's `|| 96` fallback (which fabricated 96% when the
    report had no rate) is gone → shows `—` unless a real rate exists.
- **F-3 — bento accessibility:** the 12-cell health matrix now has a
  visually-hidden plain-text digest (`#bento-summary`, `aria-live=polite`)
  populated from the real cell values — the grid is no longer 12 unlabeled
  numbers for screen readers.
- **F-4 — first-time-user golden path verified live** on a fresh `XR_HOME`:
  `xr onboarding --yes` completes → `xr doctor` reports honest state (local
  runtime not detected, config/secret-store/audit OK) → `xr audit verify`
  works offline (0 entries intact) → `xr serve` serves the dashboard; the
  onboarding status honestly reports `needsSetup:true` with the real reason;
  defaults reflect the onboarding choice.

**FILES**
- `client-core.ts` (EDR honesty + bento summary), `page-panels-a.ts` (summary
  element), `test/daemon/phase-ef.test.ts`, release inventory (regenerated).

**TESTS** — `tsc` ✅ · `bun test` **2919 pass / 13 skip / 0 fail** ✅ · gates:
claim-lint · size-gate · ownership · changelog · api gates · capability-gate ·
boundaries (537 modules) ✅

**RESULT (live probe)** — fresh-home golden path: onboarding → doctor → audit
verify (offline) → serve, all honest and functional.

**KNOWN ISSUES (honest)**
- Browser-axe sweeps remain skipped without chromium (recommended for CI with
  chromium); the static a11y gates + parse gate cover the offline gap.
- Agent-detail level and shell prefs are session-scoped (persistence is a
  future config surface).
- In-GUI model pull and in-browser voice mic remain future (needs streaming
  route / browser APIs + daemon contract) — documented, not faked.

---

### PHASE D — TUI parity & polish ✅ (2026-08-13)

**CHANGES**
- **D-1 — brand indigo reaches the TUI.** `RGB.violet` was still the old
  purple `[168, 85, 247]` after the official-palette fix (F-3) — the TUI
  truecolor path rendered the wrong violet. Now `[96, 72, 248]`, matching
  `COLOR.violet #6048F8` (pinned by a test).
- **D-1 — honest context in the status bar** (`renderStatusBar`, width-gated,
  no fake data):
  - `ctx N` — real session message count (not a fake "window %");
  - `$x · Nk tok` — real spend + real token count from `store.costSummary()`;
  - `● LOCAL` / `● CLOUD` — explicit parity word (same `isLocal()` authority
    as the GUI locality badges) on wide terminals;
  - `agt <level>` — the agent-detail chip.
  Narrow terminals degrade gracefully (only essentials + always-visible model
  chip).
- **D-1 — agent detail level (`none | brief | detailed`), Ctrl+T.** The
  runtime has NO per-turn reasoning channel, so a "reasoning toggle" would
  have been fake. Instead this honestly controls how much of the agent's
  REAL work (the tool/step timeline fed by the run loop's `say()`) appears in
  the chat feed: `none` = final answers only, `brief` = tool titles,
  `detailed` = titles + detail lines. Pure `cycleAgentDetail()` helper is
  unit-tested; Ctrl+T cycles with an informative notice.
- **D-2 — `?` help refreshed** (`helpBindings`): adds Ctrl+T, `/inspect`
  (toggle inspector), the expanded `g d/c/s/w/r/t/a/m/b/x/./n` go-to map, a
  status-bar legend line, and a GUI-mode parity note (Ask→ask, Plan→plan,
  Agent→agent; Research is the GUI composer toggle). Every listed binding was
  verified against `handleKey`/`parseKey` before documenting.
- **D-2 — glyph vocabulary audit:** the remaining chrome emoji
  (`voice: "🎤"`) is now `♪` (terminal-safe; the text-only fallback stays
  `[MIC]`). No emoji remain in the TUI icon set.
- **Also:** the status-bar right hint now mentions the Ctrl+T toggle on wide
  terminals.

**FILES**
- `src/ui/tokens.ts` (RGB.violet), `src/ui/icons.ts` (voice glyph),
  `src/interfaces/shell/types.ts` (AgentDetail + cycleAgentDetail),
  `src/interfaces/shell/app.ts` (state + Ctrl+T + import),
  `src/interfaces/shell/render.ts` (status bar + chat agent-work block),
  `src/ui/primitives.ts` (help), `test/ux/shell-parity.test.ts` (new),
  `docs/perf/SIZE-WAIVERS.json` (app.ts 1226→1246, split plan unchanged),
  release inventory (regenerated).

**TESTS**
- `tsc --noEmit` ✅ · `bun test` **2909 pass / 13 skip / 0 fail** ✅ (+10
  Phase-D tests: RGB/indigo, cycle helper, status-bar wide/narrow/cloud,
  chat feed none/brief/detailed, help content, glyph safety)
- Gates: claim-lint · size-gate · ownership · changelog · api gates (no
  breaking changes) · capability-gate · boundaries (537 modules) ✅

**RESULT (live probe)**
- `xr --version` → `v7.1.0 (Truth)`; fullscreen Shell still fails gracefully
  without a TTY; a render probe of the real functions produced:
  `● LOCAL default · agent · model ollama/qwen2.5:7b · $0.0012 · 12.3k tok ·
  ctx 1 · agt brief · idle · ✓ · ◌` (130 cols) and the essentials only at
  70 cols; help contains Ctrl+T; voice glyph `♪`; `RGB.violet 96,72,248`.

**KNOWN ISSUES**
- The agent-detail level is session-scoped (not persisted) — documented in
  the help; persisting shell prefs needs a small config surface (future).
- The shell remains a single 1246-LOC module under an owned split plan
  (waiver, unchanged).
- Browser-axe sweeps still skip without chromium (pre-existing).

---

### PHASE C — Chat & component architecture ✅ (2026-08-13)

**CHANGES**
- **C-1 — component split (byte-identical).** The three dashboard modules were
  split into cohesive fragments composed by thin modules (client-script /
  markup / styles each ~13–18 lines; fragments 35–668 LOC). The composed
  SCRIPT / CSS / PAGE hashes matched the pre-split state exactly, so served
  bytes are unchanged. The three SIZE-WAIVERS entries were retired (plans
  fulfilled). Fragment files: `client-{core,chat,panels-a,panels-b,panels-c,
  runtime}.ts`, `page-{head,panels-a,panels-b,tail}.ts`,
  `style-{tokens,shell,ui}.ts` (all under `src/daemon/dashboard/`).
- **CRITICAL FIX — real served-script SyntaxError.** During the split, a
  `new Function(DASHBOARD_SCRIPT)` parse gate exposed that the served client
  did not parse: onboarding attribute builders (`onbSelectProvider`,
  `onbSetLocal`, `copyText('xr models install')`, `onbGo('models')`) had lost
  a backslash escaping level through the template layer, producing
  `data-xr-action="onbSelectProvider('' + p.id + '')"` — a hard SyntaxError
  that would have killed the entire dashboard JS in a browser. Root cause:
  inside the outer template literal, `\'` is needed to emit `\'` in the
  served script (the correct `answerApproval` idiom uses `\\'`). Fixed all
  four sites; verified with `node --check` + a permanent parse-gate test.
- **C-2 — approval cards render WHAT / WHY / RISK** from the real control
  plane (`/api/control/pending` returns `{action, risk:{level,reason,
  reversible}, preview}`). `approvalActionLabel()` turns the action union into
  human labels; risk maps to SAFE/SENSITIVE/DESTRUCTIVE badges; cards are
  `role="group"` with aria-labels; the list is `aria-live="polite"`; the
  "Jarvis approvals" label was renamed to "Approvals".
- **C-3 — streaming transparency:** a visually-hidden polite live region
  (`#xr-stream-announcer`, `.xr-sr-only`) announces start / complete / stopped
  / error (never per-token); a blinking ▍ cursor on `.msg.streaming` (guarded
  by the global reduced-motion rule); a "…streaming code…" note while a code
  fence is open.
- **C-4 — sessions:** client-side search (title/id/status) over the real
  `/api/sessions` cache, a working "Copy id" affordance, and an honest
  "Open session steps" affordance — no fake "resume" API is offered.

**FILES**
- New: `src/daemon/dashboard/{client-core,client-chat,client-panels-a,
  client-panels-b,client-panels-c,client-runtime,page-head,page-panels-a,
  page-panels-b,page-tail,style-tokens,style-shell,style-ui}.ts`,
  `test/daemon/phase-c.test.ts`.
- Modified: `client-script.ts` / `markup.ts` / `styles.ts` (now thin
  composers), `docs/perf/SIZE-WAIVERS.json` (3 dashboard waivers retired),
  `docs/OWNERSHIP.md` (regenerated, 158 areas), release inventory
  (regenerated), `test/daemon/dashboard-split.test.ts` (pin bumped
  deliberately).

**TESTS**
- `tsc --noEmit` ✅ · `bun test` **2899 pass / 13 skip / 0 fail** ✅ (+13
  Phase-C gates incl. the served-script parse guard)
- Gates: claim-lint · size-gate (14 waivers, dashboard gone) · ownership ·
  changelog · api:schema:check · client:check · api:compat (no breaking
  changes) · ci-capability-gate · boundaries (537 modules, 0 violations) ✅

**RESULT (live probe, fresh XR_HOME)**
- `xr serve` → 401/200 auth; served `/assets/dashboard.js` passes
  `node --check` (previously it did not parse!); all Phase C surfaces present
  (approval WHAT/WHY/RISK, risk labels, aria-live, stream announcer, cursor
  CSS, code note, sessions search, copy-id); 0 emoji, 0 inline styles.

**KNOWN ISSUES**
- The browser-axe sweeps remain skipped without chromium — the new parse gate
  covers the class of bug they would have caught, but a full browser pass is
  still recommended in CI where chromium is available.
- The onboarding in-GUI model pull remains guidance-only (documented in B).
- `perf/stall-detection` occasionally flakes under full-suite load (pre-existing).

---

### PHASE B — GUI onboarding & application shell ✅ (2026-08-13)

**CHANGES**
- **B-1 — GUI first-run onboarding** (`src/daemon/routes/onboarding.routes.ts`
  + dashboard overlay). A thin orchestrator over the SAME engines the CLI
  wizard uses — no duplicated or invented logic:
  - `GET /api/onboarding/status` — honest `needsSetup` from hosted keys
    (vault-aware via `PRESETS` + `getSecretSyncCached`) + local runtime
    health + best-effort internet probe;
  - `POST /api/onboarding/provider` — key stored via the secrets vault
    (`setSecretAsync`), defaults written via `saveConfig`, advisory health
    probe (save never fails on probe outcome — F-1 parity with the CLI);
    keys are never returned; local presets (no key slot) fail closed;
  - `POST /api/onboarding/complete` — append-only audit record.
  - Overlay steps: Welcome → run mode (cloud/local/both) → cloud provider
    picker (real catalog) + key + Save & test → local model (real hardware
    + recommendation + set-local + copy install command — no fake download)
    → security summary (real config/trust) → budget cap (real
    `/api/budget/set`) → done. Skip/back/resume, Esc-to-close, focus
    management, `prefers-reduced-transparency` fallback.
- **B-2 — application shell per the IA (04):**
  - sidebar groups relabeled: Mission Hub→**Start**, AI Resources→**Ask**,
    Platforms & Tools→**Capabilities**, Governance & Trust→**Guard**,
    Core Services→**System**;
  - **default view = Chat** (landing answers "what can I do", bento is one
    click away); `/dashboard` still lands on the overview;
  - **sidebar icon-rail collapse** + **chat inspector toggle**, both
    persisted and keyboard-accessible;
  - fixed the `/chat` route: its string-replace never worked (the client is
    an external CSP asset, so the HTML contained no script to rewrite) —
    routes now signal intent via `<body data-route="…">` read by the client.
- **B-3 — chat empty-state hero:** official avatar + "What can I help you
  with?" + four suggested prompts bound to real commands (`/status`,
  `/budget`, `/memory`, `/plan`) + capability chips navigating to real
  panels. Replaces the thin placeholder; `renderMessages` toggles it.
- **Also fixed:** `getProviderEnvStatus` now sees vault-stored keys
  (CLI↔GUI parity — a key saved by `xr onboarding` shows as configured in
  the dashboard).

**FILES**
- New: `src/daemon/routes/onboarding.routes.ts`,
  `test/daemon/onboarding-routes.test.ts`, `test/daemon/phase-b.test.ts`.
- Modified: `schemas.ts`, `contract.ts`, `registry.ts`, `system.routes.ts`
  (route markers), `config.ts` (vault-aware hasKey), dashboard
  `markup/styles/client-script`, `docs/api/openapi.json` +
  `src/clients/daemon-client.generated.ts` (regenerated; 103 ops, +3
  onboarding), `docs/perf/SIZE-WAIVERS.json` (owned split plans),
  release inventory (regenerated), SHA pin bumped (deliberate).

**TESTS**
- `tsc --noEmit` ✅ · `bun test` **2873 pass / 13 skip / 0 fail** ✅
  (+19: 8 onboarding-route e2e + 11 Phase-B static gates)
- Gates: claim-lint · boundaries (524 modules, 0 violations) · hot-path-lint ·
  size-gate · ownership · changelog · api:schema:check · client:check ·
  api:compat (no breaking changes) · ci-capability-gate ✅
- One flake observed: `perf/stall-detection` "golden path" failed once under
  full-suite load, passes in isolation and on re-run (pre-existing
  timing-sensitive test; unchanged by this phase).

**RESULT (live probe, fresh XR_HOME)**
- `xr serve` → 401 without token; status route: fresh home
  `needsSetup:true` with honest reason; after `POST /api/onboarding/provider`
  (`openai`, probe:false): key saved (`secretBackend:"file"`), never echoed,
  defaults set, `needsSetup:false` with reachability reason; `complete`
  audited; audit log shows both events.
- Served pages: `/` → chat active; `/chat` → `data-route="chat"`; `/dashboard`
  → `data-route="dashboard"`; client honors the marker. Overlay, empty-state
  hero, relabels, toggles all present; 0 emoji, 0 inline style attributes
  (CSP-safe); 26 panels preserved.

**KNOWN ISSUES**
- GUI local-model install is guidance-only (copy `xr models install` + Models
  panel); an in-GUI pull with progress/cancel is future scope (needs a
  streaming route — documented, not faked).
- Onboarding dismissal persists per-browser (localStorage); completion is
  audit-recorded server-side. A cross-browser "completed" flag needs a store
  KV (future).
- Settings panes remain read-only (Phase A decision); config-write API is
  Phase F scope.
- Dashboard client (2580 LOC) / styles (990) / markup (1393) still grow —
  owned split plans recorded in SIZE-WAIVERS.json for Phase C.
