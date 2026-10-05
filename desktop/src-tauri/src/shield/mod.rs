/*
 * XR Shield — host side of the Trust Center (Phase 12, SCREEN 8).
 *
 * What is real here:
 *   - `shield_audit`: an append-only SQLite table (UPDATE/DELETE raise) in the
 *     shared xr.db. Every row carries `prev_hash` + `hash` (SHA-256 of a
 *     canonical JSON array — byte-identical to src/shield/core.ts), so the
 *     webview and the shell agree on every digest. Signatures are planned
 *     (Ed25519 checkpoints, ADR 0027); `signature` is always null and the UI
 *     never says "signed".
 *   - `run_health_check`: five host checks that actually run (audit db,
 *     keychain, chain verification, settings/data dir, version match). The
 *     webview adds the four it owns (approval queue, egress proxy, biometric,
 *     PII redaction). A failing critical check → "compromised".
 *   - `revoke_all`: flips the persisted pause flag and broadcasts
 *     `shield:emergency-revoke` to every webview so other windows close their
 *     gate too. The webview denies its queue and stops its runs itself.
 *
 * State (policy, pause flag, quarantine list, last checks) lives in
 * `shield.json` via the store plugin — the same pattern as approvals.rs.
 *
 * Seed: on an empty table the 204-entry deterministic history from
 * src/shield/seed.ts is inserted (same PRNG, same tables), so a fresh native
 * install and the browser preview show the same log.
 */
use std::sync::{Arc, Mutex};
use std::time::Instant;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_store::{Store, StoreBuilder};

pub const EMERGENCY_REVOKE_EVENT: &str = "shield:emergency-revoke";
pub const RESUMED_EVENT: &str = "shield:resumed";

const STORE_FILE: &str = "shield.json";
const KEY_POLICY: &str = "policy";
const KEY_PAUSED: &str = "paused";
const KEY_QUARANTINE: &str = "quarantine";
const KEY_CHECKS: &str = "checks";

const DECISIONS: [&str; 6] = [
    "allowed",
    "denied",
    "auto-approved",
    "quarantined",
    "blocked",
    "error",
];
const RISKS: [&str; 3] = ["low", "medium", "high"];

