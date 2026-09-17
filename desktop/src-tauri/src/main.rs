//! XR Desktop — Tauri v2 shell.
//!
//! Boundary law (docs/xr-rebuild/XR_SECURITY_AUDIT.md SEC-07): this process is a
//! PRESENTATION + NATIVE-TRIMMINGS layer. All policy, approvals, audit, budgets and
//! secrets stay in the XR engine (Bun daemon sidecar). The shell only renders engine
//! truth and forwards user decisions over the loopback API.
//!
//! Phase 1 scope: sidecar attach/spawn, locked-file pairing token read, tray, window.
//! Native matrix (notifications, deep links, autostart, updater) lands Phase 4.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    xr_desktop_lib::run()
}
