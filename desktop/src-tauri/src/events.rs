/*
 * Cross-cutting IPC events shared between the webview and the Rust host.
 * Phase 0 ships exactly one: theme changes (tray/telemetry hook-in point).
 */
pub const THEMES: [&str; 5] = ["xr-native", "graphite", "midnight", "paper", "arctic"];

/// Fired by the frontend whenever the active theme changes.
/// Returns whether the reported theme is canonical (useful as a cheap
/// contract check in tests; the host never rejects an unknown id silently).
#[tauri::command]
pub fn theme_changed(theme: String) -> bool {
    THEMES.contains(&theme.as_str())
}

#[cfg(test)]
mod tests {
    #[test]
    fn recognizes_canonical_themes() {
        assert!(super::theme_changed("xr-native".to_string()));
        assert!(super::theme_changed("graphite".to_string()));
        assert!(super::theme_changed("midnight".to_string()));
        assert!(super::theme_changed("paper".to_string()));
        assert!(super::theme_changed("arctic".to_string()));
    }

    #[test]
    fn rejects_unknown_themes() {
        assert!(!super::theme_changed("hotdog".to_string()));
        assert!(!super::theme_changed(String::new()));
    }
}