// ─── Wire types (camelCase, mirror src/shield/types.ts) ───────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: String,
    pub ts: i64,
    pub actor: String,
    pub skill: Option<String>,
    pub action: String,
    pub resource: Option<String>,
    pub decision: String,
    pub rule_id: Option<String>,
    pub risk: String,
    pub cost_usd: Option<f64>,
    /// Always `None` in Phase 12 — Ed25519 checkpoint signatures are planned.
    pub signature: Option<String>,
    pub prev_hash: Option<String>,
    pub hash: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditInput {
    #[serde(default)]
    pub ts: Option<i64>,
    pub actor: String,
    #[serde(default)]
    pub skill: Option<String>,
    pub action: String,
    #[serde(default)]
    pub resource: Option<String>,
    pub decision: String,
    #[serde(default)]
    pub rule_id: Option<String>,
    pub risk: String,
    #[serde(default)]
    pub cost_usd: Option<f64>,
    #[serde(default)]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditPage {
    pub entries: Vec<AuditEntry>,
    pub next_cursor: Option<String>,
    pub total: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainVerification {
    pub valid: bool,
    pub checked: usize,
    pub broken_at: Option<usize>,
    pub detail: String,
    pub verified_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheck {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: String,
    pub critical: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityPolicy {
    pub egress_proxy: bool,
    pub auto_approve_low_risk: bool,
    pub constitution_strictness: String,
    pub quarantine_new_skills: bool,
    pub biometric_approval: bool,
    pub allow_shell_exec: bool,
    pub pii_redaction: bool,
    pub data_sharing: bool,
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    #[serde(default)]
    pub blocked_domains: Vec<String>,
    /// Read-only: no OS biometric prompt is wired in this build.
    #[serde(default)]
    pub biometric_supported: bool,
}

impl Default for SecurityPolicy {
    fn default() -> Self {
        SecurityPolicy {
            egress_proxy: true,
            auto_approve_low_risk: true,
            constitution_strictness: "balanced".into(),
            quarantine_new_skills: true,
            biometric_approval: false,
            allow_shell_exec: false,
            pii_redaction: true,
            data_sharing: false,
            allowed_domains: Vec::new(),
            blocked_domains: Vec::new(),
            biometric_supported: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuarantinedSkill {
    pub id: String,
    pub name: String,
    pub version: String,
    pub source: String,
    pub reason: String,
    pub quarantined_at: i64,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShieldPersisted {
    pub policy: SecurityPolicy,
    pub paused: bool,
    pub quarantine: Vec<QuarantinedSkill>,
    pub last_checked_at: Option<i64>,
    pub last_checks: Vec<HealthCheck>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedChecks {
    at: i64,
    checks: Vec<HealthCheck>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmergencyRevoke {
    pub pending_denied: u32,
    pub runs_stopped: u32,
    pub at: i64,
}

// ─── Hashing / canonical form ─────────────────────────────────────────────

fn hex(bytes: &[u8]) -> String {
    const TABLE: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(TABLE[(b >> 4) as usize] as char);
        out.push(TABLE[(b & 0x0f) as usize] as char);
    }
    out
}

pub fn sha256_hex(input: &str) -> String {
    let mut h = Sha256::new();
    h.update(input.as_bytes());
    hex(&h.finalize())
}

fn canonical_cost(cost: Option<f64>) -> String {
    match cost {
        Some(c) if c.is_finite() => format!("{c:.6}"),
        _ => String::new(),
    }
}

/// Field order is the contract (see `canonicalAuditString` in core.ts).
/// serde_json and JSON.stringify escape strings identically, so the bytes
/// — and therefore the digests — match across the two implementations.
pub fn canonical_of(e: &AuditEntry) -> String {
    let ts = e.ts.to_string();
    let cost = canonical_cost(e.cost_usd);
    let fields: [&str; 12] = [
        &e.id,
        &ts,
        &e.actor,
        e.skill.as_deref().unwrap_or(""),
        &e.action,
        e.resource.as_deref().unwrap_or(""),
        &e.decision,
        e.rule_id.as_deref().unwrap_or(""),
        &e.risk,
        &cost,
        e.prev_hash.as_deref().unwrap_or(""),
        e.detail.as_deref().unwrap_or(""),
    ];
    serde_json::to_string(&fields).expect("array of strings always serialises")
}

/// Walk `entries` in chain order (oldest first); fail closed on any mismatch.
pub fn verify_chain(entries: &[AuditEntry], now: i64) -> ChainVerification {
    let mut prev: Option<&str> = None;
    for (i, e) in entries.iter().enumerate() {
        if e.prev_hash.as_deref() != prev {
            return ChainVerification {
                valid: false,
                checked: i,
                broken_at: Some(i),
                detail: format!(
                    "Link {} of {} does not point at its predecessor.",
                    i + 1,
                    entries.len()
                ),
                verified_at: now,
            };
        }
        if sha256_hex(&canonical_of(e)) != e.hash {
            return ChainVerification {
                valid: false,
                checked: i,
                broken_at: Some(i),
                detail: format!("Entry {} does not match its recorded hash.", e.id),
                verified_at: now,
            };
        }
        prev = Some(e.hash.as_str());
    }
    ChainVerification {
        valid: true,
        checked: entries.len(),
        broken_at: None,
        detail: if entries.is_empty() {
            "No entries yet — nothing to verify.".to_string()
        } else {
            format!(
                "{} entries hash-chained and intact (Ed25519 signatures planned).",
                entries.len()
            )
        },
        verified_at: now,
    }
}

/// Build the next link for `input` on top of `tail` (None = genesis).
fn chain_entry(id: String, input: SeedInput, tail: Option<&str>) -> AuditEntry {
    let mut entry = AuditEntry {
        id,
        ts: input.ts,
        actor: input.actor,
        skill: input.skill,
        action: input.action,
        resource: input.resource,
        decision: input.decision,
        rule_id: input.rule_id,
        risk: input.risk,
        cost_usd: input.cost_usd,
        signature: None,
        prev_hash: tail.map(|s| s.to_string()),
        hash: String::new(),
        detail: input.detail,
    };
    entry.hash = sha256_hex(&canonical_of(&entry));
    entry
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn new_audit_id() -> String {
    let u = uuid::Uuid::new_v4().simple().to_string();
    format!("aud_{}", &u[..12])
}

// ─── Deterministic seed (port of src/shield/seed.ts) ──────────────────────

pub const SEED_COUNT: usize = 200;
const SEED: u32 = 0x5a1e1d;
const DAY: i64 = 24 * 60 * 60 * 1000;

/// mulberry32 — bit-for-bit the JS generator (all ops mod 2^32).
pub struct Mulberry32(u32);

impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Mulberry32(seed)
    }
    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }
    /// `list[Math.floor(rnd() * list.length)]`
    fn index(&mut self, len: usize) -> usize {
        (self.next_f64() * len as f64).floor() as usize
    }
    fn pick_agent(&mut self) -> String {
        AGENTS[self.index(AGENTS.len())].to_string()
    }
}

struct ActionDef {
    skill: &'static str,
    action: &'static str,
    resources: &'static [Option<&'static str>],
    risk: &'static str,
    cost: bool,
}

const ACTIONS: &[ActionDef] = &[
    ActionDef { skill: "fs-skill", action: "Read a file", resources: &[Some("~/notes/standup.md"), Some("~/projects/xr/README.md"), Some("~/Downloads/invoice-0423.pdf"), Some("~/.config/xr/settings.json")], risk: "low", cost: false },
    ActionDef { skill: "fs-skill", action: "List a directory", resources: &[Some("~/projects"), Some("~/Documents/contracts")], risk: "low", cost: false },
    ActionDef { skill: "fs-skill", action: "Write a file", resources: &[Some("~/notes/standup.md"), Some("~/projects/xr/CHANGELOG.md"), Some("~/Desktop/summary.txt")], risk: "medium", cost: false },
    ActionDef { skill: "fs-skill", action: "Delete a folder", resources: &[Some("~/projects/old-build"), Some("~/tmp/cache-2025")], risk: "high", cost: false },
    ActionDef { skill: "gmail-skill", action: "Read inbox", resources: &[Some("from:s•••@company.com"), Some("label:invoices")], risk: "low", cost: true },
    ActionDef { skill: "gmail-skill", action: "Send email", resources: &[Some("s•••@company.com"), Some("f•••@company.com"), Some("o•••@partner.io")], risk: "medium", cost: true },
    ActionDef { skill: "calendar-skill", action: "Read calendar", resources: &[Some("this week"), Some("tomorrow")], risk: "low", cost: false },
    ActionDef { skill: "calendar-skill", action: "Create an event", resources: &[Some("Standup · Tue 10:00"), Some("Design review · Thu 15:30")], risk: "medium", cost: false },
    ActionDef { skill: "web-skill", action: "Fetch a web page", resources: &[Some("https://docs.rs/rusqlite"), Some("https://news.ycombinator.com"), Some("https://api.github.com/repos/ahmadrrrtx/xr")], risk: "low", cost: true },
    ActionDef { skill: "github-skill", action: "Open a pull request", resources: &[Some("ahmadrrrtx/xr#153"), Some("ahmadrrrtx/xr#161")], risk: "medium", cost: true },
    ActionDef { skill: "github-skill", action: "Push to a branch", resources: &[Some("phase/11-control-room"), Some("phase/12-shield")], risk: "high", cost: false },
    ActionDef { skill: "slack-skill", action: "Post a message", resources: &[Some("#eng-updates"), Some("#design")], risk: "medium", cost: true },
    ActionDef { skill: "shell-skill", action: "Run a shell command", resources: &[None, Some("brew upgrade && brew cleanup"), Some("git status"), Some("rm -rf ~/tmp/cache-2025")], risk: "high", cost: false },
    ActionDef { skill: "figma-plugin", action: "Export frames", resources: &[Some("Onboarding v3"), Some("Shield · Status")], risk: "medium", cost: false },
    ActionDef { skill: "legacy-exec", action: "Run a script", resources: &[Some("deploy.sh"), Some("cleanup.py")], risk: "high", cost: false },
    ActionDef { skill: "unknown-skill", action: "Read contacts", resources: &[None], risk: "medium", cost: false },
];

const AGENTS: &[&str] = &[
    "agent:main",
    "agent:main",
    "agent:coder",
    "agent:research",
    "agent:writer",
];
const QUARANTINED: &[&str] = &["figma-plugin", "legacy-exec", "unknown-skill"];

/// Mock quarantine list — the three skills the brief names.
pub fn seed_quarantine(now: i64) -> Vec<QuarantinedSkill> {
    vec![
        QuarantinedSkill {
            id: "figma-plugin".into(),
            name: "figma-plugin".into(),
            version: "0.3.1".into(),
            source: "Skills Store · unsigned".into(),
            reason: "No publisher signature. Requests file export and network access.".into(),
            quarantined_at: now - 3 * DAY - 2 * 60 * 60 * 1000,
            status: "quarantined".into(),
        },
        QuarantinedSkill {
            id: "legacy-exec".into(),
            name: "legacy-exec".into(),
            version: "1.0.0".into(),
            source: "Local install".into(),
            reason: "Requests shell execution with no manifest capability list.".into(),
            quarantined_at: now - 9 * DAY,
            status: "quarantined".into(),
        },
        QuarantinedSkill {
            id: "unknown-skill".into(),
            name: "unknown-skill".into(),
            version: "—".into(),
            source: "Sideloaded".into(),
            reason: "No manifest. Identity could not be established.".into(),
            quarantined_at: now - 20 * DAY - 5 * 60 * 60 * 1000,
            status: "quarantined".into(),
        },
    ]
}

#[derive(Debug, Clone, PartialEq)]
pub struct SeedInput {
    pub id: String,
    pub ts: i64,
    pub actor: String,
    pub skill: Option<String>,
    pub action: String,
    pub resource: Option<String>,
    pub decision: String,
    pub rule_id: Option<String>,
    pub risk: String,
    pub cost_usd: Option<f64>,
    pub detail: Option<String>,
}

struct SeedDecision {
    decision: &'static str,
    actor: String,
    rule_id: Option<String>,
    detail: String,
}

fn rule_slug(action: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in action.to_lowercase().chars() {
        if c.is_ascii_lowercase() {
            out.push(c);
            dash = false;
        } else if !dash {
            out.push('-');
            dash = true;
        }
    }
    out
}

/// Same branch structure and the same PRNG consumption order as decideSeed.
fn decide_seed(rnd: &mut Mulberry32, def: &ActionDef) -> SeedDecision {
    let r = rnd.next_f64();
    let user = |decision: &'static str, detail: &str| SeedDecision {
        decision,
        actor: "user".into(),
        rule_id: None,
        detail: detail.into(),
    };
    if QUARANTINED.contains(&def.skill) {
        return if r < 0.75 {
            SeedDecision {
                decision: "quarantined",
                actor: rnd.pick_agent(),
                rule_id: Some("policy.quarantine".into()),
                detail: format!("{} is quarantined — request held for explicit approval.", def.skill),
            }
        } else {
            user("denied", "Denied from the approval prompt.")
        };
    }
    if def.skill == "shell-skill" {
        if r < 0.7 {
            return SeedDecision {
                decision: "blocked",
                actor: rnd.pick_agent(),
                rule_id: Some("policy.shell-exec".into()),
                detail: "Shell execution is disabled in Security Settings.".into(),
            };
        }
        if r < 0.9 {
            return user("allowed", "Approved once from the prompt.");
        }
        return user("denied", "Denied from the approval prompt.");
    }
    if def.risk == "low" {
        if r < 0.9 {
            return SeedDecision {
                decision: "auto-approved",
                actor: rnd.pick_agent(),
                rule_id: Some("policy.auto-approve-low".into()),
                detail: "Low risk — ran without a prompt.".into(),
            };
        }
        if r < 0.96 {
            return user("allowed", "Approved from the prompt.");
        }
        return SeedDecision {
            decision: "error",
            actor: rnd.pick_agent(),
            rule_id: None,
            detail: "The skill returned an error after approval.".into(),
        };
    }
    if def.risk == "medium" {
        if r < 0.5 {
            return user("allowed", "Approved from the prompt.");
        }
        if r < 0.82 {
            return SeedDecision {
                decision: "auto-approved",
                actor: rnd.pick_agent(),
                rule_id: Some(format!("rule.{}.{}", def.skill, rule_slug(def.action))),
                detail: "A remember rule you created matched.".into(),
            };
        }
        if r < 0.95 {
            return user("denied", "Denied from the prompt.");
        }
        return SeedDecision {
            decision: "error",
            actor: rnd.pick_agent(),
            rule_id: None,
            detail: "The skill returned an error after approval.".into(),
        };
    }
    if r < 0.55 {
        return user("allowed", "Approved after review.");
    }
    if r < 0.9 {
        return user("denied", "Denied — not worth the risk.");
    }
    SeedDecision {
        decision: "blocked",
        actor: rnd.pick_agent(),
        rule_id: Some("policy.paused".into()),
        detail: "XR was paused when this arrived.".into(),
    }
}

/// The 200 inputs (+4 system rows), oldest first, before chaining.
pub fn seed_audit_inputs(now: i64, count: usize) -> Vec<SeedInput> {
    let mut rnd = Mulberry32::new(SEED);
    let mut offsets: Vec<i64> = Vec::with_capacity(count);
    for _ in 0..count {
        let u = rnd.next_f64();
        let skew = u * u;
        offsets.push((60_000.0 + skew * ((30 * DAY - 120_000) as f64)).floor() as i64);
    }
    offsets.sort_unstable_by(|a, b| b.cmp(a));
    let mut out: Vec<SeedInput> = Vec::with_capacity(count + 4);
    for (i, offset) in offsets.iter().enumerate() {
        let def = &ACTIONS[rnd.index(ACTIONS.len())];
        let resource = def.resources[rnd.index(def.resources.len())];
        let d = decide_seed(&mut rnd, def);
        let ran = d.decision == "allowed" || d.decision == "auto-approved";
        let cost = if ran && def.cost {
            Some((rnd.next_f64() * 0.08 * 10000.0).round() / 10000.0)
        } else if ran {
            Some(0.0)
        } else {
            None
        };
        out.push(SeedInput {
            id: format!("aud_{:06}", i + 1),
            ts: now - offset,
            actor: d.actor,
            skill: Some(def.skill.to_string()),
            action: def.action.to_string(),
            resource: resource.map(|s| s.to_string()),
            decision: d.decision.to_string(),
            rule_id: d.rule_id,
            risk: def.risk.to_string(),
            cost_usd: cost,
            detail: Some(d.detail),
        });
    }
    let system_rows: [(i64, &str, &str); 4] = [
        (27 * DAY, "Health check completed", "9 checks · 7 passed · 2 planned"),
        (14 * DAY, "Policy updated", "quarantineNewSkills: on"),
        (6 * DAY, "Health check completed", "9 checks · 7 passed · 2 planned"),
        (2 * DAY, "Policy updated", "allowShellExec: off"),
    ];
    for (ago, action, detail) in system_rows {
        out.push(SeedInput {
            id: format!("aud_{:06}", out.len() + 1),
            ts: now - ago - 17 * 60_000,
            actor: "system".into(),
            skill: None,
            action: action.into(),
            resource: None,
            decision: "allowed".into(),
            rule_id: None,
            risk: "low".into(),
            cost_usd: None,
            detail: Some(detail.into()),
        });
    }
    out.sort_by(|a, b| a.ts.cmp(&b.ts).then_with(|| a.id.cmp(&b.id)));
    out
}

/// Chain the seed, oldest first.
pub fn build_seed_chain(now: i64, count: usize) -> Vec<AuditEntry> {
    let mut out: Vec<AuditEntry> = Vec::with_capacity(count + 4);
    for input in seed_audit_inputs(now, count) {
        let tail = out.last().map(|e| e.hash.clone());
        let id = input.id.clone();
        out.push(chain_entry(id, input, tail.as_deref()));
    }
    out
}

// ─── Database ──────────────────────────────────────────────────────────────

const DDL: &str = "
CREATE TABLE IF NOT EXISTS shield_audit (
    seq       INTEGER PRIMARY KEY AUTOINCREMENT,
    id        TEXT    NOT NULL UNIQUE,
    ts        INTEGER NOT NULL,
    actor     TEXT    NOT NULL,
    skill     TEXT,
    action    TEXT    NOT NULL,
    resource  TEXT,
    decision  TEXT    NOT NULL,
    rule_id   TEXT,
    risk      TEXT    NOT NULL,
    cost_usd  REAL,
    prev_hash TEXT,
    hash      TEXT    NOT NULL,
    detail    TEXT
);
CREATE INDEX IF NOT EXISTS idx_shield_audit_ts ON shield_audit(ts DESC);
CREATE TRIGGER IF NOT EXISTS shield_audit_no_update BEFORE UPDATE ON shield_audit
BEGIN SELECT RAISE(ABORT, 'shield_audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS shield_audit_no_delete BEFORE DELETE ON shield_audit
BEGIN SELECT RAISE(ABORT, 'shield_audit is append-only'); END;
";

pub struct ShieldDb {
    conn: Mutex<Connection>,
}

impl ShieldDb {
    /// Open the shared xr.db (WAL, own connection), apply the DDL, seed once.
    pub fn init(app: &AppHandle) -> Self {
        let dir = app
            .path()
            .app_data_dir()
            .expect("tauri app_data_dir must resolve");
        std::fs::create_dir_all(&dir).expect("create app data dir");
        let conn = Connection::open(dir.join("xr.db")).expect("open xr.db");
        conn.pragma_update(None, "journal_mode", "WAL")
            .expect("enable WAL (shared with chat)");
        ShieldDb::from_connection(conn).expect("apply shield DDL")
    }

    pub fn from_connection(conn: Connection) -> rusqlite::Result<Self> {
        conn.execute_batch(DDL)?;
        let db = ShieldDb {
            conn: Mutex::new(conn),
        };
        db.seed_if_empty(now_ms())?;
        Ok(db)
    }

    fn seed_if_empty(&self, now: i64) -> rusqlite::Result<usize> {
        let mut conn = self.conn.lock().map_err(|_| rusqlite::Error::InvalidQuery)?;
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM shield_audit", [], |r| r.get(0))?;
        if count > 0 {
            return Ok(0);
        }
        let tx = conn.transaction()?;
        let entries = build_seed_chain(now, SEED_COUNT);
        for e in &entries {
            insert_entry(&tx, e)?;
        }
        tx.commit()?;
        Ok(entries.len())
    }

    pub fn count(&self) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|_| "shield db poisoned")?;
        conn.query_row("SELECT COUNT(*) FROM shield_audit", [], |r| r.get(0))
            .map_err(|e| e.to_string())
    }

    /// Newest first; `cursor` is the id of the last entry already seen.
    pub fn page(&self, cursor: Option<&str>, limit: u32) -> Result<AuditPage, String> {
        let conn = self.conn.lock().map_err(|_| "shield db poisoned")?;
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM shield_audit", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let limit = limit.clamp(1, 1000) as i64;
        let mut entries: Vec<AuditEntry> = match cursor {
            Some(c) => {
                let mut stmt = conn
                    .prepare(
                        "SELECT id, ts, actor, skill, action, resource, decision, rule_id, risk, cost_usd, prev_hash, hash, detail
                         FROM shield_audit
                         WHERE seq < COALESCE((SELECT seq FROM shield_audit WHERE id = ?1), 0)
                         ORDER BY seq DESC LIMIT ?2",
                    )
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map(params![c, limit + 1], row_to_entry)
                    .map_err(|e| e.to_string())?;
                rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
            }
            None => {
                let mut stmt = conn
                    .prepare(
                        "SELECT id, ts, actor, skill, action, resource, decision, rule_id, risk, cost_usd, prev_hash, hash, detail
                         FROM shield_audit ORDER BY seq DESC LIMIT ?1",
                    )
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map(params![limit + 1], row_to_entry)
                    .map_err(|e| e.to_string())?;
                rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
            }
        };
        let has_more = entries.len() as i64 > limit;
        if has_more {
            entries.truncate(limit as usize);
        }
        let next_cursor = if has_more {
            entries.last().map(|e| e.id.clone())
        } else {
            None
        };
        Ok(AuditPage {
            entries,
            next_cursor,
            total,
        })
    }

    /// Append under the connection lock: readers of the tail and the insert
    /// are one critical section, so two writers can never share a prev_hash.
    pub fn append(&self, input: AuditInput) -> Result<AuditEntry, String> {
        if !DECISIONS.contains(&input.decision.as_str()) {
            return Err(format!("invalid audit decision: {}", input.decision));
        }
        if !RISKS.contains(&input.risk.as_str()) {
            return Err(format!("invalid audit risk: {}", input.risk));
        }
        if input.actor.trim().is_empty() || input.action.trim().is_empty() {
            return Err("audit entry needs an actor and an action".into());
        }
        let conn = self.conn.lock().map_err(|_| "shield db poisoned")?;
        let tail: Option<String> = conn
            .query_row(
                "SELECT hash FROM shield_audit ORDER BY seq DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let seed = SeedInput {
            id: String::new(),
            ts: input.ts.unwrap_or_else(now_ms),
            actor: input.actor,
            skill: input.skill,
            action: input.action,
            resource: input.resource,
            decision: input.decision,
            rule_id: input.rule_id,
            risk: input.risk,
            cost_usd: input.cost_usd.filter(|c| c.is_finite()),
            detail: input.detail,
        };
        let entry = chain_entry(new_audit_id(), seed, tail.as_deref());
        insert_entry(&conn, &entry).map_err(|e| e.to_string())?;
        Ok(entry)
    }

    /// Whole chain in order (the log is small; a streaming walk comes with
    /// the Phase 14 volumes).
    pub fn all(&self) -> Result<Vec<AuditEntry>, String> {
        let conn = self.conn.lock().map_err(|_| "shield db poisoned")?;
        let mut stmt = conn
            .prepare(
                "SELECT id, ts, actor, skill, action, resource, decision, rule_id, risk, cost_usd, prev_hash, hash, detail
                 FROM shield_audit ORDER BY seq ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], row_to_entry).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn verify(&self) -> Result<ChainVerification, String> {
        Ok(verify_chain(&self.all()?, now_ms()))
    }
}

fn insert_entry(conn: &Connection, e: &AuditEntry) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO shield_audit (id, ts, actor, skill, action, resource, decision, rule_id, risk, cost_usd, prev_hash, hash, detail)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            e.id,
            e.ts,
            e.actor,
            e.skill,
            e.action,
            e.resource,
            e.decision,
            e.rule_id,
            e.risk,
            e.cost_usd,
            e.prev_hash,
            e.hash,
            e.detail
        ],
    )
}

