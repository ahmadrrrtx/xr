//! Engine sidecar lifecycle (Phase 14 · real LLM integration).
//!
//! The packaged app ships the XR engine as a Tauri externalBin sidecar
//! (`xr-engine-<target-triple>`, compiled by `scripts/compile-sidecar.ts`).
//! On startup the shell spawns it with `serve --port 0` (ephemeral — it can
//! never collide with an operator-started daemon on 3141) and pairs by
//! parsing the daemon's own startup banner on stdout:
//!
//! ```text
//! ✓ Listening on  http://127.0.0.1:<port>   → the real bound port
//! Token: <48-hex>                           → the bearer token
//! ```
//!
//! The token is handed ONLY to this app's own webview via `engine_link`; the
//! shell never prints, stores or forwards it anywhere else. All policy,
//! audit and secrets stay engine-side — this module is the handshake, not a
//! second trust domain.
//!
//! Dev mode (`tauri dev`): no sidecar binary exists next to the debug exe,
//! so `engine_link` honestly reports `spawned: false` with a reason and the
//! frontend falls back to the relative `/api/v1` paths served by the Vite
//! proxy (which injects the dev token).
//!
//! Containment — the engine never outlives the shell:
//!   Windows  Job Object, KILL_ON_JOB_CLOSE (`win.rs`)         — kernel-enforced
//!   Linux    PR_SET_PDEATHSIG armed between fork and exec   — kernel-enforced
//!   macOS    engine-side parent watch only (`--parent-pid`) — 1 s poll
//!   all      clean quits send SIGTERM first (Unix) so the engine runs its
//!            own stop path instead of being killed mid-write.
//!
//! Parsing and caching live in `engine_state.rs` (pure std, unit-tested).

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::State;

use crate::engine_state::{parse_banner_line, Banner, ProbeCache, StderrTail};

/// Shared engine-link state, populated by the stdout reader thread.
#[derive(Default)]
pub struct EngineState {
    port: Mutex<Option<u16>>,
    token: Mutex<Option<String>>,
    child: Mutex<Option<Child>>,
    /// Honest reason when no sidecar link exists (dev builds, spawn errors).
    note: Mutex<Option<String>>,
    /// The tail of the sidecar's stderr, so a failure can explain itself.
    stderr_tail: Mutex<StderrTail>,
    /// Short-lived cache for the reachability probe.
    probe_cache: Mutex<ProbeCache>,
    /// Non-None when the sidecar is running WITHOUT job containment.
    containment: Mutex<Option<String>>,
    /// How many times this shell has (re)spawned the sidecar.
    generation: Mutex<u32>,
    /// Job object holding the sidecar; closing it kills the engine.
    #[cfg(windows)]
    job: Mutex<Option<crate::win::JobObject>>,
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

fn tcp_reachable(port: u16) -> bool {
    if let Ok(addr) = format!("127.0.0.1:{port}").parse() {
        std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
    } else {
        false
    }
}

/// Reachability with a short-lived cache: `tcp_reachable` blocks up to
/// 400 ms and the webview polls, so an uncached probe would freeze the IPC
/// handler on the very screen whose job is to say the engine is down.
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

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Spawn the sidecar and start the banner/stderr reader threads.
///
/// Must be called from the MAIN thread: on Linux the parent-death signal is
/// bound to the thread that spawned the child (see `unix.rs`, invariant 1).
/// Tauri's `setup` hook and sync commands both run there.
pub fn spawn_sidecar(state: &Arc<EngineState>) {
    let Some(bin) = sidecar_path() else {
        *lock(&state.note) =
            Some("sidecar binary not found (dev build — frontend uses the vite proxy)".into());
        return;
    };
    *lock(&state.port) = None;
    *lock(&state.token) = None;
    *lock(&state.note) = None;
    *lock(&state.containment) = None;
    *lock(&state.generation) += 1;
    let generation = *lock(&state.generation);

    let mut cmd = Command::new(&bin);
    cmd.arg("serve")
        .arg("--port")
        .arg("0")
        // The engine watches THIS process and stops itself when it is gone
        // (src/daemon/parent-watch.ts). On macOS this is the only crash-path
        // guarantee; elsewhere it backs the kernel mechanism.
        .arg("--parent-pid")
        .arg(std::process::id().to_string())
        .env("NO_COLOR", "1")
        .stdout(Stdio::piped())
        // The engine explains its refusals on stderr; keep it.
        .stderr(Stdio::piped());
    // The engine is a console application. Without CREATE_NO_WINDOW a console
    // window flashes on every launch of the desktop app.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(target_os = "linux")]
    crate::unix::arm_parent_death_signal(&mut cmd);

    match cmd.spawn() {
        Ok(mut child) => {
            let stdout = child.stdout.take();

            if let Some(err) = child.stderr.take() {
                let st = Arc::clone(state);
                std::thread::spawn(move || {
                    for line in BufReader::new(err).lines() {
                        let Ok(line) = line else { break };
                        lock(&st.stderr_tail).push(line);
                    }
                });
            }

            // Contain the sidecar in a job so it dies with this process even
            // if the shell crashes. Failure is recorded, not hidden.
            #[cfg(windows)]
            {
                match crate::win::JobObject::new_kill_on_close() {
                    Ok(job) => match job.assign(&child) {
                        Ok(()) => {
                            *lock(&state.job) = Some(job);
                        }
                        Err(e) => {
                            *lock(&state.containment) = Some(format!(
                                "sidecar started WITHOUT job containment ({e}) — it dies only on a clean shutdown"
                            ));
                        }
                    },
                    Err(e) => {
                        *lock(&state.containment) = Some(format!(
                            "no job object available ({e}) — sidecar dies only on a clean shutdown"
                        ));
                    }
                }
            }

            *lock(&state.child) = Some(child);
            let st = Arc::clone(state);
            std::thread::spawn(move || {
                let Some(out) = stdout else { return };
                for line in BufReader::new(out).lines() {
                    let Ok(line) = line else { break };
                    match parse_banner_line(&line) {
                        Some(Banner::Port(port)) => *lock(&st.port) = Some(port),
                        Some(Banner::Token(token)) => *lock(&st.token) = Some(token),
                        None => {}
                    }
                }
                // stdout closed = daemon exited. Only the CURRENT generation
                // may mark the link stale — a restart's old reader must not
                // overwrite the new engine's state.
                if *lock(&st.generation) == generation && lock(&st.port).is_some() {
                    *lock(&st.note) = Some("sidecar exited (stdout closed)".into());
                    *lock(&st.port) = None;
                    *lock(&st.token) = None;
                }
            });
        }
        Err(e) => {
            *lock(&state.note) = Some(format!("spawn failed: {e}"));
        }
    }
}

/// Stop the sidecar we own (SIGTERM first on Unix, bounded grace), if any.
/// Returns whether a child was running.
pub fn stop_sidecar(state: &EngineState, grace: Duration) -> bool {
    #[cfg(windows)]
    {
        lock(&state.job).take();
    }
    let Some(mut child) = lock(&state.child).take() else {
        return false;
    };
    #[cfg(unix)]
    {
        crate::unix::terminate_gracefully(&mut child, grace);
    }
    #[cfg(not(unix))]
    {
        let _ = grace;
        let _ = child.kill();
        let _ = child.wait();
    }
    if let Ok(mut cache) = state.probe_cache.lock() {
        *cache = ProbeCache::default();
    }
    true
}

/// Which crash-containment mechanism is actually in force for the sidecar.
fn containment_mode(state: &EngineState) -> Option<&'static str> {
    if lock(&state.child).is_none() {
        return None;
    }
    #[cfg(windows)]
    let mode = if lock(&state.job).is_some() { "job-object" } else { "none" };
    #[cfg(target_os = "linux")]
    let mode = "pdeathsig+parent-watch";
    #[cfg(not(any(windows, target_os = "linux")))]
    let mode = "parent-watch";
    Some(mode)
}

