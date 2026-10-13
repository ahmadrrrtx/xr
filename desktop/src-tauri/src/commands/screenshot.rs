/*
 * Screenshot-and-ask: the global chord, the capture, and the hand-off
 * (Phase 27).
 *
 *   ⌘⇧X  (macOS)   Ctrl+Shift+X  (Windows / Linux)
 *
 * Pressing it captures a region (see `crate::capture` for the per-OS tools) and
 * emits `xr-global-screenshot` with the file path. The main webview opens a new
 * chat with that image attached, then calls `screenshot_ask_discard` so the PNG
 * does not outlive the message it was made for.
 *
 * Registration follows the HUD/push-to-talk pattern exactly — user override →
 * platform default → runner-up — because a second, different shortcut policy in
 * the same app is how users end up with hotkeys that "sometimes" work.
 *
 * Capture runs on a worker thread: `screencapture -i` blocks until the user
 * finishes selecting, and blocking the UI thread for that is the difference
 * between a shortcut and a freeze.
 */
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use super::settings::{settings, ShortcutRegistration};
use crate::capture;

/// settings.json key holding the user's chord (shared with the webview).
pub const SHORTCUT_KEY: &str = "xr.screenshot.shortcut";
const SHORTCUT_CONFLICT_KEY: &str = "xr.screenshot.shortcutConflict";

/// The chord the capture last ran on (also reflects a fallback).
#[derive(Default)]
pub struct ScreenshotState {
    pub current: Mutex<String>,
    pub conflict: Mutex<bool>,
    pub fallback_used: Mutex<bool>,
}

/// (primary, fallback) per platform. Esc-cancel-safe: all three chords are
/// unclaimed by the OS on a stock install (unlike ⌘⇧4, which macOS owns).
pub fn default_screenshot_shortcuts(os: &str) -> (&'static str, &'static str) {
    match os {
        "macos" => ("Cmd+Shift+X", "Alt+Shift+X"),
        _ => ("Ctrl+Shift+X", "Alt+Shift+X"),
    }
}

/// Payload of `xr-global-screenshot`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotPayload {
    pub path: Option<String>,
    pub tool: String,
    pub cancelled: bool,
    pub error: Option<String>,
}

impl From<capture::CaptureOutcome> for ScreenshotPayload {
    fn from(outcome: capture::CaptureOutcome) -> Self {
        ScreenshotPayload {
            path: outcome.path,
            tool: outcome.tool,
            cancelled: outcome.cancelled,
            error: outcome.error,
        }
    }
}

/// Capture, then tell the webview. Never panics; a failure is a payload.
fn run_capture<R: Runtime>(app: &AppHandle<R>) {
    let wayland = std::env::var("XDG_SESSION_TYPE")
        .map(|v| v.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false);
    let plan = capture::plan_for(std::env::consts::OS, wayland);
    let dir = capture::scratch_dir();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let outcome = capture::capture(&plan, &dir, stamp);
    let payload = ScreenshotPayload::from(outcome);
    let _ = app.emit("xr-global-screenshot", payload);
}