fn row_to_entry(r: &Row<'_>) -> rusqlite::Result<AuditEntry> {
    Ok(AuditEntry {
        id: r.get(0)?,
        ts: r.get(1)?,
        actor: r.get(2)?,
        skill: r.get(3)?,
        action: r.get(4)?,
        resource: r.get(5)?,
        decision: r.get(6)?,
        rule_id: r.get(7)?,
        risk: r.get(8)?,
        cost_usd: r.get(9)?,
        signature: None,
        prev_hash: r.get(10)?,
        hash: r.get(11)?,
        detail: r.get(12)?,
    })
}

// ─── State store (shield.json) ────────────────────────────────────────────

fn shield_store<R: Runtime>(app: &AppHandle<R>) -> Result<Arc<Store<R>>, String> {
    StoreBuilder::new(app, STORE_FILE)
        .build()
        .map_err(|e| format!("shield store unavailable: {e}"))
}

fn read_key<R: Runtime, T: for<'de> Deserialize<'de>>(store: &Store<R>, key: &str) -> Option<T> {
    store
        .get(key)
        .and_then(|v| serde_json::from_value(v).ok())
}

fn write_key<R: Runtime, T: Serialize>(store: &Store<R>, key: &str, value: &T) -> Result<(), String> {
    store.set(key, serde_json::to_value(value).map_err(|e| e.to_string())?);
    store
        .save()
        .map_err(|e| format!("failed to save {STORE_FILE}: {e}"))
}

