//! XR Desktop — engine sidecar lifecycle (Phase 4 · D-02).
//!
//! The packaged app ships the XR engine as a Tauri externalBin sidecar
//! (`xr-engine-<target-triple>`, compiled by scripts/compile-sidecar.ts).
//! On startup the shell spawns it with `serve --port 0` (ephemeral — it can
//! never collide with an operator-started daemon on 3141) and performs the
//! pairing handshake by parsing the daemon's own startup banner on stdout:
//!
//! ```text
//! ✓ Listening on  http://127.0.0.1:<port>   → the real bound port
//! Token: <48-hex>                           → the bearer token
//! ```
//!
//! The engine prints the ACTUAL bound port (Phase 4 · T4), so port 0 is
//! honest end-to-end. The token is handed ONLY to this app's own webview via
//! the `engine_link` command — the shell never prints, stores or forwards it
//! anywhere else (SEC-07: all policy/audit/secrets stay engine-side; this is
//! the daemon handshake itself, not a second trust domain).
//!
//! Dev mode (`tauri dev`): no sidecar binary exists next to the debug exe, so
//! spawn honestly reports "not found" and the frontend falls back to relative
//! /api/v1 paths served by the vite proxy (which injects XR_DEV_TOKEN).

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, State,
};

/// Shared engine-link state, populated by the stdout reader thread.
#[derive(Default)]
struct EngineState {
    port: Mutex<Option<u16>>,
    token: Mutex<Option<String>>,
    child: Mutex<Option<Child>>,
    /// Honest reason when no sidecar link exists (dev builds, spawn errors).
    note: Mutex<Option<String>>,
}

fn target_triple() -> &'static str {
    env!("TARGET_TRIPLE")
}

/// Resolve the sidecar next to this executable. Tauri bundles externalBin
/// beside the main binary keeping the triple suffix; also accept the plain
/// name in case a packager renames it.
fn sidecar_path() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let exe_suffix = if cfg!(windows) { ".exe" } else { "" };
    let candidates = [
        format!("xr-engine-{}{}", target_triple(), exe_suffix),
        format!("xr-engine{}", exe_suffix),
    ];
    for name in candidates.iter() {
        let path = dir.join(name);
        if path.exists() {
            return Some(path);
        }
    }
    None
}

fn tcp_reachable(port: u16) -> bool {
    if let Ok(addr) = format!("127.0.0.1:{port}").parse() {
        std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
    } else {
        false
    }
}

fn spawn_sidecar(state: &Arc<EngineState>) {
    let Some(bin) = sidecar_path() else {
        *state.note.lock().unwrap() = Some(
            "sidecar binary not found (dev build — frontend uses the vite proxy)".into(),
        );
        return;
    };
    match Command::new(&bin)
        .arg("serve")
        .arg("--port")
        .arg("0")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(mut child) => {
            let stdout = child.stdout.take();
            *state.child.lock().unwrap() = Some(child);
            let st = Arc::clone(state);
            std::thread::spawn(move || {
                let Some(out) = stdout else { return };
                for line in BufReader::new(out).lines() {
                    let Ok(line) = line else { break };
                    // "Listening on  http://127.0.0.1:<port>" — the real bound
                    // port. Dashboard/Chat banner lines carry "?token=…"
                    // suffixes and fail the strict u16 parse — by design.
                    if let Some(idx) = line.find("http://127.0.0.1:") {
                        let tail = &line[idx + "http://127.0.0.1:".len()..];
                        if let Ok(port) = tail.trim().parse::<u16>() {
                            *st.port.lock().unwrap() = Some(port);
                        }
                    }
                    if let Some(idx) = line.find("Token: ") {
                        let token = line[idx + "Token: ".len()..].trim().to_string();
                        if token.len() >= 32 && token.chars().all(|c| c.is_ascii_hexdigit()) {
                            *st.token.lock().unwrap() = Some(token);
                        }
                    }
                }
                // stdout closed = daemon exited; mark the link stale honestly.
                if st.port.lock().unwrap().is_some() {
                    *st.note.lock().unwrap() =
                        Some("sidecar exited (stdout closed)".into());
                }
            });
        }
        Err(e) => {
            *state.note.lock().unwrap() = Some(format!("spawn failed: {e}"));
        }
    }
}

