/*
 * Companion Orb window (Phase 6) — XR's persistent desktop presence.
 *
 * A config-declared webview (`orb.html`, 120×120 frameless transparent
 * always-on-top) that renders the Phase 2 CompanionOrb SVG. This module
 * owns everything window-shaped so the webview stays dumb (hud.rs pattern):
 *
 *   - startup gate: show only after onboarding AND while `xr.orb.showOrb`
 *   - position memory: debounced writes on WindowEvent::Moved, validated
 *     against the current monitors (an unplugged display can't strand the
 *     orb off-screen), default = 24pt from the primary's bottom-right
 *   - native context menu (tauri::menu) popped at the cursor on right-click
 *   - ⌥⌘O / Ctrl+Alt+O global visibility toggle (fallback Alt+Shift+O)
 *   - cross-window plumbing: show/hide broadcasts, main-window focus
 *
 * IPC surface (frontend: src/lib/orb.ts):
 *   orb_show / orb_hide / orb_toggle      — window ops (persist showOrb)
 *   orb_open_main                         — double-click → focus main
 *   orb_show_context_menu                 — native menu at the cursor
 *   orb_get_position / orb_set_position   — validated position get/set
 *
 * Events: `orb:show` / `orb:hide` (Rust → all webviews), `orb:voice-requested`
 * / `orb:approvals-requested` (Rust → main, from the context menu).
 * `orb:set-state` and `orb:clicked` are webview broadcasts — no Rust hop.
 *
 * Shortcut teardown: lib.rs's RunEvent::Exit calls hud::unregister_all,
 * which unregisters EVERY global shortcut — the orb's included.
 */
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::menu::{ContextMenu, Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, Listener, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_store::{Store, StoreBuilder};

/// settings.json keys (shared with src/lib/persistent-store.ts).
const POSITION_KEY: &str = "xr.orb.position";
const SHOW_KEY: &str = "xr.orb.showOrb";
const ONBOARDING_KEY: &str = "xr.onboarding.complete";
/// User rebind for the orb visibility toggle (Settings → Shortcuts, Phase 8).
const ORB_SHORTCUT_KEY: &str = "xr.orb.shortcut";

/// Orb window label (tauri.conf.json > app.windows).
const ORB_LABEL: &str = "orb";
/// Orb window size — logical px, kept in sync with tauri.conf.json.
pub const ORB_SIZE: i32 = 120;
/// Default distance from the screen edges — logical px (scaled per monitor).
const MARGIN_LOGICAL: i32 = 24;

// ─── Pure helpers (unit-tested) ─────────────────────────────────────────────

/// (primary, fallback) shortcut pair. CommandOrControl maps ⌘ on macOS and
/// Ctrl elsewhere, so one expression covers all three platforms: ⌥⌘O / Ctrl+Alt+O.
pub fn default_shortcuts(os: &str) -> (&'static str, &'static str) {
    let _ = os; // platform-agnostic — kept for symmetry with hud.rs
    ("Alt+CommandOrControl+O", "Alt+Shift+O")
}

/// A monitor rectangle in physical pixels (hud.rs shape).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Orb window size in physical px at `scale`.
pub fn orb_physical_size(scale: f64) -> (i32, i32) {
    let size = (ORB_SIZE as f64 * scale).round() as i32;
    (size, size)
}

/// True when the orb at `pos` (top-left, physical px) overlaps any monitor —
/// i.e. the user can still reach it. A window fully outside every monitor
/// (display unplugged, layout changed) must NOT reuse its position.
pub fn position_is_reachable(pos: (i32, i32), monitors: &[MonitorRect], scale: f64) -> bool {
    let (w, h) = orb_physical_size(scale);
    let (x, y) = pos;
    monitors.iter().any(|m| {
        x < m.x + m.w && x + w > m.x && y < m.y + m.h && y + h > m.y
    })
}

/// Bottom-right corner of `monitor` with a 24pt margin (physical px) —
/// the OV-3 first-launch position.
pub fn default_corner(monitor: &MonitorRect, scale: f64) -> (i32, i32) {
    let (w, _) = orb_physical_size(scale);
    let margin = (MARGIN_LOGICAL as f64 * scale).round() as i32;
    (
        monitor.x + monitor.w - w - margin,
        monitor.y + monitor.h - w - margin,
    )
}

/// The position the orb should use: the remembered one when still
/// reachable, otherwise the default corner of the primary monitor.
pub fn choose_position(
    saved: Option<(i32, i32)>,
    monitors: &[MonitorRect],
    primary: &MonitorRect,
    scale: f64,
) -> (i32, i32) {
    match saved {
        Some(pos) if position_is_reachable(pos, monitors, scale) => pos,
        _ => default_corner(primary, scale),
    }
}

// ─── Settings store ─────────────────────────────────────────────────────────

fn settings<R: Runtime>(app: &AppHandle<R>) -> Option<Arc<Store<R>>> {
    StoreBuilder::new(app, "settings.json").build().ok()
}

fn read_saved_position<R: Runtime>(app: &AppHandle<R>) -> Option<(i32, i32)> {
    let store = settings(app)?;
    let value = store.get(POSITION_KEY)?;
    let arr = value.as_array()?;
    if arr.len() != 2 {
        return None;
    }
    // JSON numbers are f64; physical positions are i32.
    let x = arr.first()?.as_i64()? as i32;
    let y = arr.last()?.as_i64()? as i32;
    Some((x, y))
}

fn write_saved_position<R: Runtime>(app: &AppHandle<R>, pos: (i32, i32)) {
    if let Some(store) = settings(app) {
        store.set(POSITION_KEY, serde_json::json!([pos.0, pos.1]));
        let _ = store.save();
    }
}

fn read_bool<R: Runtime>(app: &AppHandle<R>, key: &str, default: bool) -> bool {
    match settings(app).and_then(|store| store.get(key)) {
        Some(value) => value.as_bool().unwrap_or(default),
        None => default,
    }
}

fn write_bool<R: Runtime>(app: &AppHandle<R>, key: &str, value: bool) {
    if let Some(store) = settings(app) {
        store.set(key, serde_json::json!(value));
        let _ = store.save();
    }
}

fn monitor_rects<R: Runtime>(app: &AppHandle<R>) -> Vec<MonitorRect> {
    match app.available_monitors() {
        Ok(monitors) => monitors
            .iter()
            .map(|m| MonitorRect {
                x: m.position().x,
                y: m.position().y,
                w: m.size().width as i32,
                h: m.size().height as i32,
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn primary_rect<R: Runtime>(app: &AppHandle<R>) -> Option<MonitorRect> {
    app.primary_monitor().ok().flatten().map(|m| MonitorRect {
        x: m.position().x,
        y: m.position().y,
        w: m.size().width as i32,
        h: m.size().height as i32,
    })
}

// ─── Debounced position memory ──────────────────────────────────────────────

/// Latest-vs-saved window position (updated by the Moved listener, drained
/// by the writer thread below and by the exit flush).
#[derive(Default)]
pub struct OrbPositionState(pub std::sync::Mutex<OrbPositionInner>);

/// The chord actually registered for the orb toggle (init candidate loop or
/// a Phase 8 rebind). Read by `orb_shortcut_info` for the Settings UI.
#[derive(Default)]
pub struct OrbShortcutState(pub std::sync::Mutex<String>);

#[derive(Default)]
pub struct OrbPositionInner {
    pub latest: Option<(i32, i32)>,
    pub saved: Option<(i32, i32)>,
}

fn flush_locked<R: Runtime>(app: &AppHandle<R>, inner: &mut OrbPositionInner) {
    if let Some(pos) = inner.latest {
        if inner.saved != Some(pos) {
            write_saved_position(app, pos);
            inner.saved = Some(pos);
        }
    }
}

/// Final flush for RunEvent::Exit — see lib.rs. A drag that ended within
/// the debounce window still lands on disk.
pub fn flush_position<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<OrbPositionState>() {
        if let Ok(mut inner) = state.0.lock() {
            flush_locked(app, &mut inner);
        }
    }
}

/// Background writer: persists the position once it has been stable for a
/// tick (~800ms) — a drag in flight never touches the disk, and a finished
/// drag settles well inside the next tick.
fn spawn_position_writer<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut previous: Option<(i32, i32)> = None;
        loop {
            std::thread::sleep(Duration::from_millis(400));
            let Some(state) = app.try_state::<OrbPositionState>() else {
                continue;
            };
            let Ok(mut inner) = state.0.lock() else {
                continue;
            };
            let latest = inner.latest;
            if matches!((latest, previous), (Some(pos), Some(prev)) if pos == prev) {
                flush_locked(&app, &mut inner);
            }
            previous = latest;
        }
    });
}

// ─── Window ops ─────────────────────────────────────────────────────────────

fn orb_window<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::WebviewWindow<R>> {
    app.get_webview_window(ORB_LABEL)
}

/// Where the orb should sit right now: the remembered position when still
/// reachable, else the primary's bottom-right corner.
fn resolve_position<R: Runtime>(app: &AppHandle<R>) -> Option<(i32, i32)> {
    let primary = primary_rect(app)?;
    let monitors = monitor_rects(app);
    let scale = orb_window(app)
        .and_then(|orb| orb.scale_factor().ok())
        .unwrap_or(1.0);
    Some(choose_position(
        read_saved_position(app),
        &monitors,
        &primary,
        scale,
    ))
}

/// Place the orb at its remembered position (validated) and show it.
pub fn show_orb<R: Runtime>(app: &AppHandle<R>) {
    let Some(orb) = orb_window(app) else {
        return;
    };
    if let Some((x, y)) = resolve_position(app) {
        let _ = orb.set_position(tauri::PhysicalPosition::new(x, y));
    }
    let _ = orb.show();
    write_bool(app, SHOW_KEY, true);
    let _ = app.emit("orb:show", ());
}

/// Park the current position, hide the orb, remember the user's choice.
pub fn hide_orb<R: Runtime>(app: &AppHandle<R>) {
    let Some(orb) = orb_window(app) else {
        return;
    };
    if let Ok(pos) = orb.outer_position() {
        if let Some(state) = app.try_state::<OrbPositionState>() {
            if let Ok(mut inner) = state.0.lock() {
                inner.latest = Some((pos.x, pos.y));
            }
        }
    }
    let _ = orb.hide();
    write_bool(app, SHOW_KEY, false);
    let _ = app.emit("orb:hide", ());
}

/// Global-shortcut semantics: visible → hide, hidden → show.
pub fn toggle_orb<R: Runtime>(app: &AppHandle<R>) {
    let Some(orb) = orb_window(app) else {
        return;
    };
    if orb.is_visible().unwrap_or(false) {
        hide_orb(app);
    } else {
        show_orb(app);
    }
}

/// Re-check the current position against the monitors and reset to the
/// default corner when stranded (display unplugged / layout changed).
/// Called on show, on second-instance, and on the main window's
/// ScaleFactorChanged — Tauri v2 has no monitor-list event, so these are
/// the display-change proxies.
pub fn validate_position<R: Runtime>(app: &AppHandle<R>) {
    let Some(orb) = orb_window(app) else {
        return;
    };
    if !orb.is_visible().unwrap_or(false) {
        return;
    }
    let Some(primary) = primary_rect(app) else {
        return;
    };
    let Ok(scale) = orb.scale_factor() else {
        return;
    };
    let Ok(pos) = orb.outer_position() else {
        return;
    };
    let monitors = monitor_rects(app);
    if !position_is_reachable((pos.x, pos.y), &monitors, scale) {
        let (x, y) = default_corner(&primary, scale);
        let _ = orb.set_position(tauri::PhysicalPosition::new(x, y));
    }
}

// ─── Native context menu ────────────────────────────────────────────────────

/// Menu item ids — the single source of truth shared by `build_menu` (what
/// pops up) and `handle_menu_id` (what runs), so a typo can't create a dead
/// item. Unit-tested below.
mod menu_ids {
    pub const OPEN: &str = "orb-open";
    pub const VOICE: &str = "orb-voice";
    pub const THEATER: &str = "orb-theater";
    pub const APPROVALS: &str = "orb-approvals";
    /// Phase 17: the Builder (3-pane IDE) — routes the main window.
    pub const BUILDER: &str = "orb-builder";
    pub const SETTINGS: &str = "orb-settings";
    pub const HIDE: &str = "orb-hide";
    pub const QUIT: &str = "orb-quit";

    /// Every id `build_menu` creates, in menu order (tests iterate this).
    #[cfg(test)]
    pub const ALL: &[&str] = &[OPEN, VOICE, THEATER, APPROVALS, BUILDER, SETTINGS, HIDE, QUIT];
}

/// What a menu selection should do — `handle_menu_id` dispatches on this.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum MenuAction {
    OpenMain,
    Voice,
    Theater,
    Approvals,
    Builder,
    Settings,
    Hide,
    Quit,
}