/// Trim, lowercase, drop empties, keep first occurrence.
pub fn normalize_domains(list: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(list.len());
    for raw in list {
        let host = raw.trim().to_lowercase();
        if host.is_empty() || out.iter().any(|x| *x == host) {
            continue;
        }
        out.push(host);
    }
    out
}

/// What this build can honour: no biometric prompt exists, so the switch
/// is forced off and reported unsupported; domain lists are normalised.
pub fn coerce_policy(mut p: SecurityPolicy) -> SecurityPolicy {
    p.biometric_supported = false;
    p.biometric_approval = false;
    if !["relaxed", "balanced", "strict"].contains(&p.constitution_strictness.as_str()) {
        p.constitution_strictness = "balanced".into();
    }
    p.allowed_domains = normalize_domains(&p.allowed_domains);
    p.blocked_domains = normalize_domains(&p.blocked_domains);
    p
}

// ─── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_shield_status<R: Runtime>(app: AppHandle<R>) -> Result<ShieldPersisted, String> {
    let store = shield_store(&app)?;
    let policy = coerce_policy(read_key::<R, SecurityPolicy>(store.as_ref(), KEY_POLICY).unwrap_or_default());
    let paused = read_key::<R, bool>(store.as_ref(), KEY_PAUSED).unwrap_or(false);
    let quarantine = match read_key::<R, Vec<QuarantinedSkill>>(store.as_ref(), KEY_QUARANTINE) {
        Some(list) => list,
        None => {
            let list = seed_quarantine(now_ms());
            // Best effort: the UI still gets the list if the save fails.
            let _ = write_key(store.as_ref(), KEY_QUARANTINE, &list);
            list
        }
    };
    let saved = read_key::<R, SavedChecks>(store.as_ref(), KEY_CHECKS);
    Ok(ShieldPersisted {
        policy,
        paused,
        quarantine,
        last_checked_at: saved.as_ref().map(|s| s.at),
        last_checks: saved.map(|s| s.checks).unwrap_or_default(),
    })
}

