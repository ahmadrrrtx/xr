//! Shell-side engine state: banner parsing, the sidecar's stderr tail, and the
//! cached reachability probe (Phase 1 · W-5/W-6).
//!
//! Deliberately free of Tauri, of the OS, and of the network, so it can be
//! compiled AND executed on any target — including a Windows cross-target — by
//! `rustc --test`. The Tauri commands in `lib.rs` are thin wrappers over this;
//! everything with a decision in it lives here where it can be tested.

use std::collections::HashMap;
use std::time::{Duration, Instant};

/// How many stderr lines to retain from the sidecar.
pub const STDERR_TAIL_LINES: usize = 40;
/// The reachability answer is reused for this long before a real connect.
pub const PROBE_TTL: Duration = Duration::from_millis(1_500);
/// The engine's token is 48 hex characters; accept anything credible.
const MIN_TOKEN_LEN: usize = 32;

/// A fact read off the daemon's own startup banner.
#[derive(Debug, PartialEq, Eq)]
pub enum Banner {
    /// `✓ Listening on  http://127.0.0.1:<port>` — the REAL bound port
    /// (the sidecar is asked for port 0, so the banner is the only source).
    Port(u16),
    /// `Token: <48 hex>`.
    Token(String),
}

/// Parse one line of daemon stdout.
///
/// The strictness is the point: the dashboard/chat lines carry a `?token=…`
/// query string, so a lenient "find a port anywhere" parse would read those
/// too. Returning `None` for them is what keeps the port honest.
pub fn parse_banner_line(line: &str) -> Option<Banner> {
    if let Some(idx) = line.find("http://127.0.0.1:") {
        let tail = &line[idx + "http://127.0.0.1:".len()..];
        if let Ok(port) = tail.trim().parse::<u16>() {
            return Some(Banner::Port(port));
        }
    }
    if let Some(idx) = line.find("Token: ") {
        let token = line[idx + "Token: ".len()..].trim();
        if token.len() >= MIN_TOKEN_LEN && token.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(Banner::Token(token.to_string()));
        }
    }
    None
}

/// A bounded ring of the sidecar's stderr.
///
/// W-5: the shell used to spawn the engine with `Stdio::null()`, so every
/// diagnostic the daemon printed while refusing to start — the *only* place the
/// engine explains itself — was discarded. A window that shows "engine
/// unreachable" with no reason is the observable symptom.
#[derive(Debug)]
pub struct StderrTail {
    lines: Vec<String>,
    max: usize,
}

impl Default for StderrTail {
    fn default() -> Self {
        Self::new(STDERR_TAIL_LINES)
    }
}

impl StderrTail {
    pub fn new(max: usize) -> Self {
        Self {
            lines: Vec::new(),
            max: max.max(1),
        }
    }

    /// Append, dropping the oldest line past the cap. Never grows unbounded:
    /// a chatty engine must not become a memory leak in the shell.
    pub fn push(&mut self, line: String) {
        self.lines.push(line);
        let len = self.lines.len();
        if len > self.max {
            self.lines.drain(0..len - self.max);
        }
    }

    /// The newest `n` lines, oldest first.
    pub fn last(&self, n: usize) -> Vec<String> {
        let start = self.lines.len().saturating_sub(n);
        self.lines[start..].to_vec()
    }

    pub fn len(&self) -> usize {
        self.lines.len()
    }

    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }
}

/// Short-lived cache for "is the engine listening on this port?".
///
/// W-6: each probe is a blocking `TcpStream::connect_timeout(…400ms)`, and the
/// shell asks up to three times per `engine_link` call — a frozen webview IPC
/// handler for over a second when nothing is listening, on the exact screen
/// that is trying to tell the user the engine is down. Time is injected so the
/// expiry rule is testable without sleeping.
#[derive(Debug)]
pub struct ProbeCache {
    ttl: Duration,
    entries: HashMap<u16, (bool, Instant)>,
}

impl Default for ProbeCache {
    fn default() -> Self {
        Self::new(PROBE_TTL)
    }
}

