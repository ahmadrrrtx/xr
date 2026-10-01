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
            // A relaunch is a fine moment to re-check the orb's display
            // still exists (monitor layouts change between runs).
            #[cfg(desktop)]
            commands::orb::validate_position(app);
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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            commands::chat::init(app)?;
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_autostart::init(
                    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                    None,
                ))?;
                app.handle()
                    .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
                // HUD palette (Phase 5): global shortcut + hidden second window.
                commands::hud::init(app.handle())?;
                // Companion Orb (Phase 6): startup gate, position memory,
                // native context menu, ⌥⌘O visibility toggle.
                commands::orb::init(app.handle())?;
                tray::create_tray(app.handle())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::window::minimize_window,
            commands::window::toggle_maximize,
            commands::window::close_window,
            commands::window::get_platform,
            commands::system::detect_system,
            commands::system::detect_ollama,
            commands::ollama::ollama_pull,
            commands::chat::chat_list_sessions,
            commands::chat::chat_get_session,
            commands::chat::chat_create_session,
            commands::chat::chat_update_session_title,
            commands::chat::chat_update_session_model,
            commands::chat::chat_archive_session,
            commands::chat::chat_delete_session,
            commands::chat::chat_list_messages,
            commands::chat::chat_save_message,
            commands::chat::chat_delete_message,
            #[cfg(desktop)]
            commands::approvals::load_rules,
            commands::approvals::save_rules,
            commands::approvals::send_os_notification,
            commands::hud::hud_show,
            #[cfg(desktop)]
            commands::hud::hud_hide,
            #[cfg(desktop)]
            commands::hud::hud_toggle,
            #[cfg(desktop)]
            commands::hud::hud_navigate,
            #[cfg(desktop)]
            commands::hud::hud_run_main_command,
            #[cfg(desktop)]
            commands::hud::hud_notify_sessions_changed,
            #[cfg(desktop)]
            commands::hud::hud_shortcut_info,
            #[cfg(desktop)]
            commands::orb::orb_show,
            #[cfg(desktop)]
            commands::orb::orb_hide,
            #[cfg(desktop)]
            commands::orb::orb_toggle,
            #[cfg(desktop)]
            commands::orb::orb_open_main,
            #[cfg(desktop)]
            commands::orb::orb_show_context_menu,
            #[cfg(desktop)]
            commands::orb::orb_get_position,
            #[cfg(desktop)]
            commands::orb::orb_set_position,
            events::theme_changed,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Belt-and-braces global-shortcut teardown: the plugin unregisters
            // on drop, but a hotkey that outlives a crashed process sticks
            // until reboot on macOS — clean up loudly on the way out.
            if let tauri::RunEvent::Exit = event {
                #[cfg(desktop)]
                commands::hud::unregister_all(app);
                // Park the orb's final position (drag → quit race).
                #[cfg(desktop)]
                commands::orb::flush_position(app);
            }
        });
}