/// Register the global chord (override → platform primary → fallback).
pub fn register<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let (primary, fallback) = default_screenshot_shortcuts(std::env::consts::OS);

    let user_override = settings(app)
        .and_then(|store| store.get(SHORTCUT_KEY))
        .and_then(|value| value.as_str().map(str::to_string));

    let mut candidates: Vec<String> = Vec::new();
    if let Some(user) = user_override {
        candidates.push(user);
    }
    candidates.push(primary.to_string());
    candidates.push(fallback.to_string());

    let mut registered: Option<(String, bool)> = None;
    for (index, candidate) in candidates.iter().enumerate() {
        let Ok(shortcut) = candidate.parse::<Shortcut>() else { continue };
        match app.global_shortcut().on_shortcut(shortcut, |app, _s, event| {
            if event.state() == ShortcutState::Pressed {
                // Off the UI thread: the selector is interactive and blocks.
                let handle = app.clone();
                std::thread::spawn(move || run_capture(&handle));
            }
        }) {
            Ok(()) => {
                registered = Some((candidate.clone(), index > 0));
                break;
            }
            Err(_) => continue,
        }
    }

    // Nothing registered: record the intent and mark the conflict so the
    // Settings row can say "taken by another app" instead of showing a chord
    // that does nothing.
    let conflict = registered.is_none() || registered.as_ref().is_some_and(|(_, fell)| *fell);
    let shortcut = registered
        .as_ref()
        .map(|(chord, _)| chord.clone())
        .unwrap_or_else(|| primary.to_string());
    let fallback_used = registered.as_ref().is_some_and(|(_, fell)| *fell);

    if let Some(state) = app.try_state::<ScreenshotState>() {
        if let Ok(mut guard) = state.current.lock() {
            *guard = shortcut.clone();
        }
        if let Ok(mut guard) = state.conflict.lock() {
            *guard = conflict;
        }
        if let Ok(mut guard) = state.fallback_used.lock() {
            *guard = fallback_used;
        }
    }
    if let Some(store) = settings(app) {
        store.set(SHORTCUT_CONFLICT_KEY.to_string(), conflict);
        let _ = store.save();
    }
    Ok(())
}

/// What chord is live, and whether it had to fall back.
#[tauri::command]
pub fn screenshot_ask_info(app: AppHandle) -> Result<ShortcutRegistration, String> {
    let state = app.try_state::<ScreenshotState>().ok_or("screenshot ask not initialized")?;
    let shortcut = state.current.lock().map_err(|e| e.to_string())?.clone();
    let conflict = *state.conflict.lock().map_err(|e| e.to_string())?;
    Ok(ShortcutRegistration { shortcut, conflict })
}

/// Rebind at runtime. Same failure mode as the HUD: a chord another app owns
/// registers nowhere, and the caller is told rather than silently ignored.
#[tauri::command]
pub fn screenshot_ask_set_shortcut(
    app: AppHandle,
    chord: String,
) -> Result<ShortcutRegistration, String> {
    let state = app.try_state::<ScreenshotState>().ok_or("screenshot ask not initialized")?;
    let parsed: Shortcut = chord.parse().map_err(|e| format!("invalid chord {chord}: {e}"))?;

    // Drop the previous registration before taking the new one, so a rebind to
    // the same chord does not fail against ourselves.
    let previous = state.current.lock().map_err(|e| e.to_string())?.clone();
    if let Ok(old) = previous.parse::<Shortcut>() {
        let _ = app.global_shortcut().unregister(old);
    }

    let conflict = match app.global_shortcut().on_shortcut(parsed, |app, _s, event| {
        if event.state() == ShortcutState::Pressed {
            let handle = app.clone();
            std::thread::spawn(move || run_capture(&handle));
        }
    }) {
        Ok(()) => false,
        Err(_) => {
            // Put the old chord back rather than leaving the app with none.
            if let Ok(old) = previous.parse::<Shortcut>() {
                let _ = app.global_shortcut().on_shortcut(old, |app, _s, event| {
                    if event.state() == ShortcutState::Pressed {
                        let handle = app.clone();
                        std::thread::spawn(move || run_capture(&handle));
                    }
                });
            }
            true
        }
    };

    if !conflict {
        *state.current.lock().map_err(|e| e.to_string())? = chord.clone();
        if let Some(store) = settings(&app) {
            store.set(SHORTCUT_KEY.to_string(), chord.clone());
            let _ = store.save();
        }
    }
    *state.conflict.lock().map_err(|e| e.to_string())? = conflict;
    if let Some(store) = settings(&app) {
        store.set(SHORTCUT_CONFLICT_KEY.to_string(), conflict);
        let _ = store.save();
    }

    Ok(ShortcutRegistration { shortcut: if conflict { previous } else { chord }, conflict })
}

