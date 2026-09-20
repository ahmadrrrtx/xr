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

use std::io::Write;

/// The Windows GUI subsystem hides ALL console output: a crash before the first
/// window paints is completely invisible to the user ("I clicked the icon and
/// nothing happened"). So every launch leaves a breadcrumb trail in
/// `%TEMP%\xr-desktop-boot.log` — how far boot got, and the panic message when
/// it didn't get far. Support (and the user) can finally SEE a silent death.
fn boot_log(line: &str) {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut path = std::env::temp_dir();
    path.push("xr-desktop-boot.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "[{secs}] {line}");
    }
}

fn main() {
    std::panic::set_hook(Box::new(|info| {
        boot_log(&format!("PANIC: {info}"));
    }));
    boot_log("boot: main() entered");
    xr_desktop_lib::run();
    boot_log("boot: run() returned (clean exit)");
}
