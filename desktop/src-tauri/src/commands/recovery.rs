/*
 * Crash recovery (Phase 27) — the commands behind the pre-router screen.
 *
 * The recovery screen appears when `~/.xr/crash-dirty.json` is still on disk at
 * launch, which means the previous session never reached its clean-exit path
 * (see `crate::crash`, which owns the flag and the report assembly).
 *
 * The three answers, and what each actually does:
 *
 *   resume  Keep the previous session's workspaces and chats. Interrupted runs
 *           are marked `killed` in the webview with the note "App was
 *           interrupted" — this module only says "it was interrupted"; the run
 *           records live in the webview's own store (there is no runs table),
 *           so the honest split is: Rust owns the fact, the webview owns the
 *           rows.
 *   fresh   Same, minus the interrupted runs: they are dropped rather than
 *           rewritten, so nothing pretends to be finished that never finished.
 *   report  Never a choice on its own — it is offered alongside both, and it is
 *           always manual: XR assembles a redacted file, shows what is in it,
 *           and hands the user a mail draft. Nothing is uploaded, ever.
 *
 * Plus the escape hatch for a crash loop: if the previous run's engine failed to
 * start, the user can start without the local engine. When they do, the shell
 * skips the sidecar entirely (so it cannot crash the app again) and offers to
 * attach to an engine they are already running on 127.0.0.1:3141 — which needs
 * that engine's token, because XR's daemon does not answer anonymous requests
 * even on loopback (Phase 4 auth: bearer token or session cookie, nothing
 * else). "Attach" therefore means: user pastes the token, we prove it works
 * against the running engine, and only then link.
 */
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use super::settings::settings;
use crate::crash::{self, CrashReport, CrashState};
use crate::engine::{self, EngineState};

/// The default port a hand-started engine listens on (`xr serve`).
pub const EXTERNAL_DEFAULT_PORT: u16 = 3141;

/// Where a crash report is addressed. A static address on purpose: the user
/// sees the destination in the draft before anything is sent.
pub const REPORT_EMAIL: &str = "crashes@rrrtx.ai";

/// settings.json key: the user started this session without the local engine.
const KEY_WITHOUT_ENGINE: &str = "xr.engine.withoutLocal";

/// What the user chose on the recovery screen (this session only).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecoveryChoice {
    /// No decision yet — the screen is still up.
    #[default]
    Pending,
    /// Keep everything the interrupted session had.
    Resume,
    /// Start clean; interrupted runs are dropped, not rewritten.
    Fresh,
    /// Ran without the local engine this session.
    WithoutEngine,
}

/// Managed state for the recovery flow.
#[derive(Default)]
pub struct RecoveryState {
    pub choice: Mutex<RecoveryChoice>,
}

/// Everything the recovery screen renders.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryInfo {
    /// A previous session was interrupted.
    pub interrupted: bool,
    pub previous_version: Option<String>,
    pub consecutive_interruptions: u32,
    /// The interrupted run's engine never came up — offer the engine-less start.
    pub engine_spawn_failed: bool,
    /// Shell-version that hit the wall (informational, for the copy).
    pub current_version: String,
    /// How many log files exist to report on.
    pub log_files: usize,
    pub shell_log_bytes: Option<u64>,
    /// The user's answer, once given.
    pub choice: RecoveryChoice,
    /// This session is running without the local engine.
    pub without_local_engine: bool,
    /// This session is attached to a user-started engine.
    pub attached_external: bool,
    /// `127.0.0.1:3141` is listening right now.
    pub external_engine_listening: bool,
    pub platform: String,
}

/// Where the user-started engine lives, when they attach to one.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachResult {
    pub attached: bool,
    pub port: u16,
    pub message: String,
}

fn version<R: Runtime>(app: &AppHandle<R>) -> String {
    app.package_info().version.to_string()
}

/// Is anything listening on `port` on loopback? (No HTTP, no auth: a probe.)
pub fn loopback_listening(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(400),
    )
    .is_ok()
}