/// Slow the shortcut out of the picture on the way to exit (macOS keeps a
/// stale hotkey until logout otherwise).
pub fn unregister<R: Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<ScreenshotState>() else { return };
    let Ok(current) = state.current.lock() else { return };
    if let Ok(shortcut) = current.parse::<Shortcut>() {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

/// Capture now (the tray item, the Settings "Try it" button, tests).
#[tauri::command]
pub fn screenshot_ask_capture(app: AppHandle) -> ScreenshotPayload {
    let wayland = std::env::var("XDG_SESSION_TYPE")
        .map(|v| v.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false);
    let plan = capture::plan_for(std::env::consts::OS, wayland);
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let outcome = capture::capture(&plan, &capture::scratch_dir(), stamp);
    let payload = ScreenshotPayload::from(outcome);
    // Also broadcast, so every window stays consistent with a manual capture.
    let _ = app.emit("xr-global-screenshot", payload.clone());
    payload
}

/// Delete a capture once the message it belongs to exists. Idempotent.
#[tauri::command]
pub fn screenshot_ask_discard(path: String) -> bool {
    capture::discard(&path)
}

/// Can this machine capture a region at all? Drives the Settings row and the
/// Wayland help text, so a shortcut that cannot work explains itself.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSupport {
    pub available: bool,
    pub tool: Option<String>,
    pub wayland: bool,
    pub help: Option<String>,
}

#[tauri::command]
pub fn screenshot_ask_support() -> CaptureSupport {
    let os = std::env::consts::OS;
    let wayland = std::env::var("XDG_SESSION_TYPE")
        .map(|v| v.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false);
    let plan = capture::plan_for(os, wayland);
    let tool = if os == "windows" {
        // The overlay needs PowerShell, which ships with every supported
        // Windows; there is no separate binary to look for.
        Some("powershell".to_string())
    } else {
        capture::first_available(&plan).map(|c| c.program.to_string())
    };
    let help = if tool.is_some() { None } else { Some(capture::missing_tool_help(os, wayland)) };
    CaptureSupport { available: tool.is_some(), tool, wayland, help }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_per_platform_are_distinct_and_unclaimed() {
        assert_eq!(default_screenshot_shortcuts("macos"), ("Cmd+Shift+X", "Alt+Shift+X"));
        assert_eq!(default_screenshot_shortcuts("windows"), ("Ctrl+Shift+X", "Alt+Shift+X"));
        assert_eq!(default_screenshot_shortcuts("linux"), ("Ctrl+Shift+X", "Alt+Shift+X"));
        // macOS's own screenshot chords must not be taken over.
        let (primary, _) = default_screenshot_shortcuts("macos");
        assert_ne!(primary, "Cmd+Shift+4");
    }

    #[test]
    fn every_default_chord_parses_as_a_tauri_shortcut() {
        for os in ["macos", "windows", "linux"] {
            let (primary, fallback) = default_screenshot_shortcuts(os);
            assert!(primary.parse::<Shortcut>().is_ok(), "{os} primary {primary}");
            assert!(fallback.parse::<Shortcut>().is_ok(), "{os} fallback {fallback}");
        }
    }

    #[test]
    fn settings_keys_are_namespaced_like_the_other_shortcuts() {
        assert!(SHORTCUT_KEY.starts_with("xr."));
        assert!(SHORTCUT_KEY.ends_with(".shortcut"));
    }

    #[test]
    fn payload_maps_a_cancel_without_calling_it_an_error() {
        let payload = ScreenshotPayload::from(capture::CaptureOutcome {
            path: None,
            cancelled: true,
            tool: "grim".into(),
            error: None,
        });
        assert!(payload.cancelled);
        assert!(payload.error.is_none());
        let json = serde_json::to_value(&payload).unwrap();
        assert!(json.get("cancelled").is_some());
        assert!(json.get("error").is_some());
    }

    #[test]
    fn support_reports_the_tool_or_the_fix() {
        let support = screenshot_ask_support();
        assert_eq!(support.available, support.tool.is_some());
        if !support.available {
            assert!(support.help.is_some(), "an unavailable capture must explain itself");
        }
    }
}