impl ProbeCache {
    pub fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            entries: HashMap::new(),
        }
    }

    pub fn get_at(&self, port: u16, now: Instant) -> Option<bool> {
        self.entries
            .get(&port)
            .filter(|(_, at)| now.saturating_duration_since(*at) < self.ttl)
            .map(|(ok, _)| *ok)
    }

    pub fn put_at(&mut self, port: u16, ok: bool, at: Instant) {
        self.entries.insert(port, (ok, at));
    }

    pub fn get(&self, port: u16) -> Option<bool> {
        self.get_at(port, Instant::now())
    }

    pub fn put(&mut self, port: u16, ok: bool) {
        self.put_at(port, ok, Instant::now());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn banner_port_is_read_from_the_real_line_and_not_from_the_dashboard_url() {
        // Copied verbatim from a running daemon's startup output.
        assert_eq!(
            parse_banner_line("  ✓ Listening on  http://127.0.0.1:3141"),
            Some(Banner::Port(3141))
        );
        // The dashboard/chat lines carry `?token=…`, so they must NOT parse: a
        // lenient parser would read a port out of a line that is not the bind
        // announcement, and the shell would then probe the wrong number.
        assert_eq!(
            parse_banner_line("  ✓ Dashboard     http://127.0.0.1:3141/?token=deadbeef"),
            None
        );
        assert_eq!(
            parse_banner_line("  ✓ Chat          http://127.0.0.1:3141/chat?token=deadbeef"),
            None
        );
        assert_eq!(parse_banner_line("no address here"), None);
    }

    #[test]
    fn token_is_only_accepted_when_it_looks_like_one() {
        let real = "  Token: 14fed849ad8dc3eb0dc0dd75f60d0c43299923d57266e1df";
        assert_eq!(
            parse_banner_line(real),
            Some(Banner::Token(
                "14fed849ad8dc3eb0dc0dd75f60d0c43299923d57266e1df".into()
            ))
        );
        assert_eq!(parse_banner_line("  Token: short"), None);
        assert_eq!(
            parse_banner_line("  Token: zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"),
            None
        );
    }

    #[test]
    fn a_later_log_line_naming_another_local_port_cannot_hijack_the_engine_port() {
        // This is WHY the port parse demands a bare number after the prefix
        // instead of taking the leading digits. The daemon logs provider
        // health to the same stream, and a lenient parser would read a
        // provider's address as the engine's own:
        //
        //     http://127.0.0.1:11434/api/tags        ← Ollama, not the engine
        //
        // The shell would then probe the wrong port forever.
        assert_eq!(
            parse_banner_line("[ollama] health probe http://127.0.0.1:11434/api/tags"),
            None
        );
        assert_eq!(
            parse_banner_line("provider lmstudio at http://127.0.0.1:1234/v1/models"),
            None
        );
    }

    #[test]
    fn when_one_line_carries_both_facts_the_token_is_kept_and_the_port_is_not_guessed() {
        // A synthetic line (the real daemon prints these separately). The
        // strict parse yields the token and declines to guess a port from a
        // tail that is not a bare number — the conservative half of the pair,
        // since a wrong port is worse than a missing one.
        let line = "  ✓ Listening on  http://127.0.0.1:52341  Token: 14fed849ad8dc3eb0dc0dd75f60d0c43299923d57266e1df";
        assert_eq!(
            parse_banner_line(line),
            Some(Banner::Token(
                "14fed849ad8dc3eb0dc0dd75f60d0c43299923d57266e1df".into()
            ))
        );
    }

    #[test]
    fn stderr_tail_is_bounded_and_keeps_the_newest_lines_in_order() {
        let mut tail = StderrTail::new(3);
        for i in 1..=5 {
            tail.push(format!("line {i}"));
        }
        assert_eq!(tail.len(), 3, "the buffer must not grow past its cap");
        assert_eq!(tail.last(3), vec!["line 3", "line 4", "line 5"]);
        assert_eq!(tail.last(2), vec!["line 4", "line 5"]);
        assert_eq!(tail.last(99), vec!["line 3", "line 4", "line 5"]);
        assert!(StderrTail::new(10).is_empty());
        // A cap of 0 is meaningless; it is clamped to 1 rather than thrashing.
        let mut one = StderrTail::new(0);
        one.push("a".into());
        one.push("b".into());
        assert_eq!(one.last(5), vec!["b"]);
    }

    #[test]
    fn probe_cache_serves_the_cached_answer_then_expires() {
        let ttl = Duration::from_millis(1_500);
        let mut cache = ProbeCache::new(ttl);
        let t0 = Instant::now();

        assert_eq!(cache.get_at(3141, t0), None, "nothing cached yet");

        cache.put_at(3141, false, t0);
        assert_eq!(cache.get_at(3141, t0), Some(false));
        assert_eq!(
            cache.get_at(3141, t0 + ttl - Duration::from_millis(1)),
            Some(false)
        );

        // At the TTL the answer is stale — the shell must probe again rather
        // than report a dead engine as permanently dead.
        assert_eq!(cache.get_at(3141, t0 + ttl), None);

        cache.put_at(3141, true, t0 + ttl);
        assert_eq!(cache.get_at(3141, t0 + ttl), Some(true));
    }

    #[test]
    fn defaults_carry_the_documented_limits() {
        // `#[derive(Default)]` on the Tauri state struct would silently give a
        // 0-line tail and a 0ms TTL; these are the numbers the shell relies on.
        let mut tail = StderrTail::default();
        for i in 0..(STDERR_TAIL_LINES + 5) {
            tail.push(format!("{i}"));
        }
        assert_eq!(tail.len(), STDERR_TAIL_LINES);
        assert_eq!(tail.last(1)[0], format!("{}", STDERR_TAIL_LINES + 4));

        let cache = ProbeCache::default();
        assert_eq!(cache.ttl, PROBE_TTL);
    }

    #[test]
    fn probe_cache_is_per_port() {
        let mut cache = ProbeCache::new(Duration::from_millis(1_500));
        let t0 = Instant::now();
        cache.put_at(3141, true, t0);
        assert_eq!(cache.get_at(3141, t0), Some(true));
        assert_eq!(
            cache.get_at(3142, t0),
            None,
            "a different port is a different question"
        );
    }

    #[test]
    fn a_clock_that_goes_backwards_does_not_extend_the_ttl_forever() {
        // `saturating_duration_since` is used precisely so a non-monotonic
        // reading cannot turn a stale cache entry into a permanent one.
        let mut cache = ProbeCache::new(Duration::from_millis(1_500));
        let t0 = Instant::now();
        cache.put_at(3141, true, t0 + Duration::from_secs(60));
        assert_eq!(cache.get_at(3141, t0), Some(true));
    }
}