/// Pure id → action mapping (unit-tested; keeps `handle_menu_id` exhaustive).
fn menu_action_for(id: &str) -> Option<MenuAction> {
    match id {
        menu_ids::OPEN => Some(MenuAction::OpenMain),
        menu_ids::VOICE => Some(MenuAction::Voice),
        menu_ids::THEATER => Some(MenuAction::Theater),
        menu_ids::APPROVALS => Some(MenuAction::Approvals),
        menu_ids::BUILDER => Some(MenuAction::Builder),
        menu_ids::SETTINGS => Some(MenuAction::Settings),
        menu_ids::HIDE => Some(MenuAction::Hide),
        menu_ids::QUIT => Some(MenuAction::Quit),
        _ => None,
    }
}

/// Phase 16: the theater item shows its global chord like the voice item.
pub fn theater_menu_label(os: &str) -> String {
    let chord = if os == "macos" { "⌥⌘V" } else { "Ctrl+Alt+V" };
    format!("Voice theater ({chord})")
}

/// Whether a voice session is running (Phase 15). The main window broadcasts
/// `voice:state-changed {state, active}` on every change; the menu reads it
/// so the voice item is an honest toggle, not a dead "Start" while listening.
#[derive(Default)]
pub struct VoiceActiveState(pub AtomicBool);