#[tauri::command]
pub fn get_audit_log(
    state: State<'_, ShieldDb>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<AuditPage, String> {
    state.page(cursor.as_deref(), limit.unwrap_or(100))
}

#[tauri::command]
pub fn append_audit(state: State<'_, ShieldDb>, input: AuditInput) -> Result<AuditEntry, String> {
    state.append(input)
}

#[tauri::command]
pub fn verify_audit_chain(state: State<'_, ShieldDb>) -> Result<ChainVerification, String> {
    state.verify()
}

/// Host-side checks. Every row describes what ran and what it found; a
/// keychain that cannot be reached is a warning (the app keeps working on
/// the flagged fallback), never a "compromised" — that word is reserved for
/// integrity failures (audit db / chain).
#[tauri::command]
pub fn run_health_check<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, ShieldDb>,
    webview_version: Option<String>,
) -> Result<Vec<HealthCheck>, String> {
    let mut checks: Vec<HealthCheck> = Vec::with_capacity(5);

    // 1. audit_db
    let t = Instant::now();
    match state.count() {
        Ok(n) => checks.push(HealthCheck {
            id: "audit_db".into(),
            label: "Audit database".into(),
            status: "pass".into(),
            detail: format!("{n} entries readable (SQLite, WAL, append-only)."),
            critical: true,
            duration_ms: Some(t.elapsed().as_millis() as u64),
        }),
        Err(e) => checks.push(HealthCheck {
            id: "audit_db".into(),
            label: "Audit database".into(),
            status: "fail".into(),
            detail: format!("Could not read the audit table: {e}"),
            critical: true,
            duration_ms: Some(t.elapsed().as_millis() as u64),
        }),
    }

    // 2. keychain — a read probe; NoEntry is the healthy answer.
    let t = Instant::now();
    let keychain = match keyring::Entry::new("xr-desktop", "shield-health-probe") {
        Ok(entry) => match entry.get_password() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        },
        Err(e) => Err(e.to_string()),
    };
    checks.push(match keychain {
        Ok(()) => HealthCheck {
            id: "keychain".into(),
            label: "Secrets store".into(),
            status: "pass".into(),
            detail: "OS keychain reachable.".into(),
            critical: true,
            duration_ms: Some(t.elapsed().as_millis() as u64),
        },
        Err(e) => HealthCheck {
            id: "keychain".into(),
            label: "Secrets store".into(),
            status: "warn".into(),
            detail: format!(
                "OS keychain unreachable ({e}). Provider keys use the flagged fallback store until it returns."
            ),
            critical: true,
            duration_ms: Some(t.elapsed().as_millis() as u64),
        },
    });

    // 3. audit_chain
    let t = Instant::now();
    match state.verify() {
        Ok(v) => checks.push(HealthCheck {
            id: "audit_chain".into(),
            label: "Audit chain".into(),
            status: (if v.valid { "pass" } else { "fail" }).to_string(),
            detail: v.detail,
            critical: true,
            duration_ms: Some(t.elapsed().as_millis() as u64),
        }),
        Err(e) => checks.push(HealthCheck {
            id: "audit_chain".into(),
            label: "Audit chain".into(),
            status: "fail".into(),
            detail: format!("Could not walk the chain: {e}"),
            critical: true,
            duration_ms: Some(t.elapsed().as_millis() as u64),
        }),
    }

    // 4. settings_store — settings.json loads and the data dir is writable.
    let t = Instant::now();
    let settings = StoreBuilder::new(&app, "settings.json")
        .build()
        .map(|s| s.keys().len())
        .map_err(|e| e.to_string());
    let writable = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())
        .and_then(|dir| {
            let probe = dir.join(".shield-probe");
            std::fs::write(&probe, b"ok")
                .and_then(|_| std::fs::remove_file(&probe))
                .map_err(|e| e.to_string())
        });
    checks.push(match (settings, writable) {
        (Ok(n), Ok(())) => HealthCheck {
            id: "settings_store".into(),
            label: "Settings store".into(),
            status: "pass".into(),
            detail: format!("Preferences readable ({n} keys); data folder writable."),
            critical: true,
            duration_ms: Some(t.elapsed().as_millis() as u64),
        },
        (Err(e), _) => HealthCheck {
            id: "settings_store".into(),
            label: "Settings store".into(),
            status: "fail".into(),
            detail: format!("Preferences could not be loaded: {e}"),
            critical: true,
            duration_ms: Some(t.elapsed().as_millis() as u64),
        },
        (Ok(_), Err(e)) => HealthCheck {
            id: "settings_store".into(),
            label: "Settings store".into(),
            status: "fail".into(),
            detail: format!("Data folder is not writable: {e}"),
            critical: true,
            duration_ms: Some(t.elapsed().as_millis() as u64),
        },
    });

    // 5. version_integrity — webview bundle vs. shell crate.
    let shell = env!("CARGO_PKG_VERSION");
    let web = webview_version.unwrap_or_default();
    let matches = web == shell;
    checks.push(HealthCheck {
        id: "version_integrity".into(),
        label: "Version integrity".into(),
        status: (if matches { "pass" } else { "fail" }).to_string(),
        detail: if matches {
            format!("Shell {shell} and webview {web} match.")
        } else {
            format!("Webview {web} does not match shell {shell} — reinstall or restart XR.")
        },
        critical: false,
        duration_ms: None,
    });

    Ok(checks)
}

