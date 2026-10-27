/*
 * XR-LAUNCH-009 — demo ("seed") data never reaches a release install.
 *
 * Earlier builds wrote scripted demo rows into xr.db on first launch: ~220
 * spend events (`budget_events`), a 204-entry audit chain (`shield_audit`)
 * and, in shield.json, three quarantined demo skills. Release builds no
 * longer seed anything (`demo_data_enabled()` is false without
 * `debug_assertions`); this module is the cleanup for installs that already
 * have those rows. It runs on every open and is idempotent — once the seed
 * rows are gone there is nothing left for it to match.
 *
 * Seed rows are recognised by markers only the seed generators produce:
 *   spend events   `sp_seed_NNNN`            (live ids: `sp_<base36>…`)
 *   audit entries  `aud_NNNNNN` (6 digits)   (live ids: `aud_` + 12 hex)
 *   quarantine     the three fixed demo skills, matched on id+version+source
 *
 * Mirrors desktop/src/lib/seedPurge.ts (the browser preview's storage).
 * Self-contained on purpose (std + rusqlite only) so it can be unit-tested
 * without the Tauri stack.
 */
use rusqlite::{params, Connection};

/// Demo data is a development aid: debug builds only, explicit opt-in with
/// `XR_DEMO_DATA=1`. Always false in a release build.
pub fn demo_data_enabled() -> bool {
    cfg!(debug_assertions)
        && std::env::var("XR_DEMO_DATA")
            .map(|v| v == "1")
            .unwrap_or(false)
}

fn all_digits(s: &str, n: usize) -> bool {
    s.len() == n && s.bytes().all(|b| b.is_ascii_digit())
}

/// Mirror of the TS marker; the SQL purge uses the equivalent `SPEND_GLOB`.
#[cfg_attr(not(test), allow(dead_code))]
pub fn is_seed_spend_id(id: &str) -> bool {
    id.strip_prefix("sp_seed_")
        .is_some_and(|rest| all_digits(rest, 4))
}

pub fn is_seed_audit_id(id: &str) -> bool {
    id.strip_prefix("aud_")
        .is_some_and(|rest| all_digits(rest, 6))
}

const SEED_QUARANTINE: [(&str, &str, &str); 3] = [
    ("figma-plugin", "0.3.1", "Skills Store · unsigned"),
    ("legacy-exec", "1.0.0", "Local install"),
    ("unknown-skill", "—", "Sideloaded"),
];

pub fn is_seed_quarantine(id: &str, version: &str, source: &str) -> bool {
    SEED_QUARANTINE
        .iter()
        .any(|(i, v, s)| *i == id && *v == version && *s == source)
}

const SPEND_GLOB: &str = "sp_seed_[0-9][0-9][0-9][0-9]";
const AUDIT_GLOB: &str = "aud_[0-9][0-9][0-9][0-9][0-9][0-9]";

/// Delete seeded spend events. Returns how many were removed.
pub fn purge_budget_seed(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM budget_events WHERE id GLOB ?1",
        params![SPEND_GLOB],
    )
}

/// One `shield_audit` row (column order of the table, minus `seq`).
#[derive(Debug, Clone, PartialEq)]
pub struct AuditRow {
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
    pub prev_hash: Option<String>,
    pub hash: String,
    pub detail: Option<String>,
}

pub const PURGE_AUDIT_ACTION: &str = "Demo entries removed";
pub const ARCHIVE_TABLE: &str = "shield_audit_archive_009";

