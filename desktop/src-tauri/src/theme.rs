/*
 * OS appearance → webview (Phase 27).
 *
 * XR has its own theme system (`src/stores/theme.ts`, and `events::theme_changed`
 * for in-app changes). What was missing is the other direction: when the OS
 * switches to dark at sunset, the app should be able to follow without a
 * restart.
 *
 * `RunEvent::WindowEvent { event: WindowEvent::ThemeChanged(theme) }` is the
 * cross-platform source of truth — Tauri delivers it on macOS, Windows and
 * Linux, so there is no reason to hand-roll Windows registry reads
 * (`AppsUseLightTheme` + `WM_SETTINGCHANGE`) or `gsettings` polling. The state
 * below remembers the current value so a freshly loaded webview can ask for it
 * instead of waiting for the next change.
 */
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// What the webview receives on `xr-os-theme`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OsTheme {
    Light,
    Dark,
}

impl OsTheme {
    pub fn as_str(self) -> &'static str {
        match self {
            OsTheme::Light => "light",
            OsTheme::Dark => "dark",
        }
    }
}

/// The last theme the OS reported. `None` until a window exists or reports.
#[derive(Default)]
pub struct ThemeState {
    current: Mutex<Option<OsTheme>>,
}

fn state<R: Runtime>(app: &AppHandle<R>) -> tauri::State<'_, ThemeState> {
    if app.try_state::<ThemeState>().is_none() {
        app.manage(ThemeState::default());
    }
    app.state::<ThemeState>()
}

/// The full answer to "what is the OS doing right now?".
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSnapshot {
    /// "light" | "dark", or null when the OS has not said (a headless session,
    /// a Linux desktop without a theme portal).
    pub theme: Option<&'static str>,
    /// The platform's own preference exists, so the UI can offer "follow system"
    /// honestly rather than optimistically.
    pub known: bool,
    pub platform: &'static str,
}

/// Read the current OS theme from the main window (Tauri's own resolution),
/// remembering it for later subscribers.
pub fn detect_now<R: Runtime>(app: &AppHandle<R>) -> Option<OsTheme> {
    let window = app.get_webview_window("main")?;
    let theme = window.theme().ok()?;
    Some(match theme {
        tauri::Theme::Light => OsTheme::Light,
        tauri::Theme::Dark => OsTheme::Dark,
        // `Theme::Windows`/other values are not appearances.
        _ => return None,
    })
}

/// Record and broadcast an OS theme change. Called from `lib.rs` for every
/// `WindowEvent::ThemeChanged`.
pub fn on_theme_changed<R: Runtime>(app: &AppHandle<R>, theme: tauri::Theme) {
    let Some(value) = (match theme {
        tauri::Theme::Light => Some(OsTheme::Light),
        tauri::Theme::Dark => Some(OsTheme::Dark),
        _ => None,
    }) else {
        return;
    };
    let state = state(app);
    *state.current.lock().unwrap_or_else(|e| e.into_inner()) = Some(value);
    let _ = app.emit(
        "xr-os-theme",
        serde_json::json!({ "theme": value.as_str(), "platform": std::env::consts::OS }),
    );
}

/// The webview asks once on mount, then listens for `xr-os-theme`.
#[tauri::command]
pub fn subscribe_os_theme(app: AppHandle) -> ThemeSnapshot {
    let state = state(&app);
    let mut current = *state.current.lock().unwrap_or_else(|e| e.into_inner());
    if current.is_none() {
        current = detect_now(&app);
        *state.current.lock().unwrap_or_else(|e| e.into_inner()) = current;
    }
    ThemeSnapshot {
        theme: current.map(OsTheme::as_str),
        known: current.is_some(),
        platform: std::env::consts::OS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn theme_names_are_the_css_side_vocabulary() {
        assert_eq!(OsTheme::Light.as_str(), "light");
        assert_eq!(OsTheme::Dark.as_str(), "dark");
    }

    #[test]
    fn snapshot_serializes_with_the_keys_the_bridge_reads() {
        let snapshot = ThemeSnapshot { theme: Some("dark"), known: true, platform: "linux" };
        let json = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(json["theme"], "dark");
        assert_eq!(json["known"], true);
        assert_eq!(json["platform"], "linux");

        let unknown = ThemeSnapshot { theme: None, known: false, platform: "linux" };
        let json = serde_json::to_value(&unknown).unwrap();
        assert!(json["theme"].is_null(), "an unknown theme is null, never guessed");
        assert_eq!(json["known"], false);
    }
}
