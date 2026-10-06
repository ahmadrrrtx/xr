/*
 * Budget governor — host side (Phase 13, SCREEN 11).
 *
 * What is real here:
 *   - Every mock LLM / tool / voice / compute charge goes through
 *     `budget_check` BEFORE the call starts and `budget_record` after it.
 *     The verdict is computed by `governor.rs`, a line-for-line port of
 *     desktop/src/budget/core.ts — the webview's browser fallback and this
 *     module agree on every number and every message string.
 *   - A hard cap ON means the call does not start. There is no bypass flag;
 *     the webview cannot "spend anyway" (Constitution Art. IV.2 — enforced
 *     claims must be enforced in code).
 *   - Spend events and settings live in the shared xr.db (WAL, own
 *     connection, same pattern as shield::ShieldDb). The in-memory mirror is
 *     the working set; SQLite is the source of truth across launches.
 *   - Breakers (threshold / spike) flip `paused` here and broadcast
 *     `budget:state-change` + `budget:settings` so every window reacts.
 *
 * Money: nothing in this module bills anybody. Costs are the price-table
 * estimates for the mock LLM. Unknown models are priced at the flagged
 * $5 / $15 per 1M estimate (Art. IV.5 — the UI shows an "estimate" pill).
 */
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub mod governor;

use governor::*;

const DDL: &str = include_str!("migrations.sql");
pub const EVENT_CAP: usize = 5000;
const KEY_SETTINGS: &str = "settings";
const KEY_SEEDED: &str = "seeded";

pub const EV_STATE_CHANGE: &str = "budget:state-change";
pub const EV_SPEND: &str = "budget:spend";
pub const EV_SETTINGS: &str = "budget:settings";

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn base36(mut n: u64) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// `sp_{now base36}{8 random hex}` — same shape as core.ts newSpendId().
fn new_spend_id(now: i64) -> String {
    let rnd = uuid::Uuid::new_v4().simple().to_string();
    format!("sp_{}{}", base36(now.max(0) as u64), &rnd[..8])
}

type Outbox = Vec<(&'static str, Value)>;

struct Inner {
    conn: Connection,
    settings: BudgetSettings,
    /// Insertion order (rowid order on load), like the webview's array.
    events: Vec<SpendEvent>,
    tz: i64,
    counters: Option<Counters>,
    period: Option<Period>,
}

pub struct BudgetDb {
    inner: Mutex<Inner>,
}

// ─── SQLite helpers ─────────────────────────────────────────────────────────

fn insert_event(conn: &Connection, e: &SpendEvent) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO budget_events
            (id, ts, kind, agent, workspace, session_id, model, tokens_in, tokens_out, cost_usd, category, detail)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            e.id,
            e.ts,
            e.kind,
            e.agent,
            e.workspace,
            e.session_id,
            e.model,
            e.tokens_in,
            e.tokens_out,
            e.cost_usd,
            e.category,
            e.detail.as_ref().map(|d| d.to_string()),
        ],
    )?;
    Ok(())
}

