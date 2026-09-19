//! XR Desktop — engine sidecar lifecycle (Phase 4 · D-02).
//!
//! The packaged app ships the XR engine as a Tauri externalBin sidecar
//! (`xr-engine-<target-triple>`, compiled by scripts/compile-sidecar.ts).
//! On startup the shell spawns it with `serve --port 0` (ephemeral — it can
//! never collide with an operator-started daemon on 3141) and performs the
//! pairing handshake by parsing the daemon's own startup banner on stdout:
//!
//! ```text
//! ✓ Listening on  http://127.0.0.1:<port>   → the real bound port
//! Token: <48-hex>                           → the bearer token
//! ```
//!
//! The engine prints the ACTUAL bound port (Phase 4 · T4), so port 0 is
//! honest end-to-end. The token is handed ONLY to this app's own webview via
//! the `engine_link` command — the shell never prints, stores or forwards it
//! anywhere else (SEC-07: all policy/audit/secrets stay engine-side; this is
//! the daemon handshake itself, not a second trust domain).
//!
//! Dev mode (`tauri dev`): no sidecar binary exists next to the debug exe, so
//! spawn honestly reports "not found" and the frontend falls back to relative
//! /api/v1 paths served by the vite proxy (which injects XR_DEV_TOKEN).
//!
//! Phase 1 · Windows-native hardening (W-1/W-2/W-3/W-5/W-6)
//! ─────────────────────────────────────────────────────────────────────────────
//!   W-1  the sidecar is spawned with CREATE_NO_WINDOW, so a console window no
//!        longer flashes on every launch of the desktop app;
//!   W-2  the sidecar is assigned to a Job Object armed with
//!        KILL_ON_JOB_CLOSE, so it cannot outlive the shell even if the shell
//!        crashes (previously an engine survived a shell crash, invisible);
//!   W-3  a named-mutex single-instance guard stops a second shell from
//!        spawning a second engine against the same workspace;
//!   W-5  the sidecar's stderr is captured into a bounded tail and reported
//!        with the link status, so failures explain themselves;
//!   W-6  reachability probes are cached for 1.5 s, so a down engine no longer
//!        freezes the webview IPC handler for ~1.2 s per poll.
//!
//! SEC-12 · the engine never outlives the shell, on every OS
//! ─────────────────────────────────────────────────────────────────────────────
//!   Windows  Job Object, KILL_ON_JOB_CLOSE (W-2)            — kernel-enforced
//!   Linux    PR_SET_PDEATHSIG armed between fork and exec  — kernel-enforced
//!   macOS    engine-side parent watch only                 — 1 s poll
//!   all      `--parent-pid <shell pid>` is passed everywhere as defence in
//!            depth; clean quits send SIGTERM first (Unix) so the engine runs
//!            its own stop path instead of being killed mid-write.
//!   `engine_link` reports the mode in force as `containmentMode`, and a
//!   Windows job failure as a `containment` warning — never silently.
//!
//! Parsing and caching live in `engine_state.rs` (pure std, unit-tested);
//! the Win32 calls live in `win.rs` (hand-written FFI, runtime-tested on the
//! Windows runner); the Unix calls live in `unix.rs` (libc, runtime-tested
//! on the Linux reference). See docs/audits/XR_PHASE1_FOUNDATION_VERIFICATION.md
//! for what is runtime-verified and what is not.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

mod engine_state;
/// W-1/W-2/W-3 · Windows-native process containment (hand-written FFI; see the
/// module header for why the `windows` crate is not used).
#[cfg(windows)]
mod win;
/// SEC-12 · Linux parent-death signal + graceful SIGTERM shutdown (libc).
#[cfg(unix)]
mod unix;

use engine_state::{parse_banner_line, Banner, ProbeCache, StderrTail};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, State,
};

/// Shared engine-link state, populated by the stdout reader thread.
#[derive(Default)]
struct EngineState {
    port: Mutex<Option<u16>>,
    token: Mutex<Option<String>>,
    child: Mutex<Option<Child>>,
    /// Honest reason when no sidecar link exists (dev builds, spawn errors).
    note: Mutex<Option<String>>,
    /// W-5 — the tail of the sidecar's stderr, so a failure can explain itself.
    stderr_tail: Mutex<StderrTail>,
    /// W-6 — short-lived cache for the reachability probe.
    probe_cache: Mutex<ProbeCache>,
    /// W-2 — non-None when the sidecar is running WITHOUT job containment.
    containment: Mutex<Option<String>>,
    /// W-2 — job object holding the sidecar; closing it kills the engine.
    #[cfg(windows)]
    job: Mutex<Option<win::JobObject>>,
}

