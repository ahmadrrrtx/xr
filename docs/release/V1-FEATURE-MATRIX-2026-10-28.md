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
| D-04 | Workspaces list | `/workspaces` | `desktop/src/screens/Workspaces/` | implemented, **verified** | `test/desktop/workspaces-core.test.ts` (filter/order/counts/withPatch; multi-select state machine; filter/search setters) | closed 2026-10-28 |
| D-05 | Workspace landing | `/workspaces/:id` | `desktop/src/screens/WorkspaceLanding.tsx` | implemented, **verified** | `landingRuns` extracted pure helper + `test/desktop/workspaces-core.test.ts` (id/name match, archived excluded, newest-first, cap 5, empty-honesty) | closed 2026-10-28 |
| D-06 | Builder | `/builder/:workspaceId?` | `desktop/src/screens/Builder/` | implemented, tested | `test/desktop/builder-core.test.ts` | Phase 3.5 audit target |
| D-07 | Research | `/research` | `desktop/src/screens/Research/` | implemented, tested | `test/desktop/research-core.test.ts`, `research-reduce.test.ts` | Phase 3.5 audit target |
| D-08 | Agents | `/agents` | `desktop/src/screens/Agents/` | implemented, **verified** | `test/desktop/agents-core.test.ts` (summaryFromCustom permission/scope derivation, editor lifecycle incl. dirty-guard, template/edit/duplicate seeds, favorites persistence, validateForm limits) + engine `test/agents/` | closed 2026-10-28 |
| D-09 | Skills Store | `/skills` | `desktop/src/screens/SkillsStore/` | implemented, tested | `test/desktop/skills-core.test.ts` | 65 bundled skills |
| D-10 | Shield | `/shield` | `desktop/src/screens/Shield/` | implemented, tested | `test/desktop/shield-core.test.ts` | |
| D-11 | Runs | `/runs` | `desktop/src/screens/Runs/` | implemented, tested | `runs-core.test.ts` + frontend-stores (empty-state honesty) | |
| D-12 | Memory | `/memory` | `desktop/src/screens/Memory/` | implemented, tested | `test/desktop/memory-core.test.ts` + engine `test/memory*.test.ts` | |
| D-13 | Budget | `/budget` | `desktop/src/screens/Budget/` | implemented, tested | `test/desktop/budget-core.test.ts`, `selection-accounting.test.ts` | |
| D-14 | Integrations | `/integrations` | `desktop/src/screens/Integrations/` | implemented, tested | `test/desktop/integrations-core.test.ts` | bots: discord/telegram/whatsapp |
| D-15 | Voice | `/voice` | `desktop/src/screens/Voice/` | implemented, tested | `test/desktop/voice-audio.test.ts`, `test/voice/` (6 files) | mic-failure paths = Phase 3 |
| D-16 | Settings | `/settings` | `desktop/src/screens/Settings/` | implemented, tested | `settings-core.test.ts` + frontend-stores (hydrate/persist/sync) | |
| D-17 | Splash | boot | `desktop/src/screens/Splash.tsx` | implemented, **verified** | `test/desktop/splash-core.test.ts` (boot status vocabulary, deterministic seeded particle field, bounds/ids) | closed 2026-10-28 |
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

| Group | Inventory (from HEAD source) | Status @ `4ce055f1`+ | Coverage (existing tests) |
|---|---|---|---|
| Provider presets (26) | anthropic, bedrock, cerebras, cohere, deepseek, fireworks, google, gpt4all, groq, huggingface, jan, koboldcpp, llamacpp, lmstudio, localai, mistral, ollama, openai, openrouter, perplexity, sambanova, sglang, textgenwebui, together, vllm, xai — `src/providers/presets.ts` | implemented | `test/providers/` 13 files: capability-fixtures (with `fixtures/`), credential-boundary, gateway, governed-attempts, malformed-response, native-continuation, offline-listing, probe-boundary, request-guard, resilience-boundary, service-authority, stream-settlement; tested-vs-unverified split per live key = Phase 6 |
| Native adapters | anthropic, bedrock, cerebras, cohere, google, mistral, openai-responses (+ shared schemas/history) — `src/providers/native/` | implemented | `native-continuation.test.ts`, `malformed-response.test.ts`, `stream-settlement.test.ts` |
| Custom/openai-compat endpoints | `src/providers/custom.ts`, `openai-compat.ts`, `gateway.ts` | implemented | `gateway.test.ts`, `credential-boundary.test.ts` |
| Connectors subsystem | `src/connectors/` (registry, service, runtime, credential vault adapter, MCP bridge, OAuth state) | implemented | `test/integrations/` (integrations-service, integrations-primitives) + fake-MCP fixtures in `test/fixtures/` |
| MCP | `src/mcp/` (client, manager, allowlist, pins, registry) | implemented | `test/integrations/integrations-mcp.test.ts`, `test/security/mcp-{allowlist,pinning,description-poison}.test.ts`, `test/trust/mcp-isolation.test.ts`, `test/phase8/mcp-isolation-grants.test.ts` |
| Plugins | `plugins/github`, `plugins/hello` | implemented | `test/plugins/` (fs-authority, host, loader) |
| Extensions | `extensions/vscode` | implemented | none found in test tree (IDE-side; out of daemon test reach) |
| Skills | 65 bundled manifests in `skills/` | implemented | `test/skills/` (counts-authority, quality, quarantine-policy) |
| Bots/integrations | discord, telegram, whatsapp (`src/bots/`) | implemented | `test/bots/shared-runtime.test.ts`, `telegram-characterization.test.ts`; discord/whatsapp characterization = Phase 6 |