#[tauri::command]
pub fn set_security_policy<R: Runtime>(
    app: AppHandle<R>,
    policy: SecurityPolicy,
) -> Result<SecurityPolicy, String> {
    let next = coerce_policy(policy);
    write_key(shield_store(&app)?.as_ref(), KEY_POLICY, &next)?;
    Ok(next)
}

#[tauri::command]
pub fn set_shield_paused<R: Runtime>(app: AppHandle<R>, paused: bool) -> Result<(), String> {
    write_key(shield_store(&app)?.as_ref(), KEY_PAUSED, &paused)?;
    if !paused {
        let _ = app.emit(RESUMED_EVENT, serde_json::json!({ "at": now_ms() }));
    }
    Ok(())
}

#[tauri::command]
pub fn set_quarantine<R: Runtime>(
    app: AppHandle<R>,
    list: Vec<QuarantinedSkill>,
) -> Result<(), String> {
    write_key(shield_store(&app)?.as_ref(), KEY_QUARANTINE, &list)
}

#[tauri::command]
pub fn save_shield_checks<R: Runtime>(
    app: AppHandle<R>,
    checks: Vec<HealthCheck>,
    at: i64,
) -> Result<(), String> {
    write_key(shield_store(&app)?.as_ref(), KEY_CHECKS, &SavedChecks { at, checks })
}