fn target_triple() -> &'static str {
    env!("TARGET_TRIPLE")
}

/// Resolve the sidecar next to this executable. Tauri bundles externalBin
/// beside the main binary keeping the triple suffix; also accept the plain
/// name in case a packager renames it.
fn sidecar_path() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let exe_suffix = if cfg!(windows) { ".exe" } else { "" };
    let candidates = [
        format!("xr-engine-{}{}", target_triple(), exe_suffix),
        format!("xr-engine{}", exe_suffix),
    ];
    for name in candidates.iter() {
        let path = dir.join(name);
        if path.exists() {
            return Some(path);
        }
    }
    None
}

/// Reachability with a short-lived cache (W-6).
///
/// `tcp_reachable` blocks up to 400 ms, and `engine_link` asks about up to three
/// ports per call. Uncached, a down engine froze the webview's IPC handler for
/// over a second on the very screen whose job is to say the engine is down.
fn probe_reachable(state: &EngineState, port: u16) -> bool {
    if let Ok(cache) = state.probe_cache.lock() {
        if let Some(ok) = cache.get(port) {
            return ok;
        }
    }
    let ok = tcp_reachable(port);
    if let Ok(mut cache) = state.probe_cache.lock() {
        cache.put(port, ok);
    }
    ok
}

fn tcp_reachable(port: u16) -> bool {
    if let Ok(addr) = format!("127.0.0.1:{port}").parse() {
        std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
    } else {
        false
    }
}

fn spawn_sidecar(state: &Arc<EngineState>) {
    let Some(bin) = sidecar_path() else {
        *state.note.lock().unwrap() =
            Some("sidecar binary not found (dev build — frontend uses the vite proxy)".into());
        return;
    };
    let mut cmd = Command::new(&bin);
    cmd.arg("serve")
        .arg("--port")
        .arg("0")
        // SEC-12 — the engine watches THIS process and stops itself when it
        // is gone (src/daemon/parent-watch.ts). On macOS this is the only
        // crash-path guarantee; elsewhere it backs the kernel mechanism.
        .arg("--parent-pid")
        .arg(std::process::id().to_string())
        .stdout(Stdio::piped())
        // W-5 — the engine explains its refusals on stderr. Discarding it
        // (`Stdio::null()`) left the shell able to say only "unreachable",
        // with the actual reason thrown away.
        .stderr(Stdio::piped());
    // W-1 — the engine is a console application. Without CREATE_NO_WINDOW a
    // console window flashes on every launch of the desktop app.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    // SEC-12 — Linux: the kernel SIGKILLs the engine when the thread that
    // spawned it exits. This function runs on the main thread (Tauri `setup`),
    // which lives exactly as long as the shell — see unix.rs invariant 1.
    #[cfg(target_os = "linux")]
    unix::arm_parent_death_signal(&mut cmd);

    match cmd.spawn() {
        Ok(mut child) => {
            let stdout = child.stdout.take();

            // W-5 — keep the tail of stderr so `engine_link` can report WHY.
            if let Some(err) = child.stderr.take() {
                let st = Arc::clone(state);
                std::thread::spawn(move || {
                    for line in BufReader::new(err).lines() {
                        let Ok(line) = line else { break };
                        if let Ok(mut tail) = st.stderr_tail.lock() {
                            tail.push(line);
                        }
                    }
                });
            }

            // W-2 — contain the sidecar in a job so it dies with this process
            // even if the shell crashes. Failure is recorded, not hidden: an
            // uncontained sidecar can outlive a crashed shell.
            #[cfg(windows)]
            {
                match win::JobObject::new_kill_on_close() {
                    Ok(job) => match job.assign(&child) {
                        Ok(()) => {
                            *state.job.lock().unwrap() = Some(job);
                        }
                        Err(e) => {
                            *state.containment.lock().unwrap() = Some(format!(
                                "sidecar started WITHOUT job containment ({e}) — it dies only on a clean shutdown"
                            ));
                        }
                    },
                    Err(e) => {
                        *state.containment.lock().unwrap() = Some(format!(
                            "no job object available ({e}) — sidecar dies only on a clean shutdown"
                        ));
                    }
                }
            }

            *state.child.lock().unwrap() = Some(child);
            let st = Arc::clone(state);
            std::thread::spawn(move || {
                let Some(out) = stdout else { return };
                for line in BufReader::new(out).lines() {
                    let Ok(line) = line else { break };
                    // Parsing lives in engine_state.rs, where it is unit-tested
                    // — including the case that a provider's log line naming a
                    // different local port must NOT be mistaken for our port.
                    match parse_banner_line(&line) {
                        Some(Banner::Port(port)) => *st.port.lock().unwrap() = Some(port),
                        Some(Banner::Token(token)) => *st.token.lock().unwrap() = Some(token),
                        None => {}
                    }
                }
                // stdout closed = daemon exited; mark the link stale honestly.
                if st.port.lock().unwrap().is_some() {
                    *st.note.lock().unwrap() = Some("sidecar exited (stdout closed)".into());
                }
            });
        }
        Err(e) => {
            *state.note.lock().unwrap() = Some(format!("spawn failed: {e}"));
        }
    }
}

