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
| D-01 | Onboarding (gate + screen) | `/onboarding` | `desktop/src/screens/Onboarding/` | implemented, tested | `test/ux/onboarding-yes.test.ts`; onboarding store in RC-208 tests | |
| D-02 | Chat | `/chat/:sessionId?` | `desktop/src/screens/Chat/` | implemented, tested | `test/desktop/frontend-stores.test.ts` (chatStore: modes, attachments, offline queue, SR announcements) | |
| D-03 | Brain (run inspector) | `/brain/:runId?` | `desktop/src/screens/Brain/` | implemented, tested | `frontend-stores.test.ts` (brainStore) | |
| D-04 | Workspaces list | `/workspaces` | `desktop/src/screens/Workspaces/` | implemented, **unverified** | no dedicated test found in Phase-1 scan | Phase 1 gap to close |
| D-05 | Workspace landing | `/workspaces/:id` | `desktop/src/screens/WorkspaceLanding.tsx` | implemented, **unverified** | none found | Phase 1 gap |
| D-06 | Builder | `/builder/:workspaceId?` | `desktop/src/screens/Builder/` | implemented, tested | `test/desktop/builder-core.test.ts` | Phase 3.5 audit target |
| D-07 | Research | `/research` | `desktop/src/screens/Research/` | implemented, tested | `test/desktop/research-core.test.ts`, `research-reduce.test.ts` | Phase 3.5 audit target |
| D-08 | Agents | `/agents` | `desktop/src/screens/Agents/` | implemented, **unverified** | none dedicated (multi-agent engine tests exist in `test/agents/`) | Phase 1 gap (UI level) |
| D-09 | Skills Store | `/skills` | `desktop/src/screens/SkillsStore/` | implemented, tested | `test/desktop/skills-core.test.ts` | 65 bundled skills |
| D-10 | Shield | `/shield` | `desktop/src/screens/Shield/` | implemented, tested | `test/desktop/shield-core.test.ts` | |
| D-11 | Runs | `/runs` | `desktop/src/screens/Runs/` | implemented, tested | `runs-core.test.ts` + frontend-stores (empty-state honesty) | |
| D-12 | Memory | `/memory` | `desktop/src/screens/Memory/` | implemented, tested | `test/desktop/memory-core.test.ts` + engine `test/memory*.test.ts` | |
| D-13 | Budget | `/budget` | `desktop/src/screens/Budget/` | implemented, tested | `test/desktop/budget-core.test.ts`, `selection-accounting.test.ts` | |
| D-14 | Integrations | `/integrations` | `desktop/src/screens/Integrations/` | implemented, tested | `test/desktop/integrations-core.test.ts` | bots: discord/telegram/whatsapp |
| D-15 | Voice | `/voice` | `desktop/src/screens/Voice/` | implemented, tested | `test/desktop/voice-audio.test.ts`, `test/voice/` (6 files) | mic-failure paths = Phase 3 |
| D-16 | Settings | `/settings` | `desktop/src/screens/Settings/` | implemented, tested | `settings-core.test.ts` + frontend-stores (hydrate/persist/sync) | |
| D-17 | Splash | boot | `desktop/src/screens/Splash.tsx` | implemented, **unverified** | none dedicated | minor |
| W-01 | Main window | — | `desktop/src/App.tsx` | implemented, tested | deep-link listener tested in frontend-stores; shell parity `test/ux/shell-parity.test.ts` | |
| W-02 | HUD window | — | `desktop/src/hud/App.tsx` | implemented, tested | `test/desktop/orb-core.test.ts` adjacency; HUD command surface in RC IPC gates | 96 HUD commands per RC report |
| W-03 | Orb window | — | `desktop/src/orb/App.tsx` | implemented, tested | `test/desktop/orb-core.test.ts` | |
| W-04 | Theater window | — | `desktop/src/theater/App.tsx` | implemented, tested | `test/desktop/theater-core.test.ts` | |
| S-01 | Tray | OS | Rust shell (`desktop/src-tauri/src/`) | implemented, tested | `test/desktop/tray-icons.test.ts` | OS rendering not observed in this env |
| S-02 | Global shortcuts | OS | Rust shell | implemented, **unverified-OS** | unit tests in Rust shell per prior matrix | |
| S-03 | Updater | OS | `updates.rs` | implemented, **unprovisioned** | fail-closed state tested | BLOCKED: owner must set `TAURI_UPDATER_KEY` + publish pubkey (L-011) |
| S-04 | Crash recovery | OS | Rust shell | implemented, **unverified-OS** | unit tests per prior matrix | |
| S-05 | Themes | settings | `desktop/src/styles/` | implemented, tested | `test/ux/mode-color.test.ts`, `contrast.test.ts` | light/dark |
| S-06 | Approvers / denial paths | engine+UI | `src` approval plane | implemented, tested | `test/desktop/approval-core.test.ts`, fail-closed matrix tests | Phase 3 exercises allow+deny |
| S-07 | IPC ACL / command surface | Rust bridge | `desktop/src-tauri/capabilities/` | implemented, tested | `test/desktop/ipc-acl.test.ts`, `desktop:ipc-acl` gate | 129 main/124 workspace/96 HUD/9 orb/10 theater commands |

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
