# XR — Complete Feature Inventory

> [OBSERVED] unless tagged. Support codes: B=backend/daemon, U=current UI(dashboard), C=CLI, T=TUI, A=API. Quality: S=solid, G=good, P=partial, X=absent-in-surface.
> Source locations abbreviated under `src/`. 65 bundled skills verified on disk (`skills/`, 54 manifests + 11 legacy md).

## A. Agent & execution

| # | Feature | Impl | Location | C/T/U/A | Q | Notes |
|---|---|---|---|---|---|---|
| A1 | Agent loop (Observe→Think→Act) | single spine | core/agent.ts | C T B A | S | only runner calls loop (test-enforced) |
| A2 | Modes agent/plan/ask | flags+tools scoping | cli, core | C T A | S | |
| A3 | Streaming events (token/tool/status/done) | StreamEventSink | core/types, daemon SSE | T U A | S | real provider deltas |
| A4 | Durable execution + checkpoints + resume | task-runtime, checkpoint repo | execution/, state/repos | C A | S | doctor shows unresolved work |
| A5 | Workflow engine (nodes, versioning, human nodes) | engine+state machine | execution/workflow | B A | S | UI exposure minimal (P) |
| A6 | Multi-agent planner + roles + permission profiles | planner/registry | agents/ | C B A | S | `xr agents`; dashboard agents panel thin |
| A7 | Partitions/leases/lanes (isolation & ownership) | execution | execution/ | B | S | not surfaced in UX (P) |
| A8 | Stall detection + retry classification + recovery | core/stall-detector, execution/recovery | core, execution | B | S | |
| A9 | Run inspection (status summary) | inspection | execution/inspection.ts | C A | G | no narrative UI (P) |
| A10 | Cancellation (agent-cancel) | request-guard | providers/request-guard | C T A | S | |

## B. Providers, models, local AI

| # | Feature | Impl | Location | C/T/U/A | Q |
|---|---|---|---|---|---|
| B1 | 26 provider presets (10 local, 16 cloud) | presets+native adapters | providers/ | C U A | S |
| B2 | BYOK key management (keyring) | secrets+config | security/secrets, commands/providers | C U A | S |
| B3 | Fallback chain + model-switch | providers | providers/ | C B A | S |
| B4 | Intelligence routing (capability/health/SLO/failover/degradation) | router/scorer | intelligence/ | B A | S | invisible in UX (P) |
| B5 | Local runtime detection/admission/recommend (ollama etc.) | local/ | local/ | C U A | S |
| B6 | Hardware probe + model recommendations | local/hardware,recommend | local/ | C A | G |
| B7 | Provider health matrix + canaries | health; CI canaries | providers/health | C U A | S |
| B8 | Model test/select | commands/providers, API models/test | commands, daemon | C U A | S |

## C. Tools & actions

| # | Feature | Location | C/T/U/A | Q |
|---|---|---|---|---|
| C1 | 18 core tools (files/shell/git×8/fetch/web_search/check_package/computer_control) | tools/ | B | S |
| C2 | Tool scoping per mode/agent (allow/deny) | core/agent deps | B | S |
| C3 | Git workflows via tools | tools/git.ts | B | S |
| C4 | Shell execution w/ placement | control/executor + trust | B | S |

## D. Security & trust