/// SEC-12 — which crash-containment mechanism is actually in force for the
/// sidecar. A fact for the Trust surface, never a guess:
///   `job-object`              Windows, job assigned (kernel-enforced)
///   `none`                    Windows, job unavailable — `containment` says why
///   `pdeathsig+parent-watch`  Linux (kernel-enforced + engine poll)
///   `parent-watch`            macOS and other Unix (engine poll only)
///   `null`                    no sidecar was spawned by this shell
fn containment_mode(state: &EngineState) -> Option<&'static str> {
    if state.child.lock().unwrap().is_none() {
        return None;
    }
    #[cfg(windows)]
    let mode = if state.job.lock().unwrap().is_some() { "job-object" } else { "none" };
    #[cfg(target_os = "linux")]
    let mode = "pdeathsig+parent-watch";
    #[cfg(not(any(windows, target_os = "linux")))]
    let mode = "parent-watch";
    Some(mode)
}

/// Instant snapshot — the frontend polls this.
///
/// W-6: every reachability answer comes from the short-lived cache, so this
/// cannot block the webview for 400 ms per port per call. W-5: the sidecar's
/// last stderr lines travel with the answer, so "unreachable" arrives with the
/// engine's own explanation instead of a bare failure.
#[tauri::command]
fn engine_link(state: State<'_, Arc<EngineState>>) -> serde_json::Value {
    let port: Option<u16> = *state.port.lock().unwrap();
    let token: Option<String> = state.token.lock().unwrap().clone();
    let note: Option<String> = state.note.lock().unwrap().clone();
    let containment: Option<String> = state.containment.lock().unwrap().clone();
    let mode = containment_mode(state.inner());
    let stderr: Vec<String> = state
        .stderr_tail
        .lock()
        .map(|t| t.last(5))
        .unwrap_or_default();

    if let (Some(port), Some(linked_token)) = (port, token.clone()) {
        if probe_reachable(state.inner(), port) {
            return serde_json::json!({
                "reachable": true,
                "spawned": true,
                "port": port,
                "token": linked_token,
                "containment": containment,
                "containmentMode": mode,
                "stderr": stderr,
                "externalDaemonOn3141": probe_reachable(state.inner(), 3141),
            });
        }
    }
    serde_json::json!({
        "reachable": false,
        "spawned": false,
        "port": port,
        "hasToken": token.is_some(),
        "reason": note,
        "containment": containment,
        "containmentMode": mode,
        "stderr": stderr,
        "externalDaemonOn3141": probe_reachable(state.inner(), 3141),
    })
}

/// Phase 5 · OS notification (approval due / run done) — real OS primitive,
/// invoked only from the shell when the user has opted in (Settings).
#[tauri::command]
fn notify_os(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

/// Phase 5 · opt-in autostart. Disabled by default; the toggle lives in
/// Settings and maps 1:1 onto the plugin's enable/disable.
#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enable: bool) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let l = app.autolaunch();
    if enable {
        l.enable().map_err(|e| e.to_string())?;
    } else {
        l.disable().map_err(|e| e.to_string())?;
    }
    l.is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn autostart_status(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Phase 5 · signed updater. Honest by construction: errors until the
/// operator provisions endpoints + pubkey (scripts/generate-updater-keys.ts).
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(serde_json::json!({ "available": true, "version": update.version })),
        Ok(None) => Ok(serde_json::json!({ "available": false })),
        Err(e) => Err(format!(
            "updater not provisioned or check failed: {e} (see docs/release/UPDATER.md)"
        )),
    }
}

