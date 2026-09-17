# XR — Feature → Product Location → Phase Matrix

> Every existing feature maps somewhere; nothing important is lost. Phases: **P1** Foundation & Shell · **P2** Core Work & Workspace · **P3** Agents & Library · **P4** Trust, Voice, Control & Native · **P5** Hardening, Migration & Ecosystem.
> Columns: current location → target location · target UX · backend/API need · security note · phase · deps · test emphasis.

## P1 — Foundation & Shell (usable increment: desktop opens, pairs, shows Home + Runs read-only)

| Feature (inv #) | Current | Target | UX | API | Security | Deps | Tests |
|---|---|---|---|---|---|---|---|
| H3 daemon/API | daemon | engine sidecar | invisible | reuse | pairing fix SEC-04 | — | pairing, respawn |
| H6 doctor/status | CLI | Home readiness strip + Settings→System | glanceable | reuse /health,/overview | — | — | readiness states |
| H4 dashboard | SSR panels | headless fallback (deprecated primary) | — | reuse | — | P1 shell | fallback parity |
| Runs list (A4,A9,H3) | sessions panel | Runs surface (list+anatomy read) | scannable | reuse /sessions | — | — | anatomy completeness |
| Workspaces (H3) | workspace cmd | titlebar context switcher | one-click | reuse /workspaces | — | — | switch integrity |
| Auth/session (H3) | token/cookie | locked-file pairing + cookie | silent | adapt | SEC-04 | — | no token in URL/history |
| Design system | none | all surfaces | tokens/components | — | — | — | visual regression |
| H7 installers | sh/ps1/brew… | + desktop installer channel | guided | — | signing | P1 | install matrix |

## P2 — Core Work & Workspace (increment: real daily-driver work surface + editor)

| Feature | Current | Target | UX | API | Security | Deps | Tests |
|---|---|---|---|---|---|---|---|
| A1-A3 loop/modes/streaming | CLI/TUI/chat panel | Work surface transcript | conversational+live | reuse /chat SSE | boundary CI | P1 | stream parity w/ TUI |
| C1-C4 tools/git/shell | tools/ | tool timeline + diff panes + terminal | legible activity | reuse | placement unchanged | P1 | tool event fidelity |
| D3 approvals inline | approvals panel/CLI | inline approval moments + global sheet | decision-first | reuse /approvals | UI display-only (SEC-07) | P2 work | approval E2E |
| E1-E3 memory | memory cmd/panel | memory peek drawer + Memory settings | human-readable | reuse /memory | ACLs kept | P2 | forget/delete flows |
| Editor (new) | none (files panel) | Workspace: explorer/tabs/CM6/diff/problems | select→ask→diff→approve→apply | reuse /files/* | path-traversal server-side | P2 | editor↔agent loop |
| Terminal (new) | none | PTY panes in Workspace | native feel | new PTY route (engine-owned) | shell placement unchanged | P2 | PTY lifecycle |
| Git panel | git tools | Workspace git rail | glanceable | reuse tools | — | P2 | status/diff accuracy |
| B1-B8 models/providers | providers cmds/panel | Model Center (Library) | connect/test/default/fallback | reuse /providers,/models | keys stay keyring | P2 | BYOK flows |
| D13 budgets | budget cmd/panel | Trust→Budgets + Work cost meter | always-visible spend | reuse /budget,/cost | enforcement engine-side | P2 | cap enforcement UI |
| H5 onboarding | CLI wizard | first-launch experience (desktop) | narrative | reuse /onboarding | — | P2 | no repeat-loop after setup |
| H1/H2 CLI/TUI | — | unchanged, glossary sync | — | — | — | P2 | terminology parity |

## P3 — Agents & Library (increment: teams visible; 65 skills discoverable)

| Feature | Current | Target | UX | API | Security | Deps | Tests |
|---|---|---|---|---|---|---|---|
| A5-A7 workflows/partitions | engine | Agents surface: team runs (roles/status/deps/progress/budget) | orchestration map | reuse /agents,/execution | — | P2 | team-run fidelity |
| A6 roles/permissions | agents registry | agent definitions viewer/editor (advanced) | legible profiles | reuse | profiles engine-owned | P3 | profile scoping |
| F1-F4 skills | skills cmd/panel | Library→Skills: search/categories/featured/detail/permissions/examples/run | marketplace-grade | reuse /skills | signing shown; SEC-02 badges | P2 | 65-skill browse parity |
| F7-F8 MCP | mcp cmd | Library→MCP: connect/status/tools/health/activity + pinning | connection trust | reuse+mcp routes (republish) | SEC-01 pinning | P3 | rug-pull re-approval |
| F5-F6 plugins | plugins cmd | Library→Plugins: install/enable/sandbox status | safe extensibility | reuse /plugins | signing surfaced | P3 | sandbox worker E2E |
| F9 integrations | capabilities | Library→Integrations (discovered catalog) | browse/connect | reuse /capabilities | grants UI read-only | P3 | catalog parity (165) |
| E4-E5 research | research cmd/panel | Work research mode + report view w/ citations | source-first | reuse /research | guards unchanged | P3 | citation rendering |
| I1 workflow templates | templates json | Automations starter gallery | one-click starters | reuse workflows | — | P3 | template run |
| G2 triggers | triggers cmd/panel | Settings→Automations + Runs filters | scheduled legibility | reuse /triggers | pause-all prominent | P3 | trigger fire E2E |

## P4 — Trust, Voice, Control & Native (increment: felt safety + ambient modes + OS citizenship)

| Feature | Current | Target | UX | API | Security | Deps | Tests |
|---|---|---|---|---|---|---|---|
| D1-D2 trust/placement | trust cmd | Trust→Modes (Careful/Balanced/Autonomous) + placement detail | named autonomy | reuse /trust | fail-closed kept | P2 | mode↔tier mapping |
| D7 audit | audit cmd/panel | Trust→Audit (chain verify UI, export) | tamper-evident story | reuse /audit | verify engine-side | P4 | chain UI parity |
| D10 shield | hygiene cmd/panel | Trust→Shield | calm scanner | reuse /shield | not boundary (ADR-0027) | P4 | scan states |
| D12 capability grants | capabilities cmd | Trust→Permissions (grants table, quarantine/rollback) | advanced clarity | reuse /capabilities | — | P4 | quarantine flows |
| G3 voice | voice cmd | Voice mode: avatar presence states + push-to-talk + barge-in | ambient conversation | reuse voice pipeline + new WS audio | mic perms; recordings local | P4 | state machine + latency p95 |
| G4-G5 computer/browser | control cmd/panel | Control cockpit sheet + acting indicator + stop | visible control | reuse /control | SEC-03 category blocks | P4 | stop/cancel E2E |
| G1 telegram | telegram | Channels settings (connect/status) + Work mirrors | optional channel | reuse | disclosure (SEC-09) | P4 | bot smoke |
| Native: tray/notifications/shortcuts/deeplinks/autostart/updater/clipboard/drag-drop | none | desktop shell | OS citizenship | Tauri IPC | updater signed | P4 | per-OS matrix |
| D5 egress visibility | invisible | Trust→Network (allowlist editor, blocked events) | legible egress | reuse audit events | engine enforced | P4 | allowlist UX |

## P5 — Hardening, Migration & Ecosystem (increment: GA-quality everywhere, old surface retired)

| Feature | Current | Target | Notes |
|---|---|---|---|
| H4 dashboard | primary | headless fallback only | deprecation banner → removal 2.x |
| I2 business routes | core daemon | satellite or flag-OFF | SEC-05 |
| H10 i18n | seeds | desktop string catalog (en/es/ur) | reuse i18n dir |
| H11 export | partial | Runs→export (md/json/pdf) | reuse export/ |
| H8 website/marketplace | Next app | marketplace ↔ Library parity feed | reuse generator |
| F10 vscode ext | thin | selection→Work deep-link + cost meter kept | deeplinks xr:// |
| QA/perf/a11y gates | repo gates | + desktop gates (bundle, IPC contract, axe, PTY matrix, win32 approvals) | SEC-06 |
| Migration shims/deprecations | shims | removal per 2.0.0 plan | Migration doc |
| Offline/degraded modes | partial | engine-down splash, queued tasks, retry | crash recovery |
| Telemetry privacy | none | privacy manifest + opt-in diagnostics only | SEC-08 |

**Coverage check:** all 84 inventory items appear above (A1–A10, B1–B8, C1–C4, D1–D13, E1–E5, F1–F10, G1–G6, H1–H12, I1–I10). [RECOMMENDED mapping; OBSERVED current locations]
