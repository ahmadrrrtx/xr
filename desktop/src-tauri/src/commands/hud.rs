/*
 * HUD command palette window (Phase 5) — the global floating palette.
 *
 * The HUD is a SECOND, config-declared webview window (`hud.html` entry, see
 * tauri.conf.json) that starts hidden and is toggled by a GLOBAL shortcut:
 *   macOS          Cmd+Space   (fallback Alt+Space — Spotlight often owns the primary)
 *   Windows/Linux  Alt+Space   (fallback Ctrl+Shift+Space)
 * A user override persisted in settings.json (`xr.hud.shortcut`, written by
 * the Settings screen in Phase 8) always wins over the platform default.
 *
 * This module owns everything window-shaped so the webviews stay dumb:
 *   - shortcut registration + conflict fallback + exit cleanup
 *   - show/hide/toggle with position memory (validated against current
 *     monitors, so an unplugged display can't strand the HUD off-screen)
 *   - cross-window plumbing: navigation, remote command execution, theme
 *     broadcast, "sessions changed" pokes
 *
 * IPC surface (frontend: src/lib/hud.ts):
 *   hud_show / hud_hide / hud_toggle      — window ops (also global shortcut)
 *   hud_navigate(route)                   — show+focus main, navigate, hide HUD
 *   hud_toggle_sidebar()                  — forward toggle to the main webview
 *   hud_notify_sessions_changed()         — main reloads its session list
 *   hud_shortcut_info()                   — what actually registered (conflict UI)
 */
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_store::{Store, StoreBuilder};

/// settings.json keys (shared with src/lib/persistent-store.ts).
const SHORTCUT_KEY: &str = "xr.hud.shortcut";
const SHORTCUT_CONFLICT_KEY: &str = "xr.hud.shortcutConflict";
const POSITION_KEY: &str = "xr.hud.position";

/// HUD window label (tauri.conf.json > app.windows).
const HUD_LABEL: &str = "hud";
/// HUD window size — kept in sync with the config (used for centering math).
const HUD_WIDTH: i32 = 640;
const HUD_HEIGHT: i32 = 480;

// ─── Pure helpers (unit-tested) ─────────────────────────────────────────────

/// (primary, fallback) shortcut pair per platform. macOS prefers ⌘Space like
/// Spotlight; if the OS (or Spotlight) already owns it, Alt+Space is the
/// conventional runner-up (Raycast's own Windows default).
pub fn default_shortcuts(os: &str) -> (&'static str, &'static str) {
    match os {
        "macos" => ("Cmd+Space", "Alt+Space"),
        _ => ("Alt+Space", "Ctrl+Shift+Space"),
    }
}

/// A monitor rectangle in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// True when a window at `pos` (top-left, physical px) with HUD dimensions
/// would be at least partially visible on one of `monitors` — i.e. the user
/// can still reach it. A window fully outside every monitor (display
/// unplugged, layout changed) must NOT reuse its remembered position.
pub fn position_is_reachable(pos: (i32, i32), monitors: &[MonitorRect]) -> bool {
    let (x, y) = pos;
    monitors.iter().any(|m| {
        // Overlap test between window rect and monitor rect.
        x < m.x + m.w && x + HUD_WIDTH > m.x && y < m.y + m.h && y + HUD_HEIGHT > m.y
    })
}

/// Center of `monitor` for the HUD window (physical px).
pub fn centered_in(monitor: &MonitorRect) -> (i32, i32) {
    (
        monitor.x + (monitor.w - HUD_WIDTH).max(0) / 2,
        monitor.y + (monitor.h - HUD_HEIGHT).max(0) / 3, // Raycast-style: slightly above center
    )
}

/// The position the HUD should use on show: the remembered one when it is
/// still reachable, otherwise centered on the primary monitor.
pub fn choose_position(
    saved: Option<(i32, i32)>,
    monitors: &[MonitorRect],
    primary: &MonitorRect,
) -> (i32, i32) {
    match saved {
        Some(pos) if position_is_reachable(pos, monitors) => pos,
        _ => centered_in(primary),
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
        store.set(
            POSITION_KEY,
            serde_json::json!([pos.0, pos.1]),
        );
        let _ = store.save();
    }
}

/// Current monitor rectangles (physical px). Order is the OS's monitor order,
/// which on all three platforms puts the primary first — but we never rely on
/// that: reachability checks every monitor.
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

