# XR Desktop — Phase 2 Implementation Plan
**Date:** 2026-09-20 · **After Phase 1 elite hardening merged to main (c92eb46)**
**Status:** STARTED · **Branch:** main (now includes phase1/elite-hardening)

## Phase 1 Recap (DONE, merged via PR 125 → main)
- BUG-001 tarball invariant, SEC-04 token hygiene 0600, Windows path normalization, SEC-07 boundary CI
- Design system tokens.json 1.0.0-phase1 → generated CSS + TS + OS sync
- 10 screens hardened elite with tokens var(--xr-*), motion 120/200/320, focus cyan, skeleton/empty/error honest
- QA: engine typecheck PASS, desktop tsc PASS, daemon 111 tests PASS, tarball:check PASS
- Pushed to main: c92eb46, remote now b531837..c92eb46

## Phase 2 Goals (Current)
**Theme:** Full project CRUD, PTY terminal, Model Center provider matrix, Voice offline pipeline, Research source-first, Memory consolidation, Perf gates, MSI sidecar.

### P2-1 — Projects & Workspace Full CRUD
- **Projects screen:** real workspaces list from GET /workspaces, create/switch/delete, rootDir validation (engine rejects traversal), active chip, search, empty honest, skeleton.
- **Workspace screen enhancements:**
  - File explorer: create file/folder, rename, delete (approval-gated via files.write + policy), drag-drop? Keep simple click + context menu.
  - Editor: CodeMirror with save + diff preview live from engine fileDiff, tab dirty tracking, close confirmation, binary guard.
  - Terminal: move from line-based command runner to approval-gated PTY? Keep line-based for now but add history (localStorage xr-term-history), clear, multi-tab persistence, output cap 256KB honest, streaming SSE.
  - Git: stage/commit already wired, add push/pull? Keep approval-gated via engine git routes if exist, otherwise honest disabled.
  - Agent rail: proposed edits +/- chips from lineDelta, approve & apply via engine.

### P2-2 — Model Center Hardening
- Provider matrix: GET /providers returns 26 providers, capabilities, local flag, models, available, health.
- UI: grid with cards, status dot ok/warn/bad, primary chip, local chip, test button POST /models/test, set primary POST /providers/set, key management via OS keyring (engine secret store, shell never persists keys).
- Search/filter by capability (chat, embeddings, vision), local vs cloud.
- Empty honest: no providers → engine unreachable message.
- Budget integration: show per-task cap from budgetState.

### P2-3 — Voice Offline Pipeline Hardening
- Voice screen already has 12-state machine + waveform.
- Hardening: ensure STT/TTS availability from GET /voice/status, engine-reported, no fake levels.
- Mic levels from analyser, out levels from TTS analyser, both real.
- Approval flow: say confirm/cancel → POST /approvals/decide via engine, durable store decides.
- Barge-in: speaking → listening on mic input.
- Offline: engine unreachable → state offline honest.

### P2-4 — Research & Memory (Source-First)
- Research screen: source-first reports with citations, content guards, engine GET /research? etc if exists, otherwise honest empty with CTA to use Work skill.
- Memory screen: GET /memory, consolidation, forgetting, explainable recall, consent gates.
- Both use tokens, skeleton, empty honest.

### P2-5 — Performance & Security Gates
- Perf: perf-baseline + perf-gate scripts, dashboard-bench, ensure 3.5s hardware probe + N×2.5s runtime detection not on request path (background refresh already in daemon server.ts).
- Security: injection bench GET /security, shield status, posture score, audit chain hash intact, SBOM, license-check.
- CI: ensure ci-capability-gate, api:schema:check, client:check, boundaries, size-gate all PASS.

### P2-6 — Desktop Packaging & Sidecar
- Tauri v2 sidecar: ensure engine binary sidecar attach probe, 0600 token discovery ~/.xr/daemon-token auto-read by Tauri shell, tray quick actions.
- MSI/DMG/AppImage: build per OS via tauri build, WebView2 evergreen, notarize in CI (requires secrets).
- Window state persistence already done (xr-window-bounds).
- Deep links, autostart, updater = Phase 4 but prepare scaffolding.

## DoD for Phase 2
- Projects CRUD works on 3 OSes, file create/rename/delete approval-gated, terminal history + multi-tab, git stage/commit real.
- Model Center provider matrix with test + set primary + search/filter.
- Voice offline pipeline real levels + barge-in + approval confirm/cancel.
- Research & Memory honest empty or real data, source-first citations if engine provides.
- Perf gates PASS, security bench PASS, no fake telemetry.
- Desktop preview live on https://5173-...e2b.app (XR_DEV_EXPOSE=1 + .e2b.app allowedHosts).

## Current Actions
- Desktop preview running: process xr-desktop-preview-elite-c47901e6 on 5173 with allowedHosts .e2b.app, pairing code printed in logs.
- Branch main now at c92eb46 (Phase 1 merged).
- Starting P2-1 Projects hardening now.

## Next Steps
1. Harden Projects.tsx + ModelCenter.tsx + Research.tsx + Memory.tsx + Settings.tsx to elite (same token patterns).
2. Enhance Workspace terminal history + persistence.
3. Run typecheck + daemon tests + tarball:check.
4. Commit + push to new branch phase2/full-crud + PR → main.
5. Keep desktop preview live.

