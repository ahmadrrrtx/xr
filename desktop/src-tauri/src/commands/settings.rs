/*
 * Settings commands (Phase 8) — the Rust side of the Settings screen.
 *
 * Groups:
 *   - settings_changed / get_settings / set_setting  (store + broadcast)
 *   - keychain_get/set/delete                        (OS keychain, `keyring`)
 *   - reveal_data_folder / reveal_path / open_url    (shell opener)
 *   - storage_stats / clear_cache                    (data dir bookkeeping)
 *   - export_all_data / import_all_data              (zip via save/open dialog)
 *   - reset_app / restart_app / set_devtools_enabled
 *   - get_autostart / set_autostart                  (autostart plugin)
 *   - test_provider_connection                       (real, free HTTP pings)
 *   - PTT global shortcut (registration + override)  (hud.rs pattern)
 *
 * Keys never appear in `xr.settings`; provider keys live in the OS keychain
 * (keyring crate) and fall back to an explicitly-flagged insecure store key
 * when the OS keychain is unavailable (headless Linux dev) — the frontend
 * owns that fallback and its warning badge.
 *
 * Capabilities note: these are custom commands — they work from any window
 * without capability entries (proven Phases 5–7). Only the JS-side updater
 * check needed a new permission (`updater:default`).
 */
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::{Store, StoreBuilder};


/// settings.json key holding the whole settings object (shared with
/// src/stores/settingsStore.ts).
const SETTINGS_KEY: &str = "xr.settings";

/// Every valid top-level group of the settings object.
pub const SETTINGS_GROUPS: [&str; 11] = [
    "profile",
    "startup",
    "defaults",
    "appearance",
    "models",
    "shortcuts",
    "notifications",
    "voice",
    "privacy",
    "updates",
    "about",
];

pub const PTT_SHORTCUT_KEY: &str = "xr.ptt.shortcut";

// ─── Settings store helpers ─────────────────────────────────────────────────

fn settings<R: Runtime>(app: &AppHandle<R>) -> Option<std::sync::Arc<Store<R>>> {
    StoreBuilder::new(app, "settings.json").build().ok()
}

fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {e}"))
}

/// Validate a dot-path and deep-set it inside the settings JSON.
/// Pure — unit-tested without a Tauri app.
pub fn set_json_path(root: &mut Value, path: &str, value: Value) -> Result<(), String> {
    let mut segments: Vec<&str> = path.split('.').collect();
    if segments.is_empty() || segments.iter().any(|s| s.is_empty()) {
        return Err("empty path segment".into());
    }
    let group = segments[0];
    if !SETTINGS_GROUPS.contains(&group) {
        return Err(format!("unknown settings group: {group}"));
    }
    let mut current = root;
    for segment in segments.drain(..) {
        if !current.is_object() {
            *current = Value::Object(serde_json::Map::new());
        }
        let map = current
            .as_object_mut()
            .ok_or_else(|| "path conflicts with a non-object value".to_string())?;
        current = map
            .entry(segment.to_string())
            .or_insert(Value::Object(serde_json::Map::new()));
    }
    *current = value;
    Ok(())
}

/// Extract a group object from the settings root (for broadcasts).
fn group_value(root: &Value, group: &str) -> Value {
    root.get(group).cloned().unwrap_or(Value::Null)
}

// ─── Broadcast / get / set ──────────────────────────────────────────────────

/// Broadcast a settings change to every webview (main + HUD + orb), the same
/// pattern `events::theme_changed` uses. Payload: `{ key, value }`.
#[tauri::command]
pub fn settings_changed(app: AppHandle, key: String, value: Value) -> bool {
    if key.is_empty() {
        return false;
    }
    let _ = app.emit(
        "settings:changed",
        serde_json::json!({ "key": key, "value": value }),
    );
    true
}

/// Full settings JSON (secrets are never part of this object).
#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<Option<Value>, String> {
    let store = settings(&app).ok_or("settings store unavailable")?;
    Ok(store.get(SETTINGS_KEY))
}