/// Prove a pasted token really belongs to the engine on `port`.
///
/// `/api/v1/health` is deliberately open, so it tells us an XR engine is there
/// — but it must NOT be what we validate a token against. `/api/v1/capabilities`
/// is authenticated, which is what makes it the right check: 200 means the
/// token works, 401/403 means it does not.
pub fn verify_external_token(port: u16, token: &str) -> Result<(), String> {
    let agent = ureq::Agent::new_with_config(
        ureq::config::Config::builder()
            .timeout_global(Some(Duration::from_secs(5)))
            .build(),
    );
    let base = format!("http://127.0.0.1:{port}");

    match agent.get(&format!("{base}/api/v1/health")).call() {
        Ok(_) => {}
        // ureq 3: status errors are Error::StatusCode, not Error::Status.
        Err(ureq::Error::StatusCode(code)) => {
            return Err(format!("something is listening on 127.0.0.1:{port} but it is not an XR engine (HTTP {code})"));
        }
        Err(e) => return Err(format!("could not reach 127.0.0.1:{port}: {e}")),
    }

    match agent
        .get(&format!("{base}/api/v1/capabilities"))
        .header("Authorization", format!("Bearer {token}"))
        .call()
    {
        Ok(_) => Ok(()),
        Err(ureq::Error::StatusCode(code)) if code == 401 || code == 403 => {
            Err("the engine is running but rejected that token — check the `Token:` line the engine printed when it started".into())
        }
        Err(ureq::Error::StatusCode(code)) => Err(format!("the engine answered HTTP {code} for an authenticated request")),
        Err(e) => Err(format!("token check failed: {e}")),
    }
}

fn info<R: Runtime>(app: &AppHandle<R>, engine_state: &EngineState) -> RecoveryInfo {
    let home = crash::xr_home();
    let state: CrashState = crash::state_at_startup(&home);
    let snapshot = engine::snapshot(engine_state);
    let logs = crash::log_files(&home);
    let shell_log_bytes = std::fs::metadata(crash::shell_log_path(&home)).ok().map(|m| m.len());
    let choice = app
        .try_state::<RecoveryState>()
        .and_then(|s| s.choice.lock().ok().map(|c| *c))
        .unwrap_or(RecoveryChoice::Pending);
    let without = settings(app)
        .and_then(|store| store.get(KEY_WITHOUT_ENGINE))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    RecoveryInfo {
        interrupted: state.interrupted,
        previous_version: state.previous.as_ref().map(|p| p.version.clone()),
        consecutive_interruptions: state.previous.as_ref().map(|p| p.consecutive_interruptions).unwrap_or(0),
        engine_spawn_failed: state.engine_spawn_failed,
        current_version: version(app),
        log_files: logs.len(),
        shell_log_bytes,
        choice,
        without_local_engine: without,
        attached_external: snapshot.external,
        external_engine_listening: loopback_listening(EXTERNAL_DEFAULT_PORT),
        platform: std::env::consts::OS.to_string(),
    }
}

// ─── Commands ───────────────────────────────────────────────────────────────

/// What the recovery screen (or the router, when there was nothing to recover)
/// needs on mount. Cheap: no network, one flag read.
#[tauri::command]
pub fn crash_state(app: AppHandle, engine: tauri::State<'_, std::sync::Arc<EngineState>>) -> RecoveryInfo {
    info(&app, &engine)
}

/// Answer the screen: resume / start fresh. Either way the flag is cleared —
/// the user has now seen the interruption, and leaving it set would show the
/// screen forever.
#[tauri::command]
pub fn crash_resolve(
    app: AppHandle,
    action: String,
    engine: tauri::State<'_, std::sync::Arc<EngineState>>,
) -> Result<RecoveryInfo, String> {
    let choice = match action.as_str() {
        "resume" => RecoveryChoice::Resume,
        "fresh" => RecoveryChoice::Fresh,
        other => return Err(format!("unknown recovery action: {other}")),
    };

    let home = crash::xr_home();
    crash::log_shell(&home, &format!("recovery: user chose {action}"));
    crash::clear_flag(&home);

    if let Some(state) = app.try_state::<RecoveryState>() {
        *state.choice.lock().map_err(|e| e.to_string())? = choice;
    }
    // "fresh" also means: do not carry this session's engine-without-local
    // preference forward.
    if choice == RecoveryChoice::Fresh {
        if let Some(store) = settings(&app) {
            let _ = store.delete(KEY_WITHOUT_ENGINE);
            let _ = store.save();
        }
    }
    let _ = app.emit("xr-crash-resolved", choice);
    Ok(info(&app, &engine))
}