## 3. Mobile companion (PWA)

Source: `mobile/` (React 18 + Vite + Workbox + zustand + idb-keyval).

| # | Feature | Implementation | Status @ `4ce055f1` (2026-10-28) | Coverage | Blocker / note |
|---|---|---|---|---|---|
| M-01 | Pairing (code + expiry + QR + TLS cert pinning) | `screens/PairingScreen.tsx`, `lib/certpin.ts`, daemon `mobile-pairing.ts` | implemented, **verified** | `tools/test-lan-flow.mjs` **28/28** (pair/re-pair/expiry/rate-limit/revoke/401-after-revoke); `test/daemon/mobile-pairing.test.ts` | |
| M-02 | Chat list + conversation | `screens/ChatListScreen.tsx`, `ConversationScreen.tsx`; daemon `/api/mobile/chats*` + `/api/mobile/chat` (store: `src/daemon/mobile-chats.ts`) | implemented, **verified** (was V1-P5-001: no real-daemon backend) | `test/daemon/mobile-companion.test.ts` (round-trip, local-first adoption, honest 503, no phantom rows); offline outbox drain `tools/test-offline.mjs` **12/12**; real-daemon e2e §7 #26 | chat send needs a live provider for a 200 stream (env has none — 503 path verified instead) |
| M-03 | Approvals | `screens/ApprovalsScreen.tsx`, `stores/approvals.ts`; daemon `/api/mobile/approvals(/:id)` | implemented, **verified** | `test/daemon/mobile-companion.test.ts` (shared decide path, 400/401/404 walls, first-decision-wins); lan-flow companion checks | |
| M-04 | Voice | `screens/VoiceScreen.tsx` | implemented, **unverified** | no automated coverage found | Phase 1/6 gap; needs real-device mic (owner) for full journey |
| M-05 | Settings / logout / unpair | `screens/SettingsScreen.tsx` | implemented, **verified** (models/budget read paths) | `test/daemon/mobile-companion.test.ts` (models list = installed + effective; cents budget = real store, no fabricated daily cap); logout/unpair via session.delete + revoke covered in lan-flow | |
| M-06 | Offline queue + retry | `stores/queue.ts`, `lib/sync.ts`, `sw.ts` | implemented, **verified** | `tools/test-offline.mjs` **12/12** in real headless Chrome: SW scope `/mobile/`, precache, IndexedDB chat cache, offline render, outbox → drain after reconnect | |
| M-07 | Connection/reconnect | `stores/connection.ts` + `/api/meta/version` probe | implemented, **verified** | probe endpoint `test/daemon/mobile-lan-integration.test.ts`; probe consumed by `stores/connection.ts` (401-on-revoked detection) | |
| M-08 | Push notifications | service worker + `tools/test-web-push.mjs` | implemented, **verified** (crypto layer) | `tools/test-web-push.mjs` RFC 8291/8188 cross-check vs reference web-push — **all pass** | live push delivery needs APNs/FCM reachability from a real phone (owner) |
| M-09 | Security restrictions (no file/terminal/Git/MCP from mobile sessions) | daemon-side session policy (`server.ts` mobile seam, 403 wall) | implemented, **verified** | adversarial: lan-flow 403-wall checks on canonical path; source audit 2026-10-28 (session carries device identity only; companion surface exposes read/act endpoints, never the tool surface) | |
| M-10 | PWA serving from the real daemon | `src/daemon/routes/mobile-companion.routes.ts` (`/mobile/` static, LAN-only) | implemented, **verified** (was V1-P5-001c: harness-only) | `test/daemon/mobile-companion.test.ts` (pre-auth shell, CSP/SW-scope headers, SPA fallback, traversal probe, LAN-off 404, missing-build 404); real-daemon e2e §7 #26; screenshots `mobile-pwa-0*.png` | |
| M-11 | Installability (manifest, icons, standalone) | `mobile/public/` (manifest.webmanifest, icons), served at `/mobile/` | implemented, **verified** (static) | manifest+icons served (e2e probe); `npm --prefix mobile run build` green | real-device Add-to-HomeScreen (owner) |

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
