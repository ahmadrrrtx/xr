# XR Desktop Rebuild Blueprint — Index

> Status: **APPROVED 2026-09-17** (see [XR_DECISION_RECORD.md](XR_DECISION_RECORD.md)) — implementation unlocked per phase gates; Phase 1 in progress.
> Evidence date: 2026-09-17 · repo `main` 7ba2dc8 (v1.0.0 "Truth") · runtime exercised (CLI/TUI/daemon/dashboard/tests) · npm artifact audited · competitive research cited.
> Reading order: audits → research → architecture → experience → plans → master plan → concepts.

## The one-paragraph summary
XR's engine (agent loop, durable execution, fail-closed trust placement, egress proxy, Ed25519 audit, cost governance, 26 providers, 65 skills, MCP/plugins, research, voice pipeline, computer control) is strong and verified (3,242 tests green). Its user-facing layer is an admin cockpit + terminal surfaces. The rebuild wraps the engine in **XR Desktop** (Tauri v2 shell over the existing 129-op local daemon API): a workstation of five areas (Home, Work, Workspace, Agents, Library) plus a Trust Center, Runs, ambient Voice/Control modes, and a new design system built on the official logo/avatar — delivered in 5 phases, each a usable increment, with the old dashboard deprecated only after parity.

## Documents

| # | Doc | Contents |
|---|---|---|
| 1 | [XR_COMPLETE_FORENSIC_AUDIT.md](XR_COMPLETE_FORENSIC_AUDIT.md) | subsystem map, execution trace, works/partial/dead/dup, runtime log, defect log |
| 2 | [XR_TECHNICAL_AUDIT.md](XR_TECHNICAL_AUDIT.md) | toolchain/gates, npm audit (+BUG-001 drift), API, persistence, platforms |
| 3 | [XR_SECURITY_AUDIT.md](XR_SECURITY_AUDIT.md) | protections verified, findings SEC-01…09, boundary law |
| 4 | [XR_UX_AUDIT.md](XR_UX_AUDIT.md) | Control Center/TUI/CLI/ext/onboarding audit, KEEP/REUSE/REBUILD/REMOVE |
| 5 | [XR_ASSET_AUDIT.md](XR_ASSET_AUDIT.md) | avatar/logo specs, brand duality (BUG-002), dispositions, usage rules |
| 6 | [XR_COMPETITIVE_RESEARCH.md](XR_COMPETITIVE_RESEARCH.md) | cited research: Claude Code, Cursor, Codex, Antigravity, MCP security, computer use, voice, shells |
| 7 | [XR_DESKTOP_ARCHITECTURE.md](XR_DESKTOP_ARCHITECTURE.md) | Tauri v2 decision, shell/engine diagram, pairing, budgets, risks |
| 8 | [XR_PRODUCT_ARCHITECTURE.md](XR_PRODUCT_ARCHITECTURE.md) | layers, glossary (8 nouns), capability→surface map, non-goals |
| 9 | [XR_INFORMATION_ARCHITECTURE.md](XR_INFORMATION_ARCHITECTURE.md) | 5 areas + Trust/Runs, palette, disclosure ladder, terminology map |
| 10 | [XR_FEATURE_INVENTORY.md](XR_FEATURE_INVENTORY.md) | 84 discovered capabilities w/ locations & support matrix |
| 11 | [XR_FEATURE_PHASE_MATRIX.md](XR_FEATURE_PHASE_MATRIX.md) | every feature → target location/UX/API/security/phase/deps/tests |
| 12 | [XR_DESIGN_SYSTEM.md](XR_DESIGN_SYSTEM.md) | "XR Prism": mark system, tokens, type, space, motion, icons, components, a11y |
| 13 | [XR_SCREEN_SPECS.md](XR_SCREEN_SPECS.md) | 24 screens w/ full spec fields |
| 14 | [XR_DESKTOP_NATIVE_PLAN.md](XR_DESKTOP_NATIVE_PLAN.md) | tray/notifications/shortcuts/deeplinks/autostart/updater/recovery |
| 15 | [XR_EDITOR_PLAN.md](XR_EDITOR_PLAN.md) | CM6+xterm, AI loop behaviors, safety, DoD |
| 16 | [XR_MULTI_AGENT_PLAN.md](XR_MULTI_AGENT_PLAN.md) | team runs, board, steer/approve, budgets, failures |
| 17 | [XR_COMPUTER_CONTROL_PLAN.md](XR_COMPUTER_CONTROL_PLAN.md) | cockpit, acting indicator, category blocks, kill switch |
| 18 | [XR_VOICE_PLAN.md](XR_VOICE_PLAN.md) | presence states, barge-in, latency budgets, approval integrity |
| 19 | [XR_SKILLS_PLAN.md](XR_SKILLS_PLAN.md) | library UX, trust legibility, 5 proposed skills |
| 20 | [XR_MCP_PLUGIN_PLAN.md](XR_MCP_PLUGIN_PLAN.md) | connections, grants, pinning/rug-pull defense, plugins |
| 21 | [XR_ONBOARDING_PLAN.md](XR_ONBOARDING_PLAN.md) | 8-step first launch, rules, parity |
| 22 | [XR_MIGRATION_PLAN.md](XR_MIGRATION_PLAN.md) | remain/wrap/deprecate/delete, compat guarantees, cutover, rollback |
| 23 | [XR_QA_PLAN.md](XR_QA_PLAN.md) | layered strategy incl. chaos/offline/voice/control/native, certification |
| 24 | [XR_MASTER_IMPLEMENTATION_PLAN.md](XR_MASTER_IMPLEMENTATION_PLAN.md) | 5 phases w/ goals/features/work/deps/risks/tests/DoD |
| — | [concepts/](concepts/) | 10 visual concepts (approval gate artifacts) |

## Evidence conventions
[OBSERVED] measured/read this audit · [INFERRED] reasoned · [RECOMMENDED] proposed action · [PROPOSED] new feature idea · [RESEARCH-BACKED] cited external source (see Competitive Research).

## Approval gate
Implementation begins only after explicit human approval of: audits, security findings, architecture decisions (Tauri v2 + engine boundary), IA, design system, screen specs, phase plan, and visual concepts.
