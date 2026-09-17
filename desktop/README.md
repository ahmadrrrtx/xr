# XR Desktop (Phase 1 foundation)

Tauri v2 shell over the existing XR engine daemon (`xr serve`, loopback API v1).
Blueprint: `docs/xr-rebuild/` · decisions: `XR_DECISION_RECORD.md` (D-02: Tauri v2, Win+mac+Linux first-class).

## Layout
- `src/` — web shell (React + TS, XR Prism tokens): AppShell (icon rail), Home (composer/continue/approvals/readiness), Runs (list + anatomy drawer), engine-down splash.
- `src/api/client.ts` — typed daemon client; display-only: never computes risk/policy/budget (SEC-07).
- `src-tauri/` — Rust shell: sidecar attach probe, 0600 pairing-token discovery, tray quick actions. Native matrix (notifications/deep links/autostart/updater) = Phase 4.

## Dev (any OS)
```bash
# 1. engine
bun run src/index.ts serve          # repo root → daemon on 127.0.0.1:3141 (prints token)
# 2. shell (from desktop/)
XR_DEV_TOKEN=<daemon token> bun run dev   # vite on :5173, proxies /api → daemon, injects bearer server-side
```
Open http://127.0.0.1:5173 — token never reaches browser code.

## Package (per OS)
Prereqs: Rust stable, Bun ≥1.3, platform webview libs.
- **macOS:** `bun run tauri build --target universal-apple-darwin` (needs Xcode; notarize in CI).
- **Windows:** `bun run tauri build --target x86_64-pc-windows-msvc` (WebView2 evergreen; MSI in bundle targets).
- **Linux:** `bun run tauri build` (webkit2gtk-4.1 + rpm tools; AppImage/deb/rpm targets).
Icons: drop official-mark renders into `src-tauri/icons/` (generate from `assets/logo.png` per Asset Audit §4).

## Phase gates
- P1 DoD (this slice): pair/attach, Home live data, Runs anatomy read, engine-down recovery splash, 3-OS CI job green.
- P2: Work transcript/approvals, editor+terminal, Model Center, onboarding.