/// Emergency revoke: persist the pause and tell every webview. The audit
/// row is written by the caller through `append_audit` (one record, one
/// writer); the queue denial and run stops happen in the webviews.
#[tauri::command]
pub fn revoke_all<R: Runtime>(
    app: AppHandle<R>,
    pending_denied: Option<u32>,
    runs_stopped: Option<u32>,
) -> Result<(), String> {
    write_key(shield_store(&app)?.as_ref(), KEY_PAUSED, &true)?;
    app.emit(
        EMERGENCY_REVOKE_EVENT,
        EmergencyRevoke {
            pending_denied: pending_denied.unwrap_or(0),
            runs_stopped: runs_stopped.unwrap_or(0),
            at: now_ms(),
        },
    )
    .map_err(|e| e.to_string())
}

/// Host-known approvals — none yet: the queue lives in the webview until the
/// agent runtime (Phase 14). Mirrors `list_runs`.
#[tauri::command]
pub fn list_approvals() -> Vec<serde_json::Value> {
    Vec::new()
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_700_000_000_000;

    #[test]
    fn sha256_matches_the_fips_vector() {
        assert_eq!(
            sha256_hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn mulberry32_matches_the_js_generator() {
        // First five doubles from mulberry32(0x5a1e1d) in the webview.
        let mut r = Mulberry32::new(SEED);
        assert_eq!(r.next_f64(), 0.17755939578637481_f64);
        assert_eq!(r.next_f64(), 0.23168646264821291_f64);
        assert_eq!(r.next_f64(), 0.59413540200330317_f64);
        assert_eq!(r.next_f64(), 0.53720333194360137_f64);
        assert_eq!(r.next_f64(), 0.88609548262320459_f64);
    }

    #[test]
    fn seed_inputs_match_the_webview_seed() {
        let inputs = seed_audit_inputs(NOW, SEED_COUNT);
        assert_eq!(inputs.len(), 204);
        let first = &inputs[0];
        assert_eq!(first.id, "aud_000001");
        assert_eq!(first.ts, 1_697_420_148_262);
        assert_eq!(first.actor, "agent:main");
        assert_eq!(first.skill.as_deref(), Some("web-skill"));
        assert_eq!(first.resource.as_deref(), Some("https://docs.rs/rusqlite"));
        assert_eq!(first.decision, "auto-approved");
        assert_eq!(first.cost_usd, Some(0.0558));
        let last = &inputs[203];
        assert_eq!(last.id, "aud_000200");
        assert_eq!(last.ts, 1_699_999_931_718);
        assert_eq!(last.decision, "quarantined");
        assert_eq!(last.resource.as_deref(), Some("Shield · Status"));
    }

    #[test]
    fn canonical_form_and_chain_match_the_webview_byte_for_byte() {
        let chain = build_seed_chain(NOW, SEED_COUNT);
        assert_eq!(
            canonical_of(&chain[0]),
            "[\"aud_000001\",\"1697420148262\",\"agent:main\",\"web-skill\",\"Fetch a web page\",\"https://docs.rs/rusqlite\",\"auto-approved\",\"policy.auto-approve-low\",\"low\",\"0.055800\",\"\",\"Low risk — ran without a prompt.\"]"
        );
        assert_eq!(
            chain[0].hash,
            "3f52655c3b7ab591e673316641c6781449e2b2917b469aeb7da147753bbddc9d"
        );
        assert_eq!(
            chain[203].hash,
            "52a23b48027be6384924f11de2a12f8646d679d86d0ce508f5131732cdf72121"
        );
        assert!(chain.iter().all(|e| e.signature.is_none()));
    }

    #[test]
    fn verify_detects_tampering_and_cuts() {
        let chain = build_seed_chain(NOW, 20);
        assert!(verify_chain(&chain, NOW).valid);

        let mut tampered = chain.clone();
        tampered[5].detail = Some("edited after the fact".into());
        let v = verify_chain(&tampered, NOW);
        assert!(!v.valid);
        assert_eq!(v.broken_at, Some(5));

        let mut cut = chain.clone();
        cut.remove(3);
        let v = verify_chain(&cut, NOW);
        assert!(!v.valid);
        assert_eq!(v.broken_at, Some(3));

        assert!(verify_chain(&[], NOW).valid);
    }

    #[test]
    fn db_seeds_once_pages_newest_first_and_appends_in_order() {
        let db = ShieldDb::from_connection(Connection::open_in_memory().unwrap()).unwrap();
        assert_eq!(db.count().unwrap(), 204);
        // Seeding is idempotent.
        assert_eq!(db.seed_if_empty(NOW).unwrap(), 0);

        let page = db.page(None, 100).unwrap();
        assert_eq!(page.entries.len(), 100);
        assert_eq!(page.total, 204);
        assert!(page.entries[0].ts >= page.entries[99].ts);
        let next = page.next_cursor.clone().unwrap();
        let page2 = db.page(Some(&next), 100).unwrap();
        assert_eq!(page2.entries.len(), 100);
        assert_ne!(page2.entries[0].id, page.entries[0].id);
        let page3 = db.page(page2.next_cursor.as_deref(), 100).unwrap();
        assert_eq!(page3.entries.len(), 4);
        assert!(page3.next_cursor.is_none());

        let appended = db
            .append(AuditInput {
                ts: Some(NOW + 10),
                actor: "user".into(),
                skill: None,
                action: "Policy updated".into(),
                resource: None,
                decision: "allowed".into(),
                rule_id: Some("user.policy".into()),
                risk: "low".into(),
                cost_usd: None,
                detail: Some("allowShellExec: true".into()),
            })
            .unwrap();
        assert!(appended.id.starts_with("aud_"));
        assert!(appended.prev_hash.is_some());
        assert!(db.verify().unwrap().valid);
        assert_eq!(db.count().unwrap(), 205);

        assert!(db
            .append(AuditInput {
                ts: None,
                actor: "user".into(),
                skill: None,
                action: "x".into(),
                resource: None,
                decision: "maybe".into(),
                rule_id: None,
                risk: "low".into(),
                cost_usd: None,
                detail: None,
            })
            .is_err());
    }

    #[test]
    fn audit_table_is_append_only() {
        let db = ShieldDb::from_connection(Connection::open_in_memory().unwrap()).unwrap();
        let conn = db.conn.lock().unwrap();
        assert!(conn
            .execute("UPDATE shield_audit SET detail = 'x' WHERE seq = 1", [])
            .is_err());
        assert!(conn.execute("DELETE FROM shield_audit WHERE seq = 1", []).is_err());
    }

    #[test]
    fn policy_coercion_is_honest_about_biometrics_and_cleans_domains() {
        let p = coerce_policy(SecurityPolicy {
            biometric_approval: true,
            biometric_supported: true,
            constitution_strictness: "paranoid".into(),
            allowed_domains: vec![" API.Example.com ".into(), "api.example.com".into(), "".into()],
            ..SecurityPolicy::default()
        });
        assert!(!p.biometric_approval);
        assert!(!p.biometric_supported);
        assert_eq!(p.constitution_strictness, "balanced");
        assert_eq!(p.allowed_domains, vec!["api.example.com"]);
    }

    #[test]
    fn rule_slug_matches_the_js_regex() {
        assert_eq!(rule_slug("Send email"), "send-email");
        assert_eq!(rule_slug("Create an event"), "create-an-event");
        assert_eq!(rule_slug("Post a message"), "post-a-message");
    }
}
