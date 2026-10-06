/*
 * Budget governor — pure logic (Phase 13).
 *
 * A line-for-line port of desktop/src/budget/{period,models,core,seed}.ts.
 * Same order of checks, same EPS, same price table, same rounding, same
 * message strings — the webview's browser fallback and this module must
 * produce identical verdicts, and `mod tests` pins the shared vectors.
 *
 * Nothing in here touches SQLite, Tauri or the clock; mod.rs owns those.
 */
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const EPS: f64 = 0.0001;
pub const DAY_MS: i64 = 86_400_000;
pub const HOUR_MS: i64 = 3_600_000;
pub const SPIKE_WINDOW_MS: i64 = 5 * 60_000;
pub const DANGER_PCT: f64 = 0.85;
pub const SEED_VERSION: i64 = 1;
pub const SEED_RNG: u32 = 0x1317_b0d6;
pub const UNKNOWN_IN_PER_1M: f64 = 5.0;
pub const UNKNOWN_OUT_PER_1M: f64 = 15.0;

// ─── Wire types (camelCase, mirror src/budget/types.ts) ───────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetSettings {
    pub monthly_limit: f64,
    pub hard_cap: bool,
    pub circuit_breaker_pct: f64,
    pub circuit_breaker_spend_per5min: f64,
    pub model_downshifting: bool,
    pub finalization_reserve_pct: f64,
    pub daily_limit: f64,
    pub per_request_limit: f64,
    pub notify_warn_pct: f64,
    pub notify_os: bool,
    pub notify_toast: bool,
    pub billing_tier: String,
    pub per_agent_caps: BTreeMap<String, f64>,
    pub per_workspace_caps: BTreeMap<String, f64>,
    pub month_start_day: i64,
    pub paused: bool,
    pub pause_reason: Option<String>,
    pub paused_at: Option<i64>,
    pub configured_models: Vec<String>,
    pub installed_local: Vec<String>,
    pub default_model: String,
}

