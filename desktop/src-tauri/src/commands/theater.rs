/*
 * Voice Theater window (Phase 16) — docs/phases/16-theater-plan.md.
 *
 * An on-demand, frameless 900×700 webview (`theater.html`) that renders the
 * main window's voice session. This module owns only the shell concerns:
 *
 *   - lifecycle: open (reuse → show + focus), close, toggle, is_open
 *   - placement: last saved bounds when still reachable, else centred on the
 *     primary display — or on a secondary display when the user asked for it
 *     and one exists
 *   - memory (Tauri Store `settings.json`): `xr.theater.bounds`,
 *     `xr.theater.fullscreen`, `xr.theater.alwaysOnTop`,
 *     `xr.theater.secondMonitor`, `xr.theater.shortcut`
 *   - ⌥⌘V / Ctrl+Alt+V global toggle with the Alt+Shift+V fallback
 *     (hud.rs / orb.rs candidate loop), live rebind from Settings
 *   - the native right-click menu (Minimize · Always on top · Mute
 *     microphone · Toggle subtitles · Settings · Close)
 *   - `theater:close` to the main window whenever the window goes away, so
 *     the voice loop can decide what to do (it keeps running by default)
 *
 * The pure helpers (display choice, centring, bounds parsing, menu ids) are
 * unit-tested below; everything else mirrors orb.rs idioms.
 */
use std::sync::{Arc, Mutex};

use tauri::menu::{CheckMenuItem, ContextMenu, Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_store::{Store, StoreBuilder};

pub const LABEL: &str = "theater";
const TITLE: &str = "XR Voice Theater";
const DEFAULT_SIZE: (f64, f64) = (900.0, 700.0);
const MIN_SIZE: (f64, f64) = (600.0, 400.0);
/// Deep space — the theater ignores the app theme (docs/THEME-SYSTEM.md §7).
const BACKGROUND: tauri::window::Color = tauri::window::Color(3, 7, 13, 255);

const BOUNDS_KEY: &str = "xr.theater.bounds";
const FULLSCREEN_KEY: &str = "xr.theater.fullscreen";
const ALWAYS_ON_TOP_KEY: &str = "xr.theater.alwaysOnTop";
const SECOND_MONITOR_KEY: &str = "xr.theater.secondMonitor";
const SHORTCUT_KEY: &str = "xr.theater.shortcut";

/// (primary, fallback) — ⌥⌘V everywhere; ⌥⇧V when something else owns it.
pub fn default_shortcuts() -> (&'static str, &'static str) {
    ("Alt+CommandOrControl+V", "Alt+Shift+V")
}

// ─── Pure geometry ──────────────────────────────────────────────────────────

/// A display in physical pixels plus its scale (Tauri's `Monitor`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Display {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub scale: f64,
}

/// Saved window bounds, logical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Logical top-left that centres a `w`×`h` logical window on `display`.
pub fn centered_on(display: &Display, w: f64, h: f64) -> (f64, f64) {
    let scale = if display.scale > 0.0 { display.scale } else { 1.0 };
    let dw = display.w as f64 / scale;
    let dh = display.h as f64 / scale;
    let x = display.x as f64 / scale + ((dw - w) / 2.0).max(0.0);
    let y = display.y as f64 / scale + ((dh - h) / 2.0).max(0.0);
    (x.round(), y.round())
}

/// The display to open on: a secondary one when asked for and present,
/// otherwise the primary (or the first known display, or none at all).
pub fn pick_display(
    displays: &[Display],
    primary: Option<Display>,
    prefer_second: bool,
) -> Option<Display> {
    if prefer_second {
        let secondary = displays.iter().find(|d| !same_origin(d, primary)).copied();
        if secondary.is_some() {
            return secondary;
        }
    }
    primary.or_else(|| displays.first().copied())
}

/// Same display as `primary` (by origin); false when there is no primary.
fn same_origin(d: &Display, primary: Option<Display>) -> bool {
    match primary {
        Some(p) => (d.x, d.y) == (p.x, p.y),
        None => false,
    }
}