/// Label for the voice menu item given the session + OS (unit-tested).
pub fn voice_menu_label(active: bool, os: &str) -> String {
    let chord = if os == "macos" { "⌘." } else { "Ctrl+." };
    if active {
        format!("Stop listening ({chord})")
    } else {
        format!("Start voice session ({chord})")
    }
}

/// `voice:state-changed` payload → is a session active? Tolerates both the
/// explicit `active` flag and a bare state string.
pub fn voice_active_from_payload(payload: &str) -> Option<bool> {
    let value: serde_json::Value = serde_json::from_str(payload).ok()?;
    if let Some(active) = value.get("active").and_then(|v| v.as_bool()) {
        return Some(active);
    }
    let state = value.get("state").and_then(|v| v.as_str())?;
    Some(state != "idle" && state != "offline")
}

fn voice_active<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<VoiceActiveState>()
        .map(|s| s.0.load(Ordering::Relaxed))
        .unwrap_or(false)
}

/// The right-click menu. Ids are `orb-`-prefixed: selections arrive on the
/// app-wide menu event stream, which the tray's menu shares.
fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let open = MenuItem::with_id(app, menu_ids::OPEN, "Open XR", true, None::<&str>)?;
    let voice_label = voice_menu_label(voice_active(app), std::env::consts::OS);
    let voice = MenuItem::with_id(app, menu_ids::VOICE, voice_label, true, None::<&str>)?;
    let theater_label = theater_menu_label(std::env::consts::OS);
    let theater = MenuItem::with_id(app, menu_ids::THEATER, theater_label, true, None::<&str>)?;
    let approvals =
        MenuItem::with_id(app, menu_ids::APPROVALS, "Pending Approvals", true, None::<&str>)?;
    let builder = MenuItem::with_id(app, menu_ids::BUILDER, "Open Builder", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let settings = MenuItem::with_id(app, menu_ids::SETTINGS, "Settings…", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, menu_ids::HIDE, "Hide Orb", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, menu_ids::QUIT, "Quit XR", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &open,
            &voice,
            &theater,
            &approvals,
            &builder,
            &separator,
            &settings,
            &hide,
            &separator,
            &quit,
        ],
    )
}