/// Skip the local engine for this session (the crash-loop escape hatch). The
/// sidecar is not spawned again until the next launch, so a broken engine
/// binary cannot take the shell down twice.
#[tauri::command]
pub fn crash_start_without_engine(
    app: AppHandle,
    engine: tauri::State<'_, std::sync::Arc<EngineState>>,
) -> Result<RecoveryInfo, String> {
    let home = crash::xr_home();
    crash::log_shell(&home, "recovery: starting without the local engine");

    if let Some(store) = settings(&app) {
        store.set(KEY_WITHOUT_ENGINE.to_string(), true);
        let _ = store.save();
    }
    if let Some(state) = app.try_state::<RecoveryState>() {
        *state.choice.lock().map_err(|e| e.to_string())? = RecoveryChoice::WithoutEngine;
    }
    if let Some(state) = app.try_state::<std::sync::Arc<EngineState>>() {
        engine::stop_sidecar(state.inner(), Duration::from_millis(1_500));
    }
    crash::clear_flag(&home);
    let _ = app.emit("xr-crash-resolved", RecoveryChoice::WithoutEngine);
    Ok(info(&app, &engine))
}

/// Attach to an engine the user already runs (`xr serve --port 3141`).
/// The token is verified before it is stored — a link that lies about being
/// paired is worse than no link.
#[tauri::command]
pub fn crash_attach_external(
    app: AppHandle,
    token: String,
    port: Option<u16>,
    engine: tauri::State<'_, std::sync::Arc<EngineState>>,
) -> Result<AttachResult, String> {
    let port = port.unwrap_or(EXTERNAL_DEFAULT_PORT);
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("the engine's token is required — it is the `Token:` line printed when the engine starts".into());
    }
    if port == 0 {
        return Err("invalid port: 0".into());
    }

    match verify_external_token(port, &token) {
        Ok(()) => {
            engine::attach_external(&engine, port, token);
            if let Some(state) = app.try_state::<RecoveryState>() {
                *state.choice.lock().map_err(|e| e.to_string())? = RecoveryChoice::WithoutEngine;
            }
            if let Some(store) = settings(&app) {
                store.set(KEY_WITHOUT_ENGINE.to_string(), true);
                let _ = store.save();
            }
            crash::log_shell(&crash::xr_home(), &format!("recovery: attached to external engine on 127.0.0.1:{port}"));
            let _ = app.emit("xr-engine-attached", port);
            Ok(AttachResult {
                attached: true,
                port,
                message: format!("Attached to the engine on 127.0.0.1:{port}"),
            })
        }
        // The token is the user's secret: the error names the failure, never
        // the value.
        Err(e) => Err(e),
    }
}

/// Detach from the attached engine (start the local one again on restart).
#[tauri::command]
pub fn crash_detach_external(app: AppHandle) -> Result<(), String> {
    if let Some(store) = settings(&app) {
        let _ = store.delete(KEY_WITHOUT_ENGINE);
        let _ = store.save();
    }
    Ok(())
}

/// Should this session skip the sidecar? Read once in `lib.rs` setup.
pub fn started_without_engine<R: Runtime>(app: &AppHandle<R>) -> bool {
    settings(app)
        .and_then(|store| store.get(KEY_WITHOUT_ENGINE))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// Assemble a crash report and write it to `~/.xr/crash-reports/`.
/// Returns a preview plus the paths — the full text stays on disk until the
/// user decides what to do with it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportTicket {
    pub path: String,
    pub subject: String,
    pub bytes: usize,
    /// First chunk of the redacted text, so the modal can show real content.
    pub preview: String,
    /// Every source that contributed.
    pub included: Vec<String>,
    /// A mail draft with the summary + the file location. Body is short by
    /// design: mail clients truncate long `mailto:` bodies, and the file is
    /// the real payload.
    pub mailto: String,
}

#[tauri::command]
pub fn crash_report(
    app: AppHandle,
    engine: tauri::State<'_, std::sync::Arc<EngineState>>,
) -> Result<ReportTicket, String> {
    let home = crash::xr_home();
    let state = crash::state_at_startup(&home);
    let snapshot = engine::snapshot(&engine);
    let report: CrashReport = crash::build_report(
        &home,
        &state,
        &version(&app),
        &snapshot.stderr_tail,
        crash::now_ms(),
    );

    let dir = home.join("crash-reports");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let path = dir.join(format!("xr-report-{}.txt", crash::now_ms()));
    std::fs::write(&path, &report.body).map_err(|e| format!("could not write the report: {e}"))?;
    crash::log_shell(&home, &format!("recovery: report written to {}", path.display()));

    let preview: String = report.body.chars().take(1200).collect();

    // The draft carries the summary and the file location; the report itself
    // travels as an attachment. Keeping the body short matters: mail clients
    // truncate long `mailto:` bodies, and a truncated report is a misleading
    // report.
    let body = format!(
        "What happened: <one line from you>\n\n\
         The full report is on this machine at:\n{path}\n\
         Attach that file before sending.\n\n\
         XR Desktop {version} · {os} · {bytes} bytes, assembled locally and redacted.\n\
         Nothing was uploaded automatically.",
        path = path.display(),
        version = version(&app),
        os = std::env::consts::OS,
        bytes = report.bytes,
    );
    let mailto = format!(
        "mailto:{REPORT_EMAIL}?subject={}&body={}",
        urlencode(&report.subject),
        urlencode(&body)
    );

    Ok(ReportTicket {
        path: path.display().to_string(),
        subject: report.subject,
        bytes: report.bytes,
        preview,
        included: report.included,
        mailto,
    })
}