/// Instant snapshot — the frontend polls this (no blocking commands).
#[tauri::command]
fn engine_link(state: State<'_, Arc<EngineState>>) -> serde_json::Value {
    let port: Option<u16> = *state.port.lock().unwrap();
    let token: Option<String> = state.token.lock().unwrap().clone();
    let note: Option<String> = state.note.lock().unwrap().clone();
    if let (Some(port), Some(linked_token)) = (port, token.clone()) {
        if tcp_reachable(port) {
            return serde_json::json!({
                "reachable": true,
                "spawned": true,
                "port": port,
                "token": linked_token,
                "externalDaemonOn3141": tcp_reachable(3141),
            });
        }
    }
    serde_json::json!({
        "reachable": false,
        "spawned": false,
        "port": port,
        "hasToken": token.is_some(),
        "reason": note,
        "externalDaemonOn3141": tcp_reachable(3141),
    })
}

/// Phase 5 · OS notification (approval due / run done) — real OS primitive,
/// invoked only from the shell when the user has opted in (Settings).
#[tauri::command]
fn notify_os(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

/// Phase 5 · opt-in autostart. Disabled by default; the toggle lives in
/// Settings and maps 1:1 onto the plugin's enable/disable.
#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enable: bool) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let l = app.autolaunch();
    if enable {
        l.enable().map_err(|e| e.to_string())?;
    } else {
        l.disable().map_err(|e| e.to_string())?;
    }
    l.is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn autostart_status(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Phase 5 · signed updater. Honest by construction: errors until the
/// operator provisions endpoints + pubkey (scripts/generate-updater-keys.ts).
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(serde_json::json!({ "available": true, "version": update.version })),
        Ok(None) => Ok(serde_json::json!({ "available": false })),
        Err(e) => Err(format!(
            "updater not provisioned or check failed: {e} (see docs/release/UPDATER.md)"
        )),
    }
}

#[tauri::command]
fn engine_status(state: State<'_, Arc<EngineState>>) -> serde_json::Value {
    let port: Option<u16> = *state.port.lock().unwrap();
    let token: Option<String> = state.token.lock().unwrap().clone();
    serde_json::json!({
        "reachable": port.is_some_and(tcp_reachable) || tcp_reachable(3141),
        "paired": token.is_some(),
    })
}

pub fn run() {
    let engine = Arc::new(EngineState::default());
    let engine_setup = Arc::clone(&engine);
    let builder = tauri::Builder::default()
        .manage(Arc::clone(&engine))
        .plugin(tauri_plugin_notification::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            engine_status,
            engine_link,
            notify_os,
            set_autostart,
            autostart_status,
            check_update
        ])
        .setup(move |app| {
            // Ephemeral-port sidecar: always spawn our own engine when the
            // binary is present; it can never collide with a daemon an
            // operator already runs on 3141.
            spawn_sidecar(&engine_setup);

            // Tray: global quick actions (Phase 1 minimal; full matrix later).
            let menu = Menu::with_items(
                app.handle(),
                &[
                    &MenuItem::with_id(app.handle(), "new_task", "New task", true, None::<&str>)?,
                    &MenuItem::with_id(
                        app.handle(),
                        "approvals",
                        "Pending approvals",
                        true,
                        None::<&str>,
                    )?,
                    &MenuItem::with_id(app.handle(), "quit", "Quit XR Desktop", true, None::<&str>)?,
                ],
            )?;
            let _tray = TrayIconBuilder::new()
                // Bundled icon set (generated from the official avatar render,
                // D-05 format conversion) — required on Linux, consistent tray
                // identity everywhere.
                .icon(
                    app.default_window_icon()
                        .expect("bundle icon must be present")
                        .clone(),
                )
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
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building XR Desktop");
    app.run(move |_app_handle, event| {
        // Never orphan the engine: the sidecar dies with the shell.
        if let tauri::RunEvent::Exit = event {
            if let Some(mut child) = engine.child.lock().unwrap().take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    });
}