fn focus_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

/// Menu selections (registered once in `init` via `app.on_menu_event`).
fn handle_menu_id<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match menu_action_for(id) {
        Some(MenuAction::OpenMain) => focus_main(app),
        Some(MenuAction::Voice) => {
            // Toggle: the main window's controller starts or stops based on
            // its own state, so the label and the action can't disagree.
            focus_main(app);
            let _ = app.emit_to("main", "orb:voice-requested", ());
        }
        // Phase 16: the theater is its own window — no main-window detour.
        Some(MenuAction::Theater) => super::theater::open_theater(app),
        Some(MenuAction::Approvals) => {
            focus_main(app);
            let _ = app.emit_to("main", "orb:approvals-requested", ());
        }
        Some(MenuAction::Settings) => {
            focus_main(app);
            // Phase 5's route event — the main window's palette IPC navigates.
            let _ = app.emit_to("main", "palette:navigate", "/settings");
        }
        Some(MenuAction::Builder) => {
            focus_main(app);
            // Phase 17: no workspace id here — the route shows recent projects.
            let _ = app.emit_to("main", "palette:navigate", "/builder");
        }
        Some(MenuAction::Hide) => hide_orb(app),
        Some(MenuAction::Quit) => app.exit(0),
        None => {}
    }
}

// ─── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn orb_show<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    show_orb(&app);
    Ok(())
}