// ─── Window ops ─────────────────────────────────────────────────────────────

fn hud_window<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::WebviewWindow<R>> {
    app.get_webview_window(HUD_LABEL)
}

/// Place the HUD at its remembered position (when still on a monitor) or
/// centered on the primary display, then show + focus it.
pub fn show_hud<R: Runtime>(app: &AppHandle<R>) {
    let Some(hud) = hud_window(app) else {
        return;
    };
    if let Some(primary) = primary_rect(app) {
        let monitors = monitor_rects(app);
        let (x, y) = choose_position(read_saved_position(app), &monitors, &primary);
        let _ = hud.set_position(tauri::PhysicalPosition::new(x, y));
    }
    let _ = hud.show();
    let _ = hud.set_focus();
    let _ = app.emit("hud:show", ());
}

/// Remember where the user parked the HUD, then hide it.
pub fn hide_hud<R: Runtime>(app: &AppHandle<R>) {
    let Some(hud) = hud_window(app) else {
        return;
    };
    if let Ok(pos) = hud.outer_position() {
        write_saved_position(app, (pos.x, pos.y));
    }
    let _ = hud.hide();
    let _ = app.emit("hud:hide", ());
}

/// Global-shortcut / `hud:toggle` semantics: visible → hide, hidden → show.
pub fn toggle_hud<R: Runtime>(app: &AppHandle<R>) {
    let Some(hud) = hud_window(app) else {
        return;
    };
    if hud.is_visible().unwrap_or(false) {
        hide_hud(app);
    } else {
        show_hud(app);
    }
}

#[tauri::command]
pub async fn hud_show<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    show_hud(&app);
    Ok(())
}

#[tauri::command]
pub async fn hud_hide<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    hide_hud(&app);
    Ok(())
}

#[tauri::command]
pub async fn hud_toggle<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    toggle_hud(&app);
    Ok(())
}

/// Leave the HUD for a route in the MAIN window: surface + focus main, tell
/// its webview to navigate, then tuck the HUD away.
#[tauri::command]
pub async fn hud_navigate<R: Runtime>(app: AppHandle<R>, route: String) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
        let _ = app.emit_to("main", "palette:navigate", route);
    }
    hide_hud(&app);
    Ok(())
}

/// Run a main-window command from the HUD (the registry's non-navigation
/// actions that need the main window's stores, e.g. the sidebar toggle).
#[tauri::command]
pub async fn hud_run_main_command<R: Runtime>(
    app: AppHandle<R>,
    command: String,
) -> Result<(), String> {
    let _ = app.emit_to("main", "palette:execute-command", command);
    Ok(())
}

/// The HUD writes chat data through the same SQLite commands; poke the main
/// window so its session sidebar reloads.
#[tauri::command]
pub async fn hud_notify_sessions_changed<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let _ = app.emit_to("main", "hud:sessions-changed", ());
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HudShortcutInfo {
    pub shortcut: String,
    pub fallback_used: bool,
    pub conflict: bool,
}

#[tauri::command]
pub async fn hud_shortcut_info<R: Runtime>(app: AppHandle<R>) -> Result<HudShortcutInfo, String> {
    let state = app.state::<HudShortcutState>();
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    Ok(HudShortcutInfo {
        shortcut: inner.shortcut.clone(),
        fallback_used: inner.fallback_used,
        conflict: inner.conflict,
    })
}

// ─── Registration ───────────────────────────────────────────────────────────

/// What actually got registered (readable by the palette conflict warning).
#[derive(Default)]
pub struct HudShortcutState(pub std::sync::Mutex<HudShortcutInner>);

#[derive(Default)]
pub struct HudShortcutInner {
    pub shortcut: String,
    pub fallback_used: bool,
    pub conflict: bool,
}