impl Default for BudgetSettings {
    fn default() -> Self {
        BudgetSettings {
            monthly_limit: 5.0,
            hard_cap: true,
            circuit_breaker_pct: 0.95,
            circuit_breaker_spend_per5min: 0.5,
            model_downshifting: true,
            finalization_reserve_pct: 0.1,
            daily_limit: 1.0,
            per_request_limit: 0.25,
            notify_warn_pct: 0.8,
            notify_os: true,
            notify_toast: true,
            billing_tier: "personal".into(),
            per_agent_caps: BTreeMap::new(),
            per_workspace_caps: BTreeMap::new(),
            month_start_day: 1,
            paused: false,
            pause_reason: None,
            paused_at: None,
            configured_models: [
                "claude-sonnet-4.5",
                "claude-haiku-4-6",
                "gpt-5",
                "gpt-5-mini",
                "gpt-4o",
                "gpt-4o-mini",
                "gemini-2.5-flash",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect(),
            installed_local: vec!["qwen2.5:3b".into(), "qwen2.5-coder:3b".into()],
            default_model: "claude-sonnet-4.5".into(),
        }
    }
}

/// JSON field name mapping is camelCase; the settings patch arrives as a
/// partial object, so merge at the JSON level then clamp (coerceSettings).
pub fn coerce_settings(v: &Value) -> BudgetSettings {
    let d = BudgetSettings::default();
    let obj = match v.as_object() {
        Some(o) => o,
        None => return d,
    };
    let num = |k: &str, fallback: f64, min: f64, max: f64| -> f64 {
        match obj.get(k).and_then(Value::as_f64) {
            Some(n) if n.is_finite() => n.clamp(min, max),
            _ => fallback,
        }
    };
    let boolean = |k: &str, fallback: bool| obj.get(k).and_then(Value::as_bool).unwrap_or(fallback);
    let caps = |k: &str| -> BTreeMap<String, f64> {
        let mut out = BTreeMap::new();
        if let Some(m) = obj.get(k).and_then(Value::as_object) {
            for (key, n) in m {
                if let Some(f) = n.as_f64() {
                    if f.is_finite() && f >= 0.0 {
                        out.insert(key.clone(), f);
                    }
                }
            }
        }
        out
    };
    let strs = |k: &str, fallback: &[String]| -> Vec<String> {
        match obj.get(k).and_then(Value::as_array) {
            Some(a) => a
                .iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect(),
            None => fallback.to_vec(),
        }
    };
    let reason = obj
        .get("pauseReason")
        .and_then(Value::as_str)
        .filter(|r| matches!(*r, "manual" | "threshold" | "spike" | "emergency"))
        .map(|r| r.to_string());
    BudgetSettings {
        monthly_limit: num("monthlyLimit", d.monthly_limit, 0.0, 100_000.0),
        hard_cap: boolean("hardCap", d.hard_cap),
        circuit_breaker_pct: num("circuitBreakerPct", d.circuit_breaker_pct, 0.5, 1.0),
        circuit_breaker_spend_per5min: num(
            "circuitBreakerSpendPer5min",
            d.circuit_breaker_spend_per5min,
            0.0,
            1000.0,
        ),
        model_downshifting: boolean("modelDownshifting", d.model_downshifting),
        finalization_reserve_pct: num(
            "finalizationReservePct",
            d.finalization_reserve_pct,
            0.0,
            0.2,
        ),
        daily_limit: num("dailyLimit", d.daily_limit, 0.0, 100_000.0),
        per_request_limit: num("perRequestLimit", d.per_request_limit, 0.0, 1000.0),
        notify_warn_pct: num("notifyWarnPct", d.notify_warn_pct, 0.5, 1.0),
        notify_os: boolean("notifyOs", d.notify_os),
        notify_toast: boolean("notifyToast", d.notify_toast),
        billing_tier: if obj.get("billingTier").and_then(Value::as_str) == Some("pro") {
            "pro".into()
        } else {
            "personal".into()
        },
        per_agent_caps: caps("perAgentCaps"),
        per_workspace_caps: caps("perWorkspaceCaps"),
        month_start_day: num("monthStartDay", d.month_start_day as f64, 1.0, 28.0).round() as i64,
        paused: boolean("paused", false),
        pause_reason: reason,
        paused_at: obj.get("pausedAt").and_then(Value::as_i64),
        configured_models: strs("configuredModels", &d.configured_models),
        installed_local: strs("installedLocal", &d.installed_local),
        default_model: obj
            .get("defaultModel")
            .and_then(Value::as_str)
            .map(|s| s.to_string())
            .unwrap_or(d.default_model),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpendEvent {
    pub id: String,
    pub ts: i64,
    pub kind: String,
    pub agent: Option<String>,
    pub workspace: Option<String>,
    pub session_id: Option<String>,
    pub model: Option<String>,
    pub tokens_in: i64,
    pub tokens_out: i64,
    pub cost_usd: f64,
    pub category: String,
    pub detail: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpendInput {
    pub kind: String,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub workspace: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub tokens_in: Option<f64>,
    #[serde(default)]
    pub tokens_out: Option<f64>,
    pub cost_usd: f64,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub detail: Option<Value>,
    #[serde(default)]
    pub ts: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreCallRequest {
    pub model: String,
    pub estimated_tokens_in: f64,
    pub estimated_tokens_out: f64,
    #[serde(default)]
    pub estimated_cost: Option<f64>,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub workspace: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub finalization: Option<bool>,
    pub surface: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreCallCheck {
    pub allowed: bool,
    pub code: String,
    pub reason: Option<String>,
    pub downgraded_to_model: Option<String>,
    pub downshift_why: Option<String>,
    pub model: String,
    pub estimated_cost: f64,
    pub remaining: f64,
    pub hard_remaining: Option<f64>,
    pub state: String,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiggestRun {
    pub session_id: Option<String>,
    pub cost_usd: f64,
    pub model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetOverview {
    pub spent_today: f64,
    pub spent_month: f64,
    pub monthly_limit: f64,
    pub daily_limit: f64,
    pub pct_used_month: f64,
    pub pct_used_today: f64,
    pub tokens_in_month: i64,
    pub tokens_out_month: i64,
    pub days_until_reset: i64,
    pub reset_date: String,
    pub period_start: i64,
    pub period_end: i64,
    pub avg_per_day: f64,
    pub projected_month_end: f64,
    pub biggest_run: Option<BiggestRun>,
    pub remaining: f64,
    pub reserve_usd: f64,
    pub spent_last5min: f64,
    pub blocked_month: i64,
    pub downshifted_month: i64,
    pub agent_spend: BTreeMap<String, f64>,
    pub workspace_spend: BTreeMap<String, f64>,
    pub events_total: i64,
    pub state: String,
    pub settings: BudgetSettings,
    pub computed_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpendFilter {
    #[serde(default)]
    pub search: String,
    #[serde(default = "all")]
    pub category: String,
    #[serde(default = "all")]
    pub model: String,
    #[serde(default = "all")]
    pub agent: String,
    #[serde(default = "all")]
    pub kind: String,
    #[serde(default = "thirty_days")]
    pub range: String,
}

fn all() -> String {
    "all".into()
}
fn thirty_days() -> String {
    "30d".into()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpendSort {
    pub key: String,
    pub dir: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpendPage {
    pub events: Vec<SpendEvent>,
    pub next_cursor: Option<String>,
    pub total: i64,
    pub total_cost: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesBucket {
    pub at: i64,
    pub label: String,
    pub total: f64,
    pub by_category: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakdownRow {
    pub key: String,
    pub cost: f64,
    pub tokens: i64,
    pub count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateChange {
    pub prev: String,
    pub next: String,
    pub reason: String,
    pub at: i64,
}

// ─── Numbers & formatting (en-US currency, like Intl in the webview) ──────

pub fn round6(n: f64) -> f64 {
    (n * 1_000_000.0).round() / 1_000_000.0
}

fn group_thousands(int: &str) -> String {
    let mut out = String::with_capacity(int.len() + int.len() / 3);
    let head = int.len() % 3;
    let mut run = if head == 0 { 3 } else { head };
    for (i, ch) in int.chars().enumerate() {
        if i > 0 && run == 0 {
            out.push(',');
            run = 3;
        }
        out.push(ch);
        run -= 1;
    }
    out
}

/// `fmtUsd(n, { precise })`: 4 dp when precise or 0 < |n| < 0.01, else 2.
pub fn fmt_usd(n: f64, precise: bool) -> String {
    let abs = n.abs();
    let digits = if precise || (abs > 0.0 && abs < 0.01) {
        4
    } else {
        2
    };
    let s = format!("{:.*}", digits, abs);
    let (int, frac) = s.split_once('.').unwrap_or((&s, ""));
    let body = format!("{}.{}", group_thousands(int), frac);
    if n < 0.0 && body != format!("{:.*}", digits, 0.0) {
        format!("-${}", body)
    } else {
        format!("${}", body)
    }
}

pub fn fmt_pct(p: f64) -> String {
    format!("{}%", (p * 100.0).round() as i64)
}

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// "Oct 31" from "2026-10-31".
pub fn short_date(iso: &str) -> String {
    let mut parts = iso.split('-').skip(1);
    let m: usize = parts.next().and_then(|x| x.parse().ok()).unwrap_or(1);
    let d: i64 = parts.next().and_then(|x| x.parse().ok()).unwrap_or(1);
    format!("{} {}", MONTHS[m.clamp(1, 12) - 1], d)
}

// ─── Civil dates & periods (period.ts) ─────────────────────────────────────

pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let yy = if m <= 2 { y - 1 } else { y };
    let era = yy.div_euclid(400);
    let yoe = yy - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let zz = z + 719_468;
    let era = zz.div_euclid(146_097);
    let doe = zz - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn local_day_index(ts: i64, tz_offset_min: i64) -> i64 {
    (ts - tz_offset_min * 60_000).div_euclid(DAY_MS)
}

pub fn local_day_start(ts: i64, tz_offset_min: i64) -> i64 {
    local_day_index(ts, tz_offset_min) * DAY_MS + tz_offset_min * 60_000
}

pub fn day_index_to_ts(day: i64, tz_offset_min: i64) -> i64 {
    day * DAY_MS + tz_offset_min * 60_000
}

#[derive(Debug, Clone, PartialEq)]
pub struct Period {
    pub start: i64,
    pub end: i64,
    pub days_until_reset: i64,
    pub days_elapsed: i64,
    pub reset_date: String,
}

pub fn iso_date(y: i64, m: i64, d: i64) -> String {
    format!("{:04}-{:02}-{:02}", y, m, d)
}

pub fn period_for(now: i64, tz: i64, month_start_day: i64, reset_at: Option<i64>) -> Period {
    let start_day = month_start_day.clamp(1, 28);
    let today = local_day_index(now, tz);
    let (y, m, d) = civil_from_days(today);
    let (mut sy, mut sm) = (y, m);
    if d < start_day {
        sm -= 1;
        if sm == 0 {
            sm = 12;
            sy -= 1;
        }
    }
    let (mut ey, mut em) = (sy, sm + 1);
    if em == 13 {
        em = 1;
        ey += 1;
    }
    let start_idx = days_from_civil(sy, sm, start_day);
    let end_idx = days_from_civil(ey, em, start_day);
    let mut start = day_index_to_ts(start_idx, tz);
    if let Some(r) = reset_at {
        if r > start && r <= now {
            start = r;
        }
    }
    let end = day_index_to_ts(end_idx, tz);
    let (ly, lm, ld) = civil_from_days(end_idx - 1);
    Period {
        start,
        end,
        days_until_reset: (end_idx - today).max(1),
        days_elapsed: (today - local_day_index(start, tz) + 1).max(1),
        reset_date: iso_date(ly, lm, ld),
    }
}

pub fn short_day_label(ts: i64, tz: i64) -> String {
    let (_, m, d) = civil_from_days(local_day_index(ts, tz));
    format!("{} {}", MONTHS[(m as usize).clamp(1, 12) - 1], d)
}

// ─── Model registry (models.ts) ────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct ModelInfo {
    pub id: &'static str,
    pub provider: &'static str,
    pub in_per_1m: f64,
    pub out_per_1m: f64,
    pub local: bool,
}

const fn cloud(id: &'static str, provider: &'static str, i: f64, o: f64) -> ModelInfo {
    ModelInfo {
        id,
        provider,
        in_per_1m: i,
        out_per_1m: o,
        local: false,
    }
}
const fn local(id: &'static str) -> ModelInfo {
    ModelInfo {
        id,
        provider: "ollama",
        in_per_1m: 0.0,
        out_per_1m: 0.0,
        local: true,
    }
}

/// Same order as MODEL_REGISTRY in models.ts — ties in downshift sorting use it.
pub const MODEL_REGISTRY: [ModelInfo; 17] = [
    cloud("gpt-5", "openai", 2.5, 10.0),
    cloud("gpt-5-mini", "openai", 0.15, 0.6),
    cloud("gpt-4o", "openai", 2.5, 10.0),
    cloud("gpt-4o-mini", "openai", 0.15, 0.6),
    cloud("claude-opus-4-6", "anthropic", 15.0, 75.0),
    cloud("claude-sonnet-4-6", "anthropic", 3.0, 15.0),
    cloud("claude-sonnet-4.5", "anthropic", 3.0, 15.0),
    cloud("claude-haiku-4-6", "anthropic", 0.25, 1.25),
    cloud("gemini-2.5-pro", "google", 1.25, 10.0),
    cloud("gemini-2.5-flash", "google", 0.3, 2.5),
    cloud("grok-4", "xai", 3.0, 15.0),
    local("qwen2.5:3b"),
    local("qwen2.5-coder:3b"),
    local("llama3.2:3b"),
    local("llama3.1:8b"),
    local("deepseek-r1:7b"),
    local("llama3.1:70b"),
];

#[derive(Debug, Clone, PartialEq)]
pub struct Priced {
    pub provider: String,
    pub in_per_1m: f64,
    pub out_per_1m: f64,
    pub local: bool,
    pub estimate: bool,
}

fn looks_local(id: &str) -> bool {
    if id.starts_with("ollama/") {
        return true;
    }
    // /:\d+b$/i
    match id.rfind(':') {
        Some(i) => {
            let tail = &id[i + 1..];
            let lower = tail.to_ascii_lowercase();
            lower.len() >= 2
                && lower.ends_with('b')
                && lower[..lower.len() - 1].chars().all(|c| c.is_ascii_digit())
        }
        None => false,
    }
}

pub fn model_info(id: &str) -> Priced {
    if let Some(m) = MODEL_REGISTRY.iter().find(|m| m.id == id) {
        return Priced {
            provider: m.provider.into(),
            in_per_1m: m.in_per_1m,
            out_per_1m: m.out_per_1m,
            local: m.local,
            estimate: false,
        };
    }
    let is_local = looks_local(id);
    Priced {
        provider: if is_local { "ollama" } else { "other" }.into(),
        in_per_1m: if is_local { 0.0 } else { UNKNOWN_IN_PER_1M },
        out_per_1m: if is_local { 0.0 } else { UNKNOWN_OUT_PER_1M },
        local: is_local,
        estimate: !is_local,
    }
}

pub fn is_local_model(id: &str) -> bool {
    model_info(id).local
}

pub fn estimate_cost(id: &str, tokens_in: f64, tokens_out: f64) -> f64 {
    let m = model_info(id);
    round6((tokens_in * m.in_per_1m + tokens_out * m.out_per_1m) / 1_000_000.0)
}

fn registry_index(id: &str) -> usize {
    MODEL_REGISTRY
        .iter()
        .position(|m| m.id == id)
        .unwrap_or(999)
}

// ─── Counters (core.ts) ────────────────────────────────────────────────────

pub const SPEND_KINDS: [&str; 4] = ["llm_call", "tool_call", "voice", "compute"];

pub fn is_spend_kind(kind: &str) -> bool {
    SPEND_KINDS.contains(&kind)
}

#[derive(Debug, Clone, PartialEq)]
pub struct Counters {
    pub period_start: i64,
    pub day_start: i64,
    pub spent_month: f64,
    pub spent_today: f64,
    pub tokens_in_month: i64,
    pub tokens_out_month: i64,
    pub agent_month: BTreeMap<String, f64>,
    pub workspace_month: BTreeMap<String, f64>,
    pub blocked_month: i64,
    pub downshifted_month: i64,
    pub events_total: i64,
    pub biggest: Option<BiggestRun>,
    pub recent: Vec<(i64, f64)>,
}

impl Counters {
    pub fn empty(period_start: i64, day_start: i64) -> Self {
        Counters {
            period_start,
            day_start,
            spent_month: 0.0,
            spent_today: 0.0,
            tokens_in_month: 0,
            tokens_out_month: 0,
            agent_month: BTreeMap::new(),
            workspace_month: BTreeMap::new(),
            blocked_month: 0,
            downshifted_month: 0,
            events_total: 0,
            biggest: None,
            recent: Vec::new(),
        }
    }
}

pub fn apply_spend(c: &mut Counters, e: &SpendEvent, now: i64) {
    c.events_total += 1;
    if e.kind == "blocked" {
        if e.ts >= c.period_start {
            c.blocked_month += 1;
        }
        return;
    }
    if e.kind == "downshifted" {
        if e.ts >= c.period_start {
            c.downshifted_month += 1;
        }
        return;
    }
    if !is_spend_kind(&e.kind) {
        return;
    }
    let cost = round6(e.cost_usd);
    if e.ts >= c.period_start {
        c.spent_month = round6(c.spent_month + cost);
        c.tokens_in_month += e.tokens_in;
        c.tokens_out_month += e.tokens_out;
        if let Some(a) = &e.agent {
            let v = c.agent_month.get(a).copied().unwrap_or(0.0);
            c.agent_month.insert(a.clone(), round6(v + cost));
        }
        if let Some(w) = &e.workspace {
            let v = c.workspace_month.get(w).copied().unwrap_or(0.0);
            c.workspace_month.insert(w.clone(), round6(v + cost));
        }
        let bigger = match &c.biggest {
            None => true,
            Some(b) => cost > b.cost_usd + EPS,
        };
        if bigger {
            c.biggest = Some(BiggestRun {
                session_id: e.session_id.clone(),
                cost_usd: cost,
                model: e.model.clone(),
            });
        }
    }
    if e.ts >= c.day_start {
        c.spent_today = round6(c.spent_today + cost);
    }
    if e.ts > now - SPIKE_WINDOW_MS {
        c.recent.push((e.ts, cost));
        prune_recent(c, now);
    }
}

pub fn prune_recent(c: &mut Counters, now: i64) {
    let cutoff = now - SPIKE_WINDOW_MS;
    if c.recent.first().is_some_and(|r| r.0 <= cutoff) {
        c.recent.retain(|r| r.0 > cutoff);
    }
}

pub fn spike_spend(c: &Counters, now: i64) -> f64 {
    let cutoff = now - SPIKE_WINDOW_MS;
    round6(c.recent.iter().filter(|r| r.0 > cutoff).map(|r| r.1).sum())
}

pub fn counters_from(events: &[SpendEvent], period: &Period, now: i64, tz: i64) -> Counters {
    let day_start = local_day_index(now, tz) * DAY_MS + tz * 60_000;
    let mut c = Counters::empty(period.start, day_start);
    let mut sorted: Vec<&SpendEvent> = events.iter().collect();
    sorted.sort_by(|a, b| a.ts.cmp(&b.ts).then_with(|| a.id.cmp(&b.id)));
    for e in sorted {
        apply_spend(&mut c, e, now);
    }
    c
}

pub fn last_reset_at(events: &[SpendEvent], now: i64) -> Option<i64> {
    events
        .iter()
        .filter(|e| e.kind == "reset" && e.ts <= now)
        .map(|e| e.ts)
        .max()
}

// ─── State ─────────────────────────────────────────────────────────────────

pub fn usable_limit(s: &BudgetSettings) -> f64 {
    round6(s.monthly_limit * (1.0 - s.finalization_reserve_pct))
}

pub fn reserve_usd(s: &BudgetSettings) -> f64 {
    round6(s.monthly_limit - usable_limit(s))
}

pub fn derive_state(s: &BudgetSettings, c: &Counters) -> &'static str {
    if s.paused {
        return "paused";
    }
    if s.monthly_limit <= EPS {
        return "local";
    }
    let pct = c.spent_month / s.monthly_limit;
    if s.hard_cap {
        if c.spent_month >= usable_limit(s) - EPS {
            return "capped";
        }
    } else if c.spent_month >= s.monthly_limit - EPS {
        return "over";
    }
    if pct >= DANGER_PCT - EPS {
        return "danger";
    }
    if pct >= s.notify_warn_pct - EPS {
        return "warn";
    }
    "ok"
}

/// `Some("threshold" | "spike")` when the breaker should trip right now.
pub fn evaluate_trip(s: &BudgetSettings, c: &Counters, now: i64) -> Option<&'static str> {
    if s.paused {
        return None;
    }
    if s.hard_cap
        && s.monthly_limit > EPS
        && c.spent_month / s.monthly_limit >= s.circuit_breaker_pct - EPS
    {
        return Some("threshold");
    }
    if s.circuit_breaker_spend_per5min > EPS
        && spike_spend(c, now) > s.circuit_breaker_spend_per5min + EPS
    {
        return Some("spike");
    }
    None
}

pub fn pause_reason_text(reason: Option<&str>) -> String {
    match reason {
        Some("threshold") => {
            "Spending auto-paused at the circuit-breaker threshold. Resume under Budget, or raise the limit."
        }
        Some("spike") => {
            "Spending paused — an unusual spike was detected. Review Spend History, then resume if it looks right."
        }
        Some("emergency") => "Spending is paused by the emergency stop. Resume under Budget to continue.",
        _ => "Spending is paused. Resume under Budget to continue.",
    }
    .to_string()
}

// ─── Pre-call check ────────────────────────────────────────────────────────

pub fn available_models(s: &BudgetSettings) -> Vec<&'static str> {
    MODEL_REGISTRY
        .iter()
        .filter(|m| {
            s.configured_models.iter().any(|x| x == m.id)
                || s.installed_local.iter().any(|x| x == m.id)
        })
        .map(|m| m.id)
        .collect()
}

#[derive(Debug, Clone, Default)]
struct Caps {
    per_request: f64,
    month: Option<f64>,
    day: Option<f64>,
    agent: Option<f64>,
    workspace: Option<f64>,
}

impl Caps {
    fn ordered(&self) -> [(&'static str, Option<f64>); 4] {
        [
            ("month", self.month),
            ("day", self.day),
            ("agent", self.agent),
            ("workspace", self.workspace),
        ]
    }
    fn first_violation(&self, cost: f64) -> Option<&'static str> {
        if self.per_request > 0.0 && cost > self.per_request + EPS {
            return Some("per-request");
        }
        for (code, r) in self.ordered() {
            if let Some(r) = r {
                if cost > r + EPS {
                    return Some(code);
                }
            }
        }
        None
    }
    fn min_remaining(&self) -> f64 {
        let mut min = f64::INFINITY;
        for (_, r) in self.ordered() {
            if let Some(r) = r {
                if r < min {
                    min = r;
                }
            }
        }
        min
    }
}

fn caps_for(s: &BudgetSettings, c: &Counters, req: &PreCallRequest) -> Caps {
    let mut caps = Caps {
        per_request: if s.per_request_limit > EPS {
            s.per_request_limit
        } else {
            0.0
        },
        ..Default::default()
    };
    if s.monthly_limit > EPS {
        let ceiling = if req.finalization.unwrap_or(false) {
            s.monthly_limit
        } else {
            usable_limit(s)
        };
        caps.month = Some(round6(ceiling - c.spent_month));
    }
    if s.daily_limit > EPS {
        caps.day = Some(round6(s.daily_limit - c.spent_today));
    }
    if let Some(agent) = &req.agent {
        if let Some(cap) = s.per_agent_caps.get(agent) {
            if *cap > EPS {
                caps.agent = Some(round6(
                    cap - c.agent_month.get(agent).copied().unwrap_or(0.0),
                ));
            }
        }
    }
    if let Some(ws) = &req.workspace {
        if let Some(cap) = s.per_workspace_caps.get(ws) {
            if *cap > EPS {
                caps.workspace = Some(round6(
                    cap - c.workspace_month.get(ws).copied().unwrap_or(0.0),
                ));
            }
        }
    }
    caps
}

#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub model: String,
    pub cost: f64,
}

fn candidates_cheaper_than(
    s: &BudgetSettings,
    from: &str,
    ti: f64,
    to: f64,
    local_only: bool,
) -> Vec<Candidate> {
    let from_cost = estimate_cost(from, ti, to);
    available_models(s)
        .into_iter()
        .filter(|id| *id != from)
        .filter(|id| !local_only || is_local_model(id))
        .map(|id| Candidate {
            model: id.to_string(),
            cost: estimate_cost(id, ti, to),
        })
        .filter(|x| x.cost < from_cost - EPS)
        .collect()
}

fn cmp_f64(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
}

fn pick_fitting_downshift(
    s: &BudgetSettings,
    from: &str,
    ti: f64,
    to: f64,
    caps: &Caps,
    local_only: bool,
) -> Option<Candidate> {
    let mut cands = candidates_cheaper_than(s, from, ti, to, local_only);
    cands.sort_by(|a, b| {
        cmp_f64(b.cost, a.cost)
            .then_with(|| registry_index(&a.model).cmp(&registry_index(&b.model)))
    });
    cands
        .into_iter()
        .find(|cand| caps.first_violation(cand.cost).is_none())
}

fn pick_approach_downshift(
    s: &BudgetSettings,
    from: &str,
    ti: f64,
    to: f64,
    pct: f64,
) -> Option<Candidate> {
    if is_local_model(from) {
        return None;
    }
    let cands = candidates_cheaper_than(s, from, ti, to, false);
    if cands.is_empty() {
        return None;
    }
    if pct >= DANGER_PCT - EPS {
        let mut locals: Vec<Candidate> = cands
            .iter()
            .filter(|c| is_local_model(&c.model))
            .cloned()
            .collect();
        if !locals.is_empty() {
            locals.sort_by_key(|a| std::cmp::Reverse(registry_index(&a.model)));
            return locals.into_iter().next();
        }
    }
    let cloud: Vec<Candidate> = cands
        .iter()
        .filter(|c| !is_local_model(&c.model))
        .cloned()
        .collect();
    if cloud.is_empty() {
        return None;
    }
    let provider = model_info(from).provider;
    let same: Vec<Candidate> = cloud
        .iter()
        .filter(|c| model_info(&c.model).provider == provider)
        .cloned()
        .collect();
    let mut pool = if same.is_empty() { cloud } else { same };
    pool.sort_by(|a, b| {
        cmp_f64(a.cost, b.cost)
            .then_with(|| registry_index(&a.model).cmp(&registry_index(&b.model)))
    });
    pool.into_iter().next()
}

fn denial_text(
    code: &str,
    s: &BudgetSettings,
    c: &Counters,
    req: &PreCallRequest,
    cost: f64,
    now: i64,
    reset_date: Option<&str>,
) -> String {
    match code {
        "paused" => pause_reason_text(s.pause_reason.as_deref()),
        "per-request" => format!(
            "This call would cost about {}, more than your per-request limit of {}. Use a cheaper model or raise the limit under Budget → Settings.",
            fmt_usd(cost, true),
            fmt_usd(s.per_request_limit, false)
        ),
        "month" => format!(
            "Budget limit reached — you've spent {} of your {} limit. Raise the limit, switch to a local model, or wait for your reset{}.",
            fmt_usd(c.spent_month, false),
            fmt_usd(s.monthly_limit, false),
            reset_date.map(|d| format!(" on {}", short_date(d))).unwrap_or_default()
        ),
        "day" => format!(
            "Daily limit reached — {} of {} today. Raise the daily limit under Budget → Settings or try again tomorrow.",
            fmt_usd(c.spent_today, false),
            fmt_usd(s.daily_limit, false)
        ),
        "agent" => {
            let agent = req.agent.clone().unwrap_or_else(|| "This agent".into());
            let cap = req.agent.as_ref().and_then(|a| s.per_agent_caps.get(a)).copied().unwrap_or(0.0);
            format!("{} has reached its {} cap this month. Raise it under Budget → Agents.", agent, fmt_usd(cap, false))
        }
        "workspace" => {
            let ws = req.workspace.clone().unwrap_or_default();
            let cap = req.workspace.as_ref().and_then(|w| s.per_workspace_caps.get(w)).copied().unwrap_or(0.0);
            format!("Workspace {} has reached its {} cap this month. Raise it under Budget → Workspaces.", ws, fmt_usd(cap, false))
        }
        "local-only" => "Cloud models are off while the monthly budget is $0. Raise the budget or pick a local model.".into(),
        "spike" => format!(
            "Unusual spending spike — {} in the last 5 minutes. Spending is paused until you resume it under Budget.",
            fmt_usd(spike_spend(c, now), false)
        ),
        _ => String::new(),
    }
}

const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// The governor. Order: paused → local-only → per-request → approach
/// downshift → caps (month, day, agent, workspace) → spike breaker → allow.
pub fn check_pre_call(
    s: &BudgetSettings,
    c: &Counters,
    req: &PreCallRequest,
    now: i64,
    reset_date: Option<&str>,
) -> PreCallCheck {
    let state = derive_state(s, c).to_string();
    let tokens_in = req.estimated_tokens_in.max(0.0).floor();
    let tokens_out = req.estimated_tokens_out.max(0.0).floor();
    let mut model = req.model.clone();
    let mut cost = round6(
        req.estimated_cost
            .unwrap_or_else(|| estimate_cost(&model, tokens_in, tokens_out)),
    );
    let caps = caps_for(s, c, req);
    let hard_caps = Caps {
        per_request: 0.0,
        month: if s.monthly_limit > EPS {
            Some(round6(s.monthly_limit - c.spent_month))
        } else {
            caps.month
        },
        ..caps.clone()
    };
    let hard_min = hard_caps.min_remaining();
    let hard_remaining = if s.hard_cap && hard_min.is_finite() {
        Some(hard_min.max(0.0))
    } else {
        None
    };
    let usable_min = caps.min_remaining();
    let remaining_now = if usable_min.is_finite() {
        usable_min.max(0.0)
    } else {
        MAX_SAFE_INTEGER
    };

    let mut downgraded: Option<String> = None;
    let mut why: Option<String> = None;

    macro_rules! deny {
        ($code:expr) => {
            return PreCallCheck {
                allowed: false,
                code: $code.to_string(),
                reason: Some(denial_text($code, s, c, req, cost, now, reset_date)),
                downgraded_to_model: downgraded.clone(),
                downshift_why: why.clone(),
                model: model.clone(),
                estimated_cost: cost,
                remaining: remaining_now,
                hard_remaining,
                state: state.clone(),
                warning: None,
            }
        };
    }

    if s.paused {
        deny!("paused");
    }

    let local_only = s.monthly_limit <= EPS;
    if local_only && !is_local_model(&model) {
        let alt = if s.model_downshifting {
            pick_fitting_downshift(s, &model, tokens_in, tokens_out, &caps, true)
        } else {
            None
        };
        match alt {
            None => deny!("local-only"),
            Some(cand) => {
                downgraded = Some(cand.model.clone());
                why = Some("Monthly budget is $0 — local models only.".into());
                model = cand.model;
                cost = cand.cost;
            }
        }
    }

    if caps.per_request > 0.0 && cost > caps.per_request + EPS {
        let alt = if s.model_downshifting {
            pick_fitting_downshift(s, &model, tokens_in, tokens_out, &caps, local_only)
        } else {
            None
        };
        match alt {
            None => deny!("per-request"),
            Some(cand) => {
                downgraded = Some(cand.model.clone());
                why = Some(format!(
                    "This call would have exceeded the {} per-request limit.",
                    fmt_usd(s.per_request_limit, false)
                ));
                model = cand.model;
                cost = cand.cost;
            }
        }
    }

    if !local_only && s.model_downshifting && downgraded.is_none() {
        let pct = c.spent_month / s.monthly_limit;
        if pct >= s.notify_warn_pct - EPS {
            if let Some(cand) = pick_approach_downshift(s, &model, tokens_in, tokens_out, pct) {
                downgraded = Some(cand.model.clone());
                why = Some(format!("{} of the monthly budget is used.", fmt_pct(pct)));
                model = cand.model;
                cost = cand.cost;
            }
        }
    }

    if let Some(violation) = caps.first_violation(cost) {
        let soft = !s.hard_cap && violation != "per-request";
        if !soft {
            deny!(violation);
        }
        return PreCallCheck {
            allowed: true,
            code: "over-soft".into(),
            reason: None,
            downgraded_to_model: downgraded,
            downshift_why: why,
            model,
            estimated_cost: cost,
            remaining: 0.0,
            hard_remaining,
            state,
            warning: Some(format!(
                "Over budget — {} of {} spent. Hard cap is off, so this call was allowed.",
                fmt_usd(c.spent_month, false),
                fmt_usd(s.monthly_limit, false)
            )),
        };
    }

    if s.circuit_breaker_spend_per5min > EPS
        && spike_spend(c, now) > s.circuit_breaker_spend_per5min + EPS
    {
        deny!("spike");
    }

    let after = if usable_min.is_finite() {
        round6(usable_min - cost).max(0.0)
    } else {
        MAX_SAFE_INTEGER
    };
    PreCallCheck {
        allowed: true,
        code: if downgraded.is_some() {
            "downshifted"
        } else {
            "ok"
        }
        .into(),
        reason: None,
        downgraded_to_model: downgraded,
        downshift_why: why,
        model,
        estimated_cost: cost,
        remaining: after,
        hard_remaining,
        state,
        warning: None,
    }
}

// ─── Overview ──────────────────────────────────────────────────────────────

pub fn overview_from(s: &BudgetSettings, c: &Counters, p: &Period, now: i64) -> BudgetOverview {
    let pct_used_month = if s.monthly_limit > EPS {
        c.spent_month / s.monthly_limit
    } else {
        0.0
    };
    let pct_used_today = if s.daily_limit > EPS {
        c.spent_today / s.daily_limit
    } else {
        0.0
    };
    let avg_per_day = round6(c.spent_month / p.days_elapsed as f64);
    let projected = round6(c.spent_month + avg_per_day * (p.days_until_reset - 1) as f64);
    let remaining = if s.monthly_limit > EPS {
        round6(usable_limit(s) - c.spent_month).max(0.0)
    } else {
        0.0
    };
    BudgetOverview {
        spent_today: c.spent_today,
        spent_month: c.spent_month,
        monthly_limit: s.monthly_limit,
        daily_limit: s.daily_limit,
        pct_used_month,
        pct_used_today,
        tokens_in_month: c.tokens_in_month,
        tokens_out_month: c.tokens_out_month,
        days_until_reset: p.days_until_reset,
        reset_date: p.reset_date.clone(),
        period_start: p.start,
        period_end: p.end,
        avg_per_day,
        projected_month_end: projected,
        biggest_run: c.biggest.clone(),
        remaining,
        reserve_usd: reserve_usd(s),
        spent_last5min: spike_spend(c, now),
        blocked_month: c.blocked_month,
        downshifted_month: c.downshifted_month,
        agent_spend: c.agent_month.clone(),
        workspace_spend: c.workspace_month.clone(),
        events_total: c.events_total,
        state: derive_state(s, c).into(),
        settings: s.clone(),
        computed_at: now,
    }
}

// ─── Filters / sort / aggregations ─────────────────────────────────────────

pub fn range_start(range: &str, now: i64) -> i64 {
    match range {
        "24h" => now - DAY_MS,
        "7d" => now - 7 * DAY_MS,
        "30d" => now - 30 * DAY_MS,
        _ => 0,
    }
}

pub fn filter_events<'a>(
    events: &'a [SpendEvent],
    f: &SpendFilter,
    now: i64,
) -> Vec<&'a SpendEvent> {
    let start = range_start(&f.range, now);
    let q = f.search.trim().to_lowercase();
    events
        .iter()
        .filter(|e| {
            if e.ts < start {
                return false;
            }
            if f.category != "all" && e.category != f.category {
                return false;
            }
            if f.model != "all" && e.model.as_deref() != Some(f.model.as_str()) {
                return false;
            }
            if f.agent != "all" && e.agent.as_deref() != Some(f.agent.as_str()) {
                return false;
            }
            if f.kind == "spend" && !is_spend_kind(&e.kind) {
                return false;
            }
            if f.kind == "blocked" && e.kind != "blocked" {
                return false;
            }
            if f.kind == "downshifted" && e.kind != "downshifted" {
                return false;
            }
            if !q.is_empty() {
                let hay = [
                    e.kind.clone(),
                    e.agent.clone().unwrap_or_default(),
                    e.workspace.clone().unwrap_or_default(),
                    e.session_id.clone().unwrap_or_default(),
                    e.model.clone().unwrap_or_default(),
                    e.category.clone(),
                    e.detail.as_ref().map(|d| d.to_string()).unwrap_or_default(),
                ]
                .join(" ")
                .to_lowercase();
                if !hay.contains(&q) {
                    return false;
                }
            }
            true
        })
        .collect()
}

pub fn sort_events(events: &mut [&SpendEvent], sort: &SpendSort) {
    let asc = sort.dir == "asc";
    let by_cost = sort.key == "costUsd";
    events.sort_by(|a, b| {
        let d = if by_cost {
            cmp_f64(a.cost_usd, b.cost_usd)
        } else {
            a.ts.cmp(&b.ts)
        };
        let o = d
            .then_with(|| a.ts.cmp(&b.ts))
            .then_with(|| a.id.cmp(&b.id));
        if asc {
            o
        } else {
            o.reverse()
        }
    });
}

pub fn total_cost<'a>(events: impl Iterator<Item = &'a SpendEvent>) -> f64 {
    round6(
        events
            .filter(|e| is_spend_kind(&e.kind))
            .map(|e| e.cost_usd)
            .sum(),
    )
}

fn empty_by_category() -> BTreeMap<String, f64> {
    ["llm", "tools", "voice", "compute"]
        .iter()
        .map(|k| (k.to_string(), 0.0))
        .collect()
}

pub fn series_for(events: &[SpendEvent], range: &str, now: i64, tz: i64) -> Vec<SeriesBucket> {
    let hourly = range == "24h";
    let tz_ms = tz * 60_000;
    let size = if hourly { HOUR_MS } else { DAY_MS };
    let now_idx = (now - tz_ms).div_euclid(size);
    let count: i64 = if hourly {
        24
    } else if range == "7d" {
        7
    } else if range == "30d" {
        30
    } else {
        let oldest = events
            .iter()
            .filter(|e| is_spend_kind(&e.kind))
            .map(|e| e.ts)
            .min()
            .unwrap_or(now)
            .min(now);
        (now_idx - (oldest - tz_ms).div_euclid(size) + 1).clamp(7, 90)
    };
    let first_idx = now_idx - count + 1;
    let mut buckets: Vec<SeriesBucket> = (0..count)
        .map(|i| {
            let idx = first_idx + i;
            let at = idx * size + tz_ms;
            let label = if hourly {
                format!("{:02}:00", idx.rem_euclid(24))
            } else {
                short_day_label(at, tz)
            };
            SeriesBucket {
                at,
                label,
                total: 0.0,
                by_category: empty_by_category(),
            }
        })
        .collect();
    for e in events {
        if !is_spend_kind(&e.kind) {
            continue;
        }
        let idx = (e.ts - tz_ms).div_euclid(size) - first_idx;
        if idx < 0 || idx >= count {
            continue;
        }
        let b = &mut buckets[idx as usize];
        b.total = round6(b.total + e.cost_usd);
        let v = b.by_category.get(&e.category).copied().unwrap_or(0.0);
        b.by_category
            .insert(e.category.clone(), round6(v + e.cost_usd));
    }
    buckets
}

pub fn breakdown(events: &[SpendEvent], by: &str, range: &str, now: i64) -> Vec<BreakdownRow> {
    let start = range_start(range, now);
    let mut map: BTreeMap<String, BreakdownRow> = BTreeMap::new();
    for e in events {
        if e.ts < start || !is_spend_kind(&e.kind) {
            continue;
        }
        let key = match by {
            "model" => e.model.clone().unwrap_or_else(|| "—".into()),
            "agent" => e.agent.clone().unwrap_or_else(|| "—".into()),
            "workspace" => e.workspace.clone().unwrap_or_else(|| "—".into()),
            _ => e.category.clone(),
        };
        let row = map.entry(key.clone()).or_insert(BreakdownRow {
            key,
            cost: 0.0,
            tokens: 0,
            count: 0,
        });
        row.cost = round6(row.cost + e.cost_usd);
        row.tokens += e.tokens_in + e.tokens_out;
        row.count += 1;
    }
    let mut rows: Vec<BreakdownRow> = map.into_values().collect();
    rows.sort_by(|a, b| cmp_f64(b.cost, a.cost).then_with(|| a.key.cmp(&b.key)));
    rows
}

// ─── Seed (seed.ts) ────────────────────────────────────────────────────────

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
        (t ^ (t >> 14)) as f64 / 4_294_967_296.0
    }
}

fn pick<'a, T>(rand: &mut Mulberry32, table: &'a [(T, f64)]) -> &'a T {
    let r = rand.next_f64();
    let mut acc = 0.0;
    for (v, w) in table {
        acc += w;
        if r < acc {
            return v;
        }
    }
    &table[table.len() - 1].0
}

fn category_of(kind: &str) -> &'static str {
    match kind {
        "tool_call" => "tools",
        "voice" => "voice",
        "compute" => "compute",
        _ => "llm",
    }
}

/// ~220 events across the 30 local days before `now` (none today).
pub fn seed_events(now: i64, tz: i64) -> Vec<SpendEvent> {
    let agents: [(&str, f64); 4] = [
        ("main", 0.45),
        ("coder", 0.25),
        ("research", 0.2),
        ("writer", 0.1),
    ];
    let workspaces: [(&str, f64); 3] = [("xr", 0.55), ("client-acme", 0.3), ("personal", 0.15)];
    let models: [(&str, f64); 7] = [
        ("claude-sonnet-4.5", 0.35),
        ("gpt-5-mini", 0.2),
        ("claude-haiku-4-6", 0.15),
        ("gpt-4o-mini", 0.1),
        ("gemini-2.5-flash", 0.1),
        ("qwen2.5:3b", 0.07),
        ("gpt-5", 0.03),
    ];
    let kinds: [(&str, f64); 4] = [
        ("llm_call", 0.85),
        ("tool_call", 0.08),
        ("voice", 0.04),
        ("compute", 0.03),
    ];
    let tools = [
        "web_search",
        "read_file",
        "shell",
        "gmail",
        "calendar",
        "browser",
    ];

    let mut rand = Mulberry32::new(SEED_RNG);
    let today_start = local_day_start(now, tz);
    let mut out: Vec<SpendEvent> = Vec::with_capacity(260);
    let mut n = 0u32;
    let mut next_id = || {
        n += 1;
        format!("sp_seed_{:04}", n)
    };

    for back in (1..=30).rev() {
        let day_start = today_start - back * DAY_MS;
        let count = 4 + (rand.next_f64() * 8.0).floor() as i64;
        for _ in 0..count {
            let hour = 9 + (rand.next_f64() * 12.0).floor() as i64;
            let minute = (rand.next_f64() * 60.0).floor() as i64;
            let second = (rand.next_f64() * 60.0).floor() as i64;
            let ts = day_start + ((hour * 60 + minute) * 60 + second) * 1000;
            let kind = *pick(&mut rand, &kinds);
            let agent = *pick(&mut rand, &agents);
            let workspace = *pick(&mut rand, &workspaces);
            let session_hex = format!("{:04x}", (rand.next_f64() * 65535.0).floor() as u32);
            let session_id = if agent == "main" {
                format!("chat-{}", session_hex)
            } else {
                format!("run-{}", session_hex)
            };
            let mut model: Option<String> = None;
            let mut tokens_in = 0i64;
            let mut tokens_out = 0i64;
            let cost_usd: f64;
            let mut detail: Option<Value> = None;
            if kind == "llm_call" {
                let m = *pick(&mut rand, &models);
                model = Some(m.to_string());
                tokens_in = 300 + (rand.next_f64() * 2500.0).floor() as i64;
                tokens_out = 100 + (rand.next_f64() * 1200.0).floor() as i64;
                cost_usd = estimate_cost(m, tokens_in as f64, tokens_out as f64);
            } else if kind == "tool_call" {
                let tool = tools[(rand.next_f64() * tools.len() as f64).floor() as usize];
                cost_usd = round6(0.001 + rand.next_f64() * 0.019);
                detail = Some(serde_json::json!({ "tool": tool }));
            } else if kind == "voice" {
                let seconds = 20 + (rand.next_f64() * 160.0).floor() as i64;
                cost_usd = round6(seconds as f64 * 0.00025);
                model = Some("tts-1".into());
                detail = Some(serde_json::json!({ "seconds": seconds }));
            } else {
                cost_usd = round6(0.002 + rand.next_f64() * 0.048);
                detail = Some(serde_json::json!({ "job": "embeddings" }));
            }
            out.push(SpendEvent {
                id: next_id(),
                ts,
                kind: kind.into(),
                agent: Some(agent.into()),
                workspace: Some(workspace.into()),
                session_id: Some(session_id),
                model,
                tokens_in,
                tokens_out,
                cost_usd,
                category: category_of(kind).into(),
                detail,
            });
        }
    }

    let governor: [(i64, &str); 6] = [
        (26, "downshifted"),
        (19, "blocked"),
        (12, "downshifted"),
        (9, "blocked"),
        (4, "downshifted"),
        (2, "blocked"),
    ];
    for (back, kind) in governor {
        let day_start = today_start - back * DAY_MS;
        let hour = 9 + (rand.next_f64() * 12.0).floor() as i64;
        let minute = (rand.next_f64() * 60.0).floor() as i64;
        let ts = day_start + (hour * 60 + minute) * 60 * 1000;
        let agent = *pick(&mut rand, &agents);
        let workspace = *pick(&mut rand, &workspaces);
        let id = next_id();
        if kind == "blocked" {
            let session = format!("run-{:04x}", (rand.next_f64() * 65535.0).floor() as u32);
            let est = round6(0.26 + rand.next_f64() * 0.2);
            out.push(SpendEvent {
                id,
                ts,
                kind: "blocked".into(),
                agent: Some(agent.into()),
                workspace: Some(workspace.into()),
                session_id: Some(session),
                model: Some("claude-opus-4-6".into()),
                tokens_in: 0,
                tokens_out: 0,
                cost_usd: 0.0,
                category: "llm".into(),
                detail: Some(serde_json::json!({ "code": "per-request", "estimatedCost": est })),
            });
        } else {
            let session = format!("chat-{:04x}", (rand.next_f64() * 65535.0).floor() as u32);
            out.push(SpendEvent {
                id,
                ts,
                kind: "downshifted".into(),
                agent: Some(agent.into()),
                workspace: Some(workspace.into()),
                session_id: Some(session),
                model: Some("gpt-5-mini".into()),
                tokens_in: 0,
                tokens_out: 0,
                cost_usd: 0.0,
                category: "llm".into(),
                detail: Some(serde_json::json!({ "from": "gpt-5", "to": "gpt-5-mini" })),
            });
        }
    }

    out.sort_by(|a, b| a.ts.cmp(&b.ts).then_with(|| a.id.cmp(&b.id)));
    out
}

// ─── Tests: the vectors shared with test/desktop/budget-core.test.ts ───────

#[cfg(test)]
mod tests {
    use super::*;