fn load_events(conn: &Connection) -> rusqlite::Result<Vec<SpendEvent>> {
    let mut stmt = conn.prepare(
        "SELECT id, ts, kind, agent, workspace, session_id, model, tokens_in, tokens_out, cost_usd, category, detail
         FROM budget_events ORDER BY rowid",
    )?;
    let rows = stmt.query_map([], |r| {
        let detail: Option<String> = r.get(11)?;
        Ok(SpendEvent {
            id: r.get(0)?,
            ts: r.get(1)?,
            kind: r.get(2)?,
            agent: r.get(3)?,
            workspace: r.get(4)?,
            session_id: r.get(5)?,
            model: r.get(6)?,
            tokens_in: r.get(7)?,
            tokens_out: r.get(8)?,
            cost_usd: r.get(9)?,
            category: r.get(10)?,
            detail: detail.and_then(|d| serde_json::from_str(&d).ok()),
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    if out.len() > EVENT_CAP {
        out.drain(..out.len() - EVENT_CAP);
    }
    Ok(out)
}

fn read_kv(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM budget_settings WHERE key = ?1",
        params![key],
        |r| r.get(0),
    )
    .optional()
}

fn write_kv(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO budget_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

// ─── Inner: the port of BrowserBackend (api.ts) ────────────────────────────

impl Inner {
    fn persist_settings(&self) -> Result<(), String> {
        let json = serde_json::to_string(&self.settings).map_err(|e| e.to_string())?;
        write_kv(&self.conn, KEY_SETTINGS, &json).map_err(|e| e.to_string())
    }

    fn invalidate(&mut self) {
        self.counters = None;
    }

    /// Counters follow the local day / period; rebuild when either rolls.
    fn fresh(&mut self, now: i64) -> (&mut Counters, Period) {
        let reset_at = last_reset_at(&self.events, now);
        let p = period_for(now, self.tz, self.settings.month_start_day, reset_at);
        let day_start = local_day_start(now, self.tz);
        let stale = match (&self.counters, &self.period) {
            (Some(c), Some(prev)) => prev.start != p.start || c.day_start != day_start,
            _ => true,
        };
        if stale {
            self.counters = Some(counters_from(&self.events, &p, now, self.tz));
        }
        self.period = Some(p.clone());
        (self.counters.as_mut().expect("counters just built"), p)
    }

    fn state_now(&mut self, now: i64) -> String {
        let settings = self.settings.clone();
        let (c, _) = self.fresh(now);
        derive_state(&settings, c).to_string()
    }

    fn overview_now(&mut self, now: i64) -> BudgetOverview {
        let settings = self.settings.clone();
        let (c, p) = self.fresh(now);
        overview_from(&settings, c, &p, now)
    }

    fn push(
        &mut self,
        input: SpendInput,
        now: i64,
        out: &mut Outbox,
    ) -> Result<SpendEvent, String> {
        let e = SpendEvent {
            id: new_spend_id(now),
            ts: input.ts.unwrap_or(now),
            kind: input.kind,
            agent: input.agent,
            workspace: input.workspace,
            session_id: input.session_id,
            model: input.model,
            tokens_in: input.tokens_in.unwrap_or(0.0).max(0.0).floor() as i64,
            tokens_out: input.tokens_out.unwrap_or(0.0).max(0.0).floor() as i64,
            cost_usd: round6(input.cost_usd.max(0.0)),
            category: input.category.unwrap_or_else(|| "llm".into()),
            detail: input.detail,
        };
        insert_event(&self.conn, &e).map_err(|err| err.to_string())?;
        self.events.push(e.clone());
        if self.events.len() > EVENT_CAP {
            let overflow = self.events.len() - EVENT_CAP;
            self.events.drain(..overflow);
            let _ = self.conn.execute(
                "DELETE FROM budget_events WHERE id IN
                   (SELECT id FROM budget_events ORDER BY rowid LIMIT ?1)",
                params![overflow as i64],
            );
        }
        let (c, _) = self.fresh(now);
        apply_spend(c, &e, now);
        out.push((
            EV_SPEND,
            serde_json::to_value(&e).map_err(|err| err.to_string())?,
        ));
        Ok(e)
    }

    fn transition(&mut self, prev: &str, reason: &str, now: i64, out: &mut Outbox) {
        let next = self.state_now(now);
        if next != prev {
            let change = StateChange {
                prev: prev.into(),
                next,
                reason: reason.into(),
                at: now,
            };
            if let Ok(v) = serde_json::to_value(&change) {
                out.push((EV_STATE_CHANGE, v));
            }
        }
    }

    fn pause(
        &mut self,
        reason: &str,
        now: i64,
        note: &str,
        out: &mut Outbox,
    ) -> Result<(), String> {
        self.settings.paused = true;
        self.settings.pause_reason = Some(reason.into());
        self.settings.paused_at = Some(now);
        self.push(
            SpendInput {
                kind: "paused".into(),
                agent: None,
                workspace: None,
                session_id: None,
                model: None,
                tokens_in: None,
                tokens_out: None,
                cost_usd: 0.0,
                category: None,
                detail: Some(serde_json::json!({ "reason": reason, "note": note })),
                ts: Some(now),
            },
            now,
            out,
        )?;
        self.persist_settings()?;
        self.emit_settings(out);
        Ok(())
    }

    fn emit_settings(&self, out: &mut Outbox) {
        if let Ok(v) = serde_json::to_value(&self.settings) {
            out.push((EV_SETTINGS, v));
        }
    }

    fn seed_if_fresh(&mut self, now: i64) -> Result<(), String> {
        let seeded = read_kv(&self.conn, KEY_SEEDED).map_err(|e| e.to_string())?;
        let version = seeded.and_then(|s| s.parse::<i64>().ok());
        if version == Some(SEED_VERSION) || !self.events.is_empty() {
            return Ok(());
        }
        let events = seed_events(now, self.tz);
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        for e in &events {
            insert_event(&tx, e).map_err(|err| err.to_string())?;
        }
        write_kv(&tx, KEY_SEEDED, &SEED_VERSION.to_string()).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        self.events = events;
        self.invalidate();
        Ok(())
    }

    fn check(
        &mut self,
        req: PreCallRequest,
        now: i64,
        out: &mut Outbox,
    ) -> Result<PreCallCheck, String> {
        let settings = self.settings.clone();
        let (c, p) = self.fresh(now);
        let prev = derive_state(&settings, c).to_string();
        let result = check_pre_call(&settings, c, &req, now, Some(&p.reset_date));
        let base = |kind: &str, model: Option<String>, detail: Value| SpendInput {
            kind: kind.into(),
            agent: req.agent.clone(),
            workspace: req.workspace.clone(),
            session_id: req.session_id.clone(),
            model,
            tokens_in: None,
            tokens_out: None,
            cost_usd: 0.0,
            category: Some("llm".into()),
            detail: Some(detail),
            ts: Some(now),
        };
        if !result.allowed {
            self.push(
                base(
                    "blocked",
                    Some(req.model.clone()),
                    serde_json::json!({
                        "code": result.code,
                        "estimatedCost": result.estimated_cost,
                        "surface": req.surface,
                        "reason": result.reason,
                    }),
                ),
                now,
                out,
            )?;
            if result.code == "spike" {
                let note = result.reason.clone().unwrap_or_else(|| "spike".into());
                self.pause("spike", now, &note, out)?;
            }
        } else if let Some(to) = &result.downgraded_to_model {
            self.push(
                base(
                    "downshifted",
                    Some(to.clone()),
                    serde_json::json!({
                        "from": req.model,
                        "to": to,
                        "why": result.downshift_why,
                        "surface": req.surface,
                    }),
                ),
                now,
                out,
            )?;
        }
        let reason = if result.allowed {
            "check".to_string()
        } else {
            format!("blocked:{}", result.code)
        };
        self.transition(&prev, &reason, now, out);
        Ok(result)
    }

    fn record(
        &mut self,
        input: SpendInput,
        now: i64,
        out: &mut Outbox,
    ) -> Result<RecordResult, String> {
        let prev = self.state_now(now);
        let event = self.push(input, now, out)?;
        let settings = self.settings.clone();
        let trip = {
            let (c, _) = self.fresh(now);
            evaluate_trip(&settings, c, now)
        };
        if let Some(t) = trip {
            let note = if t == "spike" {
                "Spending spike"
            } else {
                "Circuit breaker threshold"
            };
            self.pause(t, now, note, out)?;
        }
        let reason = match trip {
            Some(t) => format!("breaker:{}", t),
            None => "spend".into(),
        };
        self.transition(&prev, &reason, now, out);
        Ok(RecordResult {
            event,
            overview: self.overview_now(now),
            tripped: trip.map(|t| t.to_string()),
        })
    }

    fn update_settings(
        &mut self,
        patch: Value,
        now: i64,
        out: &mut Outbox,
    ) -> Result<BudgetSettings, String> {
        let prev_settings = self.settings.clone();
        let prev = self.state_now(now);
        let mut merged = serde_json::to_value(&prev_settings).map_err(|e| e.to_string())?;
        if let (Some(target), Some(src)) = (merged.as_object_mut(), patch.as_object()) {
            for (k, v) in src {
                target.insert(k.clone(), v.clone());
            }
        }
        let next = coerce_settings(&merged);
        self.settings = next.clone();
        let limit_changed = next.monthly_limit != prev_settings.monthly_limit
            || next.daily_limit != prev_settings.daily_limit
            || next.per_request_limit != prev_settings.per_request_limit
            || next.hard_cap != prev_settings.hard_cap;
        if limit_changed {
            self.push(
                SpendInput {
                    kind: "cap_set".into(),
                    agent: None,
                    workspace: None,
                    session_id: None,
                    model: None,
                    tokens_in: None,
                    tokens_out: None,
                    cost_usd: 0.0,
                    category: None,
                    detail: Some(serde_json::json!({
                        "monthlyLimit": next.monthly_limit,
                        "dailyLimit": next.daily_limit,
                        "perRequestLimit": next.per_request_limit,
                        "hardCap": next.hard_cap,
                    })),
                    ts: Some(now),
                },
                now,
                out,
            )?;
        }
        if next.month_start_day != prev_settings.month_start_day {
            self.invalidate();
        }
        self.persist_settings()?;
        self.emit_settings(out);
        self.transition(&prev, "settings", now, out);
        Ok(self.settings.clone())
    }

    fn set_paused(
        &mut self,
        paused: bool,
        reason: Option<String>,
        now: i64,
        out: &mut Outbox,
    ) -> Result<BudgetSettings, String> {
        let prev = self.state_now(now);
        let reason_str = reason.clone().unwrap_or_else(|| "manual".into());
        if paused {
            self.pause(&reason_str, now, "Paused by user", out)?;
        } else {
            self.settings.paused = false;
            self.settings.pause_reason = None;
            self.settings.paused_at = None;
            self.push(
                SpendInput {
                    kind: "resumed".into(),
                    agent: None,
                    workspace: None,
                    session_id: None,
                    model: None,
                    tokens_in: None,
                    tokens_out: None,
                    cost_usd: 0.0,
                    category: None,
                    detail: Some(serde_json::json!({ "from": reason })),
                    ts: Some(now),
                },
                now,
                out,
            )?;
            self.persist_settings()?;
            self.emit_settings(out);
        }
        let why = if paused {
            format!("paused:{}", reason_str)
        } else {
            "resumed".into()
        };
        self.transition(&prev, &why, now, out);
        Ok(self.settings.clone())
    }

    fn reset_month(&mut self, now: i64, out: &mut Outbox) -> Result<BudgetOverview, String> {
        let prev = self.state_now(now);
        let spent = self.fresh(now).0.spent_month;
        self.push(
            SpendInput {
                kind: "reset".into(),
                agent: None,
                workspace: None,
                session_id: None,
                model: None,
                tokens_in: None,
                tokens_out: None,
                cost_usd: 0.0,
                category: None,
                detail: Some(serde_json::json!({ "spentBefore": spent })),
                ts: Some(now),
            },
            now,
            out,
        )?;
        self.invalidate();
        self.transition(&prev, "reset", now, out);
        Ok(self.overview_now(now))
    }

    fn clear_all(&mut self, now: i64, out: &mut Outbox) -> Result<BudgetOverview, String> {
        let prev = self.state_now(now);
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM budget_events", [])
            .map_err(|e| e.to_string())?;
        // A cleared install stays empty — never re-seeded.
        write_kv(&tx, KEY_SEEDED, &SEED_VERSION.to_string()).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        self.events.clear();
        self.settings = BudgetSettings::default();
        self.invalidate();
        self.persist_settings()?;
        self.emit_settings(out);
        self.transition(&prev, "cleared", now, out);
        Ok(self.overview_now(now))
    }

    fn list(
        &self,
        filter: &SpendFilter,
        sort: &SpendSort,
        cursor: Option<&str>,
        limit: usize,
        now: i64,
    ) -> SpendPage {
        let mut filtered = filter_events(&self.events, filter, now);
        sort_events(&mut filtered, sort);
        let offset = cursor
            .and_then(|c| c.parse::<usize>().ok())
            .unwrap_or(0)
            .min(filtered.len());
        let end = (offset + limit).min(filtered.len());
        let page: Vec<SpendEvent> = filtered[offset..end].iter().map(|e| (*e).clone()).collect();
        SpendPage {
            next_cursor: if end < filtered.len() {
                Some(end.to_string())
            } else {
                None
            },
            total: filtered.len() as i64,
            total_cost: total_cost(filtered.iter().copied()),
            events: page,
        }
    }

    fn export(&self, range: &str, now: i64) -> Vec<SpendEvent> {
        let start = range_start(range, now);
        let mut rows: Vec<SpendEvent> = self
            .events
            .iter()
            .filter(|e| e.ts >= start)
            .cloned()
            .collect();
        rows.sort_by_key(|e| e.ts);
        rows
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordResult {
    pub event: SpendEvent,
    pub overview: BudgetOverview,
    pub tripped: Option<String>,
}

// ─── BudgetDb ───────────────────────────────────────────────────────────────

impl BudgetDb {
    /// Open the shared xr.db (WAL, own connection) and apply the DDL. Seeding
    /// waits for `budget_init`, which carries the webview's UTC offset.
    pub fn init(app: &AppHandle) -> Self {
        let dir = app
            .path()
            .app_data_dir()
            .expect("tauri app_data_dir must resolve");
        std::fs::create_dir_all(&dir).expect("create app data dir");
        let conn = Connection::open(dir.join("xr.db")).expect("open xr.db");
        conn.pragma_update(None, "journal_mode", "WAL")
            .expect("enable WAL (shared with chat)");
        BudgetDb::from_connection(conn).expect("apply budget DDL")
    }

    pub fn from_connection(conn: Connection) -> rusqlite::Result<Self> {
        conn.execute_batch(DDL)?;
        let settings = match read_kv(&conn, KEY_SETTINGS)? {
            Some(json) => serde_json::from_str::<Value>(&json)
                .map(|v| coerce_settings(&v))
                .unwrap_or_default(),
            None => BudgetSettings::default(),
        };
        let events = load_events(&conn)?;
        Ok(BudgetDb {
            inner: Mutex::new(Inner {
                conn,
                settings,
                events,
                tz: 0,
                counters: None,
                period: None,
            }),
        })
    }

    fn with<T>(
        &self,
        f: impl FnOnce(&mut Inner, &mut Outbox) -> Result<T, String>,
    ) -> Result<(T, Outbox), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "budget db poisoned".to_string())?;
        let mut out: Outbox = Vec::new();
        let value = f(&mut inner, &mut out)?;
        Ok((value, out))
    }
}

fn flush<R: Runtime>(app: &AppHandle<R>, out: Outbox) {
    for (name, payload) in out {
        let _ = app.emit(name, payload);
    }
}

// ─── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn budget_init<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, BudgetDb>,
    tz_offset_min: i64,
) -> Result<BudgetOverview, String> {
    let now = now_ms();
    let (overview, out) = state.with(|db, _out| {
        db.tz = tz_offset_min;
        db.invalidate();
        db.seed_if_fresh(now)?;
        Ok(db.overview_now(now))
    })?;
    flush(&app, out);
    Ok(overview)
}

#[tauri::command]
pub fn budget_overview(state: State<'_, BudgetDb>) -> Result<BudgetOverview, String> {
    let now = now_ms();
    state.with(|db, _| Ok(db.overview_now(now))).map(|(v, _)| v)
}

/// The gate. Called by the mock LLM / brain / palette BEFORE a call starts;
/// a denial is final — nothing on the webview side can override it.
#[tauri::command]
pub fn budget_check<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, BudgetDb>,
    req: PreCallRequest,
) -> Result<PreCallCheck, String> {
    let now = now_ms();
    let (verdict, out) = state.with(|db, out| db.check(req, now, out))?;
    flush(&app, out);
    Ok(verdict)
}

#[tauri::command]
pub fn budget_record<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, BudgetDb>,
    input: SpendInput,
) -> Result<RecordResult, String> {
    let now = now_ms();
    let (result, out) = state.with(|db, out| db.record(input, now, out))?;
    flush(&app, out);
    Ok(result)
}

#[tauri::command]
pub fn budget_events(
    state: State<'_, BudgetDb>,
    filter: SpendFilter,
    sort: SpendSort,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<SpendPage, String> {
    let now = now_ms();
    let limit = limit.unwrap_or(200).clamp(1, 2000) as usize;
    state
        .with(|db, _| Ok(db.list(&filter, &sort, cursor.as_deref(), limit, now)))
        .map(|(v, _)| v)
}

#[tauri::command]
pub fn budget_series(
    state: State<'_, BudgetDb>,
    range: String,
) -> Result<Vec<SeriesBucket>, String> {
    let now = now_ms();
    state
        .with(|db, _| Ok(series_for(&db.events, &range, now, db.tz)))
        .map(|(v, _)| v)
}

#[tauri::command]
pub fn budget_breakdown(
    state: State<'_, BudgetDb>,
    by: String,
    range: String,
) -> Result<Vec<BreakdownRow>, String> {
    let now = now_ms();
    state
        .with(|db, _| Ok(breakdown(&db.events, &by, &range, now)))
        .map(|(v, _)| v)
}

#[tauri::command]
pub fn budget_update_settings<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, BudgetDb>,
    patch: Value,
) -> Result<BudgetSettings, String> {
    let now = now_ms();
    let (settings, out) = state.with(|db, out| db.update_settings(patch, now, out))?;
    flush(&app, out);
    Ok(settings)
}

#[tauri::command]
pub fn budget_set_paused<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, BudgetDb>,
    paused: bool,
    reason: Option<String>,
) -> Result<BudgetSettings, String> {
    let now = now_ms();
    let (settings, out) = state.with(|db, out| db.set_paused(paused, reason, now, out))?;
    flush(&app, out);
    Ok(settings)
}