#[tauri::command]
pub async fn orb_hide<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    hide_orb(&app);
    Ok(())
}

#[tauri::command]
pub async fn orb_toggle<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    toggle_orb(&app);
    Ok(())
}

/// Double-click on the orb → surface + focus the main window.
#[tauri::command]
pub async fn orb_open_main<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    focus_main(&app);
    Ok(())
}

/// Right-click → the NATIVE menu, popped at the cursor over the orb window.
#[tauri::command]
pub async fn orb_show_context_menu<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let Some(orb) = orb_window(&app) else {
        return Ok(());
    };
    let menu = build_menu(&app).map_err(|e| e.to_string())?;
    // popup takes the window (not the webview) — WebviewWindow derefs
    // through AsRef<Webview> and Webview::window() hands it over.
    menu.popup(orb.as_ref().window()).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrbPosition {
    pub x: i32,
    pub y: i32,
}

#[tauri::command]
pub async fn orb_get_position<R: Runtime>(app: AppHandle<R>) -> Result<OrbPosition, String> {
    let orb = orb_window(&app).ok_or("orb window missing")?;
    let pos = orb.outer_position().map_err(|e| e.to_string())?;
    Ok(OrbPosition { x: pos.x, y: pos.y })
}

/// Set + remember the position — validated against the CURRENT monitors so
/// no caller can strand the orb off-screen.
#[tauri::command]
pub async fn orb_set_position<R: Runtime>(
    app: AppHandle<R>,
    x: i32,
    y: i32,
) -> Result<(), String> {
    let orb = orb_window(&app).ok_or("orb window missing")?;
    let scale = orb.scale_factor().unwrap_or(1.0);
    if !position_is_reachable((x, y), &monitor_rects(&app), scale) {
        return Err("position is not on any monitor".into());
    }
    orb.set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    if let Some(state) = app.try_state::<OrbPositionState>() {
        if let Ok(mut inner) = state.0.lock() {
            inner.latest = Some((x, y));
        }
    }
    Ok(())
}

// ─── Registration ───────────────────────────────────────────────────────────

/// Wire everything: state, moved-events, the menu handler, the visibility
/// shortcut, and the startup gate. Called once from lib.rs setup.
pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    app.manage(OrbPositionState::default());
    app.manage(VoiceActiveState::default());

    // Native menu selections (shared stream — only orb-* ids match here).
    app.on_menu_event(|app, event| handle_menu_id(app, event.id.as_ref()));

    // Voice session state (Phase 15) — drives the menu's Start/Stop label.
    {
        let handle = app.clone();
        app.listen_any("voice:state-changed", move |event| {
            if let Some(active) = voice_active_from_payload(event.payload()) {
                if let Some(state) = handle.try_state::<VoiceActiveState>() {
                    state.0.store(active, Ordering::Relaxed);
                }
            }
        });
    }

    // Position memory: Moved → the debouncer's latest.
    if let Some(orb) = orb_window(app) {
        let app = app.clone();
        orb.on_window_event(move |event| {
            if let tauri::WindowEvent::Moved(pos) = event {
                if let Some(state) = app.try_state::<OrbPositionState>() {
                    if let Ok(mut inner) = state.0.lock() {
                        if inner.latest != Some((pos.x, pos.y)) {
                            inner.latest = Some((pos.x, pos.y));
                        }
                    }
                }
            }
        });
    }
    spawn_position_writer(app);

    // Display-layout proxy: revalidate when the main window's scale changes
    // (resolution/monitor changes without a monitor-list event).
    if let Some(main) = app.get_webview_window("main") {
        let app = app.clone();
        main.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::ScaleFactorChanged { .. }) {
                validate_position(&app);
            }
        });
    }

    // ⌥⌘O / Ctrl+Alt+O visibility toggle — the user override (Phase 8
    // Settings) wins, then the platform primary, then the fallback.
    app.manage(OrbShortcutState::default());
    let (primary, fallback) = default_shortcuts(std::env::consts::OS);
    let user_override = settings(app)
        .and_then(|store| store.get(ORB_SHORTCUT_KEY))
        .and_then(|value| value.as_str().map(str::to_string));
    let mut candidates: Vec<(String, bool)> = Vec::new();
    if let Some(user) = user_override {
        candidates.push((user, false));
    }
    candidates.push((primary.to_string(), false));
    candidates.push((fallback.to_string(), true));
    for (candidate, is_fallback) in candidates {
        let shortcut: Shortcut = match candidate.parse() {
            Ok(s) => s,
            Err(_) => continue,
        };
        match app.global_shortcut().on_shortcut(shortcut, |app, _s, event| {
            // The plugin also reports key RELEASES — only presses toggle.
            if event.state() == ShortcutState::Pressed {
                toggle_orb(app);
            }
        }) {
            Ok(()) => {
                if let Some(state) = app.try_state::<OrbShortcutState>() {
                    if let Ok(mut guard) = state.0.lock() {
                        *guard = candidate.clone();
                    }
                }
                if is_fallback {
                    eprintln!(
                        "[xr] orb shortcut: {primary} unavailable — using {candidate} instead"
                    );
                }
                break;
            }
            Err(_) => continue, // taken by another app — try the next candidate
        }
    }

    // Startup gate: onboarding done AND showOrb (default true) → float it.
    if read_bool(app, ONBOARDING_KEY, false) && read_bool(app, SHOW_KEY, true) {
        show_orb(app);
    }

    Ok(())
}

