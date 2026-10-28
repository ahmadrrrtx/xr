# XR V1 Feature-Coverage & Preservation Matrix — 2026-10-28

> **Companion to [`V1-RELEASE-LEDGER-2026-10-28.md`](V1-RELEASE-LEDGER-2026-10-28.md) (Phase 1 artifact).**
> One row per shipped feature. Statuses are strictly distinguished:
> **implemented** (code exists, compiles) · **tested** (automated test exercises
> it) · **verified-OS** (executed on a real OS surface, evidence named) ·
> **unverified** (exists, no evidence) · **not-implemented**. Anything this
> pass could not execute is *unverified*, never promoted by inference.
>
> **Preservation rule:** every row below is in-scope for V1 preservation.
> Deleting or hiding any row to simplify release is a defect, not a fix.

## 1. Desktop screens and windows

Source of routes: `desktop/src/router.tsx` (hash router; dev-only `/__brand`).

| # | Feature | Route / entry | Implementation location | Status @ HEAD (2026-10-28) | Coverage | Blocker / note |
|---|---|---|---|---|---|---|
| D-01 | Onboarding (gate + screen) | `/onboarding` | `desktop/src/screens/Onboarding/` | implemented | pending inventory | RC-208/RC-402 fixes merged via PR #199 — re-verify |
| D-02 | Chat | `/chat/:sessionId?` | `desktop/src/screens/Chat/` | implemented | pending | |
| D-03 | Brain (run inspector) | `/brain/:runId?` | `desktop/src/screens/Brain/` | implemented | pending | |
| D-04 | Workspaces list | `/workspaces` | `desktop/src/screens/Workspaces/` | implemented | pending | |
| D-05 | Workspace landing | `/workspaces/:id` | `desktop/src/screens/WorkspaceLanding.tsx` | implemented | pending | |
| D-06 | Builder | `/builder/:workspaceId?` | `desktop/src/screens/Builder/` | implemented | pending | Phase 3.5 audit target |
| D-07 | Research | `/research` | `desktop/src/screens/Research/` | implemented | pending | Phase 3.5 audit target |
| D-08 | Agents | `/agents` | `desktop/src/screens/Agents/` | implemented | pending | |
| D-09 | Skills Store | `/skills` | `desktop/src/screens/SkillsStore/` | implemented | pending | 65 bundled skills |
| D-10 | Shield | `/shield` | `desktop/src/screens/Shield/` | implemented | pending | |
| D-11 | Runs | `/runs` | `desktop/src/screens/Runs/` | implemented | pending | |
| D-12 | Memory | `/memory` | `desktop/src/screens/Memory/` | implemented | pending | |
| D-13 | Budget | `/budget` | `desktop/src/screens/Budget/` | implemented | pending | |
| D-14 | Integrations | `/integrations` | `desktop/src/screens/Integrations/` | implemented | pending | bots: discord/telegram/whatsapp sections seen in source |
| D-15 | Voice | `/voice` | `desktop/src/screens/Voice/` | implemented | pending | mic-failure paths = Phase 3 |
| D-16 | Settings | `/settings` | `desktop/src/screens/Settings/` | implemented | pending | |
| D-17 | Splash | boot | `desktop/src/screens/Splash.tsx` | implemented | pending | |
| W-01 | Main window | — | `desktop/src/App.tsx` | implemented | pending | |
| W-02 | HUD window | — | `desktop/src/hud/App.tsx` | implemented | pending | 96 HUD commands per RC report |
| W-03 | Orb window | — | `desktop/src/orb/App.tsx` | implemented | pending | |
| W-04 | Theater window | — | `desktop/src/theater/App.tsx` | implemented | pending | |
| S-01 | Tray | OS | Rust shell (`desktop/src-tauri/src/`) | implemented | pending | OS rendering not observed in this env (prior matrix: unit-tested only) |
| S-02 | Global shortcuts | OS | Rust shell | implemented | pending | same |
| S-03 | Updater | OS | `updates.rs` | implemented, **unprovisioned** | pending | fail-closed until owner sets TAURI_UPDATER_KEY (L-011) |
| S-04 | Crash recovery | OS | Rust shell | implemented | pending | |
| S-05 | Themes | settings | `desktop/src/styles/` | implemented | pending | light/dark per THEME-SYSTEM.md |