| # | Feature | Location | C/T/U/A | Q |
|---|---|---|---|---|
| D1 | Risk tiers + placement policy (fail-closed, hardened) | runtime/trust | C B A | S |
| D2 | Sandboxes: restricted-proc/namespace/container/gVisor/Firecracker | runtime/trust/environment | B | S (hooks) |
| D3 | Approvals store + decisions (deny/once/always) | control/approvals | C T U A | S |
| D4 | Typed-confirm (headless approvals) | control/typed-confirm | C B | S |
| D5 | Egress proxy (allowlist, DNS pin, private-block, caps) | security/egress-proxy | B | S |
| D6 | Secret broker (default OFF) + keyring | security/secret-broker,secrets | C B | S |
| D7 | Ed25519 audit chain + anchor + verify/export | security/audit-* | C U A | S |
| D8 | Prompt-injection benchmark (`xr attacks`) | security/attacks | C B | S |
| D9 | Tool-output framing + research content/url guards | security/tool-output, research/*-guard | B | S |
| D10 | XR Shield / host hygiene (processes/startup/miners/privacy) | hygiene/, xr-shield | C U A | G (not boundary, ADR-0027) |
| D11 | seccomp blocklists (assets) | assets/seccomp | B | S |
| D12 | Capability grants/certify/quarantine/rollback | capabilities/ | C U A | S |
| D13 | Budgets/reservations/partitions (cost governor) | cost/ | C U A | S |

## E. Context, memory, research

| # | Feature | Location | C/T/U/A | Q |
|---|---|---|---|---|
| E1 | User + project memory (SQLite, ACLs Phase 7) | context/memory, state/repos | C U A | S |
| E2 | Memory inject/compact into loop | context/memory/inject,compact | B | S |
| E3 | Context inspection/approve-pending/revoke/undo | context/, daemon context routes | C U A | G |
| E4 | Research engine (plan/search/extract/rank/synth/report) + citations | research/ | C U A | S |
| E5 | Research jobs + SSE + cancel | research/jobs | U A | S |

## F. Extensions ecosystem

| # | Feature | Location | C/T/U/A | Q |
|---|---|---|---|---|
| F1 | 65 bundled skills (54 manifest, 11 legacy md) | skills/ | C U A | S/G |
| F2 | Skill marketplace (backend store, deps solver, download engine) | skills/marketplace* | C B A | G |
| F3 | Skill signing/verify/permissions/tool-allowlist | skills/signing,permissions | C B | S |
| F4 | Skill autolearn | skills/autolearn.ts | B | P |
| F5 | Plugins host + sandbox worker + protocol | plugins/ | C B A | S |
| F6 | Plugin signing (Phase 8) + catalog + allowlist | plugins/ | C B | S |
| F7 | MCP client/manager/registry/allowlist | mcp/ | C B A | S |
| F8 | MCP daemon routes (repo only; npm drift BUG-001) | daemon/routes/mcp.routes.ts | A | P |
| F9 | Integrations catalog (capabilities 165 incl. discovered) | capabilities inventory | C U A | G |
| F10 | VS Code ext (cost meter, ask-on-selection, open dashboard) | extensions/vscode | IDE | G (thin) |

## G. Channels, automation, voice, computer

| # | Feature | Location | C/T/U/A | Q |
|---|---|---|---|---|
| G1 | Telegram bot (commands/render/auth) | telegram/ | channel | G (untested in audit env) |
| G2 | Triggers/automations (cron/webhook/token-bucket/pause-all) | automation/ | C U A | S |
| G3 | Voice pipeline v2 (VAD/wake/STT/TTS/intents, streaming states) | voice/ | C B | P (needs ffmpeg/whisper/piper) |
| G4 | Computer control (screen/vision/actions) tier2+approvals | control/computer-use,vision | C B A | G (OS-tool dependent) |
| G5 | Browser automation (Playwright) + shield browser views | control/browser, shield routes | C U A | G |
| G6 | Environment sessions (observe/act governed) | platform/environment | C B A | S |

## H. Surfaces & ops

| # | Feature | Location | Q |
|---|---|---|---|
| H1 | CLI ~40 verbs + formats (text/json/yaml/md) | cli/, commands/ | S |
| H2 | TUI Shell (workspace picker, status bar, palette) | interfaces/shell | S |
| H3 | Daemon + 129-op API + OpenAPI sync | daemon/ | S |
| H4 | Control Center dashboard (23 panels, SSR) | daemon/dashboard | G (UX debt) |
| H5 | Onboarding wizard (CLI) + daemon onboarding routes | interfaces/onboard, daemon | P (form-like) |
| H6 | doctor/status/repair/update(logs) | commands/ | S |
| H7 | Installers sh/ps1 + brew/scoop/winget + Docker + binary matrix | install.*, packaging/, Dockerfile, scripts/build-matrix | S |
| H8 | Website (Next) + marketplace generator | website/ | G |
| H9 | Observability (structured logs, metrics, spans, traces routes) | observability/ | S |
| H10 | i18n seeds (README es/ur; i18n dir) | i18n/, README-* | P |
| H11 | Export (session/report export) | export/ | P |
| H12 | Satellites business-os / xr-enterprise (+shims) | satellites/ | G |

## I. Discovered extras (not README-obvious)

| # | Feature | Evidence |
|---|---|---|
| I1 | Workflow templates (11 JSON: competitor-monitoring, content-calendar, customer-onboarding, email-campaign, invoice-generation, lead-qualification, market-research, meeting-prep, sales-followup, support-routing, weekly-reports) | [OBSERVED] src/templates/workflows/ |
| I2 | Business L0 views (journeys/workers/outcomes/privacy-subjects) still in core | [OBSERVED] core/business-l0.ts + daemon business routes |
| I3 | Mutation testing gate (0.6 threshold), fuzz-canonic, soak, perf gates, profile gate | [OBSERVED] package.json scripts |
| I4 | Ownership map + CODEOWNERS gate | [OBSERVED] scripts/ownership-map.ts |
| I5 | API compat + client generation gates | [OBSERVED] scripts/api-compat.ts, generate-client.ts |
| I6 | Channel manifest + claim-lint (marketing-claim evidence gate) | [OBSERVED] scripts/ |
| I7 | Constitution + claim citations enforcement | [OBSERVED] docs/CONSTITUTION.md |
| I8 | a11y test suite (axe, WCAG 2.2, keyboard) live-gated | [OBSERVED] test/a11y |
| I9 | E2E blackbox + ecosystem tests | [OBSERVED] test/e2e-blackbox, ecosystem.test.ts |
| I10 | Provider fixtures/matrix + pentest/readiness reports (Phase 10) | [OBSERVED] docs/PHASE_08…, git log phase10 |

**Counts:** 74 primary features (A10+B8+C4+D13+E5+F10+G6+H12) + 10 extras = **84 discovered capabilities**; 65 skills verified; 165 capability records; 129 API ops.
