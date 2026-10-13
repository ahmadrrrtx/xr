//! Crash recovery (Phase 27).
//!
//! Three jobs, all local and all inspectable by the user:
//!
//!   1. **The dirty flag.** `~/.xr/crash-dirty.json` is written once the engine
//!      sidecar has actually spawned (the main loop is entered), and deleted
//!      only after a *clean* exit — `RunEvent::Exit` → `stop_sidecar` returned.
//!      If the file is still there on the next launch, the previous run was
//!      interrupted (crash, force-quit, power loss) and the shell says so
//!      instead of pretending the last session ended normally.
//!
//!   2. **The shell's own bounded log.** The engine keeps logs; the shell used
//!      to keep nothing, so a shell crash left no evidence at all. Every
//!      session appends to `~/.xr/logs/shell.log`, rotated at
//!      [`SHELL_LOG_MAX_BYTES`], so "what happened" has an answer.
//!
//!   3. **The crash report — manual, never automatic.** `crash_report` assembles
//!      a redacted text file (flag record + shell log tail + engine stderr tail
//!      + engine log tail) and hands the user a `mailto:` link. Nothing is sent
//!      by this module: zero telemetry is a constitution rule, and a crash is
//!      exactly the moment a user is least able to consent.
//!
//! Redaction is deliberate and unit-tested: the home directory becomes `$HOME`,
//! anything that looks like a bearer token, API key or the engine's 48-hex
//! pairing token becomes `[redacted]`.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// The shell keeps its own log bounded: 256 KB is a few thousand lines, enough
/// to reconstruct a session, small enough that a report can carry it.
pub const SHELL_LOG_MAX_BYTES: u64 = 256 * 1024;
/// How much of any log file a report carries.
pub const REPORT_TAIL_BYTES: u64 = 100 * 1024;

/// `XR_HOME` when set (the engine honours the same variable), else `$HOME/.xr`.
/// Honouring the variable is what lets tests and CI run hermetically.
pub fn xr_home() -> PathBuf {
    if let Some(dir) = std::env::var_os("XR_HOME") {
        return PathBuf::from(dir);
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".xr")
}

pub fn flag_path(home: &Path) -> PathBuf {
    home.join("crash-dirty.json")
}

pub fn shell_log_path(home: &Path) -> PathBuf {
    home.join("logs").join("shell.log")
}

pub fn engine_log_dir(home: &Path) -> PathBuf {
    home.join("logs")
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ─── The flag ───────────────────────────────────────────────────────────────

/// What a previous, interrupted run left behind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirtyFlag {
    /// PID of the shell that wrote it (informational; never trusted for liveness).
    pub pid: u32,
    /// ms since epoch when that shell started.
    pub started_at: u64,
    /// Shell version, so a report is meaningful across releases.
    pub version: String,
    /// Whether the *previous* run before this one had already been flagged as
    /// interrupted. Two in a row is a crash loop, and the recovery screen says
    /// so in those words instead of showing the same calm copy again.
    pub consecutive_interruptions: u32,
    /// Set when the engine sidecar of the interrupted run failed to spawn
    /// (the recovery screen offers "start without the local engine" then).
    #[serde(default)]
    pub engine_spawn_failed: bool,
}

/// What the frontend needs to decide whether to show the recovery screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashState {
    /// True when the previous run ended without clearing the flag.
    pub interrupted: bool,
    /// The flag's contents when it exists.
    pub previous: Option<DirtyFlag>,
    /// True when the interrupted run's engine never came up.
    pub engine_spawn_failed: bool,
    /// Whether a report can be assembled (any evidence file exists).
    pub report_available: bool,
}

/// Read the flag. A malformed file is still an interruption — it is proof that
/// something wrote to the marker and did not finish, and "I could not parse it"
/// is not a reason to hide a crash from the user.
pub fn read_flag(home: &Path) -> Option<DirtyFlag> {
    let raw = fs::read_to_string(flag_path(home)).ok()?;
    match serde_json::from_str::<DirtyFlag>(&raw) {
        Ok(flag) => Some(flag),
        Err(_) => Some(DirtyFlag {
            pid: 0,
            started_at: 0,
            version: "unknown".into(),
            consecutive_interruptions: 1,
            engine_spawn_failed: false,
        }),
    }
}

