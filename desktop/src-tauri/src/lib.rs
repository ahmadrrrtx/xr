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
mod shield;
#[cfg(desktop)]
mod tray;

use argon2::{Algorithm, Argon2, Params, Version};
use tauri::Manager as _;

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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            commands::chat::init(app)?;
            // Phase 10 — workspaces: same xr.db (WAL), own connection + DDL,
            // plus the in-memory window-bounds map used by multi-window spawn.
            app.handle()
                .manage(commands::workspaces::WorkspaceDb::init(app.handle()));
            app.handle().manage(commands::workspaces::SpawnState::new());
            // Phase 12 — XR Shield: append-only audit chain on the shared xr.db.
            app.handle().manage(shield::ShieldDb::init(app.handle()));
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
                // Push-to-talk (Phase 8): global chord, override-aware.
                commands::settings::init_ptt(app.handle())?;
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
            commands::workspaces::list_workspaces,
            commands::workspaces::get_workspace,
            commands::workspaces::create_workspace,
            commands::workspaces::update_workspace,
            commands::workspaces::delete_workspace,
            commands::workspaces::duplicate_workspace,
            commands::workspaces::restore_workspace,
            commands::workspaces::reveal_in_finder,
            commands::workspaces::pick_folder,
            commands::workspaces::move_workspace_window,
            commands::workspaces::spawn_workspace_windows,
            commands::workspaces::git_available,
            commands::workspaces::clone_git_workspace,
            commands::workspaces::detect_stack,
            commands::workspaces::scaffold_workspace,
            #[cfg(desktop)]
            commands::approvals::load_rules,
            commands::approvals::save_rules,
            commands::approvals::send_os_notification,
            commands::settings::settings_changed,
            commands::settings::get_settings,
            commands::settings::set_setting,
            commands::settings::keychain_get,
            commands::settings::keychain_set,
            commands::settings::keychain_delete,
            commands::settings::reveal_data_folder,
            commands::settings::reveal_path,
            commands::settings::get_data_dir,
            commands::settings::open_url,
            commands::settings::storage_stats,
            commands::settings::clear_cache,
            commands::settings::export_all_data,
            commands::settings::import_all_data,
            commands::settings::reset_app,
            commands::settings::restart_app,
            commands::settings::set_devtools_enabled,
            commands::settings::get_autostart,
            commands::settings::set_autostart,
            commands::settings::test_provider_connection,
            commands::runs::list_runs,
            commands::runs::cancel_run,
            commands::runs::bulk_cancel_runs,
            commands::runs::save_runs_export,
            shield::get_shield_status,
            shield::get_audit_log,
            shield::append_audit,
            shield::verify_audit_chain,
            shield::run_health_check,
            shield::set_security_policy,
            shield::set_shield_paused,
            shield::set_quarantine,
            shield::save_shield_checks,
            shield::revoke_all,
            shield::list_approvals,
            commands::settings::ptt_shortcut_info,
            #[cfg(desktop)]
            commands::settings::ptt_set_shortcut,
            #[cfg(desktop)]
            commands::hud::hud_set_shortcut,
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
            #[cfg(desktop)]
            commands::orb::orb_set_shortcut,
            #[cfg(desktop)]
            commands::orb::orb_shortcut_info,
            events::theme_changed,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Phase 10 — workspace windows: track live bounds in SpawnState
            // (Moved/Resized fire during drags; cheap in-memory writes) and
            // persist them to the DB when the window closes.
            if let tauri::RunEvent::WindowEvent { label, event: wev, .. } = &event {
                if label.starts_with("workspace-") {
                    match wev {
                        tauri::WindowEvent::Moved(pos) => {
                            let cur = app
                                .state::<commands::workspaces::SpawnState>()
                                .bounds
                                .lock()
                                .unwrap_or_else(|e| e.into_inner())
                                .get(label)
                                .copied();
                            let (w, h) = cur.map(|b| (b.w, b.h)).unwrap_or((1280, 800));
                            commands::workspaces::note_window_moved(
                                app, label, pos.x, pos.y, w, h,
                            );
                        }
                        tauri::WindowEvent::Resized(size) => {
                            let cur = app
                                .state::<commands::workspaces::SpawnState>()
                                .bounds
                                .lock()
                                .unwrap_or_else(|e| e.into_inner())
                                .get(label)
                                .copied();
                            let (x, y) = cur.map(|b| (b.x, b.y)).unwrap_or((80, 80));
                            commands::workspaces::note_window_moved(
                                app, label, x, y, size.width as i32, size.height as i32,
                            );
                        }
                        tauri::WindowEvent::CloseRequested { .. } => {
                            commands::workspaces::flush_window_bounds(app, label);
                        }
                        _ => {}
                    }
                }
            }
            // Belt-and-braces global-shortcut teardown: the plugin unregisters
            // on drop, but a hotkey that outlives a crashed process sticks
            // until reboot on macOS — clean up loudly on the way out.
            if let tauri::RunEvent::Exit = event {
                commands::workspaces::flush_all_bounds(app);
                #[cfg(desktop)]
                commands::hud::unregister_all(app);
                // Park the orb's final position (drag → quit race).
                #[cfg(desktop)]
                commands::orb::flush_position(app);
            }
        });
}
