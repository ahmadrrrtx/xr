# XR — Desktop Architecture

> Tags: [OBSERVED] / [INFERRED] / [RESEARCH-BACKED] / [RECOMMENDED]. Decision record for the XR Desktop shell.

## 1. Requirements (from audit + research)

| R# | Requirement | Driver |
|---|---|---|
| R1 | Rich web-technique UI (editor, terminal, panes, motion) on Win/macOS/Linux | product brief |
| R2 | Small footprint, fast start; must coexist with local models eating RAM | local-first [OBSERVED doctor], [RESEARCH-BACKED] Tauri numbers |
| R3 | Strong default security posture; UI must not be the security boundary | SEC-07; XR trust model [OBSERVED] |
| R4 | Talk to existing Bun daemon over loopback HTTP/SSE (129 ops) — no logic duplication | backend boundary [OBSERVED] |
| R5 | Native: tray, notifications, global shortcuts, deep links, file open, autostart, updater, crash recovery | brief |
| R6 | Sidecar/process management: start/monitor/respawn `xr serve` (or compiled binary) | [OBSERVED] bin/xr launcher model |
| R7 | PTY terminals (multiple), system webview acceptable for editor (CodeMirror/Monaco) | editor plan |
| R8 | Code-signed updates with rollback guard (XR already has `xr update` rollback guard) | [OBSERVED] |
| R9 | Voice I/O (mic capture, TTS playback) — can delegate to daemon pipeline | [OBSERVED voice stack] |
| R10 | Computer-control visibility overlays (acting indicator) | computer-control plan |

## 2. Options evaluated

| Criterion | Electron | Tauri v2 | Native (SwiftUI/WinUI/qt) |
|---|---|---|---|
| Bundle/RAM [RESEARCH-BACKED] | 80–200 MB / 100–450 MB | 2–12 MB / 30–85 MB | smallest |
| Rendering consistency | identical Chromium | OS webview variance (WebKit/WebView2) | n/a |
| Security defaults | checklist-driven | least-privilege capabilities, Rust core | best |
| IPC to daemon | trivial (fetch) | trivial (fetch from webview) | trivial |
| PTY/terminal | node-pty mature | taury-plugin-shell / sidecar PTY possible; fewer batteries | most work |
| Sidecar mgmt | child_process | sidecar API (built-in) | manual |
| Updater | electron-updater mature | tauri-updater (signed artifacts) | per-platform |
| Team fit (TS codebase) | perfect | TS frontend + small Rust seam | poor |
| Editor fidelity (Monaco/CM6) | guaranteed | good (CM6 safe; Monaco mostly OK w/ WebKit quirks) | n/a |

## 3. Decision

**[RECOMMENDED→APPROVED (D-02, 2026-09-17)] Tauri v2 shell ("XR Desktop") + existing Bun daemon as sidecar engine.** Hard requirement from approval: first-class support on **Windows, macOS and Linux** — CI matrix and native feature parity (tray/notifications/updater/deep links) are P1/P4 gates on all three OSes.
Rationale: R2/R3 favor Tauri decisively; R4 means the shell is a *client*, so Electron's Node main-process advantage is irrelevant; R7 mitigated by choosing CodeMirror 6 (webkit-safe) over Monaco for the integrated editor, with Monaco optional later; R6 satisfied by Tauri sidecar API launching `xr` compiled binary (or `bun run src/index.ts serve` in dev); R8 by tauri-updater + XR's existing rollback-guard semantics.
**Fallback trigger:** if Phase-2 editor fidelity tests fail on WebKit/WebView2 beyond mitigation, isolate editor pane in a bundled Chromium frame (single-surface Electron-style escape hatch) or switch shell to Electron — decision gate at Phase 2 DoD. [RECOMMENDED]

## 4. Target architecture

```
┌────────────────────────── XR Desktop (Tauri v2) ──────────────────────────┐
│ Webview UI (TS/React): Home · Work · Editor · Agents · Library · Trust …  │
│  ├─ Design System (tokens/components)                                     │
│  ├─ Typed API client (generated: scripts/generate-client.ts)              │
│  ├─ SSE streams: chat events, research jobs, control events, approvals    │
│  ├─ Native bridge (Tauri IPC): tray, notifications, shortcuts, deep links,│
│  │   file-open, clipboard, drag/drop, autostart, updater, window state    │
│  └─ PTY panes (terminal) via shell plugin → daemon-owned shells           │
└───────────────▲───────────────────────────────────────────────────────────┘
                │ loopback HTTPS/HTTP + one-time pairing token (never URL query)
┌───────────────┴──────────── XR Engine (existing, Bun) ────────────────────┐
│ xr daemon (sidecar): routes(129) · agent loop · trust · approvals · audit │
│ state(SQLite) · providers · skills/plugins/MCP · research · voice pipeline│
└───────────────────────────────────────────────────────────────────────────┘
```

- **Pairing:** desktop spawns/attaches sidecar; obtains bootstrap token via locked file (`~/.xr/run/<pid>.token`, 0600) or local Unix socket; exchanges to session cookie. Fixes SEC-04. [RECOMMENDED]
- **Ownership:** engine owns all policy/state; desktop owns presentation + native trimmings + window/PTY lifecycle. CI boundary gate: desktop package may import only generated client + design system. [RECOMMENDED]
- **Offline/degraded:** desktop detects sidecar death → respawn with backoff → surface "engine restarting" state; runs continue durably in engine (checkpoints) — work never lost. [RECOMMENDED + OBSERVED durability]
- **Multi-window:** one main workstation window + detachable panes (task view, approval sheet) as child windows; tray menu = global quick actions (new task, voice, approve pending, pause-all). [RECOMMENDED]

## 5. Platform notes

- **macOS:** WebKit; mic perms via Tauri; tray icon template variants (mono mark).
- **Windows:** WebView2; notifications via WinRT; autostart registry; sandbox interplay: engine's namespace/container backends unaffected by shell.
- **Linux:** WebKitGTK variance highest; provide AppImage/deb/rpm + Flatpak later; tray via SNI.
- **All:** global shortcut (Cmd/Ctrl+Shift+X) → quick task palette; deep links `xr://task/<id>`, `xr://approve/<id>`. [RECOMMENDED]

## 6. Performance budgets [RECOMMENDED]

- Shell cold start < 1.5 s to interactive (sidecar warm attach < 3 s; show engine-boot splash w/ avatar).
- Idle RAM shell < 150 MB (webview) on top of engine baseline.
- Installer < 25 MB signed.
- SSE event → paint < 100 ms p95.

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| WebKit editor/terminal quirks | CM6 + xterm.js parity test matrix in Phase 2 DoD; escape hatch §3 |
| Rust seam skill gap | keep Rust surface < 500 LOC (sidecar, tray, updater config); everything else TS |
| Sidecar version skew (desktop newer than engine) | handshake `/api/v1` version check + guided engine update (`xr update` rollback guard) |
| Updater trust | signed artifacts + XR audit-anchored update events |
| WebView security | CSP, no remote content except daemon loopback; capabilities allowlist minimal |