/// Validated leaf write + persist + group broadcast (future agent-side use;
/// the UI's primary writer stays the JS write-through layer).
#[tauri::command]
pub fn set_setting(app: AppHandle, path: String, value: Value) -> Result<(), String> {
    let group = path
        .split('.')
        .next()
        .filter(|g| SETTINGS_GROUPS.contains(g))
        .ok_or_else(|| format!("unknown settings group in path: {path}"))?
        .to_string();

    let store = settings(&app).ok_or("settings store unavailable")?;
    let mut root = store
        .get(SETTINGS_KEY)
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    set_json_path(&mut root, &path, value)?;
    store.set(SETTINGS_KEY, root.clone());
    store.save().map_err(|e| e.to_string())?;

    let _ = app.emit(
        "settings:changed",
        serde_json::json!({ "key": group, "value": group_value(&root, &group) }),
    );
    Ok(())
}

// ─── OS keychain ────────────────────────────────────────────────────────────

/// Read a secret. `Ok(None)` = no entry; `Err` = keychain unavailable
/// (the frontend then falls back to the flagged insecure store).
#[tauri::command]
pub fn keychain_get(service: String, account: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(&service, &account)
        .map_err(|e| format!("keychain-unavailable: {e}"))?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keychain-unavailable: {e}")),
    }
}

#[tauri::command]
pub fn keychain_set(service: String, account: String, secret: String) -> Result<(), String> {
    let entry = keyring::Entry::new(&service, &account)
        .map_err(|e| format!("keychain-unavailable: {e}"))?;
    entry
        .set_password(&secret)
        .map_err(|e| format!("keychain-unavailable: {e}"))
}

#[tauri::command]
pub fn keychain_delete(service: String, account: String) -> Result<(), String> {
    let entry = keyring::Entry::new(&service, &account)
        .map_err(|e| format!("keychain-unavailable: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain-unavailable: {e}")),
    }
}

// ─── Shell opener ───────────────────────────────────────────────────────────