/// Remove seeded entries from the append-only audit chain.
///
/// The table's UPDATE/DELETE triggers are dropped and recreated (by re-running
/// `ddl`) inside ONE transaction, so either the whole migration lands or none
/// of it does. Before anything changes, the complete original table — seed and
/// real rows with their original hashes — is copied to `ARCHIVE_TABLE`. Real
/// entries keep content, ids, timestamps and order; only `prev_hash`/`hash`
/// are recomputed with `rehash` (their predecessor was a demo row). A system
/// entry recording the removal is appended so the rewrite is itself on the
/// chain. Returns the number of seed entries removed (0 = nothing changed).
pub fn purge_shield_seed(
    conn: &mut Connection,
    ddl: &str,
    rehash: impl Fn(&AuditRow) -> String,
    purge_id: String,
    now: i64,
) -> rusqlite::Result<usize> {
    let seeded: i64 = conn.query_row(
        "SELECT COUNT(*) FROM shield_audit WHERE id GLOB ?1",
        params![AUDIT_GLOB],
        |r| r.get(0),
    )?;
    if seeded == 0 {
        return Ok(0);
    }
    let tx = conn.transaction()?;
    let rows: Vec<AuditRow> = {
        let mut stmt = tx.prepare(
            "SELECT id, ts, actor, skill, action, resource, decision, rule_id, risk, cost_usd, prev_hash, hash, detail
             FROM shield_audit ORDER BY seq",
        )?;
        let mapped = stmt.query_map([], |r| {
            Ok(AuditRow {
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
                prev_hash: r.get(10)?,
                hash: r.get(11)?,
                detail: r.get(12)?,
            })
        })?;
        mapped.collect::<rusqlite::Result<_>>()?
    };
    tx.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS {ARCHIVE_TABLE} AS SELECT * FROM shield_audit WHERE 0;
         INSERT INTO {ARCHIVE_TABLE} SELECT * FROM shield_audit;
         DROP TRIGGER IF EXISTS shield_audit_no_update;
         DROP TRIGGER IF EXISTS shield_audit_no_delete;
         DELETE FROM shield_audit;"
    ))?;
    let real: Vec<AuditRow> = rows
        .into_iter()
        .filter(|r| !is_seed_audit_id(&r.id))
        .collect();
    let removed = seeded as usize;
    let mut prev: Option<String> = None;
    let note = AuditRow {
        id: purge_id,
        ts: now,
        actor: "system".into(),
        skill: None,
        action: PURGE_AUDIT_ACTION.into(),
        resource: None,
        decision: "allowed".into(),
        rule_id: None,
        risk: "low".into(),
        cost_usd: None,
        prev_hash: None,
        hash: String::new(),
        detail: Some(format!(
            "{removed} demo entries written by an earlier build were removed; {} real entries re-chained (XR-LAUNCH-009). Original rows: table {ARCHIVE_TABLE}.",
            real.len()
        )),
    };
    for mut row in real.into_iter().chain(std::iter::once(note)) {
        row.prev_hash = prev.clone();
        row.hash = rehash(&row);
        tx.execute(
            "INSERT INTO shield_audit (id, ts, actor, skill, action, resource, decision, rule_id, risk, cost_usd, prev_hash, hash, detail)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                row.id, row.ts, row.actor, row.skill, row.action, row.resource, row.decision,
                row.rule_id, row.risk, row.cost_usd, row.prev_hash, row.hash, row.detail
            ],
        )?;
        prev = Some(row.hash);
    }
    // Re-create the append-only triggers (the DDL is all IF NOT EXISTS).
    tx.execute_batch(ddl)?;
    tx.commit()?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DDL: &str = "