/// Write the flag. Returns the record written so callers can log it.
pub fn write_flag(home: &Path, version: &str, consecutive: u32, engine_spawn_failed: bool) -> std::io::Result<DirtyFlag> {
    let flag = DirtyFlag {
        pid: std::process::id(),
        started_at: now_ms(),
        version: version.to_string(),
        consecutive_interruptions: consecutive,
        engine_spawn_failed,
    };
    fs::create_dir_all(home)?;
    let body = serde_json::to_string_pretty(&flag).unwrap_or_else(|_| "{}".into());
    fs::write(flag_path(home), format!("{body}\n"))?;
    Ok(flag)
}

/// Clear the flag: only ever called from the clean-exit path, after the engine
/// has been stopped (see `lib.rs`). Returns whether a file was removed.
pub fn clear_flag(home: &Path) -> bool {
    fs::remove_file(flag_path(home)).is_ok()
}

/// Evaluate the flag at startup. `engine_spawn_failed` is the *current* run's
/// spawn result (used only for the report, not for the interruption verdict).
pub fn state_at_startup(home: &Path) -> CrashState {
    let previous = read_flag(home);
    let interrupted = previous.is_some();
    CrashState {
        interrupted,
        engine_spawn_failed: previous.as_ref().is_some_and(|p| p.engine_spawn_failed),
        report_available: interrupted
            && (shell_log_path(home).exists() || !log_files(home).is_empty()),
        previous,
    }
}

// ─── The shell's bounded log ────────────────────────────────────────────────

/// Append one line to the shell log, rotating first when the file has grown
/// past [`SHELL_LOG_MAX_BYTES`]. Best-effort: a log failure is never allowed to
/// take the app down, so every error is swallowed after the rotation attempt.
pub fn log_shell(home: &Path, line: &str) {
    let path = shell_log_path(home);
    if let Some(dir) = path.parent() {
        if fs::create_dir_all(dir).is_err() {
            return;
        }
    }
    // Headroom is the incoming line, so the cap is never exceeded even
    // momentarily: the check happens before the append, not after it.
    let needed = line.len() as u64 + 32;
    rotate_if_needed(&path, needed);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "[{}] {line}", now_ms());
    }
}

/// Keep `path` under [`SHELL_LOG_MAX_BYTES`] by keeping its newest half (a
/// copy-truncate: the oldest evidence goes, the newest stays, and a
/// half-written line can never be read back as a real one because the cut is
/// made at a line boundary).
fn rotate_if_needed(path: &Path, incoming: u64) {
    let Ok(meta) = fs::metadata(path) else { return };
    if meta.len() + incoming <= SHELL_LOG_MAX_BYTES {
        return;
    }
    let Ok(body) = fs::read_to_string(path) else { return };
    let keep_from = body.len().saturating_sub((SHELL_LOG_MAX_BYTES / 2) as usize);
    let tail = match body[keep_from..].find('\n') {
        Some(idx) => &body[keep_from + idx + 1..],
        None => "",
    };
    let _ = fs::write(path, tail);
}

/// Log files in the engine's log directory, newest first (name-sorted, which is
/// how the engine names them: date-then-time).
pub fn log_files(home: &Path) -> Vec<PathBuf> {
    let dir = engine_log_dir(home);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|e| e == "log"))
        // The shell's own log is reported separately, so it must not be
        // counted twice here.
        // (map_or, not is_none_or: MSRV is 1.77)
        .filter(|p| p.file_name().map_or(true, |n| n != "shell.log"))
        .collect();
    files.sort();
    files.reverse();
    files
}

/// The last [`REPORT_TAIL_BYTES`] of a file, as lossy UTF-8, cut at a line
/// boundary when one exists in the window.
pub fn read_tail(path: &Path, limit: u64) -> Option<String> {
    fs::metadata(path).ok()?;
    let bytes = fs::read(path).ok()?;
    let start = bytes.len().saturating_sub(limit as usize);
    let window = &bytes[start..];
    let text = String::from_utf8_lossy(window).to_string();
    Some(match (start == 0, text.find('\n')) {
        (true, _) => text,
        // Mid-file window: drop the partial first line.
        (false, Some(idx)) => text[idx + 1..].to_string(),
        (false, None) => text,
    })
}

