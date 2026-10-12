/*
 * XR Desktop — Tauri v2 shell (Phase 0 scaffold).
 *
 * Plugin matrix is wired in full now (docs/DEEP-DIVE-ARCHITECTURE.md §A.1)
 * so later phases only add capabilities and frontend calls. Nothing here is
 * "active" beyond what the scaffold uses: window controls, platform
 * detection, theme events, single-instance focus, and a minimal tray.
 */
mod budget;
/// Screenshot-and-ask capture, per platform (Phase 27).
mod capture;
mod commands;
/// Phase 14 — engine sidecar lifecycle (spawn, pair, restart, stderr tail).
mod engine;
/// Banner parsing / bounded stderr tail / probe cache (pure std, unit-tested).
mod engine_state;
mod events;
/// Crash recovery: dirty flag, bounded shell log, manual report (Phase 27).
mod crash;
/// Native menus — the macOS application menu (Phase 27).
pub mod menus;
mod shield;
/// OS appearance bridge: `xr-os-theme` (Phase 27).
mod theme;
#[cfg(desktop)]
mod tray;
/// Linux parent-death signal + graceful SIGTERM shutdown (libc).
#[cfg(unix)]
mod unix;
/// Windows job-object containment + CREATE_NO_WINDOW (hand-written FFI).
#[cfg(windows)]
mod win;

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
    let engine_state = std::sync::Arc::new(engine::EngineState::default());
    let engine_setup = std::sync::Arc::clone(&engine_state);
    let engine_exit = std::sync::Arc::clone(&engine_state);
    let builder = tauri::Builder::default().manage(engine_state);

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
        .setup(move |app| {
            // Phase 27 — recovery gate. Read the dirty flag BEFORE touching
            // the engine: "start without the local engine" has to be honoured
            // from the first moment, otherwise a crash-looping engine gets one
            // more chance to take the app down before the user sees the screen.
            let skip_engine = commands::recovery::started_without_engine(app.handle());
            // Phase 14 — spawn the engine sidecar first (main thread: the
            // Linux parent-death signal binds to the spawning thread). In
            // dev there is no binary and the webview uses the Vite proxy.
            if skip_engine {
                engine::skip_spawn(&engine_setup, "recovery: starting without the local engine");
            } else {
                engine::spawn_sidecar(&engine_setup);
            }

            // Phase 27 — crash bookkeeping. The flag goes down now that the
            // spawn has been attempted, and only the clean-exit path at the
            // bottom of this file removes it.
            let crash_home = crash::xr_home();
            let previous_flag = crash::read_flag(&crash_home);
            let interrupted_before = previous_flag
                .as_ref()
                .map(|flag| flag.consecutive_interruptions.saturating_add(1))
                .unwrap_or(1);
            let engine_failed = engine::snapshot(&engine_setup).spawn_failed();
            match crash::write_flag(
                &crash_home,
                env!("CARGO_PKG_VERSION"),
                interrupted_before,
                engine_failed,
            ) {
                Ok(flag) => crash::log_shell(
                    &crash_home,
                    &format!(
                        "session start: pid {} version {} interruption-count {} engine-failed {}",
                        flag.pid, flag.version, flag.consecutive_interruptions, flag.engine_spawn_failed
                    ),
                ),
                Err(e) => eprintln!("[xr] could not write the crash flag: {e}"),
            }
            // A capture from a session that died must not sit in /tmp forever.
            let swept = capture::sweep_scratch(&capture::scratch_dir(), 24 * 60 * 60 * 1000);
            if swept > 0 {
                crash::log_shell(&crash_home, &format!("swept {swept} stale screenshot(s)"));
            }
            // The engine either pairs within a couple of seconds or it never
            // will. If it never does, the NEXT launch should know, so the
            // recovery screen can offer the engine-less start for real.
            {
                let handle = app.handle().clone();
                let state = std::sync::Arc::clone(&engine_setup);
                // A worker thread, not the async runtime: this is a timer, and
                // nothing here needs to be async.
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(8));
                    let snapshot = engine::snapshot(&state);
                    app_log_engine_state(&snapshot);
                    #[cfg(desktop)]
                    crate::tray::refresh_engine(&handle, snapshot.is_up());
                    if !snapshot.is_up() {
                        let home = crash::xr_home();
                        if let Some(flag) = crash::read_flag(&home) {
                            if !flag.engine_spawn_failed && snapshot.note.is_some() {
                                let _ = crash::write_flag(
                                    &home,
                                    env!("CARGO_PKG_VERSION"),
                                    flag.consecutive_interruptions,
                                    true,
                                );
                                crash::log_shell(
                                    &home,
                                    &format!("engine never came up: {}", snapshot.note.unwrap_or_default()),
                                );
                            }
                        }
                    }
                });
            }

            commands::chat::init(app)?;
            // Phase 10 — workspaces: same xr.db (WAL), own connection + DDL,
            // plus the in-memory window-bounds map used by multi-window spawn.
            app.handle()
                .manage(commands::workspaces::WorkspaceDb::init(app.handle()));
            app.handle().manage(commands::workspaces::SpawnState::new());
            // Phase 27 — recovery decision + updater state (both read-only
            // until the user acts; neither talks to the network on its own).
            app.handle().manage(commands::recovery::RecoveryState::default());
            app.handle().manage(commands::updates::UpdatesState::default());
            // Phase 12 — XR Shield: append-only audit chain on the shared xr.db.
            app.handle().manage(shield::ShieldDb::init(app.handle()));
            // Phase 13 — Budget governor: spend events + settings on the shared
            // xr.db; every mock LLM call is gated by `budget_check` before it starts.
            app.handle().manage(budget::BudgetDb::init(app.handle()));
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
                // Voice Theater (Phase 16): ⌥⌘V toggle + native context menu.
                commands::theater::init(app.handle())?;
                // Phase 27 — screenshot-and-ask: ⌘⇧X (Ctrl+Shift+X elsewhere).
                app.handle().manage(commands::screenshot::ScreenshotState::default());
                commands::screenshot::register(app.handle())?;
                // Phase 27 — the always-alive tray, then the macOS app menu.
                // (The menu reuses the tray's action ids, so one dispatcher
                // serves the menu bar, the tray, and — later — the dock menu.)
                tray::create_tray(app.handle())?;
                // The tray opens with the truth about the engine, not with an
                // optimistic default that flips a second later.
                tray::refresh_engine(app.handle(), engine::snapshot(&engine_setup).is_up());
                app.handle()
                    .on_menu_event(|app, event| tray::on_menu_event(app, event.id.as_ref()));
                menus::install(app.handle())?;
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
            engine::engine_link,
            engine::engine_restart,
            engine::engine_logs_tail,
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
            commands::settings::open_microphone_settings,
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
            budget::budget_init,
            budget::budget_overview,
            budget::budget_check,
            budget::budget_record,
            budget::budget_events,
            budget::budget_series,
            budget::budget_breakdown,
            budget::budget_update_settings,
            budget::budget_set_paused,
            budget::budget_reset_month,
            budget::budget_clear,
            budget::budget_export,
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
            #[cfg(desktop)]
            commands::theater::theater_open,
            #[cfg(desktop)]
            commands::theater::theater_close,
            #[cfg(desktop)]
            commands::theater::theater_toggle,
            #[cfg(desktop)]
            commands::theater::theater_is_open,
            #[cfg(desktop)]
            commands::theater::theater_focus_main,
            #[cfg(desktop)]
            commands::theater::theater_set_always_on_top,
            #[cfg(desktop)]
            commands::theater::theater_show_context_menu,
            #[cfg(desktop)]
            commands::theater::theater_shortcut_info,
            #[cfg(desktop)]
            commands::theater::theater_set_shortcut,
            events::theme_changed,
            // Phase 27 — shell: state the tray renders, OS theme bridge,
            // shortcut inventory + reset.
            theme::subscribe_os_theme,
            commands::shell::shell_shortcut_inventory,
            commands::shell::shell_reset_shortcuts,
            #[cfg(desktop)]
            tray::tray_update_state,
            #[cfg(desktop)]
            commands::screenshot::screenshot_ask_info,
            #[cfg(desktop)]
            commands::screenshot::screenshot_ask_set_shortcut,
            #[cfg(desktop)]
            commands::screenshot::screenshot_ask_capture,
            commands::screenshot::screenshot_ask_discard,
            commands::screenshot::screenshot_ask_support,
            // Phase 27 — crash recovery.
            commands::recovery::crash_state,
            commands::recovery::crash_resolve,
            commands::recovery::crash_start_without_engine,
            commands::recovery::crash_attach_external,
            commands::recovery::crash_detach_external,
            commands::recovery::crash_report,
            commands::recovery::crash_forget,
            commands::recovery::crash_report_dir,
            commands::recovery::crash_simulate,
            // Phase 27 — updates.
            commands::updates::updates_state,
            commands::updates::check_update,
            commands::updates::download_update,
            commands::updates::install_update,
            commands::updates::updates_set_channel,
            commands::updates::updates_set_auto_download,
            commands::updates::updates_skip_version,
            commands::updates::updates_clear_skip,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app, event| {
            // Phase 14 — never orphan the engine: the sidecar dies with the
            // shell. SIGTERM first (Unix) so it runs its own stop path.
            if let tauri::RunEvent::Exit = event {
                engine::stop_sidecar(&engine_exit, std::time::Duration::from_millis(1_500));
            }
            // Phase 10 — workspace windows: track live bounds in SpawnState
            // (Moved/Resized fire during drags; cheap in-memory writes) and
            // persist them to the DB when the window closes.
            if let tauri::RunEvent::WindowEvent { label, event: wev, .. } = &event {
                // Phase 27 — OS appearance: one event source for all three
                // platforms (Windows included: no registry polling needed).
                if let tauri::WindowEvent::ThemeChanged(theme) = wev {
                    theme::on_theme_changed(app, *theme);
                }
                // Phase 27 — always-alive: closing the MAIN window hides it.
                // Quitting is deliberate on every platform (tray, app menu,
                // ⌘Q); a stray ⌘W must not silently kill the engine.
                if label == "main" {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = wev {
                        api.prevent_close();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                        crash::log_shell(&crash::xr_home(), "main window hidden (close intercepted)");
                    }
                }
                // Phase 16 — Voice Theater: bounds memory + "voice keeps
                // running" hand-off when the window closes.
                #[cfg(desktop)]
                {
                    if label == commands::theater::LABEL {
                        commands::theater::on_window_event(app, wev);
                    }
                }
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
                // Phase 27 — a clean exit is the ONLY thing that clears the
                // dirty flag, and it happens after the sidecar has been
                // stopped above (order matters: a flag cleared too early is a
                // crash we cannot see).
                let home = crash::xr_home();
                #[cfg(desktop)]
                commands::screenshot::unregister(app);
                if engine::snapshot(app.state::<std::sync::Arc<engine::EngineState>>().inner()).spawned {
                    crash::log_shell(&home, "exit: engine child was still running — stopping");
                } else {
                    crash::log_shell(&home, "exit: clean shutdown");
                }
                crash::clear_flag(&home);
                commands::workspaces::flush_all_bounds(app);
                #[cfg(desktop)]
                commands::hud::unregister_all(app);
                // Park the orb's final position (drag → quit race).
                #[cfg(desktop)]
                commands::orb::flush_position(app);
                // Theater still open at quit: remember where it was.
                #[cfg(desktop)]
                commands::theater::flush(app);
            }
        });

/// One line per engine-state observation, in the shell log. Kept here (not in
/// `engine.rs`) so the engine module stays free of file I/O.
fn app_log_engine_state(snapshot: &engine::EngineSnapshot) {
    let home = crash::xr_home();
    if snapshot.is_up() {
        crash::log_shell(
            &home,
            &format!(
                "engine up: port {:?} mode {} containment {}",
                snapshot.port,
                if snapshot.external { "external" } else { "sidecar" },
                snapshot.containment.as_deref().unwrap_or("n/a")
            ),
        );
    } else {
        crash::log_shell(
            &home,
            &format!("engine down: {}", snapshot.note.as_deref().unwrap_or("no link")),
        );
    }
}
}