/// Register the HUD global shortcut with graceful conflict fallback.
/// Called once from `lib.rs` setup (desktop only).
pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    app.manage(HudShortcutState::default());

    let os = std::env::consts::OS;
    let (primary, fallback) = default_shortcuts(os);

    // User override (Phase 8 Settings screen) wins; otherwise the platform
    // primary, then the platform fallback.
    let user_override = settings(app)
        .and_then(|store| store.get(SHORTCUT_KEY))
        .and_then(|v| v.as_str().map(str::to_string));

    let mut candidates: Vec<String> = Vec::new();
    if let Some(user) = user_override.as_deref() {
        candidates.push(user.to_string());
    }
    candidates.push(primary.to_string());
    candidates.push(fallback.to_string());

    let mut registered: Option<(String, bool)> = None;
    let mut conflict = false;
    for (index, candidate) in candidates.iter().enumerate() {
        let shortcut: Shortcut = match candidate.parse() {
            Ok(s) => s,
            Err(_) => continue, // unparsable override — try the next candidate
        };
        match app.global_shortcut().on_shortcut(shortcut, |app, _s, event| {
            // The plugin also reports key RELEASES (and some platforms
            // double-deliver) — only the press toggles.
            if event.state() == ShortcutState::Pressed {
                toggle_hud(app);
            }
        }) {
            Ok(()) => {
                // index 0 with an override = the user's own choice (no
                // fallback); anything past the first *attempted* candidate
                // means we fell back.
                let fell_back = index > 0;
                conflict = fell_back;
                registered = Some((candidate.clone(), fell_back));
                break;
            }
            Err(_) => continue, // taken by another app (e.g. Spotlight) — try next
        }
    }

    let (shortcut, fallback_used) = registered.unwrap_or_else(|| {
        // Nothing registered (every candidate taken): report the primary so
        // the UI can explain, and mark conflict.
        conflict = true;
        (primary.to_string(), false)
    });

    if let Some(state) = app.try_state::<HudShortcutState>() {
        if let Ok(mut guard) = state.0.lock() {
            guard.shortcut = shortcut.clone();
            guard.fallback_used = fallback_used;
            guard.conflict = conflict;
        }
    }

    if conflict {
        eprintln!(
            "[xr] HUD shortcut conflict: {primary} unavailable — using {shortcut} \
             (conflict flag persisted for the Settings warning)"
        );
        if let Some(store) = settings(app) {
            store.set(SHORTCUT_CONFLICT_KEY, serde_json::json!(true));
            let _ = store.save();
        }
        let _ = app.emit("palette:shortcut-failed", &shortcut);
    }

    Ok(())
}

/// Explicit teardown for RunEvent::Exit — see lib.rs. The plugin unregisters
/// on Drop as well, but a global hotkey that survives a crashed process is a
/// support nightmare on macOS (held until reboot), so we clean up loudly.
pub fn unregister_all<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.global_shortcut().unregister_all();
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(x: i32, y: i32, w: i32, h: i32) -> MonitorRect {
        MonitorRect { x, y, w, h }
    }

    #[test]
    fn platform_default_pairs() {
        assert_eq!(default_shortcuts("macos"), ("Cmd+Space", "Alt+Space"));
        assert_eq!(
            default_shortcuts("windows"),
            ("Alt+Space", "Ctrl+Shift+Space")
        );
        assert_eq!(
            default_shortcuts("linux"),
            ("Alt+Space", "Ctrl+Shift+Space")
        );
    }

    #[test]
    fn reachable_positions() {
        let monitors = [monitor(0, 0, 1920, 1080)];
        // Fully on-screen.
        assert!(position_is_reachable((100, 100), &monitors));
        // Straddling the edge — still grabbable.
        assert!(position_is_reachable((1900, 500), &monitors));
        // Entirely off to the right (second monitor unplugged).
        assert!(!position_is_reachable((3000, 100), &monitors));
        // Negative-position secondary monitor that no longer exists.
        assert!(!position_is_reachable((-2000, 100), &monitors));
        // No monitors reported at all — never trust a stale position.
        assert!(!position_is_reachable((100, 100), &[]));
    }

    #[test]
    fn chooses_saved_when_reachable_otherwise_centers() {
        let primary = monitor(0, 0, 1920, 1080);
        let monitors = [primary, monitor(1920, 0, 1920, 1080)];

        // Saved on the second monitor that still exists → reused verbatim.
        assert_eq!(
            choose_position(Some((2200, 300)), &monitors, &primary),
            (2200, 300)
        );

        // Saved on a monitor that is gone → re-centered on primary.
        let centered = centered_in(&primary);
        assert_eq!(
            choose_position(Some((-2000, 100)), &monitors, &primary),
            centered
        );
        assert_eq!(choose_position(None, &monitors, &primary), centered);

        // Centering keeps the HUD inside the monitor and above true center.
        assert!(centered.0 > 0 && centered.0 + HUD_WIDTH < primary.w);
        assert!(centered.1 > 0 && centered.1 < primary.h / 2);
    }
}