/// Instant snapshot — the frontend polls this while pairing.
#[tauri::command]
pub fn engine_link(state: State<'_, Arc<EngineState>>) -> serde_json::Value {
    let port: Option<u16> = *lock(&state.port);
    let token: Option<String> = lock(&state.token).clone();
    let note: Option<String> = lock(&state.note).clone();
    let containment: Option<String> = lock(&state.containment).clone();
    let mode = containment_mode(state.inner());
    let spawned = lock(&state.child).is_some();
    let stderr: Vec<String> = lock(&state.stderr_tail).last(5);

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
            });
        }
    }
    serde_json::json!({
        "reachable": false,
        // `spawned` stays true while a live child is still printing its
        // banner, so the webview keeps polling instead of giving up early.
        "spawned": spawned && note.is_none(),
        "port": port,
        "hasToken": token.is_some(),
        "reason": note,
        "containment": containment,
        "containmentMode": mode,
        "stderr": stderr,
    })
}

/// Stop the current sidecar (if any) and spawn a fresh one. Sync on purpose:
/// sync commands run on the main thread, which is where the Linux
/// parent-death signal must be armed from.
#[tauri::command]
pub fn engine_restart(state: State<'_, Arc<EngineState>>) -> Result<serde_json::Value, String> {
    if sidecar_path().is_none() {
        return Err(
            "no sidecar in this build — in development start the engine with `bun run engine` (desktop/)"
                .into(),
        );
    }
    let was_running = stop_sidecar(state.inner(), Duration::from_millis(1_000));
    spawn_sidecar(state.inner());
    let note = lock(&state.note).clone();
    match note {
        Some(reason) => Err(reason),
        None => Ok(serde_json::json!({
            "restarted": was_running,
            "generation": *lock(&state.generation),
        })),
    }
}

/// The last `lines` stderr lines the sidecar wrote (oldest first). Tokens are
/// printed on stdout by the engine and never reach this buffer.
#[tauri::command]
pub fn engine_logs_tail(state: State<'_, Arc<EngineState>>, lines: Option<usize>) -> Vec<String> {
    let n = lines.unwrap_or(40).clamp(1, crate::engine_state::STDERR_TAIL_LINES);
    lock(&state.stderr_tail).last(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_state_reports_nothing_spawned_and_no_logs() {
        let state = EngineState::default();
        assert!(lock(&state.child).is_none());
        assert_eq!(containment_mode(&state), None);
        assert!(lock(&state.stderr_tail).last(10).is_empty());
        assert!(!stop_sidecar(&state, Duration::from_millis(10)));
    }

    #[test]
    fn logs_tail_is_clamped_to_the_documented_cap() {
        let state = EngineState::default();
        for i in 0..100 {
            lock(&state.stderr_tail).push(format!("line {i}"));
        }
        let all = lock(&state.stderr_tail).last(usize::MAX);
        assert_eq!(all.len(), crate::engine_state::STDERR_TAIL_LINES);
        assert_eq!(all.last().map(String::as_str), Some("line 99"));
    }
}
