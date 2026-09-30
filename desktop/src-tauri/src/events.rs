/*
 * Cross-cutting IPC events shared between the webview and the Rust host.
 * Phase 0 ships exactly one: theme changes (tray/telemetry hook-in point).
 */
pub const THEMES: [&str; 5] = ["xr-native", "graphite", "midnight", "paper", "arctic"];

/// Fired by the frontend whenever the active theme changes.
/// Returns whether the reported theme is canonical (useful as a cheap
/// contract check in tests; the host never rejects an unknown id silently).
///
/// Phase 5: the change is also broadcast to every webview (main + HUD) as
/// `palette:theme-change`, so the floating palette re-themes live without
/// each window polling. Listeners no-op when the payload matches their
/// current theme, which also terminates the echo loop.
pub fn is_canonical_theme(theme: &str) -> bool {
    THEMES.contains(&theme)
}

#[tauri::command]
pub fn theme_changed(app: tauri::AppHandle, theme: String) -> bool {
    let known = is_canonical_theme(&theme);
    if known {
        use tauri::Emitter;
        let _ = app.emit("palette:theme-change", &theme);
    }
    known
}

#[cfg(test)]
mod tests {
    #[test]
    fn recognizes_canonical_themes() {
        assert!(super::is_canonical_theme("xr-native"));
        assert!(super::is_canonical_theme("graphite"));
        assert!(super::is_canonical_theme("midnight"));
        assert!(super::is_canonical_theme("paper"));
        assert!(super::is_canonical_theme("arctic"));
    }

    #[test]
    fn rejects_unknown_themes() {
        assert!(!super::is_canonical_theme("hotdog"));
        assert!(!super::is_canonical_theme(""));
    }
}
