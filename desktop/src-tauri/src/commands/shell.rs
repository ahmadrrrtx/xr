/*
 * Shell-level commands that tie the pieces together (Phase 27).
 *
 * Settings → Shortcuts used to have to ask five modules for their chord one at a
 * time, in five different shapes, and there was no way to undo all of that.
 * This module is the single answer:
 *
 *   shell_shortcut_inventory   every global chord XR owns, with the platform's
 *                              note about whether it can work here at all
 *                              (Wayland capture, for instance)
 *   shell_reset_shortcuts      drop every override and re-register the
 *                              platform defaults
 *
 * "Reset to defaults" is a real rebind, not a preference-file edit: each chord
 * is registered through the same code path the Settings screen uses, so what the
 * user ends up with is what the OS actually holds.
 */
use serde::Serialize;
use tauri::AppHandle;

use super::{hud, orb, screenshot, settings, theater};

/// One row of the shortcut inventory.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutRow {
    /// Stable id the frontend keys on: hud | orb | ptt | theater | screenshot.
    pub id: &'static str,
    pub label: &'static str,
    /// The chord the OS currently holds for this action.
    pub shortcut: String,
    /// The chord registered second because the first was taken.
    pub fallback_used: bool,
    /// Nothing registered (another app owns every candidate).
    pub conflict: bool,
    /// The platform default, for the "reset" preview.
    pub default_shortcut: &'static str,
    /// Rebindable from the UI.
    pub can_rebind: bool,
    /// Present when this action cannot work as configured on this machine.
    pub platform_note: Option<String>,
    /// Whether a takeover (blocking the app's own binding) is the fix.
    pub note_action: Option<&'static str>,
}