// ─── Redaction ──────────────────────────────────────────────────────────────

const REDACTED: &str = "[redacted]";

/// Redact a user's home path down to `$HOME`, and any credential-shaped value.
///
/// Deliberately conservative — a false positive costs a reader one line of
/// diagnostic detail, a false negative mails a token to a bug tracker.
pub fn redact(text: &str, home: &Path) -> String {
    let mut out = text.to_string();

    // 1. The home directory, and the XR data dir inside it.
    if let Some(home_str) = home.parent().map(|p| p.display().to_string()) {
        if !home_str.is_empty() && home_str != "/" {
            out = out.replace(&home_str, "$HOME");
        }
    }

    // 2. Credential shapes. Order matters: the longer, more specific forms
    //    first, so a 48-hex engine token is not half-matched by the hex rule.
    out = redact_after(&out, "Bearer ");
    for key in ["token", "api_key", "apiKey", "apikey", "secret", "password", "access_token"] {
        out = redact_after(&out, &format!("{key}="));
        out = redact_after(&out, &format!("{key}: "));
        out = redact_after(&out, &format!("\"{key}\": \""));
    }
    out = redact_prefixed(&out, "sk-");
    out = redact_prefixed(&out, "ghp_");
    out = redact_prefixed(&out, "gho_");
    out = redact_prefixed(&out, "github_pat_");
    out = redact_prefixed(&out, "xai-");
    out = redact_prefixed(&out, "AKIA");
    out = redact_long_hex(&out);

    out
}

/// Replace the run of non-space characters that follows `marker`.
fn redact_after(text: &str, marker: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(idx) = rest.find(marker) {
        out.push_str(&rest[..idx + marker.len()]);
        rest = &rest[idx + marker.len()..];
        let end = rest
            .find(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == ',' || c == ')')
            .unwrap_or(rest.len());
        if end > 0 {
            out.push_str(REDACTED);
            rest = &rest[end..];
        }
    }
    out.push_str(rest);
    out
}