/// True for http/https URLs only — the shell opener is never a file executor.
pub fn is_web_url(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://")
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    if !is_web_url(&url) {
        return Err("only http(s) URLs can be opened".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Open the app data dir in Finder / Explorer.
#[tauri::command]
pub fn reveal_data_folder(app: AppHandle) -> Result<String, String> {
    let dir = app_data_dir(&app)?;
    if let Some(parent) = dir.parent() {
        let _ = app.opener().open_path(parent.to_string_lossy(), None::<&str>);
    }
    Ok(dir.display().to_string())
}

/// The app data dir path (About → "Open config file" needs the exact file).
#[tauri::command]
pub fn get_data_dir(app: AppHandle) -> Result<String, String> {
    Ok(app_data_dir(&app)?.display().to_string())
}

/// Reveal a path: directories open in the file manager, files open in their
/// default application (settings.json → text editor).
#[tauri::command]
pub fn reveal_path(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

// ─── Storage stats / cache ──────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStats {
    pub conversations: u64,
    pub attachments: u64,
    pub models: u64,
    pub cache: u64,
    pub settings: u64,
    pub total: u64,
}

fn dir_size(path: &Path) -> u64 {
    let mut size = 0u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                stack.push(entry.path());
            } else if file_type.is_file() {
                size += entry.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
    }
    size
}

fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// Ollama's model store (~/.ollama/models) — 0 when Ollama isn't installed.
fn ollama_models_size() -> u64 {
    let Some(home) = std::env::var_os("HOME") else {
        return 0;
    };
    dir_size(&PathBuf::from(home).join(".ollama").join("models"))
}

#[tauri::command]
pub fn storage_stats(app: AppHandle) -> Result<StorageStats, String> {
    let data = app_data_dir(&app)?;
    let conversations = ["xr.db", "xr.db-wal", "xr.db-shm"]
        .iter()
        .map(|name| file_size(&data.join(name)))
        .sum();
    let attachments = dir_size(&data.join("attachments"));
    let models = ollama_models_size();
    let cache = app
        .path()
        .app_cache_dir()
        .map(|dir| dir_size(&dir))
        .unwrap_or(0);
    let settings = ["settings.json", "approvals.json"]
        .iter()
        .map(|name| file_size(&data.join(name)))
        .sum();
    Ok(StorageStats {
        conversations,
        attachments,
        models,
        cache,
        settings,
        total: conversations + attachments + models + cache + settings,
    })
}

/// Wipe the app cache dir; returns the number of bytes cleared.
#[tauri::command]
pub fn clear_cache(app: AppHandle) -> Result<u64, String> {
    let Some(cache) = app.path().app_cache_dir().ok() else {
        return Ok(0);
    };
    let cleared = dir_size(&cache);
    let Ok(entries) = std::fs::read_dir(&cache) else {
        return Ok(0);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let _ = std::fs::remove_dir_all(&path);
        } else {
            let _ = std::fs::remove_file(&path);
        }
    }
    Ok(cleared)
}

// ─── Export / import (zip) ──────────────────────────────────────────────────

fn zip_dir(src: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut stack = vec![src.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(name) = path.strip_prefix(src) else {
                continue;
            };
            if name.as_os_str().is_empty() {
                continue;
            }
            if path.is_dir() {
                stack.push(path);
            } else {
                zip.start_file(name.to_string_lossy(), options)
                    .map_err(|e| e.to_string())?;
                let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
                std::io::Write::write_all(&mut zip, &bytes).map_err(|e| e.to_string())?;
            }
        }
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Save-dialog → zip of the whole app data dir. Sync command: dialogs must
/// stay off the main thread, and commands run on the worker pool.
#[tauri::command]
pub fn export_all_data(app: AppHandle) -> Result<Option<String>, String> {
    let data = app_data_dir(&app)?;
    let picked = app
        .dialog()
        .file()
        .add_filter("XR export", &["zip"])
        .set_file_name("xr-export.zip")
        .blocking_save_file();
    let Some(path) = picked else {
        return Ok(None); // user cancelled
    };
    let dest = path.into_path().map_err(|e| e.to_string())?;
    zip_dir(&data, &dest)?;
    // Reveal the result next to where the user saved it.
    if let Some(parent) = dest.parent() {
        let _ = app.opener().open_path(parent.to_string_lossy(), None::<&str>);
    }
    Ok(Some(dest.display().to_string()))
}

/// Open-dialog → unzip over the app data dir. The UI confirms before calling.
#[tauri::command]
pub fn import_all_data(app: AppHandle) -> Result<bool, String> {
    let data = app_data_dir(&app)?;
    let picked = app
        .dialog()
        .file()
        .add_filter("XR export", &["zip"])
        .blocking_pick_file();
    let Some(path) = picked else {
        return Ok(false); // user cancelled
    };
    let zip_path = path.into_path().map_err(|e| e.to_string())?;
    let file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    archive.extract(&data).map_err(|e| e.to_string())?;
    Ok(true)
}

// ─── Destructive / lifecycle ────────────────────────────────────────────────

/// Wipe every `xr.*` key from the settings store (and approvals rules),
/// optionally delete the chat database, then restart. Never returns on
/// success — the process is replaced.
#[tauri::command]
pub fn reset_app(app: AppHandle, wipe_conversations: bool) -> Result<(), String> {
    if let Some(store) = settings(&app) {
        let keys: Vec<String> = store.keys();
        for key in keys {
            if key.starts_with("xr.") {
                store.delete(key);
            }
        }
        let _ = store.save();
    }
    if let Ok(rules_store) = StoreBuilder::new(&app, "approvals.json").build() {
        rules_store.delete("rules");
        let _ = rules_store.save();
    }
    if wipe_conversations {
        let data = app_data_dir(&app)?;
        for name in ["xr.db", "xr.db-wal", "xr.db-shm"] {
            let _ = std::fs::remove_file(data.join(name));
        }
    }
    app.restart(); // never returns — the process is replaced
    #[allow(unreachable_code)]
    Ok(())
}

#[tauri::command]
pub fn restart_app(app: AppHandle) -> Result<(), String> {
    app.restart(); // never returns — the process is replaced
    #[allow(unreachable_code)]
    Ok(())
}

#[tauri::command]
pub fn set_devtools_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        if enabled {
            main.open_devtools();
        } else {
            main.close_devtools();
        }
    }
    Ok(())
}

