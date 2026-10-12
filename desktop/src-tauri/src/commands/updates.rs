/*
 * Auto-update, driven from Rust (Phase 27).
 *
 * The plugin was already registered in Phase 0, but nothing in the shell could
 * ask "is there an update?" — the Settings screen called the JS plugin directly
 * with no pubkey configured, so the answer was always a failure. This module is
 * the real command surface:
 *
 *   updates_state            what the UI renders (honest, never throws)
 *   check_update             asks the channel's endpoint
 *   download_update          verified download + progress events
 *   install_update           applies the verified bytes, then restarts
 *   updates_set_channel      Stable / Beta / Nightly (runtime endpoint switch)
 *   updates_set_auto_download / updates_skip_version / updates_clear_skip
 *
 * Four decisions worth stating plainly:
 *
 *   1. **Unprovisioned is a state, not an error.** No pubkey in
 *      `tauri.conf.json` (the operator has not run
 *      `scripts/generate-updater-keys.ts --apply`) ⇒ every command returns
 *      `provisioned: false` with the reason and the exact fix. Nothing throws,
 *      nothing spins, and the Settings card lights up by itself the moment a
 *      provisioned build exists.
 *
 *   2. **Channels are real at runtime.** `UpdaterBuilder::endpoints` lets the
 *      endpoint follow the user's channel choice, instead of being frozen at
 *      build time like the config value.
 *
 *   3. **Bytes are never persisted.** `Update::download` is where the Ed25519
 *      signature is verified; `install` trusts what it is handed. Writing a
 *      payload to disk and installing it on the next launch would mean
 *      installing bytes that skipped verification, so a "later" answer keeps
 *      the banner for this session only — a fresh launch re-checks (and, with
 *      auto-download on, re-fetches). Slower by one download; never unverified.
 *
 *   4. **Auto-download ≠ auto-apply.** The toggle (default ON on Stable)
 *      downloads in the background so "Restart to update" is one click. It
 *      never installs without the user saying so: the release CI, the signature
 *      check and the UI all assume a human is in the loop.
 */
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

use super::settings::settings;

/// Where releases live. Kept in one place so channels read as a table.
const RELEASE_BASE: &str = "https://github.com/ahmadrrrtx/xr";

/// Tauri plugin config key holding the operator-generated pubkey.
const PLUGIN_CONFIG_KEY: &str = "updater";

/// How long the release-notes modal shows before it offers the full text.
pub const NOTES_CAP: usize = 8_000;

/// Settings-store keys (settings.json, shared with the webview).
const KEY_CHANNEL: &str = "xr.updates.channel";
const KEY_AUTO_DOWNLOAD: &str = "xr.updates.autoDownload";
const KEY_SKIPPED: &str = "xr.updates.skippedVersion";
const KEY_LAST_CHECK: &str = "xr.updates.lastCheck";

// ─── Channels ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Stable,
    Beta,
    Nightly,
}

impl Channel {
    pub fn as_str(self) -> &'static str {
        match self {
            Channel::Stable => "stable",
            Channel::Beta => "beta",
            Channel::Nightly => "nightly",
        }
    }

    pub fn parse(value: &str) -> Option<Channel> {
        match value.trim().to_ascii_lowercase().as_str() {
            "stable" | "release" | "" => Some(Channel::Stable),
            "beta" => Some(Channel::Beta),
            "nightly" | "nightly-" => Some(Channel::Nightly),
            _ => None,
        }
    }
}

/// The manifest URL for a channel.
///
/// Stable is the tag GitHub calls "latest" — the pipeline publishes
/// `latest.json` there today. Beta and Nightly read `latest.json` off rolling
/// prerelease tags (`updater-beta`, `updater-nightly`), which the operator
/// creates when a channel goes live; an empty channel answers 404 and the UI
/// says "no release on this channel yet" rather than inventing one.
pub fn endpoint_for(channel: Channel, overrides: &ChannelOverrides) -> String {
    match channel {
        Channel::Stable => overrides
            .stable
            .clone()
            .unwrap_or_else(|| format!("{RELEASE_BASE}/releases/latest/download/latest.json")),
        Channel::Beta => overrides
            .beta
            .clone()
            .unwrap_or_else(|| format!("{RELEASE_BASE}/releases/download/updater-beta/latest.json")),
        Channel::Nightly => overrides
            .nightly
            .clone()
            .unwrap_or_else(|| format!("{RELEASE_BASE}/releases/download/updater-nightly/latest.json")),
    }
}