/// A saved position is only reused when its top-left still lands on a
/// display (the user may have unplugged a screen since).
pub fn bounds_reachable(bounds: &Bounds, displays: &[Display]) -> bool {
    displays.iter().any(|d| {
        let scale = if d.scale > 0.0 { d.scale } else { 1.0 };
        let left = d.x as f64 / scale;
        let top = d.y as f64 / scale;
        let right = left + d.w as f64 / scale;
        let bottom = top + d.h as f64 / scale;
        // 32 px of the drag strip must be grabbable.
        bounds.x + 32.0 <= right
            && bounds.x + bounds.w - 32.0 >= left
            && bounds.y >= top - 1.0
            && bounds.y + 32.0 <= bottom
    })
}

/// Parse `{x,y,w,h}`; sizes below the minimum are clamped, junk is None.
pub fn bounds_from_json(value: &serde_json::Value) -> Option<Bounds> {
    let obj = value.as_object()?;
    let num = |key: &str| obj.get(key).and_then(serde_json::Value::as_f64);
    let (x, y, w, h) = (num("x")?, num("y")?, num("w")?, num("h")?);
    if !(x.is_finite() && y.is_finite() && w.is_finite() && h.is_finite()) {
        return None;
    }
    Some(Bounds {
        x,
        y,
        w: w.max(MIN_SIZE.0),
        h: h.max(MIN_SIZE.1),
    })
}

// ─── Settings store ─────────────────────────────────────────────────────────

fn settings<R: Runtime>(app: &AppHandle<R>) -> Option<Arc<Store<R>>> {
    StoreBuilder::new(app, "settings.json").build().ok()
}

fn read_bool<R: Runtime>(app: &AppHandle<R>, key: &str, default: bool) -> bool {
    match settings(app).and_then(|store| store.get(key)) {
        Some(value) => value.as_bool().unwrap_or(default),
        None => default,
    }
}

fn write_json<R: Runtime>(app: &AppHandle<R>, key: &str, value: serde_json::Value) {
    if let Some(store) = settings(app) {
        store.set(key, value);
        let _ = store.save();
    }
}

fn read_bounds<R: Runtime>(app: &AppHandle<R>) -> Option<Bounds> {
    settings(app)
        .and_then(|store| store.get(BOUNDS_KEY))
        .and_then(|value| bounds_from_json(&value))
}

