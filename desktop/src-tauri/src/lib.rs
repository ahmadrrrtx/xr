/*
 * XR Desktop — Tauri v2 shell (Phase 0 scaffold).
 *
 * Plugin matrix is wired in full now (docs/DEEP-DIVE-ARCHITECTURE.md §A.1)
 * so later phases only add capabilities and frontend calls. Nothing here is
 * "active" beyond what the scaffold uses: window controls, platform
 * detection, theme events, single-instance focus, and a minimal tray.
 */
mod commands;
mod events;
#[cfg(desktop)]
mod tray;

use argon2::{Algorithm, Argon2, Params, Version};

/// Stronghold key derivation (Argon2id). The password is supplied by the
/// frontend when a stronghold is opened; the salt is a fixed app constant.
/// Phase 8 (Settings/Stronghold integration) owns the real UX around this.
fn key_derivation(password: &str) -> Vec<u8> {
    const SALT: &[u8] = b"xr-desktop-stronghold-v1";
    let params = Params::new(32, 3, 4, Some(32)).expect("valid argon2 params");
    let mut key = [0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), SALT, &mut key)
        .expect("argon2 key derivation is infallible for valid params");
    key.to_vec()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Single instance must be registered first: a second launch hands its
    // argv to the running shell and exits — we focus the existing window.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(
        |app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        },
    ));

    builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_stronghold::Builder::new(key_derivation).build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_autostart::init(
                    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                    None,
                ))?;
                app.handle()
                    .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
                tray::create_tray(app.handle())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::window::minimize_window,
            commands::window::toggle_maximize,
            commands::window::close_window,
            commands::window::get_platform,
            events::theme_changed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