/// Optional operator override, read from `plugins.updater.channels` so a fork or
/// a private mirror never needs a code change.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ChannelOverrides {
    pub stable: Option<String>,
    pub beta: Option<String>,
    pub nightly: Option<String>,
}

/// Which channel a build should follow unless the user says otherwise: a
/// prerelease version follows its own channel (0.3.0-beta.2 → beta), so a beta
/// tester is not silently dragged onto Stable by the first release.
pub fn default_channel_for_version(version: &str) -> Channel {
    let lower = version.to_ascii_lowercase();
    if lower.contains("nightly") {
        Channel::Nightly
    } else if lower.contains("-alpha") || lower.contains("-beta") || lower.contains("-rc") {
        Channel::Beta
    } else {
        Channel::Stable
    }
}

// ─── State ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    pub version: String,
    pub current_version: String,
    /// Release notes, already capped to [`NOTES_CAP`].
    pub notes: String,
    pub notes_truncated: bool,
    pub date: Option<String>,
    /// The public release page, for "View full release notes".
    pub release_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
    /// 0–100 when the server sent a Content-Length, else null.
    pub percent: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    /// True once a pubkey exists in the build (operator ran the keys script).
    pub provisioned: bool,
    /// The honest reason when the updater cannot be used here (unprovisioned,
    /// dev build, or the last failure). Never a fake success.
    pub reason: Option<String>,
    pub channel: String,
    pub channel_options: Vec<String>,
    pub auto_download: bool,
    pub current_version: String,
    pub available: Option<AvailableUpdate>,
    pub skipped_version: Option<String>,
    pub downloading: bool,
    pub progress: Option<DownloadProgress>,
    /// True when verified bytes are in memory and install can run now.
    pub ready_to_install: bool,
    pub last_check_ms: Option<u64>,
    /// Non-blocking failure from the last operation.
    pub error: Option<String>,
}

#[derive(Default)]
struct Inner {
    available: Option<Update>,
    described: Option<AvailableUpdate>,
    payload: Option<Vec<u8>>,
    progress: Option<DownloadProgress>,
    downloading: bool,
    error: Option<String>,
    check_error: Option<String>,
}

/// Managed state: the pending update and its verified bytes.
#[derive(Default)]
pub struct UpdatesState {
    inner: Mutex<Inner>,
}

impl UpdatesState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Cap release notes for the modal. Markdown is capped on a char boundary so
/// the webview never receives half a code point.
pub fn cap_notes(body: &str) -> (String, bool) {
    if body.chars().count() <= NOTES_CAP {
        return (body.to_string(), false);
    }
    let capped: String = body.chars().take(NOTES_CAP).collect();
    // Prefer a paragraph break so the cut does not land mid-sentence.
    let cut = capped.rfind("\n\n").unwrap_or(capped.len());
    (capped[..cut].to_string(), true)
}

