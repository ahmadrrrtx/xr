/*
 * Window control commands for the frameless main window.
 *
 * App-defined commands need no capability grants, so the frontend can drive
 * the custom titlebar without broad `core:window:*` permissions.
 */
use tauri::{AppHandle, Manager, Runtime};

#[tauri::command]
pub async fn minimize_window<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.minimize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn toggle_maximize<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        // WebviewWindow has no toggle_maximize in tauri 2.12 — flip it manually.
        let maximized = window.is_maximized().map_err(|e| e.to_string())?;
        if maximized {
            window.unmaximize().map_err(|e| e.to_string())?;
        } else {
            window.maximize().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn close_window<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Host OS of the running shell ("macos" | "windows" | "linux" | …).
#[tauri::command]
pub fn get_platform() -> &'static str {
    std::env::consts::OS
}

#[cfg(test)]
mod tests {
    #[test]
    fn platform_is_a_known_target() {
        let platform = super::get_platform();
        assert!(
            ["macos", "windows", "linux", "android", "ios"].contains(&platform),
            "unexpected platform: {platform}"
        );
    }
}