// ─── Autostart ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let autostart = app.autolaunch();
    if enabled {
        autostart.enable().map_err(|e| e.to_string())
    } else {
        autostart.disable().map_err(|e| e.to_string())
    }
}

// ─── Provider connection probe ──────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResult {
    pub ok: bool,
    pub message: String,
    pub latency_ms: u64,
    pub models: Vec<String>,
}

/// Shared result type for runtime shortcut re-registration (hud/orb/ptt).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutRegistration {
    pub shortcut: String,
    pub conflict: bool,
}

pub fn default_base_url(kind: &str) -> &'static str {
    match kind {
        "anthropic" => "https://api.anthropic.com",
        "gemini" => "https://generativelanguage.googleapis.com",
        "ollama" => "http://127.0.0.1:11434",
        // openai-compatible providers pass their own base; this is the
        // OpenAI default.
        _ => "https://api.openai.com/v1",
    }
}

/// The free "list models" endpoint per provider kind (pure — unit-tested).
pub fn provider_probe_url(kind: &str, base: &str) -> String {
    let base = base.trim_end_matches('/');
    match kind {
        "anthropic" => format!("{base}/v1/models"),
        "gemini" => format!("{base}/v1beta/models"),
        "ollama" => format!("{base}/api/tags"),
        _ => format!("{base}/models"),
    }
}

/// Pull model ids out of a list-models response (pure — unit-tested).
pub fn extract_models(kind: &str, body: &Value) -> Vec<String> {
    let list = match kind {
        "ollama" => body.get("models"),
        "gemini" => body.get("models"),
        _ => body.get("data"),
    };
    let Some(entries) = list.and_then(Value::as_array) else {
        return Vec::new();
    };
    entries
        .iter()
        .filter_map(|entry| {
            // Gemini's list-models reports "name" (prefixed "models/…"),
            // OpenAI-style endpoints report "id", Ollama reports "name".
            let field = if kind == "ollama" || kind == "gemini" {
                "name"
            } else {
                "id"
            };
            let name = entry.get(field).and_then(Value::as_str)?;
            Some(name.trim_start_matches("models/").to_string())
        })
        .collect()
}

/// Real, free HTTP ping: list-models endpoints authenticate without spending
/// tokens. 200 = connected, 401/403 = auth failed, transport = unreachable.
pub fn probe_provider(kind: &str, base_url: Option<&str>, api_key: Option<&str>) -> ProviderTestResult {
    let base = base_url
        .filter(|b| !b.trim().is_empty())
        .unwrap_or_else(|| default_base_url(kind));
    let url = provider_probe_url(kind, base);
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(6))
        .build();

    let mut request = agent.get(&url);
    if let Some(key) = api_key.filter(|k| !k.trim().is_empty()) {
        match kind {
            "anthropic" => {
                request = request.set("x-api-key", key);
                request = request.set("anthropic-version", "2023-06-01");
            }
            "gemini" => {
                request = request.set("x-goog-api-key", key);
            }
            _ => {
                request = request.set("Authorization", format!("Bearer {key}").as_str());
            }
        }
    }

    let start = Instant::now();
    let outcome = request.call();
    let latency = start.elapsed().as_millis() as u64;

    match outcome {
        Ok(response) => {
            let body = response.into_string().unwrap_or_default();
            let parsed: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
            let models = extract_models(kind, &parsed);
            ProviderTestResult {
                ok: true,
                message: format!("Connected ({base})"),
                latency_ms: latency,
                models,
            }
        }
        Err(ureq::Error::Status(code, _)) => {
            let message = if code == 401 || code == 403 {
                "Authentication failed — check the API key.".to_string()
            } else {
                format!("Provider returned HTTP {code}.")
            };
            ProviderTestResult {
                ok: false,
                message,
                latency_ms: latency,
                models: Vec::new(),
            }
        }
        Err(error) => ProviderTestResult {
            ok: false,
            message: format!("Could not reach {base}: {error}"),
            latency_ms: latency,
            models: Vec::new(),
        },
    }
}