/// The pubkey the operator baked in, when it exists.
fn configured_pubkey<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    app.config()
        .plugins
        .0
        .get(PLUGIN_CONFIG_KEY)
        .and_then(|plugin| plugin.get("pubkey"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn channel_overrides<R: Runtime>(app: &AppHandle<R>) -> ChannelOverrides {
    let read = |key: &str| -> Option<String> {
        app.config()
            .plugins
            .0
            .get(PLUGIN_CONFIG_KEY)
            .and_then(|plugin| plugin.get("channels"))
            .and_then(|channels| channels.get(key))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    };
    ChannelOverrides { stable: read("stable"), beta: read("beta"), nightly: read("nightly") }
}

/// Current version, from the bundle metadata (never the frontend's idea of it).
fn current_version<R: Runtime>(app: &AppHandle<R>) -> String {
    app.package_info().version.to_string()
}

fn channel<R: Runtime>(app: &AppHandle<R>) -> Channel {
    settings(app)
        .and_then(|store| store.get(KEY_CHANNEL))
        .and_then(|v| v.as_str().and_then(Channel::parse))
        .unwrap_or_else(|| default_channel_for_version(&current_version(app)))
}

fn auto_download<R: Runtime>(app: &AppHandle<R>) -> bool {
    settings(app)
        .and_then(|store| store.get(KEY_AUTO_DOWNLOAD))
        .and_then(|v| v.as_bool())
        // Default ON — but only where it is safe to be optimistic: Stable.
        // Beta/Nightly default OFF so a nightly tester opts in explicitly.
        .unwrap_or(channel(app) == Channel::Stable)
}

fn skipped_version<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    settings(app)
        .and_then(|store| store.get(KEY_SKIPPED))
        .and_then(|v| v.as_str().map(str::to_string))
        .filter(|s| !s.is_empty())
}

fn last_check<R: Runtime>(app: &AppHandle<R>) -> Option<u64> {
    settings(app)
        .and_then(|store| store.get(KEY_LAST_CHECK))
        .and_then(|v| v.as_u64())
}

fn write_setting<R: Runtime, T: Into<tauri_plugin_store::JsonValue>>(
    app: &AppHandle<R>,
    key: &str,
    value: T,
) {
    if let Some(store) = settings(app) {
        store.set(key.to_string(), value.into());
        let _ = store.save();
    }
}

/// Assemble the state the UI renders. Reads only; never performs I/O to the
/// network, so it is safe to call on every render.
fn state<R: Runtime>(app: &AppHandle<R>) -> UpdateState {
    let provisioned = configured_pubkey(app).is_some();
    let dev = cfg!(debug_assertions);
    let skip = skipped_version(app);
    let guard = app.state::<UpdatesState>();
    let inner = guard.lock();

    let available = inner.described.clone().filter(|a| {
        // A skipped version stays hidden, but the UI can still show it if it
        // asks (the Settings card offers "you skipped v…").
        skip.as_deref() != Some(a.version.as_str())
    });

    let reason = match (provisioned, dev) {
        (false, _) => Some(
            "The updater is not provisioned in this build. The operator runs \
             `bun run scripts/generate-updater-keys.ts --apply` once, commits the pubkey, \
             and the card below works with no further changes."
                .to_string(),
        ),
        (true, true) => Some(
            "Development build — the updater never runs here (there is no installed bundle \
             to replace)."
                .to_string(),
        ),
        (true, false) => inner.check_error.clone(),
    };

    UpdateState {
        provisioned: provisioned && !dev,
        reason,
        channel: channel(app).as_str().to_string(),
        channel_options: vec!["stable".into(), "beta".into(), "nightly".into()],
        auto_download: auto_download(app),
        current_version: current_version(app),
        available,
        skipped_version: skip,
        downloading: inner.downloading,
        progress: inner.progress,
        ready_to_install: inner.payload.is_some(),
        last_check_ms: last_check(app),
        error: inner.error.clone(),
    }
}

fn emit_state<R: Runtime>(app: &AppHandle<R>) {
    let snapshot = state(app);
    let _ = app.emit("xr-update:state", snapshot);
}

/// Build the updater for the user's channel. Errors here are surfaced as text,
/// never panics: an unprovisioned or offline machine must not take the UI down.
fn build_updater<R: Runtime>(app: &AppHandle<R>) -> Result<tauri_plugin_updater::Updater, String> {
    let Some(pubkey) = configured_pubkey(app) else {
        return Err("updater not provisioned (no plugin pubkey in this build)".into());
    };
    let url = endpoint_for(channel(app), &channel_overrides(app));
    let parsed = tauri::Url::parse(&url).map_err(|e| format!("bad channel endpoint {url}: {e}"))?;

    let builder = app
        .updater_builder()
        .endpoints(vec![parsed])
        .map_err(|e| format!("endpoint rejected: {e}"))?
        .pubkey(pubkey)
        .timeout(Duration::from_secs(30));
    builder.build().map_err(|e| format!("updater unavailable: {e}"))
}

/// Download the pending update, emitting progress. Shared by the explicit
/// "Download" action and the auto-download path after a check.
fn spawn_download<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    {
        let guard = app.state::<UpdatesState>();
        let mut inner = guard.lock();
        if inner.downloading || inner.payload.is_some() || inner.available.is_none() {
            return;
        }
        inner.downloading = true;
        inner.error = None;
        inner.progress = Some(DownloadProgress { downloaded: 0, total: None, percent: None });
    }
    emit_state(&handle);

    tauri::async_runtime::spawn(async move {
        let update = {
            let guard = handle.state::<UpdatesState>();
            let pending = guard.lock().available.clone();
            pending
        };
        let Some(update) = update else { return };

        let emitter = handle.clone();
        let result = update
            .download(
                move |chunk, total| {
                    let guard = emitter.state::<UpdatesState>();
                    let mut inner = guard.lock();
                    let downloaded = inner.progress.map(|p| p.downloaded).unwrap_or(0) + chunk as u64;
                    let percent = total
                        .filter(|t| *t > 0)
                        .map(|t| ((downloaded as f64 / t as f64) * 100.0).min(100.0));
                    inner.progress = Some(DownloadProgress { downloaded, total, percent });
                    drop(inner);
                    let _ = emitter.emit(
                        "xr-update:progress",
                        DownloadProgress { downloaded, total, percent },
                    );
                },
                || {},
            )
            .await;

        let guard = handle.state::<UpdatesState>();
        let mut inner = guard.lock();
        inner.downloading = false;
        match result {
            Ok(bytes) => {
                inner.payload = Some(bytes);
                inner.error = None;
            }
            Err(e) => {
                // A failed download is non-blocking: the app keeps running and
                // the card offers "Try again".
                inner.error = Some(format!("download failed: {e}"));
                inner.progress = None;
            }
        }
        drop(inner);
        emit_state(&handle);
    });
}