#[tauri::command]
fn engine_status(state: State<'_, Arc<EngineState>>) -> serde_json::Value {
    let port: Option<u16> = *state.port.lock().unwrap();
    let token: Option<String> = state.token.lock().unwrap().clone();
    let reachable = port.is_some_and(|p| probe_reachable(state.inner(), p))
        || probe_reachable(state.inner(), 3141);
    serde_json::json!({
        "reachable": reachable,
        "paired": token.is_some(),
    })
}

/// Held for the life of the process so the named mutex stays owned.
#[cfg(windows)]
static INSTANCE_GUARD: std::sync::OnceLock<win::InstanceGuard> = std::sync::OnceLock::new();

pub fn run() {
    // W-3 · one shell per session. A second launch would spawn a SECOND engine
    // sidecar, so two daemons would quietly compete for the same workspace
    // files. Windows' own primitive for this is a named mutex, which is what
    // `win::InstanceGuard` wraps.
    //
    // Honest scope: this stops the duplicate-daemon damage; it does NOT focus
    // the window that is already open, because cross-instance hand-off needs
    // IPC (tauri-plugin-single-instance, still outstanding). `XR_ALLOW_MULTI=1`
    // opts out for development.
    #[cfg(windows)]
    {
        if std::env::var("XR_ALLOW_MULTI").as_deref() != Ok("1") {
            match win::InstanceGuard::acquire("xr-desktop-single-instance") {
                Ok(Some(guard)) => {
                    let _ = INSTANCE_GUARD.set(guard);
                }
                Ok(None) => return,
                Err(e) => {
                    eprintln!("[xr] single-instance guard unavailable ({e}); continuing without it")
                }
            }
        }
    }

    let engine = Arc::new(EngineState::default());
    let engine_setup = Arc::clone(&engine);
    let builder = tauri::Builder::default()
        .manage(Arc::clone(&engine))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            engine_status,
            engine_link,
            notify_os,
            set_autostart,
            autostart_status,
            check_update
        ])
        .setup(move |app| {
            // Ephemeral-port sidecar: always spawn our own engine when the
            // binary is present; it can never collide with a daemon an
            // operator already runs on 3141.
            spawn_sidecar(&engine_setup);

            // Tray: global quick actions (Phase 1 minimal; full matrix later).
            let menu = Menu::with_items(
                app.handle(),
                &[
                    &MenuItem::with_id(app.handle(), "new_task", "New task", true, None::<&str>)?,
                    &MenuItem::with_id(
                        app.handle(),
                        "approvals",
                        "Pending approvals",
                        true,
                        None::<&str>,
                    )?,
                    &MenuItem::with_id(
                        app.handle(),
                        "quit",
                        "Quit XR Desktop",
                        true,
                        None::<&str>,
                    )?,
                ],
            )?;
            let _tray = TrayIconBuilder::new()
                // Bundled icon set (generated from the official avatar render,
                // D-05 format conversion) — required on Linux, consistent tray
                // identity everywhere.
                .icon(
                    app.default_window_icon()
                        .expect("bundle icon must be present")
                        .clone(),
                )
                .tooltip("XR — the AI agent you can actually trust")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    _ => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;
            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building XR Desktop");
    app.run(move |_app_handle, event| {
        // Never orphan the engine: the sidecar dies with the shell.
        //
        // W-2 · closing the job first is what makes this true even for a
        // sidecar that is not the direct child we spawned (JOB_OBJECT_LIMIT_
        // KILL_ON_JOB_CLOSE takes the whole tree). The explicit kill below
        // stays as the non-Windows path and as a belt-and-braces for the
        // direct child.
        if let tauri::RunEvent::Exit = event {
            #[cfg(windows)]
            {
                engine.job.lock().unwrap().take();
            }
            if let Some(mut child) = engine.child.lock().unwrap().take() {
                // SEC-12 — Unix: SIGTERM first, so the engine runs its own
                // stop path (server close, trigger loop, observability
                // flush); SIGKILL only if it has not left after the grace.
                #[cfg(unix)]
                {
                    unix::terminate_gracefully(&mut child, Duration::from_millis(1500));
                }
                #[cfg(not(unix))]
                {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    });
}