fn is_wayland() -> bool {
    std::env::var("XDG_SESSION_TYPE")
        .map(|v| v.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
}

/// Every global chord, in the order the Settings screen lists them.
#[tauri::command]
pub async fn shell_shortcut_inventory(app: AppHandle) -> Vec<ShortcutRow> {
    let os = std::env::consts::OS;
    let mut rows = Vec::new();

    // HUD
    match hud::hud_shortcut_info(app.clone()).await {
        Ok(info) => rows.push(ShortcutRow {
            id: "hud",
            label: "Toggle HUD",
            shortcut: info.shortcut,
            fallback_used: info.fallback_used,
            conflict: info.conflict,
            default_shortcut: hud::default_shortcuts(os).0,
            can_rebind: true,
            platform_note: if info.conflict {
                Some("Nothing registered — macOS Spotlight owns ⌘Space by default. Set a different chord, or turn off \"Show Spotlight search\" in System Settings → Keyboard.".into())
            } else if info.fallback_used {
                Some("Using the runner-up chord because the platform default was already taken.".into())
            } else {
                None
            },
            note_action: if info.conflict { Some("rebind") } else { None },
        }),
        Err(_) => rows.push(ShortcutRow {
            id: "hud",
            label: "Toggle HUD",
            shortcut: hud::default_shortcuts(os).0.to_string(),
            fallback_used: false,
            conflict: true,
            default_shortcut: hud::default_shortcuts(os).0,
            can_rebind: true,
            platform_note: Some("The HUD shortcut is not initialised (this build is not the desktop shell).".into()),
            note_action: None,
        }),
    }

    // Companion Orb
    {
        let chord = orb::orb_shortcut_info(app.clone());
        rows.push(ShortcutRow {
            id: "orb",
            label: "Toggle Companion Orb",
            shortcut: if chord.is_empty() { orb::default_shortcuts(os).0.to_string() } else { chord.clone() },
            fallback_used: false,
            conflict: chord.is_empty(),
            default_shortcut: orb::default_shortcuts(os).0,
            can_rebind: true,
            platform_note: None,
            note_action: None,
        });
    }

    // Push-to-talk
    match settings::ptt_shortcut_info(app.clone()) {
        Ok(info) => rows.push(ShortcutRow {
            id: "ptt",
            label: "Push-to-talk (hold)",
            shortcut: info.shortcut,
            fallback_used: false,
            conflict: info.conflict,
            default_shortcut: settings::default_ptt_shortcuts(os).0,
            can_rebind: true,
            platform_note: None,
            note_action: None,
        }),
        Err(_) => rows.push(ShortcutRow {
            id: "ptt",
            label: "Push-to-talk (hold)",
            shortcut: settings::default_ptt_shortcuts(os).0.to_string(),
            fallback_used: false,
            conflict: true,
            default_shortcut: settings::default_ptt_shortcuts(os).0,
            can_rebind: true,
            platform_note: None,
            note_action: None,
        }),
    }

    // Voice Theater
    match theater::theater_shortcut_info(app.clone()).await {
        Ok(info) => rows.push(ShortcutRow {
            id: "theater",
            label: "Toggle Voice Theater",
            shortcut: info.shortcut,
            fallback_used: false,
            conflict: info.conflict,
            default_shortcut: theater::default_shortcuts().0,
            can_rebind: true,
            platform_note: None,
            note_action: None,
        }),
        Err(_) => rows.push(ShortcutRow {
            id: "theater",
            label: "Toggle Voice Theater",
            shortcut: theater::default_shortcuts().0.to_string(),
            fallback_used: false,
            conflict: true,
            default_shortcut: theater::default_shortcuts().0,
            can_rebind: true,
            platform_note: None,
            note_action: None,
        }),
    }

    // Screenshot & ask — the one row that can be structurally impossible.
    {
        let support = screenshot::screenshot_ask_support();
        let info = screenshot::screenshot_ask_info(app.clone()).ok();
        let (shortcut, conflict, fallback_used) = match info {
            Some(info) => (info.shortcut, info.conflict, false),
            None => (screenshot::default_screenshot_shortcuts(os).0.to_string(), true, false),
        };
        rows.push(ShortcutRow {
            id: "screenshot",
            label: "Screenshot a region and ask",
            shortcut,
            fallback_used,
            conflict: conflict || !support.available,
            default_shortcut: screenshot::default_screenshot_shortcuts(os).0,
            can_rebind: true,
            platform_note: support.help.or_else(|| {
                if is_wayland() {
                    Some(format!(
                        "Wayland session — capturing through {}.",
                        support.tool.clone().unwrap_or_else(|| "the system tool".into())
                    ))
                } else {
                    None
                }
            }),
            note_action: if support.available { None } else { Some("install-capture-tool") },
        });
    }

    rows
}

/// Drop every override and re-register the platform defaults.
///
/// Returns the resulting inventory, so the UI can show what actually landed —
/// a reset that a second app steals halfway through must not look successful.
#[tauri::command]
pub async fn shell_reset_shortcuts(app: AppHandle) -> Vec<ShortcutRow> {
    let os = std::env::consts::OS;

    let _ = hud::hud_set_shortcut(app.clone(), hud::default_shortcuts(os).0.to_string()).await;
    let _ = orb::orb_set_shortcut(app.clone(), orb::default_shortcuts(os).0.to_string()).await;
    let _ = ptt_reset(app.clone());
    let _ = theater::theater_set_shortcut(app.clone(), theater::default_shortcuts().0.to_string()).await;
    let _ = screenshot::screenshot_ask_set_shortcut(
        app.clone(),
        screenshot::default_screenshot_shortcuts(os).0.to_string(),
    );
    // The overrides themselves are cleared last: if registration failed, the
    // stored override would otherwise be gone AND no chord held.
    if let Some(store) = settings::settings(&app) {
        let _ = store.delete(settings::PTT_SHORTCUT_KEY);
        let _ = store.delete("xr.hud.shortcut");
        let _ = store.delete("xr.orb.shortcut");
        let _ = store.delete("xr.theater.shortcut");
        let _ = store.delete(screenshot::SHORTCUT_KEY);
        let _ = store.save();
    }

    shell_shortcut_inventory(app).await
}

/// PTT has no async registration wrapper; keep the reset honest anyway.
fn ptt_reset(app: AppHandle) -> Result<(), String> {
    let chord = settings::default_ptt_shortcuts(std::env::consts::OS).0.to_string();
    settings::ptt_set_shortcut(app, chord).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wayland_detection_reads_the_session_type() {
        // The helper must never panic, whatever the environment says.
        let _ = is_wayland();
    }

    #[test]
    fn row_serializes_with_camel_case_keys_the_settings_tab_reads() {
        let row = ShortcutRow {
            id: "screenshot",
            label: "Screenshot a region and ask",
            shortcut: "Cmd+Shift+X".into(),
            fallback_used: false,
            conflict: false,
            default_shortcut: "Cmd+Shift+X",
            can_rebind: true,
            platform_note: None,
            note_action: None,
        };
        let json = serde_json::to_value(&row).unwrap();
        for key in ["id", "label", "shortcut", "fallbackUsed", "conflict", "defaultShortcut", "canRebind"] {
            assert!(json.get(key).is_some(), "missing {key}");
        }
    }
}