#[tauri::command]
pub fn test_provider_connection(
    kind: String,
    base_url: Option<String>,
    api_key: Option<String>,
) -> Result<ProviderTestResult, String> {
    Ok(probe_provider(&kind, base_url.as_deref(), api_key.as_deref()))
}

// ─── Push-to-talk global shortcut (hud.rs registration pattern) ─────────────

/// (primary, fallback). ⌘. on macOS, Ctrl+. elsewhere; Alt+Shift+P runner-up.
pub fn default_ptt_shortcuts(os: &str) -> (&'static str, &'static str) {
    match os {
        "macos" => ("Cmd+.", "Alt+Shift+P"),
        _ => ("Ctrl+.", "Alt+Shift+P"),
    }
}

#[derive(Default)]
pub struct PttShortcutState(pub Mutex<String>);

fn ptt_handler<R: Runtime>(
    app: &AppHandle<R>,
    _shortcut: &Shortcut,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    if event.state() == ShortcutState::Pressed {
        // Voice theater (Phase 16) owns the real UX; for now every window
        // gets an honest broadcast.
        let _ = app.emit("ptt:pressed", ());
    }
}

/// Register the PTT global shortcut (override → platform primary → fallback).
/// Called once from lib.rs setup (desktop only).
pub fn init_ptt<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    app.manage(PttShortcutState::default());
    let (primary, fallback) = default_ptt_shortcuts(std::env::consts::OS);

    let user_override = settings(app)
        .and_then(|store| store.get(PTT_SHORTCUT_KEY))
        .and_then(|value| value.as_str().map(str::to_string));

    let mut candidates: Vec<String> = Vec::new();
    if let Some(user) = user_override {
        candidates.push(user);
    }
    candidates.push(primary.to_string());
    candidates.push(fallback.to_string());

    for candidate in candidates {
        let Ok(shortcut) = candidate.parse::<Shortcut>() else {
            continue;
        };
        match app.global_shortcut().on_shortcut(shortcut, ptt_handler) {
            Ok(()) => {
                if let Some(state) = app.try_state::<PttShortcutState>() {
                    if let Ok(mut guard) = state.0.lock() {
                        *guard = candidate.clone();
                    }
                }
                break;
            }
            Err(_) => continue,
        }
    }
    Ok(())
}

/// What chord PTT is currently on.
#[tauri::command]
pub fn ptt_shortcut_info(app: AppHandle) -> Result<ShortcutRegistration, String> {
    let state = app.try_state::<PttShortcutState>().ok_or("ptt not initialized")?;
    let current = state.0.lock().map_err(|e| e.to_string())?;
    Ok(ShortcutRegistration {
        shortcut: current.clone(),
        conflict: false,
    })
}

/// Re-bind PTT at runtime: register the new chord first, then drop the old
/// one, so a failure never leaves the feature keyless.
#[tauri::command]
#[cfg(desktop)]
pub fn ptt_set_shortcut(app: AppHandle, chord: String) -> Result<ShortcutRegistration, String> {
    let new_shortcut: Shortcut = chord
        .parse()
        .map_err(|e| format!("Cannot parse shortcut: {e}"))?;
    let state = app
        .try_state::<PttShortcutState>()
        .ok_or("ptt not initialized")?;
    let old = state.0.lock().map_err(|e| e.to_string())?.clone();

    if old == chord {
        return Ok(ShortcutRegistration { shortcut: chord, conflict: false });
    }

    let global = app.global_shortcut();
    global
        .on_shortcut(new_shortcut, ptt_handler)
        .map_err(|e| format!("Shortcut is reserved by the system or another app: {e}"))?;

    if let Ok(old_shortcut) = old.parse::<Shortcut>() {
        if old_shortcut != new_shortcut {
            let _ = global.unregister(old_shortcut);
        }
    }
    if let Ok(mut guard) = state.0.lock() {
        *guard = chord.clone();
    }
    if let Some(store) = settings(&app) {
        store.set(PTT_SHORTCUT_KEY, serde_json::json!(chord));
        let _ = store.save();
    }
    Ok(ShortcutRegistration { shortcut: chord, conflict: false })
}

