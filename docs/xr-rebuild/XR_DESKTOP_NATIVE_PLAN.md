# XR — Desktop Native Plan

> Tauri v2 shell capabilities. Tags: [RECOMMENDED] unless noted. Engine = Bun daemon sidecar [OBSERVED existing].

## 1. Lifecycle
- **Boot:** desktop starts → attach to running engine (lockfile+port probe) else spawn sidecar (`xr` binary; dev: `bun run src/index.ts serve`) → pairing via 0600 token file → session cookie.
- **Crash recovery:** sidecar watchdog (exponential backoff, max 3) → "engine restarting" splash; interrupted runs resume from checkpoints [OBSERVED durability]; desktop window state restored (panes, workspace, scroll).
- **Quit:** engine keeps running (background tasks continue) unless user chooses "Quit XR completely" (tray) → graceful drain (in-flight approvals surfaced).

## 2. Native feature matrix
| Feature | Impl | Notes |
|---|---|---|
| System tray | Tauri tray, mono mark variants | menu: New task / Voice / Approvals(n) / Pause-all / Engine status / Quit |
| Notifications | OS notifications w/ actions | approval (Approve/Deny/Open), run finished/failed, budget 80%, update ready |
| Global shortcut | Cmd/Ctrl+Shift+X quick task; Cmd/Ctrl+. stop | user-rebindable |
| Clipboard | copy run/diff/audit snippets; paste image→attach | engine never sees clipboard unprompted |
| Drag & drop | files/folders → attach or open workspace | path validation engine-side |
| File/folder open | OS "Open with XR" + deep links | register xr:// |
| Deep links | xr://task/<id>, xr://approve/<id>, xr://workspace/<id> | route to surface; approval links open sheet |
| Background tasks | engine-owned; tray badge shows in-flight runs | approvals interrupt via notification |
| Autostart | optional, off by default | privacy-first |
| Updates | tauri-updater signed + engine `xr update` rollback guard [OBSERVED] | coordinated version handshake; mismatch → guided update |
| Window state | persist layout, per-workspace window memory | |
| Single-instance | second launch focuses + routes deep link | |

## 3. OS-specific
- **macOS:** menu bar extras (status = presence state), NSStatusItem template icon, mic/camera(?) perms (mic only), notarized dmg + Homebrew cask.
- **Windows:** WebView2; toast actions; MSIX + winget manifest update [OBSERVED packaging exists]; WebView2 evergreen check w/ fallback message.
- **Linux:** AppImage/deb/rpm; SNI tray; WebKitGTK matrix in CI; Flatpak post-GA (sandbox interplay review).

## 4. Security posture
- Capabilities allowlist minimal (no fs access from webview except via engine API); CSP loopback-only; no remote code; updater keys offline; token file 0600 + rotate per spawn (SEC-04 fix); notifications never leak secret values (approval summaries engine-computed).

## 5. Tests
- Per-OS CI: tray/notifications/deep-link/autostart smoke (playwright-electron-class harness or Tauri driver), updater rollback drill, sidecar kill→respawn→resume drill, window-state restore.