/// Percent-encode for a `mailto:` URL (RFC 3986 unreserved characters stay).
fn urlencode(input: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(input.len() * 2);
    for byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*byte as char),
            b' ' => out.push_str("%20"),
            b'\n' => out.push_str("%0A"),
            other => {
                out.push('%');
                out.push(HEX[(other >> 4) as usize] as char);
                out.push(HEX[(other & 0x0F) as usize] as char);
            }
        }
    }
    out
}

/// Dev-only: mark the session dirty and die, so the recovery path can be
/// exercised without actually crashing a machine. Refuses outside dev builds
/// (and when `XR_ALLOW_CRASH_SIM` is unset) — a button that can kill a user's
/// app must not ship enabled.
#[tauri::command]
pub fn crash_simulate(app: AppHandle) -> Result<(), String> {
    let allowed = cfg!(debug_assertions) || std::env::var("XR_ALLOW_CRASH_SIM").is_ok();
    if !allowed {
        return Err("crash simulation is a development feature (set XR_ALLOW_CRASH_SIM=1 to allow it)".into());
    }
    let home = crash::xr_home();
    let consecutive = crash::read_flag(&home).map(|f| f.consecutive_interruptions).unwrap_or(0) + 1;
    crash::write_flag(&home, &version(&app), consecutive, false)
        .map_err(|e| format!("could not write the dirty flag: {e}"))?;
    crash::log_shell(&home, "simulated crash (dev)");
    let _ = app.emit("xr-crash-simulated", ());
    // Hard stop: no teardown, no flag cleanup — exactly what a crash looks like.
    std::process::exit(1);
}

/// Forget the interruption without changing anything else (used by "fresh" when
/// the webview has already dropped its interrupted runs).
#[tauri::command]
pub fn crash_forget(app: AppHandle, engine: tauri::State<'_, std::sync::Arc<EngineState>>) -> RecoveryInfo {
    let home = crash::xr_home();
    crash::clear_flag(&home);
    info(&app, &engine)
}

/// The report's file location, for "Show me the file".
#[tauri::command]
pub fn crash_report_dir() -> String {
    crash::xr_home().join("crash-reports").display().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_probe_is_false_for_a_port_nobody_owns() {
        // Port 1 is never a listening service in a normal environment, and the
        // probe must return (not hang) either way.
        assert!(!loopback_listening(1));
    }

    #[test]
    fn loopback_probe_finds_a_listener() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(loopback_listening(port));
    }

    #[test]
    fn verifying_a_token_against_nothing_listening_fails_with_a_clear_message() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let err = verify_external_token(port, "deadbeef").unwrap_err();
        assert!(err.contains("could not reach"), "got: {err}");
    }

    #[test]
    fn verifying_a_token_against_a_non_xr_server_says_so() {
        // A bare TCP listener that answers HTTP 404 is not an XR engine.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            use std::io::{Read, Write};
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                );
            }
        });
        let err = verify_external_token(port, "deadbeef").unwrap_err();
        assert!(err.contains("not an XR engine"), "got: {err}");
    }

    #[test]
    fn urlencode_keeps_the_subject_readable() {
        assert_eq!(urlencode("XR crash report"), "XR%20crash%20report");
        assert_eq!(urlencode("a/b?c=d"), "a%2Fb%3Fc%3Dd");
        assert_eq!(urlencode("line\nline"), "line%0Aline");
    }

    #[test]
    fn recovery_choice_serializes_camel_case() {
        let json = serde_json::to_value(RecoveryChoice::WithoutEngine).unwrap();
        assert_eq!(json, serde_json::json!("withoutEngine"));
        assert_eq!(serde_json::to_value(RecoveryChoice::Pending).unwrap(), serde_json::json!("pending"));
    }
}
