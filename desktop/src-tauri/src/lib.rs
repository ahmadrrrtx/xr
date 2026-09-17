use std::fs;
use std::path::PathBuf;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

/// Locate the engine run directory: ~/.xr/run/<pid>.token (0600 pairing files).
/// The shell NEVER prints, stores or forwards the token beyond the daemon handshake.
fn pairing_token() -> Option<String> {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok()?;
    let run_dir = PathBuf::from(home).join(".xr").join("run");
    let mut entries: Vec<PathBuf> = fs::read_dir(&run_dir)
        .ok()?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map(|x| x == "token").unwrap_or(false))
        .collect();
    entries.sort_by_key(|p| fs::metadata(p).and_then(|m| m.modified()).ok());
    let newest = entries.last()?;
    fs::read_to_string(newest).ok().map(|s| s.trim().to_string())
}

/// Attach-or-spawn: if a daemon already listens on 127.0.0.1:3141 we attach;
/// otherwise the installer-bundled sidecar (`xr serve`) is started by the
/// platform shell (Phase 1: operator starts it; Phase 2: Tauri sidecar API).
fn daemon_reachable() -> bool {
    std::net::TcpStream::connect_timeout(
        &"127.0.0.1:3141".parse().unwrap(),
        std::time::Duration::from_millis(400),
    )
    .is_ok()
}

#[tauri::command]
fn engine_status() -> serde_json::Value {
    serde_json::json!({
        "reachable": daemon_reachable(),
        "paired": pairing_token().is_some(),
    })
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![engine_status])
        .setup(|app| {
            // Tray: global quick actions (Phase 1 minimal; full matrix Phase 4).
            let menu = Menu::with_items(
                app.handle(),
                &[
                    &MenuItem::with_id(app.handle(), "new_task", "New task", true, None::<&str>)?,
                    &MenuItem::with_id(app.handle(), "approvals", "Pending approvals", true, None::<&str>)?,
                    &MenuItem::with_id(app.handle(), "quit", "Quit XR Desktop", true, None::<&str>)?,
                ],
            )?;
            let _tray = TrayIconBuilder::new()
                .tooltip("XR — the AI agent you can actually trust")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    _ => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running XR Desktop");
}