fn displays<R: Runtime>(app: &AppHandle<R>) -> Vec<Display> {
    match app.available_monitors() {
        Ok(monitors) => monitors
            .iter()
            .map(|m| Display {
                x: m.position().x,
                y: m.position().y,
                w: m.size().width,
                h: m.size().height,
                scale: m.scale_factor(),
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn primary_display<R: Runtime>(app: &AppHandle<R>) -> Option<Display> {
    app.primary_monitor().ok().flatten().map(|m| Display {
        x: m.position().x,
        y: m.position().y,
        w: m.size().width,
        h: m.size().height,
        scale: m.scale_factor(),
    })
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

fn theater_window<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::WebviewWindow<R>> {
    app.get_webview_window(LABEL)
}

/// Open the theater — or bring the existing one forward (one instance).
pub fn open_theater<R: Runtime>(app: &AppHandle<R>) {
    if let Some(existing) = theater_window(app) {
        let _ = existing.unminimize();
        let _ = existing.show();
        let _ = existing.set_focus();
        return;
    }

    let all = displays(app);
    let primary = primary_display(app);
    let saved = read_bounds(app);
    let (w, h) = saved.map(|b| (b.w, b.h)).unwrap_or(DEFAULT_SIZE);
    let prefer_second = read_bool(app, SECOND_MONITOR_KEY, false);

    // Second display wins when requested AND present; a reachable saved
    // position next; otherwise centre on the primary.
    let on_second = if prefer_second {
        pick_display(&all, primary, true)
            .filter(|d| primary.is_some() && !same_origin(d, primary))
            .map(|d| centered_on(&d, w, h))
    } else {
        None
    };
    let position = on_second
        .or_else(|| {
            saved
                .filter(|b| bounds_reachable(b, &all))
                .map(|b| (b.x, b.y))
        })
        .or_else(|| pick_display(&all, primary, false).map(|d| centered_on(&d, w, h)));

    let mut builder =
        WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("theater.html".into()))
            .title(TITLE)
            .inner_size(w, h)
            .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
            .resizable(true)
            .decorations(false)
            .background_color(BACKGROUND)
            .always_on_top(read_bool(app, ALWAYS_ON_TOP_KEY, false))
            .fullscreen(read_bool(app, FULLSCREEN_KEY, false));
    builder = match position {
        Some((x, y)) => builder.position(x, y),
        None => builder.center(),
    };
    if let Err(e) = builder.build() {
        eprintln!("[xr] theater window failed to open: {e}");
    }
}

/// Close the theater (CloseRequested persists bounds + tells main).
pub fn close_theater<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = theater_window(app) {
        let _ = window.close();
    }
}

/// ⌥⌘V: open when closed, close when open — a minimized theater comes back
/// first (a hotkey that destroys the window you were reaching for is cruel).
pub fn toggle_theater<R: Runtime>(app: &AppHandle<R>) {
    match theater_window(app) {
        Some(window) if window.is_minimized().unwrap_or(false) => {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        Some(_) => close_theater(app),
        None => open_theater(app),
    }
}

fn focus_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

/// Remember where the window is (logical px) unless it is fullscreen —
/// a fullscreen rectangle is not a place to come back to.
fn persist_bounds<R: Runtime>(app: &AppHandle<R>, window: &tauri::WebviewWindow<R>) {
    let fullscreen = window.is_fullscreen().unwrap_or(false);
    write_json(app, FULLSCREEN_KEY, serde_json::json!(fullscreen));
    if fullscreen {
        return;
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    if let (Ok(pos), Ok(size)) = (window.outer_position(), window.inner_size()) {
        let scale = if scale > 0.0 { scale } else { 1.0 };
        write_json(
            app,
            BOUNDS_KEY,
            serde_json::json!({
                "x": (pos.x as f64 / scale).round(),
                "y": (pos.y as f64 / scale).round(),
                "w": (size.width as f64 / scale).round(),
                "h": (size.height as f64 / scale).round(),
            }),
        );
    }
}

/// `RunEvent::WindowEvent` for the theater label (wired in lib.rs).
pub fn on_window_event<R: Runtime>(app: &AppHandle<R>, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { .. } = event {
        if let Some(window) = theater_window(app) {
            persist_bounds(app, &window);
        }
        // Voice keeps running (the main window applies "close stops voice").
        let _ = app.emit_to("main", "theater:close", ());
    }
}

/// App exit while the theater is open: park its bounds (no CloseRequested).
pub fn flush<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = theater_window(app) {
        persist_bounds(app, &window);
    }
}

// ─── Context menu ───────────────────────────────────────────────────────────

/// Menu item ids — one source for `build_menu` and `handle_menu_id`.
mod menu_ids {
    pub const MINIMIZE: &str = "theater-minimize";
    pub const ALWAYS_ON_TOP: &str = "theater-always-on-top";
    pub const MUTE: &str = "theater-mute";
    pub const SUBTITLES: &str = "theater-subtitles";
    pub const SETTINGS: &str = "theater-settings";
    pub const CLOSE: &str = "theater-close";

    #[cfg(test)]
    pub const ALL: &[&str] = &[MINIMIZE, ALWAYS_ON_TOP, MUTE, SUBTITLES, SETTINGS, CLOSE];
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum MenuAction {
    Minimize,
    AlwaysOnTop,
    Mute,
    Subtitles,
    Settings,
    Close,
}

fn menu_action_for(id: &str) -> Option<MenuAction> {
    match id {
        menu_ids::MINIMIZE => Some(MenuAction::Minimize),
        menu_ids::ALWAYS_ON_TOP => Some(MenuAction::AlwaysOnTop),
        menu_ids::MUTE => Some(MenuAction::Mute),
        menu_ids::SUBTITLES => Some(MenuAction::Subtitles),
        menu_ids::SETTINGS => Some(MenuAction::Settings),
        menu_ids::CLOSE => Some(MenuAction::Close),
        _ => None,
    }
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let minimize = MenuItem::with_id(app, menu_ids::MINIMIZE, "Minimize", true, None::<&str>)?;
    let on_top = CheckMenuItem::with_id(
        app,
        menu_ids::ALWAYS_ON_TOP,
        "Always on top",
        true,
        read_bool(app, ALWAYS_ON_TOP_KEY, false),
        None::<&str>,
    )?;
    let mute = MenuItem::with_id(app, menu_ids::MUTE, "Mute microphone", true, None::<&str>)?;
    let subtitles = MenuItem::with_id(app, menu_ids::SUBTITLES, "Toggle subtitles", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, menu_ids::SETTINGS, "Settings…", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let close = MenuItem::with_id(app, menu_ids::CLOSE, "Close", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[&minimize, &on_top, &mute, &subtitles, &settings, &separator, &close],
    )
}

fn set_always_on_top<R: Runtime>(app: &AppHandle<R>, on: bool) {
    write_json(app, ALWAYS_ON_TOP_KEY, serde_json::json!(on));
    if let Some(window) = theater_window(app) {
        let _ = window.set_always_on_top(on);
    }
}

fn handle_menu_id<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match menu_action_for(id) {
        Some(MenuAction::Minimize) => {
            if let Some(window) = theater_window(app) {
                let _ = window.minimize();
            }
        }
        Some(MenuAction::AlwaysOnTop) => {
            let next = !read_bool(app, ALWAYS_ON_TOP_KEY, false);
            set_always_on_top(app, next);
        }
        // The main window owns the microphone — it toggles and broadcasts.
        Some(MenuAction::Mute) => {
            let _ = app.emit_to("main", "theater:toggle-mute", ());
        }
        Some(MenuAction::Subtitles) => {
            let _ = app.emit_to(LABEL, "theater:toggle-subtitles", ());
        }
        Some(MenuAction::Settings) => {
            focus_main(app);
            let _ = app.emit_to("main", "palette:navigate", "/voice");
        }
        Some(MenuAction::Close) => close_theater(app),
        None => {}
    }
}

// ─── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn theater_open<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    open_theater(&app);
    Ok(())
}

#[tauri::command]
pub async fn theater_close<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    close_theater(&app);
    Ok(())
}

#[tauri::command]
pub async fn theater_toggle<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    toggle_theater(&app);
    Ok(())
}

#[tauri::command]
pub fn theater_is_open<R: Runtime>(app: AppHandle<R>) -> bool {
    theater_window(&app).is_some()
}

#[tauri::command]
pub async fn theater_focus_main<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    focus_main(&app);
    Ok(())
}

#[tauri::command]
pub async fn theater_set_always_on_top<R: Runtime>(app: AppHandle<R>, on: bool) -> Result<(), String> {
    set_always_on_top(&app, on);
    Ok(())
}

/// Right-click → the NATIVE menu, popped at the cursor over the theater.
#[tauri::command]
pub async fn theater_show_context_menu<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let Some(window) = theater_window(&app) else {
        return Ok(());
    };
    let menu = build_menu(&app).map_err(|e| e.to_string())?;
    menu.popup(window.as_ref().window()).map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Global shortcut ────────────────────────────────────────────────────────

#[derive(Default)]
pub struct TheaterShortcutState(pub Mutex<TheaterShortcutInner>);

#[derive(Default)]
pub struct TheaterShortcutInner {
    pub shortcut: String,
    pub conflict: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TheaterShortcutInfo {
    pub shortcut: String,
    pub conflict: bool,
}

#[tauri::command]
pub async fn theater_shortcut_info<R: Runtime>(
    app: AppHandle<R>,
) -> Result<TheaterShortcutInfo, String> {
    let state = app.state::<TheaterShortcutState>();
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    Ok(TheaterShortcutInfo {
        shortcut: inner.shortcut.clone(),
        conflict: inner.conflict,
    })
}

/// Register-new-first rebind (hud/orb pattern): a failed swap never leaves
/// the theater without a shortcut.
#[tauri::command]
pub async fn theater_set_shortcut<R: Runtime>(
    app: AppHandle<R>,
    chord: String,
) -> Result<super::settings::ShortcutRegistration, String> {
    let new_shortcut: Shortcut = chord
        .parse()
        .map_err(|e| format!("Cannot parse shortcut: {e}"))?;

    let state = app.state::<TheaterShortcutState>();
    let old = {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        if guard.shortcut == chord {
            return Ok(super::settings::ShortcutRegistration {
                shortcut: chord,
                conflict: false,
            });
        }
        guard.shortcut.clone()
    };

    let global = app.global_shortcut();
    global
        .on_shortcut(new_shortcut, |app, _s, event| {
            if event.state() == ShortcutState::Pressed {
                toggle_theater(app);
            }
        })
        .map_err(|e| format!("Shortcut is reserved by the system or another app: {e}"))?;

    if let Ok(old_shortcut) = old.parse::<Shortcut>() {
        if old_shortcut != new_shortcut {
            let _ = global.unregister(old_shortcut);
        }
    }

    if let Some(state) = app.try_state::<TheaterShortcutState>() {
        if let Ok(mut guard) = state.0.lock() {
            guard.shortcut = chord.clone();
            guard.conflict = false;
        }
    }
    write_json(&app, SHORTCUT_KEY, serde_json::json!(chord.clone()));
    Ok(super::settings::ShortcutRegistration {
        shortcut: chord,
        conflict: false,
    })
}

/// Called once from lib.rs setup (desktop only): menu stream + shortcut.
pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    app.manage(TheaterShortcutState::default());

    // Native menu selections (shared stream — only theater-* ids match).
    app.on_menu_event(|app, event| handle_menu_id(app, event.id.as_ref()));

    let (primary, fallback) = default_shortcuts();
    let user_override = settings(app)
        .and_then(|store| store.get(SHORTCUT_KEY))
        .and_then(|value| value.as_str().map(str::to_string));
    let mut candidates: Vec<(String, bool)> = Vec::new();
    if let Some(user) = user_override {
        candidates.push((user, false));
    }
    candidates.push((primary.to_string(), false));
    candidates.push((fallback.to_string(), true));

    let mut registered: Option<(String, bool)> = None;
    for (candidate, is_fallback) in candidates {
        let shortcut: Shortcut = match candidate.parse() {
            Ok(s) => s,
            Err(_) => continue,
        };
        match app.global_shortcut().on_shortcut(shortcut, |app, _s, event| {
            // The plugin also reports key RELEASES — only presses toggle.
            if event.state() == ShortcutState::Pressed {
                toggle_theater(app);
            }
        }) {
            Ok(()) => {
                if is_fallback {
                    eprintln!("[xr] theater shortcut: {primary} unavailable — using {candidate} instead");
                }
                registered = Some((candidate, is_fallback));
                break;
            }
            Err(_) => continue, // taken by another app — try the next candidate
        }
    }

    let (shortcut, conflict) = registered.unwrap_or_else(|| {
        eprintln!("[xr] theater shortcut: every candidate is taken — toggle it from Voice settings");
        (primary.to_string(), true)
    });
    if let Some(state) = app.try_state::<TheaterShortcutState>() {
        if let Ok(mut guard) = state.0.lock() {
            guard.shortcut = shortcut;
            guard.conflict = conflict;
        }
    }
    Ok(())
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn display(x: i32, y: i32, w: u32, h: u32, scale: f64) -> Display {
        Display { x, y, w, h, scale }
    }

    #[test]
    fn centres_on_a_retina_display_in_logical_pixels() {
        let d = display(0, 0, 2880, 1800, 2.0);
        assert_eq!(centered_on(&d, 900.0, 700.0), (270.0, 100.0));
    }

    #[test]
    fn centring_offsets_by_the_display_origin_and_never_goes_negative() {
        let d = display(1920, 0, 1920, 1080, 1.0);
        assert_eq!(centered_on(&d, 900.0, 700.0), (2430.0, 190.0));
        let tiny = display(0, 0, 400, 300, 1.0);
        assert_eq!(centered_on(&tiny, 900.0, 700.0), (0.0, 0.0));
        let bad_scale = display(0, 0, 1000, 800, 0.0);
        assert_eq!(centered_on(&bad_scale, 900.0, 700.0), (50.0, 50.0));
    }

    #[test]
    fn second_display_preference_falls_back_to_the_primary() {
        let primary = display(0, 0, 1920, 1080, 1.0);
        let second = display(1920, 0, 2560, 1440, 1.0);
        assert_eq!(pick_display(&[primary, second], Some(primary), true), Some(second));
        assert_eq!(pick_display(&[primary], Some(primary), true), Some(primary));
        assert_eq!(pick_display(&[primary, second], Some(primary), false), Some(primary));
        assert_eq!(pick_display(&[second], None, false), Some(second));
        assert_eq!(pick_display(&[], None, true), None);
    }

    #[test]
    fn saved_bounds_are_reused_only_while_reachable() {
        let displays = [display(0, 0, 1920, 1080, 1.0)];
        let on_screen = Bounds { x: 100.0, y: 80.0, w: 900.0, h: 700.0 };
        let unplugged = Bounds { x: 2400.0, y: 80.0, w: 900.0, h: 700.0 };
        let below = Bounds { x: 100.0, y: 1070.0, w: 900.0, h: 700.0 };
        assert!(bounds_reachable(&on_screen, &displays));
        assert!(!bounds_reachable(&unplugged, &displays));
        assert!(!bounds_reachable(&below, &displays));
        assert!(!bounds_reachable(&on_screen, &[]));
    }

    #[test]
    fn bounds_json_round_trip_clamps_and_rejects_junk() {
        let ok = bounds_from_json(&serde_json::json!({"x": 10, "y": 20, "w": 300, "h": 200})).unwrap();
        assert_eq!(ok, Bounds { x: 10.0, y: 20.0, w: 600.0, h: 400.0 });
        assert!(bounds_from_json(&serde_json::json!({"x": 10, "y": 20})).is_none());
        assert!(bounds_from_json(&serde_json::json!([10, 20, 900, 700])).is_none());
        assert!(bounds_from_json(&serde_json::json!({"x": "a", "y": 1, "w": 1, "h": 1})).is_none());
    }

    #[test]
    fn menu_ids_map_to_distinct_actions() {
        let mut seen: Vec<MenuAction> = Vec::new();
        for id in menu_ids::ALL {
            let action = menu_action_for(id)
                .unwrap_or_else(|| panic!("menu id {id} has no dispatch arm"));
            assert!(!seen.contains(&action), "duplicate action for {id}");
            assert!(id.starts_with("theater-"), "{id} must stay namespaced");
            seen.push(action);
        }
        assert_eq!(seen.len(), 6, "expected exactly 6 menu actions");
        assert_eq!(seen[0], MenuAction::Minimize);
        assert_eq!(seen[5], MenuAction::Close);
        assert_eq!(menu_action_for("orb-open"), None);
        assert_eq!(menu_action_for(""), None);
    }

    #[test]
    fn shortcut_defaults_parse_and_differ() {
        let (primary, fallback) = default_shortcuts();
        assert!(primary.parse::<Shortcut>().is_ok());
        assert!(fallback.parse::<Shortcut>().is_ok());
        assert_ne!(primary, fallback);
    }
}