// ─── Shortcut rebind (Settings → Shortcuts, Phase 8) ────────────────────────

/// The chord the OS currently holds for the orb toggle ("" before init).
#[tauri::command]
pub fn orb_shortcut_info(app: AppHandle) -> String {
    app.try_state::<OrbShortcutState>()
        .and_then(|state| state.0.lock().ok().map(|guard| guard.clone()))
        .unwrap_or_default()
}

/// Register-new-first rebind (hud_set_shortcut pattern): the new chord is
/// claimed before the old one is released, so a failed swap never leaves
/// the orb without a shortcut.
#[tauri::command]
pub async fn orb_set_shortcut(
    app: AppHandle,
    chord: String,
) -> Result<super::settings::ShortcutRegistration, String> {
    let new_shortcut: Shortcut = chord
        .parse()
        .map_err(|e| format!("Cannot parse shortcut: {e}"))?;

    let state = app.state::<OrbShortcutState>();
    let old = {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        if *guard == chord {
            return Ok(super::settings::ShortcutRegistration {
                shortcut: chord,
                conflict: false,
            });
        }
        guard.clone()
    };

    let global = app.global_shortcut();
    global
        .on_shortcut(new_shortcut, |app, _s, event| {
            if event.state() == ShortcutState::Pressed {
                toggle_orb(app);
            }
        })
        .map_err(|e| format!("Shortcut is reserved by the system or another app: {e}"))?;

    if let Ok(old_shortcut) = old.parse::<Shortcut>() {
        if old_shortcut != new_shortcut {
            let _ = global.unregister(old_shortcut);
        }
    }

    if let Some(state) = app.try_state::<OrbShortcutState>() {
        if let Ok(mut guard) = state.0.lock() {
            *guard = chord.clone();
        }
    }
    if let Some(store) = settings(&app) {
        store.set(ORB_SHORTCUT_KEY, serde_json::json!(chord.clone()));
        let _ = store.save();
    }
    Ok(super::settings::ShortcutRegistration {
        shortcut: chord,
        conflict: false,
    })
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::{menu_action_for, menu_ids, MenuAction};

    /// Every id build_menu creates maps to exactly one distinct action —
    /// no dead menu items, no ambiguous ids — and unknown ids are ignored.
    #[test]
    fn menu_ids_map_to_distinct_actions() {
        let mut seen: Vec<MenuAction> = Vec::new();
        for id in menu_ids::ALL {
            let action = menu_action_for(id)
                .unwrap_or_else(|| panic!("menu id {id} has no dispatch arm"));
            assert!(!seen.contains(&action), "duplicate action for {id}");
            seen.push(action);
        }
        assert_eq!(seen.len(), 8, "expected exactly 8 menu actions");
        assert_eq!(menu_action_for("orb-unknown"), None);
        assert_eq!(menu_action_for(""), None);
        assert_eq!(menu_action_for("open"), None, "unprefixed id must not match");
    }

    /// Phase 15: the voice item is a toggle whose label follows the session.
    #[test]
    fn voice_menu_label_follows_session() {
        assert_eq!(voice_menu_label(false, "macos"), "Start voice session (⌘.)");
        assert_eq!(voice_menu_label(true, "macos"), "Stop listening (⌘.)");
        assert_eq!(voice_menu_label(true, "windows"), "Stop listening (Ctrl+.)");
        assert_eq!(theater_menu_label("macos"), "Voice theater (⌥⌘V)");
        assert_eq!(theater_menu_label("linux"), "Voice theater (Ctrl+Alt+V)");
        assert_eq!(voice_active_from_payload(r#"{"state":"listening","active":true}"#), Some(true));
        assert_eq!(voice_active_from_payload(r#"{"state":"idle","active":false}"#), Some(false));
        assert_eq!(voice_active_from_payload(r#"{"state":"speaking"}"#), Some(true));
        assert_eq!(voice_active_from_payload(r#"{"state":"idle"}"#), Some(false));
        assert_eq!(voice_active_from_payload("not json"), None);
    }

    use super::*;

    fn monitor(x: i32, y: i32, w: i32, h: i32) -> MonitorRect {
        MonitorRect { x, y, w, h }
    }

    #[test]
    fn platform_shortcut_pair() {
        // CommandOrControl resolves ⌘/Ctrl per platform — one pair fits all.
        for os in ["macos", "windows", "linux"] {
            assert_eq!(default_shortcuts(os).0, "Alt+CommandOrControl+O");
            assert_eq!(default_shortcuts(os).1, "Alt+Shift+O");
        }
    }

    #[test]
    fn default_corner_respects_margin_and_scale() {
        let m = monitor(0, 0, 1920, 1080);
        // 1× display: 24px from the bottom-right of the 120px window.
        assert_eq!(default_corner(&m, 1.0), (1920 - 120 - 24, 1080 - 120 - 24));
        // 2× display: a logical-1920 monitor reports 3840×2160 PHYSICAL
        // (monitor_rects feeds physical sizes); same 24pt visual margin.
        let hidpi = monitor(0, 0, 3840, 2160);
        assert_eq!(default_corner(&hidpi, 2.0), (3840 - 240 - 48, 2160 - 240 - 48));
        // Secondary monitor with an offset origin anchors to ITS corner.
        let second = monitor(1920, -100, 1920, 1080);
        assert_eq!(
            default_corner(&second, 1.0),
            (1920 + 1920 - 120 - 24, -100 + 1080 - 120 - 24)
        );
    }

    #[test]
    fn reachable_positions() {
        let monitors = [monitor(0, 0, 1920, 1080)];
        // Fully on-screen.
        assert!(position_is_reachable((100, 100), &monitors, 1.0));
        // Straddling the edge — still grabbable.
        assert!(position_is_reachable((1910, 1000), &monitors, 1.0));
        // Entirely off to the right (second monitor unplugged).
        assert!(!position_is_reachable((2500, 100), &monitors, 1.0));
        // Negative-position secondary monitor that no longer exists.
        assert!(!position_is_reachable((-2000, 100), &monitors, 1.0));
        // No monitors reported — never trust a stale position.
        assert!(!position_is_reachable((100, 100), &[], 1.0));
        // Reachability uses the SCALED size: a 2× window pokes back in from
        // further left than a 1× one.
        assert!(!position_is_reachable((-200, 100), &monitors, 1.0));
        assert!(position_is_reachable((-200, 100), &monitors, 2.0));
    }

    #[test]
    fn chooses_saved_when_reachable_otherwise_corner() {
        let primary = monitor(0, 0, 1920, 1080);
        let monitors = [primary, monitor(1920, 0, 1920, 1080)];

        // Saved on the second monitor that still exists → reused verbatim.
        assert_eq!(
            choose_position(Some((2200, 900)), &monitors, &primary, 1.0),
            (2200, 900)
        );

        // Saved on a monitor that is gone → default corner on primary.
        let corner = default_corner(&primary, 1.0);
        assert_eq!(
            choose_position(Some((-2000, 100)), &monitors, &primary, 1.0),
            corner
        );
        assert_eq!(choose_position(None, &monitors, &primary, 1.0), corner);

        // The corner keeps the orb inside the monitor with its 24pt margin.
        assert!(corner.0 > 0 && corner.0 + 120 < primary.w);
        assert!(corner.1 > 0 && corner.1 + 120 < primary.h);
    }
}