/// Replace a whole token that begins with a known credential prefix.
fn redact_prefixed(text: &str, prefix: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(idx) = rest.find(prefix) {
        out.push_str(&rest[..idx]);
        let after = &rest[idx + prefix.len()..];
        let end = after
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.'))
            .unwrap_or(after.len());
        // Only treat it as a credential when there is real entropy after the
        // prefix — `sk-` alone in prose is not a secret.
        if end >= 12 {
            out.push_str(REDACTED);
        } else {
            out.push_str(prefix);
        }
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

/// Replace any hex run of 32+ characters (engine pairing tokens are 48 hex).
fn redact_long_hex(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut run_start: Option<usize> = None;
    for (i, c) in text.char_indices() {
        if c.is_ascii_hexdigit() {
            if run_start.is_none() {
                run_start = Some(i);
            }
        } else {
            if let Some(start) = run_start.take() {
                push_hex_run(&mut out, &text[start..i]);
            }
            out.push(c);
        }
    }
    if let Some(start) = run_start {
        push_hex_run(&mut out, &text[start..]);
    }
    out
}

fn push_hex_run(out: &mut String, run: &str) {
    if run.len() >= 32 {
        out.push_str(REDACTED);
    } else {
        out.push_str(run);
    }
}

// ─── The report ─────────────────────────────────────────────────────────────

/// One assembled, redacted crash report — the text the user is about to
/// inspect and mail. Nothing here leaves the machine by itself.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    pub subject: String,
    pub body: String,
    /// Every file that contributed, so "what data is in the report?" has an
    /// answer that is not a promise.
    pub included: Vec<String>,
    pub bytes: usize,
}

/// Assemble the report. `engine_stderr` is the *current* session's tail when
/// there is one (the interrupted run's tail is gone with its process, which is
/// why the shell log and the engine's own log files matter).
pub fn build_report(
    home: &Path,
    state: &CrashState,
    version: &str,
    engine_stderr: &[String],
    generated_at: u64,
) -> CrashReport {
    let mut included = Vec::new();
    let mut body = String::new();

    body.push_str("XR crash report (assembled locally, sent only if you send it)\n");
    body.push_str("============================================================\n\n");
    body.push_str(&format!("XR Desktop: {version}\n"));
    body.push_str(&format!("Platform: {} {}\n", std::env::consts::OS, std::env::consts::ARCH));
    body.push_str(&format!("Generated: {generated_at}ms since epoch\n"));
    body.push_str(&format!("XR home: {}\n\n", home.display()));

    // 1. The flag — the reason this screen exists.
    match &state.previous {
        Some(flag) => {
            body.push_str("-- interrupted run -----------------------------------------\n");
            body.push_str(&format!(
                "shell pid: {}  started: {}  version: {}\n",
                flag.pid, flag.started_at, flag.version
            ));
            body.push_str(&format!(
                "consecutive interruptions: {}\nengine spawn failed: {}\n\n",
                flag.consecutive_interruptions, flag.engine_spawn_failed
            ));
        }
        None => body.push_str("-- interrupted run -- (no flag present)\n\n"),
    }

    // 2. The shell log tail.
    let shell_log = shell_log_path(home);
    if let Some(tail) = read_tail(&shell_log, REPORT_TAIL_BYTES) {
        body.push_str("-- shell log (tail) ---------------------------------------\n");
        body.push_str(&tail);
        if !tail.ends_with('\n') {
            body.push('\n');
        }
        body.push('\n');
        included.push(shell_log.display().to_string());
    }

    // 3. Engine log files (newest first), bounded per file.
    for path in log_files(home).into_iter().take(3) {
        if let Some(tail) = read_tail(&path, REPORT_TAIL_BYTES) {
            body.push_str(&format!("-- {} (tail) --\n", path.display()));
            body.push_str(&tail);
            if !tail.ends_with('\n') {
                body.push('\n');
            }
            body.push('\n');
            included.push(path.display().to_string());
        }
    }

    // 4. The live stderr tail, when the engine is up in this session.
    if !engine_stderr.is_empty() {
        body.push_str("-- engine stderr (this session, tail) ----------------------\n");
        for line in engine_stderr {
            body.push_str(line);
            body.push('\n');
        }
        body.push('\n');
        included.push("engine stderr (in memory)".to_string());
    }

    body.push_str("-- end -----------------------------------------------------\n");

    let body = redact(&body, home);
    let subject = format!(
        "XR crash report — {} {} (v{})",
        std::env::consts::OS,
        std::env::consts::ARCH,
        version
    );
    CrashReport {
        subject,
        bytes: body.len(),
        body,
        included,
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_home(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("xr-p27-crash-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn flag_lifecycle_is_write_read_clear() {
        let home = temp_home("flag");
        let xr = home.join(".xr");

        assert!(read_flag(&xr).is_none(), "clean state has no flag");
        assert!(!state_at_startup(&xr).interrupted);

        let written = write_flag(&xr, "0.2.0", 1, false).unwrap();
        assert_eq!(written.pid, std::process::id());
        assert_eq!(written.consecutive_interruptions, 1);

        let state = state_at_startup(&xr);
        assert!(state.interrupted, "a present flag means the last run did not finish");
        assert_eq!(state.previous.unwrap().version, "0.2.0");

        assert!(clear_flag(&xr), "clearing reports success");
        assert!(!state_at_startup(&xr).interrupted);
        assert!(!clear_flag(&xr), "clearing twice is a no-op, not an error");
    }

    #[test]
    fn a_malformed_flag_still_counts_as_an_interruption() {
        let home = temp_home("malformed").join(".xr");
        fs::create_dir_all(&home).unwrap();
        fs::write(flag_path(&home), "{ this is not json").unwrap();

        let state = state_at_startup(&home);
        assert!(state.interrupted, "we do not hide a crash because the marker is unreadable");
        assert_eq!(state.previous.unwrap().version, "unknown");
    }

    #[test]
    fn shell_log_rotates_and_keeps_the_newest_lines() {
        let home = temp_home("rotate").join(".xr");
        // Write just over the cap in many small lines.
        for i in 0..4000 {
            log_shell(&home, &format!("line-{i:05} padding padding padding padding padding padding"));
        }
        let size = fs::metadata(shell_log_path(&home)).unwrap().len();
        assert!(size <= SHELL_LOG_MAX_BYTES, "log stays under the cap (got {size})");

        let body = fs::read_to_string(shell_log_path(&home)).unwrap();
        assert!(body.contains("line-03999"), "the newest line survived");
        assert!(!body.contains("line-00000"), "the oldest line was dropped");
        // Rotation cuts at a line boundary, never mid-line.
        assert!(body.starts_with('['), "the kept text starts on a whole line");
    }

    #[test]
    fn read_tail_drops_the_partial_first_line() {
        let home = temp_home("tail");
        let path = home.join("big.log");
        fs::write(&path, "first line\nsecond line\nthird line\n").unwrap();

        // Whole file: returned verbatim.
        assert_eq!(read_tail(&path, 10_000).unwrap(), "first line\nsecond line\nthird line\n");
        // Mid-file window: the cut line is not returned half-formed.
        let tail = read_tail(&path, 18).unwrap();
        assert!(!tail.contains("second li"), "no partial line (got {tail:?})");
        assert!(tail.ends_with("third line\n"));
    }

    #[test]
    fn redaction_removes_paths_and_credentials_but_keeps_diagnostics() {
        let home = PathBuf::from("/home/ana/.xr");
        let token = "a".repeat(48);
        let text = format!(
            "engine at {}/logs/engine.log\n\
             listening on http://127.0.0.1:51234\n\
             Authorization: Bearer {token}\n\
             token={token}\n\
             api_key: sk-live-abcdefghijklmnop\n\
             {{\"token\": \"{token}\"}}\n\
             ghp_abcdefghijklmnopqrst\n\
             plain word: not-a-secret\n",
            home.display()
        );

        let out = redact(&text, &home);
        assert!(out.contains("$HOME/.xr/logs/engine.log"), "home becomes $HOME");
        assert!(!out.contains(&token), "the 48-hex engine token is gone");
        assert!(!out.contains("sk-live-abcdefghijklmnop"), "prefix keys are gone");
        assert!(!out.contains("ghp_abcdefghijklmnopqrst"), "github tokens are gone");
        // Diagnostics survive: ports, messages and ordinary words are not secrets.
        assert!(out.contains("127.0.0.1:51234"));
        assert!(out.contains("not-a-secret"));
        assert!(out.contains("Bearer [redacted]"));
        assert!(out.matches(REDACTED).count() >= 4, "each credential shape was caught");
    }

    #[test]
    fn short_hex_runs_are_not_credentials() {
        // Commit-ish short hashes and ids stay readable: over-redaction makes
        // reports useless, and 32+ is the token threshold.
        let out = redact("commit 9fbfeb3 sha 1234567890abcdef", Path::new("/home/ana/.xr"));
        assert!(out.contains("9fbfeb3"));
        assert!(out.contains("1234567890abcdef"));
    }

    #[test]
    fn report_contains_the_flag_evidences_and_no_secrets() {
        let home = temp_home("report").join(".xr");
        let token = "b".repeat(48);
        write_flag(&home, "0.2.0", 2, true).unwrap();
        log_shell(&home, &format!("sidecar spawned, token={token}"));
        fs::create_dir_all(engine_log_dir(&home)).unwrap();
        fs::write(
            engine_log_dir(&home).join("2026-10-12.log"),
            "engine started\nengine refused: missing provider key\n",
        )
        .unwrap();

        let state = state_at_startup(&home);
        let report = build_report(
            &home,
            &state,
            "0.2.0",
            &["stderr: engine exited with code 3".to_string()],
            1_700_000_000_000,
        );

        assert!(report.subject.contains("0.2.0"));
        assert!(report.body.contains("consecutive interruptions: 2"));
        assert!(report.body.contains("engine spawn failed: true"));
        assert!(report.body.contains("engine refused: missing provider key"));
        assert!(report.body.contains("stderr: engine exited with code 3"));
        assert!(!report.body.contains(&token), "the log line's token is redacted");
        assert!(report.bytes > 200);
        assert_eq!(report.body.len(), report.bytes);
        assert!(
            report.included.iter().any(|p| p.contains("shell.log")),
            "the report names its sources"
        );
    }
}