// Silence the unused-import warning for hud (used only in docs coupling).
const _: Option<fn()> = None;

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn set_path_writes_leaf_and_builds_groups() {
        let mut root = json!({});
        set_json_path(&mut root, "notifications.style", json!("alert")).unwrap();
        assert_eq!(root["notifications"]["style"], json!("alert"));
    }

    #[test]
    fn set_path_rejects_unknown_groups() {
        let mut root = json!({});
        assert!(set_json_path(&mut root, "evil.key", json!(1)).is_err());
        assert!(set_json_path(&mut root, "", json!(1)).is_err());
        assert!(set_json_path(&mut root, "a..b", json!(1)).is_err());
    }

    #[test]
    fn all_groups_are_accepted() {
        for group in SETTINGS_GROUPS {
            let mut root = json!({});
            set_json_path(&mut root, &format!("{group}.x"), json!(true)).unwrap();
        }
    }

    #[test]
    fn web_url_guard() {
        assert!(is_web_url("https://xr.rs"));
        assert!(is_web_url("http://localhost:5173"));
        assert!(!is_web_url("file:///etc/passwd"));
        assert!(!is_web_url("javascript:alert(1)"));
        assert!(!is_web_url("xr://deep/link"));
    }

    #[test]
    fn probe_urls_per_kind() {
        assert_eq!(
            provider_probe_url("openai-compatible", "https://api.openai.com/v1/"),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            provider_probe_url("anthropic", "https://api.anthropic.com"),
            "https://api.anthropic.com/v1/models"
        );
        assert_eq!(
            provider_probe_url("gemini", "https://generativelanguage.googleapis.com"),
            "https://generativelanguage.googleapis.com/v1beta/models"
        );
        assert_eq!(
            provider_probe_url("ollama", "http://127.0.0.1:11434"),
            "http://127.0.0.1:11434/api/tags"
        );
    }

    #[test]
    fn model_extraction_per_kind() {
        let openai = json!({ "data": [ { "id": "gpt-4o" }, { "id": "gpt-4o-mini" } ] });
        assert_eq!(
            extract_models("openai-compatible", &openai),
            vec!["gpt-4o", "gpt-4o-mini"]
        );
        let anthropic = json!({ "data": [ { "id": "claude-sonnet-4" } ] });
        assert_eq!(extract_models("anthropic", &anthropic), vec!["claude-sonnet-4"]);
        let ollama = json!({ "models": [ { "name": "llama3.2:3b" } ] });
        assert_eq!(extract_models("ollama", &ollama), vec!["llama3.2:3b"]);
        let gemini = json!({ "models": [ { "name": "models/gemini-2.0-flash" } ] });
        assert_eq!(extract_models("gemini", &gemini), vec!["gemini-2.0-flash"]);
        assert!(extract_models("ollama", &json!({})).is_empty());
    }

    #[test]
    fn ptt_default_pairs() {
        assert_eq!(default_ptt_shortcuts("macos"), ("Cmd+.", "Alt+Shift+P"));
        assert_eq!(default_ptt_shortcuts("linux"), ("Ctrl+.", "Alt+Shift+P"));
    }

    #[test]
    fn default_bases_are_sane() {
        assert!(default_base_url("ollama").starts_with("http://127.0.0.1"));
        assert!(default_base_url("anthropic").starts_with("https://"));
    }
}