// ─── Commands ───────────────────────────────────────────────────────────────

/// What the Settings card renders on mount.
#[tauri::command]
pub fn updates_state<R: Runtime>(app: AppHandle<R>) -> UpdateState {
    state(&app)
}

/// Check the channel endpoint. Never throws: failures land in `error`.
#[tauri::command]
pub async fn check_update<R: Runtime>(app: AppHandle<R>) -> UpdateState {
    if cfg!(debug_assertions) {
        let mut s = state(&app);
        s.error = None;
        return s;
    }
    {
        let guard = app.state::<UpdatesState>();
        let mut inner = guard.lock();
        inner.check_error = None;
        inner.error = None;
    }

    let updater = match build_updater(&app) {
        Ok(updater) => updater,
        Err(e) => {
            {
                let guard = app.state::<UpdatesState>();
                guard.lock().check_error = Some(e);
            }
            return state(&app);
        }
    };

    match updater.check().await {
        Ok(found) => {
            let skip = skipped_version(&app);
            {
                let guard = app.state::<UpdatesState>();
                let mut inner = guard.lock();
                match found {
                    Some(update) => {
                        let (notes, truncated) = cap_notes(update.body.as_deref().unwrap_or(""));
                        inner.described = Some(AvailableUpdate {
                            version: update.version.clone(),
                            current_version: update.current_version.clone(),
                            notes,
                            notes_truncated: truncated,
                            date: update.date.map(|d| d.to_string()),
                            release_url: format!("{RELEASE_BASE}/releases/tag/v{}", update.version),
                        });
                        inner.available = Some(update);
                    }
                    None => {
                        inner.available = None;
                        inner.described = None;
                        inner.payload = None;
                        inner.progress = None;
                    }
                }
            }
            write_setting(&app, KEY_LAST_CHECK, now_ms());
            let wanted = {
                let guard = app.state::<UpdatesState>();
                let inner = guard.lock();
                inner
                    .described
                    .as_ref()
                    .map(|a| a.version.clone())
                    .filter(|v| skip.as_deref() != Some(v.as_str()))
            };
            if wanted.is_some() && auto_download(&app) {
                spawn_download(&app);
            }
            emit_state(&app);
            state(&app)
        }
        Err(e) => {
            {
                let guard = app.state::<UpdatesState>();
                guard.lock().check_error = Some(format!("check failed: {e}"));
            }
            write_setting(&app, KEY_LAST_CHECK, now_ms());
            emit_state(&app);
            state(&app)
        }
    }
}