CREATE TABLE IF NOT EXISTS shield_audit (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, ts INTEGER NOT NULL,
    actor TEXT NOT NULL, skill TEXT, action TEXT NOT NULL, resource TEXT, decision TEXT NOT NULL,
    rule_id TEXT, risk TEXT NOT NULL, cost_usd REAL, prev_hash TEXT, hash TEXT NOT NULL, detail TEXT
);
CREATE TRIGGER IF NOT EXISTS shield_audit_no_update BEFORE UPDATE ON shield_audit
BEGIN SELECT RAISE(ABORT, 'shield_audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS shield_audit_no_delete BEFORE DELETE ON shield_audit
BEGIN SELECT RAISE(ABORT, 'shield_audit is append-only'); END;
CREATE TABLE IF NOT EXISTS budget_events (id TEXT PRIMARY KEY, ts INTEGER NOT NULL);
";

    /// Stand-in for sha256(canonical): deterministic and prev-dependent.
    fn fake_hash(r: &AuditRow) -> String {
        format!(
            "h({}|{}|{})",
            r.id,
            r.action,
            r.prev_hash.as_deref().unwrap_or("")
        )
    }

    fn insert(conn: &Connection, id: &str, action: &str, prev: Option<&str>) -> String {
        let row = AuditRow {
            id: id.into(),
            ts: 1,
            actor: "a".into(),
            skill: None,
            action: action.into(),
            resource: None,
            decision: "allowed".into(),
            rule_id: None,
            risk: "low".into(),
            cost_usd: None,
            prev_hash: prev.map(Into::into),
            hash: String::new(),
            detail: None,
        };
        let h = fake_hash(&row);
        conn.execute(
            "INSERT INTO shield_audit (id, ts, actor, action, decision, risk, prev_hash, hash) VALUES (?1, 1, 'a', ?2, 'allowed', 'low', ?3, ?4)",
            params![id, action, prev, h],
        ).unwrap();
        h
    }

    fn chain(conn: &Connection) -> Vec<(String, String, Option<String>, String)> {
        let mut s = conn
            .prepare("SELECT id, action, prev_hash, hash FROM shield_audit ORDER BY seq")
            .unwrap();
        s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(DDL).unwrap();
        c
    }

    #[test]
    fn markers() {
        assert!(is_seed_spend_id("sp_seed_0004"));
        for live in [
            "sp_seed_12345",
            "sp_seed_",
            "sp_abc",
            "xsp_seed_0001",
            "sp_seed_00a1",
        ] {
            assert!(!is_seed_spend_id(live), "{live}");
        }
        assert!(is_seed_audit_id("aud_000204"));
        for live in [
            "aud_0a1b2c3d4e5f",
            "aud_123456789012",
            "aud_12345",
            "aud_00000a",
        ] {
            assert!(!is_seed_audit_id(live), "{live}");
        }
        assert!(is_seed_quarantine("legacy-exec", "1.0.0", "Local install"));
        assert!(!is_seed_quarantine("legacy-exec", "1.0.1", "Local install"));
    }

    #[test]
    fn release_builds_never_seed() {
        // In a test (debug) build demo data follows XR_DEMO_DATA; the release
        // answer is the cfg!(debug_assertions) gate itself.
        assert_eq!(
            demo_data_enabled(),
            cfg!(debug_assertions) && std::env::var("XR_DEMO_DATA").as_deref() == Ok("1")
        );
    }

    #[test]
    fn budget_purge_removes_only_seed_rows() {
        let c = db();
        for id in ["sp_seed_0001", "sp_seed_0002", "sp_live1", "sp_seed_99999"] {
            c.execute(
                "INSERT INTO budget_events (id, ts) VALUES (?1, 1)",
                params![id],
            )
            .unwrap();
        }
        assert_eq!(purge_budget_seed(&c).unwrap(), 2);
        assert_eq!(purge_budget_seed(&c).unwrap(), 0);
        let left: Vec<String> = c
            .prepare("SELECT id FROM budget_events ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(left, ["sp_live1", "sp_seed_99999"]);
    }

    #[test]
    fn shield_purge_rechains_real_entries_archives_and_keeps_triggers() {
        let mut c = db();
        let mut prev: Option<String> = None;
        for i in 1..=4 {
            prev = Some(insert(
                &c,
                &format!("aud_{i:06}"),
                &format!("seed {i}"),
                prev.as_deref(),
            ));
        }
        for i in 0..3 {
            prev = Some(insert(
                &c,
                &format!("aud_live{i:08}"),
                &format!("real {i}"),
                prev.as_deref(),
            ));
        }
        let removed =
            purge_shield_seed(&mut c, DDL, fake_hash, "aud_note00000000".into(), 99).unwrap();
        assert_eq!(removed, 4);
        let rows = chain(&c);
        let actions: Vec<&str> = rows.iter().map(|r| r.1.as_str()).collect();
        assert_eq!(actions, ["real 0", "real 1", "real 2", PURGE_AUDIT_ACTION]);
        // Genesis has no predecessor; every link points at the row before it.
        assert_eq!(rows[0].2, None);
        for w in rows.windows(2) {
            assert_eq!(w[1].2.as_deref(), Some(w[0].3.as_str()));
        }
        // The original 7 rows are preserved verbatim in the archive.
        let archived: i64 = c
            .query_row(&format!("SELECT COUNT(*) FROM {ARCHIVE_TABLE}"), [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(archived, 7);
        // Still append-only afterwards.
        assert!(c.execute("DELETE FROM shield_audit", []).is_err());
        assert!(c
            .execute("UPDATE shield_audit SET action = 'x'", [])
            .is_err());
        // Idempotent.
        assert_eq!(
            purge_shield_seed(&mut c, DDL, fake_hash, "aud_note00000001".into(), 100).unwrap(),
            0
        );
        assert_eq!(chain(&c).len(), 4);
    }

    #[test]
    fn shield_purge_on_a_clean_chain_changes_nothing() {
        let mut c = db();
        let h = insert(&c, "aud_0a1b2c3d4e5f", "real", None);
        assert_eq!(
            purge_shield_seed(&mut c, DDL, fake_hash, "aud_n".into(), 1).unwrap(),
            0
        );
        assert_eq!(
            chain(&c),
            vec![("aud_0a1b2c3d4e5f".to_string(), "real".to_string(), None, h)]
        );
    }
}
