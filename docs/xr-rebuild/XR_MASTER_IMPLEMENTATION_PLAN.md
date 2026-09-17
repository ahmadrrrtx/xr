# XR — Master Implementation Plan (5 phases)

> Dependency order derived from audit: engine exists → shell needs pairing → work needs editor/terminal → agents/library build on work streams → trust/voice/control need work+agents surfaces → hardening retires old surface.
> Each phase ships a usable increment. No big-bang rewrite.

## Phase 1 — FOUNDATION & SHELL
**Goal:** XR Desktop exists, pairs safely, shows Home + Runs (read) over the real engine.
- **Features:** sidecar lifecycle + locked-file pairing (SEC-04); design system v1 (tokens/type/motion/icons core); window/tray/deep-link skeleton; Home (composer→Work stub, continue cards, readiness strip); Runs list + anatomy read-only; workspace switcher; Settings shell (General/System); dashboard→headless-fallback designation; npm packaging fix (tarball-invariant gate, docs prune, republish 1.0.1 w/ mcp routes BUG-001).
- **UI:** shell skeleton, Home, Runs, Settings shell, splash/engine-down.
- **Backend:** pairing endpoint adaptation; no engine logic changes.
- **Desktop:** Tauri project, updater signing, installers channel.
- **CLI/TUI:** unaffected; `xr desktop` verb stub.
- **Assets:** canonical mark unification sheet; icon set v1 (60); avatar state treatments spec.
- **Migration:** none user-visible.
- **Deps:** none. **Risks:** webview parity (mitigate early w/ CM6/xterm spike).
- **Tests:** pairing E2E, respawn, Runs anatomy completeness, visual snaps, a11y base.
- **DoD:** install→pair→Home→open run anatomy on 3 OSes; gates green; rollback drill.

## Phase 2 — CORE WORK & WORKSPACE
**Goal:** daily-driver work surface + editor/terminal; onboarding experience.
- **Features:** Work transcript + tool timeline + inline approvals + inspector drawer + cost meter; memory peek; composer pins (files/capabilities); Mode pills; Model Center; editor (CM6: explorer/tabs/search/diff/problems-lite) + git rail; PTY terminals (new engine route, placement-applied); ask-on-selection loop (select→ask→diff→approve→apply); first-launch onboarding sequence w/ test task; budgets UI.
- **UI:** Work, Workspace, Model Center, onboarding, approval sheet v1.
- **Backend:** PTY route; SSE event extensions (pane hints); onboarding routes reuse.
- **Desktop:** pane layout engine, window state, drag/drop attach.
- **CLI/TUI:** glossary sync; parity tests.
- **Assets:** icon set v2; empty-state gallery.
- **Migration:** dashboard unchanged.
- **Deps:** P1. **Risks:** editor fidelity on WebKit (gate: parity matrix); PTY security review.
- **Tests:** editor↔agent E2E, approval E2E, PTY lifecycle, onboarding time budget, a11y full.
- **DoD:** complete a real coding task end-to-end in desktop w/ one approval; TUI/CLI parity green.

## Phase 3 — AGENTS & LIBRARY
**Goal:** teams visible; 65 skills + MCP + plugins = one library.
- **Features:** Agents board (roles/status/deps/burn/failures) + agent transcripts + node steer/approve; template gallery; Skills library (search/categories/detail/permissions/examples/run/config) + legacy flagging; MCP connections (connect/grants/cards) ; Plugins (install/sandbox status); Integrations browse; Research mode + report view w/ citations; Automations settings (triggers + pause-all).
- **UI:** Agents, Library (Skills/MCP/Plugins/Integrations), Research view, Automations.
- **Backend:** reuse agents/workflows/research routes; marketplace store exposure.
- **Deps:** P2. **Risks:** board complexity (disclosure ladder enforced).
- **Tests:** team-run fidelity vs engine fixtures; 65-skill browse parity; MCP grant E2E.
- **DoD:** run a 3-role team task watching live board; install+run a marketplace skill; connect an MCP server w/ grants.

## Phase 4 — TRUST, VOICE, CONTROL & NATIVE
**Goal:** felt safety + ambient modes + full OS citizenship.
- **Features:** Trust Center (queue/modes/audit/budgets/network/permissions/shield); MCP pinning + diff re-approval + workspace-suggest flow (SEC-01); skills pinning (SEC-02); Voice mode (overlay, PTT, states, barge-in v1, approvals-in-voice); Computer control cockpit + acting indicator + pre-flight + category blocks + history; native matrix (tray actions, notification actions, autostart, clipboard, deep links complete, updater GA); dashboard deprecation banner.
- **UI:** Trust Center, VoiceOverlay, ControlCockpit, notifications.
- **Backend:** voice WS route; control event extensions; pinning stores.
- **Deps:** P2+P3. **Risks:** audio device matrix; OS permission flows.
- **Tests:** voice corpus+latency; control stop-drill; pinning rug-pull simulation; native matrix per OS; win32 approval parity (SEC-06).
- **DoD:** voice conversation w/ work-preserving interrupt; control session w/ visible stop; rug-pull re-approval demo; notification→approve flow.

## Phase 5 — HARDENING, MIGRATION & ECOSYSTEM
**Goal:** GA quality; old surface retired; ecosystem parity.
- **Features:** parity matrix complete → dashboard headless-only; business routes satellite/flag-OFF (SEC-05); i18n (en/es/ur); export (md/json/pdf); website↔Library marketplace parity; VS Code deep links; manifest upgrade tooling GA; LSP-problems optional; merge helper; Wayland/portals; privacy manifest + opt-in diagnostics; shims/aliases removal at 2.0.0 cut.
- **UI:** polish pass, compact mode GA, high-contrast theme.
- **Backend:** deletions per migration plan; 2.0.0 version cut.
- **Deps:** P1–P4. **Risks:** deletion regressions (announce→warn→migrate→remove).
- **Tests:** full parity matrix CI; chaos/offline/recovery suite; migration drills; certification report.
- **DoD:** GA certification: all surfaces parity, security bench no-regression, rollback clean, docs complete.

## Cross-phase invariants
- Engine boundary CI from P1; glossary from P2; parity matrix living doc from P2; every phase ends w/ usable increment + rollback drill + docs update. [RECOMMENDED]