/// One step of a manual download (also the retry path after a failure).
#[tauri::command]
pub fn download_update<R: Runtime>(app: AppHandle<R>) -> UpdateState {
    spawn_download(&app);
    state(&app)
}

/// Apply the verified bytes, then restart. On Windows the installer takes over
/// and exits the app; on macOS/Linux the app must relaunch itself.
#[tauri::command]
pub fn install_update<R: Runtime>(app: AppHandle<R>) -> Result<UpdateState, String> {
    let (update, bytes) = {
        let guard = app.state::<UpdatesState>();
        let inner = guard.lock();
        match (inner.available.clone(), inner.payload.clone()) {
            (Some(update), Some(bytes)) => (update, bytes),
            _ => {
                return Err(
                    "no verified update is ready to install — check and download first".into(),
                )
            }
        }
    };

    update.install(bytes).map_err(|e| format!("install failed: {e}"))?;

    // Windows: the installer restarts the app itself (restart_after_install is
    // true by default). Everywhere else the shell relaunches.
    #[cfg(not(windows))]
    {
        app.restart();
    }
    #[cfg(windows)]
    {
        Ok(state(&app))
    }
}

#[tauri::command]
pub fn updates_set_channel<R: Runtime>(app: AppHandle<R>, channel: String) -> Result<UpdateState, String> {
    let parsed = Channel::parse(&channel).ok_or_else(|| format!("unknown channel: {channel}"))?;
    write_setting(&app, KEY_CHANNEL, parsed.as_str().to_string());
    // A channel switch invalidates whatever was pending: those bytes came from
    // the other channel's manifest and must not be installed.
    {
        let guard = app.state::<UpdatesState>();
        let mut inner = guard.lock();
        inner.available = None;
        inner.described = None;
        inner.payload = None;
        inner.progress = None;
        inner.error = None;
        inner.check_error = None;
    }
    emit_state(&app);
    Ok(state(&app))
}

#[tauri::command]
pub fn updates_set_auto_download<R: Runtime>(app: AppHandle<R>, enabled: bool) -> UpdateState {
    write_setting(&app, KEY_AUTO_DOWNLOAD, enabled);
    emit_state(&app);
    state(&app)
}

/// Hide this version until the next one. Downloading a skipped version is
/// cancelled at the same time: "skip" has to mean something.
#[tauri::command]
pub fn updates_skip_version<R: Runtime>(app: AppHandle<R>, version: String) -> UpdateState {
    write_setting(&app, KEY_SKIPPED, version);
    {
        let guard = app.state::<UpdatesState>();
        let mut inner = guard.lock();
        inner.payload = None;
        inner.progress = None;
    }
    emit_state(&app);
    state(&app)
}