## 2. Providers, connectors, MCP, plugins, skills

| Group | Inventory (from HEAD source) | Status |
|---|---|---|
| Provider presets (26) | anthropic, bedrock, cerebras, cohere, deepseek, fireworks, google, gpt4all, groq, huggingface, jan, koboldcpp, llamacpp, lmstudio, localai, mistral, ollama, openai, openrouter, perplexity, sambanova, sglang, textgenwebui, together, vllm, xai — `src/providers/presets.ts` | implemented; tested-vs-unverified split = Phase 6 |
| Native adapters | anthropic, bedrock, cerebras, cohere, google, mistral, openai-responses (+ shared schemas/history) — `src/providers/native/` | implemented |
| Custom/openai-compat endpoints | `src/providers/custom.ts`, `openai-compat.ts`, `gateway.ts` | implemented |
| Connectors subsystem | `src/connectors/` (registry, service, runtime, credential vault adapter, MCP bridge, OAuth state) | implemented |
| MCP | `src/mcp/` (client, manager, allowlist, pins, registry) | implemented |
| Plugins | `plugins/github`, `plugins/hello` | implemented |
| Extensions | `extensions/vscode` | implemented |
| Skills | 65 bundled manifests in `skills/` | implemented |
| Bots/integrations | discord, telegram, whatsapp (`src/bots/` — verify in Phase 1 deep pass) | implemented |

## 3. Mobile companion (PWA)

Source: `mobile/` (React 18 + Vite + Workbox + zustand + idb-keyval).

| # | Feature | Implementation | Status |
|---|---|---|---|
| M-01 | Pairing (code + expiry + QR + TLS cert pinning) | `screens/PairingScreen.tsx`, `lib/certpin.ts` | implemented; verification Phase 5 |
| M-02 | Chat list + conversation | `screens/ChatListScreen.tsx`, `ConversationScreen.tsx` | implemented |
| M-03 | Approvals | `screens/ApprovalsScreen.tsx`, `stores/approvals.ts` | implemented |
| M-04 | Voice | `screens/VoiceScreen.tsx` | implemented |
| M-05 | Settings / logout / unpair | `screens/SettingsScreen.tsx` | implemented |
| M-06 | Offline queue + retry | `stores/queue.ts`, `lib/sync.ts`, `sw.ts` | implemented |
| M-07 | Connection/reconnect | `stores/connection.ts` | implemented |
| M-08 | Push notifications | service worker + `tools/test-web-push.mjs` | implemented |
| M-09 | Security restrictions (no file/terminal/Git/MCP from mobile sessions) | daemon-side session policy | implemented; adversarial tests Phase 5 |

## 4. Platform and packaging

| Item | Windows | Linux | Note |
|---|---|---|---|
| Installer targets | NSIS + MSI (+ MSIX wiring w/ fail-closed validation) | AppImage + .deb (+ rpm) | tauri.conf bundle targets list |
| Sidecar | engine sidecar per-triple via `scripts/compile-sidecar.ts` | same | |
| CI | `desktop-app.yml` matrix (x64 + arm64 legs per launch findings) | same | native runners only |

## 5. Shared engine / authority

- Single execution authority: surfaces → `AgentService` → envelope/runner →
  canonical loop/policy/tools → confined effects + SQLite/audit (AGENTS.md).
- Desktop uses bundled sidecar with independent engine home
  (`desktop/src-tauri` `engine.rs`, `desktop_home.rs`, `desktop/scripts/engine-home.ts`).
- Mobile uses authenticated daemon API over LAN.

## 6. Status legend and update rule

Rows are updated **only** with evidence (test name, log path, or executed
command in ledger §7). Phase 1 deep pass fills the Coverage column with the
actual test files; Phase 3/3.5/5/6 add verified-OS rows where the environment
allows, and mark the rest unverified with the exact missing capability.