#[tauri::command]
pub fn budget_reset_month<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, BudgetDb>,
) -> Result<BudgetOverview, String> {
    let now = now_ms();
    let (overview, out) = state.with(|db, out| db.reset_month(now, out))?;
    flush(&app, out);
    Ok(overview)
}

#[tauri::command]
pub fn budget_clear<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, BudgetDb>,
) -> Result<BudgetOverview, String> {
    let now = now_ms();
    let (overview, out) = state.with(|db, out| db.clear_all(now, out))?;
    flush(&app, out);
    Ok(overview)
}

#[tauri::command]
pub fn budget_export(state: State<'_, BudgetDb>, range: String) -> Result<Vec<SpendEvent>, String> {
    let now = now_ms();
    state
        .with(|db, _| Ok(db.export(&range, now)))
        .map(|(v, _)| v)
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_791_192_600_000;
    const TZ: i64 = -300;

    fn db() -> BudgetDb {
        BudgetDb::from_connection(Connection::open_in_memory().unwrap()).unwrap()
    }

    fn req(model: &str) -> PreCallRequest {
        PreCallRequest {
            model: model.into(),
            estimated_tokens_in: 2000.0,
            estimated_tokens_out: 800.0,
            estimated_cost: None,
            agent: Some("main".into()),
            workspace: Some("xr".into()),
            session_id: Some("chat-test".into()),
            finalization: None,
            surface: "chat".into(),
        }
    }

    fn spend(cost: f64) -> SpendInput {
        SpendInput {
            kind: "llm_call".into(),
            agent: Some("main".into()),
            workspace: Some("xr".into()),
            session_id: Some("chat-test".into()),
            model: Some("claude-sonnet-4.5".into()),
            tokens_in: Some(2000.0),
            tokens_out: Some(800.0),
            cost_usd: cost,
            category: Some("llm".into()),
            detail: None,
            ts: None,
        }
    }

    #[test]
    fn seeds_once_and_persists_events() {
        let db = db();
        let (ov, _) = db
            .with(|d, _| {
                d.tz = TZ;
                d.seed_if_fresh(NOW)?;
                Ok(d.overview_now(NOW))
            })
            .unwrap();
        assert_eq!(ov.events_total, 246);
        assert!((ov.spent_month - 0.409827).abs() < 1e-9);
        assert_eq!(ov.state, "ok");
        // Reload from the same connection state: rows are on disk (in-memory db here).
        let (count, _) = db
            .with(|d, _| {
                d.conn
                    .query_row("SELECT COUNT(*) FROM budget_events", [], |r| {
                        r.get::<_, i64>(0)
                    })
                    .map_err(|e| e.to_string())
            })
            .unwrap();
        assert_eq!(count, 246);
        let (again, _) = db
            .with(|d, _| {
                d.seed_if_fresh(NOW)?;
                Ok(d.events.len())
            })
            .unwrap();
        assert_eq!(again, 246);
    }

    #[test]
    fn one_cent_cap_blocks_before_the_call_and_logs_it() {
        let db = db();
        let ((verdict, events), out) = db
            .with(|d, out| {
                d.tz = TZ;
                d.record(spend(0.0098), NOW, out)?;
                // Lowering the cap below what is already spent → capped, no breaker.
                d.update_settings(serde_json::json!({ "monthlyLimit": 0.01 }), NOW, out)?;
                let v = d.check(req("claude-sonnet-4.5"), NOW + 1, out)?;
                Ok((v, d.events.clone()))
            })
            .unwrap();
        assert!(!verdict.allowed);
        assert_eq!(verdict.code, "month");
        assert!(verdict
            .reason
            .as_deref()
            .unwrap_or("")
            .contains("Budget limit reached"));
        assert_eq!(events.last().unwrap().kind, "blocked");
        assert!(out
            .iter()
            .any(|(name, v)| *name == EV_STATE_CHANGE && v["next"] == "capped"));
    }

    #[test]
    fn raise_limit_resumes_and_breaker_pauses() {
        let db = db();
        let (settings, out) = db
            .with(|d, out| {
                d.tz = TZ;
                d.record(spend(0.0098), NOW, out)?;
                d.update_settings(serde_json::json!({ "monthlyLimit": 0.01 }), NOW, out)?;
                assert!(!d.check(req("claude-sonnet-4.5"), NOW + 1, out)?.allowed);
                let s =
                    d.update_settings(serde_json::json!({ "monthlyLimit": 5.0 }), NOW + 2, out)?;
                assert!(d.check(req("claude-sonnet-4.5"), NOW + 3, out)?.allowed);
                // Threshold breaker: 4.75 of 5 → paused.
                let r = d.record(spend(4.74), NOW + 4, out)?;
                assert_eq!(r.tripped.as_deref(), Some("threshold"));
                assert!(d.settings.paused);
                assert_eq!(
                    d.check(req("claude-sonnet-4.5"), NOW + 5, out)?.code,
                    "paused"
                );
                let resumed = d.set_paused(false, None, NOW + 6, out)?;
                assert!(!resumed.paused);
                Ok(s)
            })
            .unwrap();
        assert!((settings.monthly_limit - 5.0).abs() < 1e-9);
        assert!(out
            .iter()
            .any(|(name, v)| *name == EV_STATE_CHANGE && v["next"] == "paused"));
        assert!(out.iter().any(|(name, _)| *name == EV_SETTINGS));
    }

    #[test]
    fn reset_month_starts_a_new_period_and_clear_stays_empty() {
        let db = db();
        let (ov, _) = db
            .with(|d, out| {
                d.tz = TZ;
                d.record(spend(0.5), NOW, out)?;
                let after = d.reset_month(NOW + 1, out)?;
                assert!(after.spent_month.abs() < 1e-9);
                assert_eq!(after.period_start, NOW + 1);
                d.record(spend(0.2), NOW + 2, out)?;
                let cleared = d.clear_all(NOW + 3, out)?;
                assert_eq!(cleared.events_total, 0);
                d.seed_if_fresh(NOW + 4)?;
                Ok(d.overview_now(NOW + 4))
            })
            .unwrap();
        assert_eq!(ov.events_total, 0);
        assert!((ov.monthly_limit - 5.0).abs() < 1e-9);
    }

    #[test]
    fn paging_sorts_and_exports() {
        let db = db();
        let ((page, expected), _) = db
            .with(|d, out| {
                d.tz = TZ;
                d.seed_if_fresh(NOW)?;
                d.record(spend(0.03), NOW, out)?;
                let f = SpendFilter {
                    search: String::new(),
                    category: "all".into(),
                    model: "all".into(),
                    agent: "all".into(),
                    kind: "all".into(),
                    range: "30d".into(),
                };
                let s = SpendSort {
                    key: "ts".into(),
                    dir: "desc".into(),
                };
                let p = d.list(&f, &s, None, 50, NOW);
                assert_eq!(p.events.len(), 50);
                assert_eq!(p.next_cursor.as_deref(), Some("50"));
                assert!((p.events[0].cost_usd - 0.03).abs() < 1e-9);
                let exported = d.export("7d", NOW);
                assert!(exported.windows(2).all(|w| w[0].ts <= w[1].ts));
                let expected = d
                    .events
                    .iter()
                    .filter(|e| e.ts >= NOW - 30 * DAY_MS)
                    .count() as i64;
                Ok((p, expected))
            })
            .unwrap();
        assert_eq!(page.total, expected);
        assert!(page.total > 200);
    }
}