#[tauri::command]
pub fn updates_clear_skip<R: Runtime>(app: AppHandle<R>) -> UpdateState {
    if let Some(store) = settings(&app) {
        let _ = store.delete(KEY_SKIPPED);
        let _ = store.save();
    }
    emit_state(&app);
    state(&app)
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channels_parse_and_round_trip() {
        assert_eq!(Channel::parse("Stable"), Some(Channel::Stable));
        assert_eq!(Channel::parse(" beta "), Some(Channel::Beta));
        assert_eq!(Channel::parse("NIGHTLY"), Some(Channel::Nightly));
        assert_eq!(Channel::parse(""), Some(Channel::Stable), "empty means the default");
        assert_eq!(Channel::parse("canary"), None, "unknown channels are refused, not guessed");
        for channel in [Channel::Stable, Channel::Beta, Channel::Nightly] {
            assert_eq!(Channel::parse(channel.as_str()), Some(channel));
        }
    }

    #[test]
    fn endpoints_follow_the_channel_and_an_override_wins() {
        let none = ChannelOverrides::default();
        assert!(endpoint_for(Channel::Stable, &none).ends_with("/releases/latest/download/latest.json"));
        assert!(endpoint_for(Channel::Beta, &none).contains("/releases/download/updater-beta/"));
        assert!(endpoint_for(Channel::Nightly, &none).contains("/releases/download/updater-nightly/"));

        let overridden = ChannelOverrides {
            beta: Some("https://mirror.example/stable.json".into()),
            ..Default::default()
        };
        assert_eq!(endpoint_for(Channel::Beta, &overridden), "https://mirror.example/stable.json");
        // Untouched channels keep their defaults.
        assert!(endpoint_for(Channel::Stable, &overridden).starts_with(RELEASE_BASE));
    }

    #[test]
    fn a_prerelease_build_defaults_to_its_own_channel() {
        assert_eq!(default_channel_for_version("0.2.0"), Channel::Stable);
        assert_eq!(default_channel_for_version("0.3.0-beta.2"), Channel::Beta);
        assert_eq!(default_channel_for_version("0.3.0-rc.1"), Channel::Beta);
        assert_eq!(default_channel_for_version("0.4.0-nightly.20261012"), Channel::Nightly);
    }

    #[test]
    fn notes_are_capped_on_a_paragraph_boundary() {
        let short = "### v2\n- a fix\n";
        let (text, truncated) = cap_notes(short);
        assert_eq!(text, short);
        assert!(!truncated);

        let para = "paragraph.\n\n";
        let long = para.repeat(2_000); // ~26k chars
        let (text, truncated) = cap_notes(&long);
        assert!(truncated);
        assert!(text.chars().count() <= NOTES_CAP);
        assert!(text.ends_with("paragraph."), "cut at a paragraph break, not mid-word");
    }

    #[test]
    fn notes_cap_handles_multibyte_text() {
        // Emoji are 4 bytes each: a naive byte cut would panic or split one.
        let long = "🎉".repeat(NOTES_CAP + 500);
        let (text, truncated) = cap_notes(&long);
        assert!(truncated);
        assert_eq!(text.chars().count(), NOTES_CAP);
    }

    #[test]
    fn download_progress_serializes_camel_case_for_the_webview() {
        let json = serde_json::to_string(&DownloadProgress {
            downloaded: 512,
            total: Some(1024),
            percent: Some(50.0),
        })
        .unwrap();
        assert!(json.contains("\"downloaded\":512"));
        assert!(json.contains("\"total\":1024"));
        assert!(json.contains("\"percent\":50.0"));
    }

    #[test]
    fn update_state_serializes_with_the_fields_the_ui_reads() {
        let state = UpdateState {
            provisioned: false,
            reason: Some("not provisioned".into()),
            channel: "stable".into(),
            channel_options: vec!["stable".into(), "beta".into(), "nightly".into()],
            auto_download: true,
            current_version: "0.2.0".into(),
            available: None,
            skipped_version: None,
            downloading: false,
            progress: None,
            ready_to_install: false,
            last_check_ms: None,
            error: None,
        };
        let json = serde_json::to_value(&state).unwrap();
        for key in [
            "provisioned",
            "reason",
            "channel",
            "channelOptions",
            "autoDownload",
            "currentVersion",
            "readyToInstall",
            "lastCheckMs",
        ] {
            assert!(json.get(key).is_some(), "missing {key} in {json}");
        }
    }
}