    // Date.UTC(2026, 9, 5, 9, 30, 0) and Asia/Karachi (getTimezoneOffset = -300).
    const NOW: i64 = 1_791_192_600_000;
    const TZ: i64 = -300;

    fn settings() -> BudgetSettings {
        BudgetSettings::default()
    }

    fn counters(s: &BudgetSettings, spent_month: f64, spent_today: f64) -> Counters {
        let p = period_for(NOW, TZ, s.month_start_day, None);
        let mut c = Counters::empty(p.start, local_day_start(NOW, TZ));
        c.spent_month = spent_month;
        c.spent_today = spent_today;
        c
    }

    fn req(model: &str, ti: f64, to: f64) -> PreCallRequest {
        PreCallRequest {
            model: model.into(),
            estimated_tokens_in: ti,
            estimated_tokens_out: to,
            estimated_cost: None,
            agent: Some("main".into()),
            workspace: Some("xr".into()),
            session_id: None,
            finalization: None,
            surface: "chat".into(),
        }
    }

    fn near(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn civil_dates_round_trip() {
        assert_eq!(days_from_civil(2026, 10, 5), 20731);
        assert_eq!(civil_from_days(20731), (2026, 10, 5));
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
    }

    #[test]
    fn period_october_pkt() {
        let p = period_for(NOW, TZ, 1, None);
        assert_eq!(p.start, 1_790_794_800_000); // 2026-09-30T19:00Z
        assert_eq!(p.end, 1_793_473_200_000); // 2026-10-31T19:00Z
        assert_eq!(p.days_until_reset, 27);
        assert_eq!(p.days_elapsed, 5);
        assert_eq!(p.reset_date, "2026-10-31");
        let p15 = period_for(NOW, TZ, 15, None);
        assert_eq!(p15.start, 1_789_412_400_000); // 2026-09-14T19:00Z
        assert_eq!(p15.reset_date, "2026-10-14");
        let reset = NOW - 2 * DAY_MS;
        let pr = period_for(NOW, TZ, 1, Some(reset));
        assert_eq!(pr.start, reset);
        assert_eq!(pr.days_elapsed, 3);
    }

    #[test]
    fn price_table() {
        assert!(near(
            estimate_cost("claude-sonnet-4.5", 2000.0, 800.0),
            0.018
        ));
        assert!(near(estimate_cost("gpt-5-mini", 2000.0, 800.0), 0.00078));
        assert!(near(estimate_cost("mystery-9000", 2000.0, 800.0), 0.022));
        assert!(model_info("mystery-9000").estimate);
        assert!(near(estimate_cost("qwen2.5:3b", 2000.0, 800.0), 0.0));
        assert!(is_local_model("ollama/anything"));
        assert!(is_local_model("llama3.1:8B"));
        assert!(!is_local_model("gpt-5"));
    }

    #[test]
    fn formatting_matches_intl() {
        assert_eq!(fmt_usd(0.41, false), "$0.41");
        assert_eq!(fmt_usd(5.0, false), "$5.00");
        assert_eq!(fmt_usd(0.0078, false), "$0.0078");
        assert_eq!(fmt_usd(1234.5, false), "$1,234.50");
        assert_eq!(fmt_usd(0.018, true), "$0.0180");
        assert_eq!(fmt_pct(0.8), "80%");
        assert_eq!(short_date("2026-10-31"), "Oct 31");
    }

    #[test]
    fn fresh_defaults_allow_and_report_remaining() {
        let s = settings();
        assert!(near(usable_limit(&s), 4.5));
        let r = check_pre_call(
            &s,
            &counters(&s, 0.0, 0.0),
            &req("claude-sonnet-4.5", 2000.0, 800.0),
            NOW,
            None,
        );
        assert!(r.allowed);
        assert_eq!(r.code, "ok");
        assert!(near(r.remaining, 0.982));
        assert_eq!(r.hard_remaining, Some(1.0));
        assert_eq!(r.state, "ok");
    }

    #[test]
    fn one_cent_cap_blocks_with_a_repair_path() {
        // The demo path: seeded month spend ($0.41) vs a $0.01 cap.
        let mut s = settings();
        s.monthly_limit = 0.01;
        let c = counters(&s, 0.41, 0.0);
        let r = check_pre_call(
            &s,
            &c,
            &req("claude-sonnet-4.5", 2000.0, 800.0),
            NOW,
            Some("2026-10-31"),
        );
        assert!(!r.allowed);
        // Approach downshift fires first (local model, $0) and the month cap still bites.
        assert_eq!(r.code, "month");
        let reason = r.reason.unwrap();
        assert!(reason.contains("Budget limit reached"), "{}", reason);
        assert!(reason.contains("$0.41 of your $0.01 limit"), "{}", reason);
        assert!(reason.contains("on Oct 31"), "{}", reason);
        assert_eq!(derive_state(&s, &c), "capped");
        let mut raised = s.clone();
        raised.monthly_limit = 5.0;
        assert!(
            check_pre_call(
                &raised,
                &c,
                &req("claude-sonnet-4.5", 2000.0, 800.0),
                NOW,
                None
            )
            .allowed
        );
    }

    #[test]
    fn per_request_downshifts_then_denies() {
        let s = settings();
        let big = req("gpt-5", 100_000.0, 20_000.0);
        let r = check_pre_call(&s, &counters(&s, 0.0, 0.0), &big, NOW, None);
        assert!(r.allowed);
        assert_eq!(r.code, "downshifted");
        assert_eq!(r.downgraded_to_model.as_deref(), Some("gemini-2.5-flash"));
        assert!(near(r.estimated_cost, 0.08));
        let mut off = settings();
        off.model_downshifting = false;
        let d = check_pre_call(&off, &counters(&off, 0.0, 0.0), &big, NOW, None);
        assert!(!d.allowed);
        assert_eq!(d.code, "per-request");
        assert!(d.reason.unwrap().contains("per-request limit of $0.25"));
    }

    #[test]
    fn per_request_one_dollar_blocks_opus() {
        let mut s = settings();
        s.per_request_limit = 1.0;
        s.configured_models = vec!["claude-opus-4-6".into()];
        s.installed_local = vec![];
        let r = check_pre_call(
            &s,
            &counters(&s, 0.0, 0.0),
            &req("claude-opus-4-6", 40_000.0, 8_000.0),
            NOW,
            None,
        );
        assert!(!r.allowed);
        assert_eq!(r.code, "per-request");
        assert!(near(r.estimated_cost, 1.2));
    }

    #[test]
    fn approach_downshift_sonnet_haiku_local() {
        let s = settings();
        let r = req("claude-sonnet-4.5", 2000.0, 800.0);
        let warn = check_pre_call(&s, &counters(&s, 4.0, 0.0), &r, NOW, None);
        assert_eq!(
            warn.downgraded_to_model.as_deref(),
            Some("claude-haiku-4-6")
        );
        assert!(warn.downshift_why.unwrap().contains("80%"));
        let danger = check_pre_call(&s, &counters(&s, 4.3, 0.0), &r, NOW, None);
        assert_eq!(
            danger.downgraded_to_model.as_deref(),
            Some("qwen2.5-coder:3b")
        );
        let mut no_local = settings();
        no_local.installed_local = vec![];
        let d2 = check_pre_call(&no_local, &counters(&no_local, 4.3, 0.0), &r, NOW, None);
        assert_eq!(d2.downgraded_to_model.as_deref(), Some("claude-haiku-4-6"));
        let mut off = settings();
        off.model_downshifting = false;
        assert_eq!(
            check_pre_call(&off, &counters(&off, 4.0, 0.0), &r, NOW, None).code,
            "ok"
        );
    }

    #[test]
    fn reserve_blocks_new_work_but_allows_finalization() {
        let s = settings();
        let c = counters(&s, 4.49, 0.0);
        let mut small = req("gpt-5-mini", 2000.0, 800.0);
        small.model = "claude-sonnet-4.5".into();
        let mut off = s.clone();
        off.model_downshifting = false;
        let denied = check_pre_call(&off, &c, &small, NOW, None);
        assert!(!denied.allowed);
        assert_eq!(denied.code, "month");
        small.finalization = Some(true);
        let fin = check_pre_call(&off, &c, &small, NOW, None);
        assert!(fin.allowed);
        assert!(near(fin.remaining, 0.492));
    }

    #[test]
    fn hard_cap_off_warns_instead_of_blocking() {
        let mut s = settings();
        s.hard_cap = false;
        s.model_downshifting = false;
        let r = check_pre_call(
            &s,
            &counters(&s, 4.99, 0.0),
            &req("claude-sonnet-4.5", 2000.0, 800.0),
            NOW,
            None,
        );
        assert!(r.allowed);
        assert_eq!(r.code, "over-soft");
        assert!(r.warning.unwrap().contains("Hard cap is off"));
        assert_eq!(r.hard_remaining, None);
    }

    #[test]
    fn states_and_breakers() {
        let s = settings();
        assert_eq!(derive_state(&s, &counters(&s, 4.49996, 0.0)), "capped");
        assert_eq!(derive_state(&s, &counters(&s, 4.4998, 0.0)), "danger");
        assert_eq!(derive_state(&s, &counters(&s, 4.0, 0.0)), "warn");
        assert_eq!(derive_state(&s, &counters(&s, 1.0, 0.0)), "ok");
        assert_eq!(evaluate_trip(&s, &counters(&s, 4.74, 0.0), NOW), None);
        assert_eq!(
            evaluate_trip(&s, &counters(&s, 4.75, 0.0), NOW),
            Some("threshold")
        );
        let mut c = counters(&s, 0.0, 0.0);
        for i in 0..18 {
            let e = SpendEvent {
                id: format!("e{}", i),
                ts: NOW - 1000 * (i as i64),
                kind: "llm_call".into(),
                agent: Some("main".into()),
                workspace: None,
                session_id: None,
                model: Some("claude-sonnet-4.5".into()),
                tokens_in: 0,
                tokens_out: 0,
                cost_usd: 0.03,
                category: "llm".into(),
                detail: None,
            };
            apply_spend(&mut c, &e, NOW);
        }
        assert_eq!(evaluate_trip(&s, &c, NOW), Some("spike"));
        assert_eq!(evaluate_trip(&s, &c, NOW + 6 * 60_000), None);
        let mut local = settings();
        local.monthly_limit = 0.0;
        let r = check_pre_call(
            &local,
            &counters(&local, 0.0, 0.0),
            &req("claude-sonnet-4.5", 2000.0, 800.0),
            NOW,
            None,
        );
        assert_eq!(r.downgraded_to_model.as_deref(), Some("qwen2.5:3b"));
        assert_eq!(r.state, "local");
    }

    #[test]
    fn mulberry32_vector() {
        let mut r = Mulberry32::new(0x1317_b0d6);
        let v: Vec<f64> = (0..4).map(|_| (r.next_f64() * 1e9).round() / 1e9).collect();
        assert_eq!(v, vec![0.847121331, 0.601883391, 0.856674884, 0.055983332]);
    }

    #[test]
    fn seed_vector_matches_webview() {
        let a = seed_events(NOW, TZ);
        assert_eq!(a.len(), 246);
        let first = &a[0];
        assert_eq!(first.id, "sp_seed_0004");
        assert_eq!(first.ts, 1_788_581_594_000);
        assert_eq!(first.agent.as_deref(), Some("main"));
        assert_eq!(first.workspace.as_deref(), Some("xr"));
        assert_eq!(first.session_id.as_deref(), Some("chat-b69c"));
        assert_eq!(first.model.as_deref(), Some("claude-sonnet-4.5"));
        assert_eq!((first.tokens_in, first.tokens_out), (362, 906));
        assert!(near(first.cost_usd, 0.014676));
        let last = &a[a.len() - 1];
        assert_eq!(last.id, "sp_seed_0233");
        assert_eq!(last.ts, 1_791_129_357_000);
        assert_eq!(last.model.as_deref(), Some("gemini-2.5-flash"));
        assert_eq!((last.tokens_in, last.tokens_out), (1800, 823));
        assert!(near(last.cost_usd, 0.002598));
        assert_eq!(a.iter().filter(|e| e.kind == "blocked").count(), 3);
        assert_eq!(a.iter().filter(|e| e.kind == "downshifted").count(), 3);
        let today = local_day_start(NOW, TZ);
        assert!(a.iter().all(|e| e.ts < today));
        let p = period_for(NOW, TZ, 1, None);
        let c = counters_from(&a, &p, NOW, TZ);
        assert!(near(c.spent_month, 0.409827), "{}", c.spent_month);
        assert_eq!(c.tokens_in_month, 47225);
        assert_eq!(c.tokens_out_month, 20640);
        assert!(near(c.spent_today, 0.0));
        let total = round6(a.iter().map(|e| e.cost_usd).sum());
        assert!(near(total, 2.084444), "{}", total);
    }

    #[test]
    fn series_and_breakdown() {
        let events = seed_events(NOW, TZ);
        let s30 = series_for(&events, "30d", NOW, TZ);
        assert_eq!(s30.len(), 30);
        assert_eq!(s30[29].label, "Oct 5");
        assert!(near(s30[29].total, 0.0));
        let sum: f64 = s30.iter().map(|b| b.total).sum();
        let expected: f64 = events
            .iter()
            .filter(|e| e.ts >= s30[0].at && e.cost_usd > 0.0)
            .map(|e| e.cost_usd)
            .sum();
        assert!((sum - expected).abs() < 0.0001);
        let h = series_for(&events, "24h", NOW, TZ);
        assert_eq!(h.len(), 24);
        assert_eq!(h[23].label, "14:00");
        let rows = breakdown(&events, "model", "all", NOW);
        assert!(rows.len() > 3);
        for w in rows.windows(2) {
            assert!(w[0].cost >= w[1].cost);
        }
        let f = SpendFilter {
            search: String::new(),
            category: "all".into(),
            model: "all".into(),
            agent: "all".into(),
            kind: "blocked".into(),
            range: "all".into(),
        };
        assert_eq!(filter_events(&events, &f, NOW).len(), 3);
    }

    #[test]
    fn settings_coercion_clamps() {
        let v = serde_json::json!({
            "monthlyLimit": -3, "circuitBreakerPct": 2, "finalizationReservePct": 0.9,
            "monthStartDay": 31, "pauseReason": "bogus", "billingTier": "pro",
            "perAgentCaps": { "coder": 2.5, "bad": -1 }
        });
        let s = coerce_settings(&v);
        assert!(near(s.monthly_limit, 0.0));
        assert!(near(s.circuit_breaker_pct, 1.0));
        assert!(near(s.finalization_reserve_pct, 0.2));
        assert_eq!(s.month_start_day, 28);
        assert_eq!(s.pause_reason, None);
        assert_eq!(s.billing_tier, "pro");
        assert_eq!(s.per_agent_caps.get("coder").copied(), Some(2.5));
        assert!(!s.per_agent_caps.contains_key("bad"));
        assert_eq!(s.configured_models.len(), 7);
    }
}
