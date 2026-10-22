/*
 * XR-LAUNCH-021 — desktop data safety.
 *
 * Pure filesystem + SQLite logic (std, rusqlite, zip only — no Tauri types) so
 * it is unit-tested by `cargo test --lib` on every OS leg and by a standalone
 * crate in environments that cannot build the Tauri shell.
 *
 *   · open_shared_db      — every xr.db connection goes through here. A file
 *                           that fails `PRAGMA quick_check` (or cannot be
 *                           opened) is moved aside, never deleted, and a fresh
 *                           database is created; if even that fails the shell
 *                           runs on an in-memory database. The app never
 *                           panics on a damaged database, and the notice is
 *                           surfaced to the UI (`db_health`).
 *   · snapshot_db         — export takes a consistent copy with
 *                           `VACUUM INTO` (includes pages still in the WAL),
 *                           instead of zipping live xr.db/-wal/-shm files.
 *   · stage_import        — import NEVER writes over the live database. The
 *                           archive is validated and extracted into
 *                           `<data>/.pending-import/`; every database in it
 *                           must pass `PRAGMA integrity_check` and is
 *                           checkpointed so it is self-contained. A damaged
 *                           archive is an error and the live data is untouched.
 *   · apply_pending_import — runs at the next launch, BEFORE any connection is
 *                           opened: current files move to
 *                           `<data>/.import-backup-<ts>/`, staged files move in.
 *                           Any failure rolls the move back.
 */
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

pub const DB_NAME: &str = "xr.db";
pub const PENDING_DIR: &str = ".pending-import";
pub const BACKUP_PREFIX: &str = ".import-backup-";
const READY_MARKER: &str = ".ready";
/// Archives larger than this (uncompressed) are refused: an export of a real
/// profile is a few hundred MB at most, and a zip bomb must not fill the disk.
pub const MAX_IMPORT_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_IMPORT_ENTRIES: usize = 100_000;
const KEEP_BACKUPS: usize = 2;

/// Result of opening the shared database.
pub struct OpenOutcome {
    pub conn: Connection,
    /// User-facing notice when recovery happened (None on a clean open).
    pub notice: Option<String>,
    /// True when the shell fell back to an in-memory database.
    pub in_memory: bool,
}

fn is_internal(name: &str) -> bool {
    name == PENDING_DIR || name.starts_with(BACKUP_PREFIX) || name.starts_with("xr.db.corrupt-")
}

fn sqlite_sidecars(db: &Path) -> [PathBuf; 2] {
    let s = db.as_os_str().to_string_lossy().to_string();
    [
        PathBuf::from(format!("{s}-wal")),
        PathBuf::from(format!("{s}-shm")),
    ]
}

fn quick_check(conn: &Connection) -> Result<(), String> {
    let verdict: String = conn
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if verdict == "ok" {
        Ok(())
    } else {
        Err(verdict)
    }
}

fn open_wal(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

/// Move a damaged database (and its WAL/SHM) aside. Returns the new path.
pub fn quarantine_db(db: &Path, stamp: u128) -> Result<PathBuf, String> {
    let dest = db.with_file_name(format!("xr.db.corrupt-{stamp}"));
    fs::rename(db, &dest).map_err(|e| format!("could not move the damaged database aside: {e}"))?;
    for (side, suffix) in sqlite_sidecars(db).iter().zip(["-wal", "-shm"]) {
        if side.exists() {
            let _ = fs::rename(side, PathBuf::from(format!("{}{suffix}", dest.display())));
        }
    }
    Ok(dest)
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Startup integrity gate — run ONCE, before the subsystems open their own
/// connections: `PRAGMA quick_check` over the whole file (O(size), so it is
/// not repeated per subsystem); a damaged file is quarantined. Returns the
/// recovery notice, if any.
pub fn preflight(dir: &Path) -> Option<String> {
    open_shared_db_at(dir, "", now_ms(), true).notice
}

/// Open `<dir>/xr.db` in WAL mode, run `ddl`, and recover instead of panicking
/// when the file cannot be opened. Integrity is checked once by `preflight`.
pub fn open_shared_db(dir: &Path, ddl: &str) -> OpenOutcome {
    open_shared_db_at(dir, ddl, now_ms(), false)
}

pub fn open_shared_db_at(dir: &Path, ddl: &str, stamp: u128, check: bool) -> OpenOutcome {
    let path = dir.join(DB_NAME);
    let first = fs::create_dir_all(dir)
        .map_err(|e| e.to_string())
        .and_then(|_| open_wal(&path))
        .and_then(|c| {
            if check {
                quick_check(&c).map(|_| c)
            } else {
                Ok(c)
            }
        })
        .and_then(|c| c.execute_batch(ddl).map_err(|e| e.to_string()).map(|_| c));
    match first {
        Ok(conn) => OpenOutcome {
            conn,
            notice: None,
            in_memory: false,
        },
        Err(first_err) => {
            // Damaged (or unreadable): keep the evidence, start fresh.
            let moved = if path.exists() {
                quarantine_db(&path, stamp).ok()
            } else {
                None
            };
            let fresh = open_wal(&path)
                .and_then(|c| c.execute_batch(ddl).map_err(|e| e.to_string()).map(|_| c));
            match fresh {
                Ok(conn) => OpenOutcome {
                    conn,
                    notice: Some(match moved {
                        Some(p) => format!(
                            "XR's local database could not be read ({first_err}). It was moved to {} and a new, empty database was created. Nothing was deleted.",
                            p.display()
                        ),
                        None => format!("XR's local database could not be opened ({first_err}). A new database was created."),
                    }),
                    in_memory: false,
                },
                Err(second) => {
                    let conn = Connection::open_in_memory().expect("in-memory sqlite always opens");
                    let _ = conn.execute_batch(ddl);
                    OpenOutcome {
                        conn,
                        notice: Some(format!(
                            "XR could not open or create its local database ({second}). This session runs without saving chats, workspaces or audit history. Check the disk and permissions of {}.",
                            dir.display()
                        )),
                        in_memory: true,
                    }
                }
            }
        }
    }
}

/// Consistent copy of a live WAL database (`VACUUM INTO`): readers are not
/// blocked and committed pages still in the WAL are included.
pub fn snapshot_db(src: &Path, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        fs::remove_file(dest).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open_with_flags(
        src,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(10))
        .map_err(|e| e.to_string())?;
    conn.execute("VACUUM INTO ?1", [dest.to_string_lossy().as_ref()])
        .map_err(|e| format!("snapshot of {} failed: {e}", src.display()))?;
    Ok(())
}

/// Files an export contains, relative to `data`: everything except SQLite
/// sidecars (the snapshot replaces them) and XR's own import/recovery dirs.
pub fn export_entries(data: &Path) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    let mut stack = vec![data.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
            let path = entry.path();
            let rel = match path.strip_prefix(data) {
                Ok(r) => r.to_path_buf(),
                Err(_) => continue,
            };
            let top = rel
                .components()
                .next()
                .map(|c| c.as_os_str().to_string_lossy().to_string())
                .unwrap_or_default();
            if is_internal(&top) {
                continue;
            }
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if name.ends_with(".db-wal") || name.ends_with(".db-shm") {
                continue;
            }
            if path.is_dir() {
                stack.push(path);
            } else {
                out.push(rel);
            }
        }
    }
    out.sort();
    Ok(out)
}

/// Write the export zip. Databases are snapshotted first.
pub fn write_export(data: &Path, dest: &Path) -> Result<usize, String> {
    let scratch = std::env::temp_dir().join(format!("xr-export-{}", now_ms()));
    fs::create_dir_all(&scratch).map_err(|e| e.to_string())?;
    let result = (|| {
        let file = fs::File::create(dest).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);
        let options: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let entries = export_entries(data)?;
        for rel in &entries {
            let src = data.join(rel);
            let bytes = if rel.extension().map(|e| e == "db").unwrap_or(false) {
                let snap = scratch.join(rel.file_name().unwrap_or_default());
                snapshot_db(&src, &snap)?;
                fs::read(&snap).map_err(|e| e.to_string())?
            } else {
                fs::read(&src).map_err(|e| e.to_string())?
            };
            let name = rel
                .components()
                .map(|c| c.as_os_str().to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join("/");
            zip.start_file(name, options).map_err(|e| e.to_string())?;
            std::io::Write::write_all(&mut zip, &bytes).map_err(|e| e.to_string())?;
        }
        zip.finish().map_err(|e| e.to_string())?;
        Ok(entries.len())
    })();
    let _ = fs::remove_dir_all(&scratch);
    if result.is_err() {
        let _ = fs::remove_file(dest);
    }
    result
}

/// A relative archive path that stays inside the destination.
fn safe_relative(name: &str) -> Option<PathBuf> {
    let p = Path::new(name);
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Normal(s) => out.push(s),
            Component::CurDir => {}
            _ => return None, // `..`, absolute roots, drive prefixes
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Validate + extract an export archive into `<data>/.pending-import/`.
/// Returns the number of files staged. The live data is never touched.
pub fn stage_import(zip_path: &Path, data: &Path) -> Result<usize, String> {
    let staging = data.join(PENDING_DIR);
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let result = stage_into(zip_path, &staging);
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn stage_into(zip_path: &Path, staging: &Path) -> Result<usize, String> {
    let file = fs::File::open(zip_path).map_err(|e| format!("could not open the archive: {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("this is not a valid XR export (not a zip archive): {e}"))?;
    if archive.len() > MAX_IMPORT_ENTRIES {
        return Err(format!(
            "the archive has {} entries (limit {MAX_IMPORT_ENTRIES})",
            archive.len()
        ));
    }
    let mut total: u64 = 0;
    let mut files = 0usize;
    let mut has_db = false;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("damaged archive entry #{i}: {e}"))?;
        let name = entry.name().to_string();
        let rel = safe_relative(&name)
            .ok_or_else(|| format!("refused archive entry outside the data folder: {name}"))?;
        let top = rel
            .components()
            .next()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .unwrap_or_default();
        let base = rel
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if is_internal(&top) || base.ends_with(".db-shm") {
            continue;
        }
        let dest = staging.join(&rel);
        if entry.is_dir() {
            fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = fs::File::create(&dest).map_err(|e| e.to_string())?;
        let mut limited = (&mut entry).take(MAX_IMPORT_BYTES.saturating_sub(total) + 1);
        let n = std::io::copy(&mut limited, &mut out)
            .map_err(|e| format!("damaged archive entry {name}: {e}"))?;
        total += n;
        if total > MAX_IMPORT_BYTES {
            return Err("the archive is larger than 4 GB uncompressed; refused".into());
        }
        if base.ends_with(".db") {
            has_db = true;
        }
        files += 1;
    }
    if files == 0 {
        return Err("the archive contains no XR data".into());
    }
    // Every database must be intact and self-contained before it can replace
    // the live one: open (replays a bundled WAL), integrity_check, checkpoint.
    if has_db {
        for rel in export_entries(staging)? {
            if rel.extension().map(|e| e == "db").unwrap_or(false) {
                let p = staging.join(&rel);
                let conn = Connection::open(&p).map_err(|e| {
                    format!("{} in the archive is not a database: {e}", rel.display())
                })?;
                let verdict: String = conn
                    .query_row("PRAGMA integrity_check", [], |r| r.get(0))
                    .map_err(|e| format!("{} in the archive is damaged: {e}", rel.display()))?;
                if verdict != "ok" {
                    return Err(format!(
                        "{} in the archive is damaged: {verdict}",
                        rel.display()
                    ));
                }
                let _ = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
                drop(conn);
                for side in sqlite_sidecars(&p) {
                    let _ = fs::remove_file(side);
                }
            }
        }
    }
    fs::write(staging.join(READY_MARKER), b"ok").map_err(|e| e.to_string())?;
    Ok(files)
}

pub fn has_pending_import(data: &Path) -> bool {
    data.join(PENDING_DIR).join(READY_MARKER).is_file()
}

/// Launches that may fail to apply a staged import before it is discarded.
pub const MAX_APPLY_LAUNCHES: u32 = 3;
const ATTEMPTS_FILE: &str = ".attempts";

/// Apply a staged import. Call at startup BEFORE any database is opened.
/// Returns Some(notice) when an import was applied.
///
/// On Windows `app.restart()` starts the new process before the old one has
/// released xr.db, so a rename can fail transiently: retry for a few seconds,
/// and if it still fails roll back, KEEP the staged import and try again at
/// the next launch (discarded after `MAX_APPLY_LAUNCHES` failed launches).
pub fn apply_pending_import(data: &Path) -> Result<Option<String>, String> {
    apply_pending_import_with(data, now_ms(), 20, std::time::Duration::from_millis(250))
}

pub fn apply_pending_import_at(data: &Path, stamp: u128) -> Result<Option<String>, String> {
    apply_pending_import_with(data, stamp, 1, std::time::Duration::ZERO)
}

pub fn apply_pending_import_with(
    data: &Path,
    stamp: u128,
    attempts: u32,
    delay: std::time::Duration,
) -> Result<Option<String>, String> {
    let staging = data.join(PENDING_DIR);
    if !staging.exists() {
        return Ok(None);
    }
    if !has_pending_import(data) {
        // An interrupted staging run: discard it, the live data was never touched.
        let _ = fs::remove_dir_all(&staging);
        return Ok(None);
    }
    let mut last = String::new();
    for attempt in 0..attempts.max(1) {
        if attempt > 0 {
            std::thread::sleep(delay);
        }
        match try_apply(data, &staging, stamp) {
            Ok(notice) => return Ok(Some(notice)),
            Err(e) => last = e,
        }
    }
    // Rolled back; the live data is exactly as it was.
    let counter = staging.join(ATTEMPTS_FILE);
    let failed = fs::read_to_string(&counter)
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0)
        + 1;
    if failed >= MAX_APPLY_LAUNCHES {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!(
            "The import could not be applied after {failed} launches and was discarded; your data is unchanged. Import the file again after closing other XR windows. ({last})"
        ));
    }
    let _ = fs::write(&counter, failed.to_string());
    Err(format!(
        "The import could not be applied yet and was rolled back; your data is unchanged. XR will try again the next time it starts. ({last})"
    ))
}

fn try_apply(data: &Path, staging: &Path, stamp: u128) -> Result<String, String> {
    let backup = data.join(format!("{BACKUP_PREFIX}{stamp}"));
    fs::create_dir_all(&backup).map_err(|e| e.to_string())?;
    let mut moved_out: Vec<String> = Vec::new();
    let mut moved_in: Vec<String> = Vec::new();
    let outcome = (|| -> Result<(), String> {
        for entry in fs::read_dir(data).map_err(|e| e.to_string())?.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if is_internal(&name) {
                continue;
            }
            fs::rename(entry.path(), backup.join(&name))
                .map_err(|e| format!("could not back up {name}: {e}"))?;
            moved_out.push(name);
        }
        for entry in fs::read_dir(staging).map_err(|e| e.to_string())?.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name == READY_MARKER || name == ATTEMPTS_FILE {
                continue;
            }
            fs::rename(entry.path(), data.join(&name))
                .map_err(|e| format!("could not move {name} into place: {e}"))?;
            moved_in.push(name);
        }
        Ok(())
    })();
    match outcome {
        Ok(()) => {
            let _ = fs::remove_dir_all(staging);
            prune_backups(data, KEEP_BACKUPS);
            Ok(format!(
                "Import finished. Your previous data is kept in {}.",
                backup.display()
            ))
        }
        Err(e) => {
            // Roll back: staged files out, originals back in.
            for name in &moved_in {
                let _ = fs::rename(data.join(name), staging.join(name));
            }
            for name in &moved_out {
                let _ = fs::rename(backup.join(name), data.join(name));
            }
            let _ = fs::remove_dir(&backup);
            Err(e)
        }
    }
}

fn prune_backups(data: &Path, keep: usize) {
    let mut backups: Vec<PathBuf> = fs::read_dir(data)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.file_name().to_string_lossy().starts_with(BACKUP_PREFIX))
                .map(|e| e.path())
                .collect()
        })
        .unwrap_or_default();
    backups.sort();
    while backups.len() > keep {
        let old = backups.remove(0);
        let _ = fs::remove_dir_all(old);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DDL: &str =
        "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL);";

    fn tmp(tag: &str) -> PathBuf {
        let d =
            std::env::temp_dir().join(format!("xr-ds-{tag}-{}-{}", std::process::id(), now_ms()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn clean_open_has_no_notice() {
        let d = tmp("clean");
        let o = open_shared_db(&d, DDL);
        assert!(o.notice.is_none());
        assert!(!o.in_memory);
        let mode: String = o
            .conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
    }

    #[test]
    fn corrupt_db_is_quarantined_not_deleted_and_never_panics() {
        let d = tmp("corrupt");
        let garbage =
            b"this is not an sqlite database, it is garbage that must not crash XR".repeat(200);
        fs::write(d.join(DB_NAME), &garbage).unwrap();
        let o = open_shared_db_at(&d, DDL, 42, false);
        assert!(!o.in_memory);
        let notice = o.notice.expect("recovery must be reported");
        assert!(notice.contains("xr.db.corrupt-42"), "{notice}");
        assert_eq!(
            fs::read(d.join("xr.db.corrupt-42")).unwrap(),
            garbage,
            "damaged file kept byte-for-byte"
        );
        o.conn
            .execute("INSERT INTO notes (body) VALUES ('fresh')", [])
            .unwrap();
        assert_eq!(count(&o.conn), 1);
    }

    #[test]
    fn preflight_quarantines_a_db_with_damaged_pages() {
        let d = tmp("pages");
        {
            let c = open_shared_db(&d, DDL).conn;
            for i in 0..2000 {
                c.execute(
                    "INSERT INTO notes (body) VALUES (?1)",
                    [format!("row-{i}-{}", "x".repeat(200))],
                )
                .unwrap();
            }
        } // closed: WAL checkpointed into the main file
        let path = d.join(DB_NAME);
        let mut bytes = fs::read(&path).unwrap();
        assert!(bytes.len() > 64 * 1024);
        // Keep the 100-byte header valid, smash interior b-tree pages.
        for b in bytes.iter_mut().skip(4096).take(32 * 1024) {
            *b = 0xA5;
        }
        fs::write(&path, &bytes).unwrap();
        let notice = preflight(&d).expect("damage must be detected");
        assert!(notice.contains("xr.db.corrupt-"), "{notice}");
        // Subsequent subsystem opens get a fresh, working database.
        let o = open_shared_db(&d, DDL);
        assert!(o.notice.is_none());
        assert_eq!(count(&o.conn), 0);
    }

    #[test]
    fn preflight_on_a_healthy_db_is_silent() {
        let d = tmp("healthy");
        drop(open_shared_db(&d, DDL));
        assert!(preflight(&d).is_none());
    }

    #[test]
    fn unopenable_location_falls_back_to_memory() {
        let d = tmp("nodir");
        let blocker = d.join("file-not-dir");
        fs::write(&blocker, b"x").unwrap();
        let o = open_shared_db(&blocker.join("sub"), DDL);
        assert!(o.in_memory);
        assert!(o.notice.unwrap().contains("without saving"));
        o.conn
            .execute("INSERT INTO notes (body) VALUES ('m')", [])
            .unwrap();
    }

    #[test]
    fn export_snapshot_includes_rows_still_in_the_wal() {
        let d = tmp("export");
        let live = open_shared_db(&d, DDL).conn;
        // Keep the WAL from being checkpointed into the main file.
        live.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        for i in 0..50 {
            live.execute("INSERT INTO notes (body) VALUES (?1)", [format!("n{i}")])
                .unwrap();
        }
        assert!(
            d.join("xr.db-wal").metadata().unwrap().len() > 0,
            "rows are in the WAL"
        );
        fs::write(d.join("settings.json"), b"{\"xr.theme\":\"dark\"}").unwrap();
        let zip_path = tmp("export-out").join("xr-export.zip");
        let n = write_export(&d, &zip_path).unwrap();
        assert_eq!(n, 2, "xr.db + settings.json; no -wal/-shm");
        // Import it elsewhere: all 50 rows survive.
        let other = tmp("export-import");
        assert_eq!(stage_import(&zip_path, &other).unwrap(), 2);
        apply_pending_import(&other).unwrap().unwrap();
        let c = Connection::open(other.join(DB_NAME)).unwrap();
        assert_eq!(count(&c), 50);
        assert_eq!(
            fs::read_to_string(other.join("settings.json")).unwrap(),
            "{\"xr.theme\":\"dark\"}"
        );
    }

    fn make_export(rows: i64) -> PathBuf {
        let src = tmp("src");
        let c = open_shared_db(&src, DDL).conn;
        for i in 0..rows {
            c.execute(
                "INSERT INTO notes (body) VALUES (?1)",
                [format!("imported-{i}")],
            )
            .unwrap();
        }
        drop(c);
        let z = tmp("zip").join("in.zip");
        write_export(&src, &z).unwrap();
        z
    }

    #[test]
    fn import_over_a_live_wal_db_loses_nothing_and_keeps_a_backup() {
        let data = tmp("live");
        let live = open_shared_db(&data, DDL).conn;
        live.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        for i in 0..20 {
            live.execute(
                "INSERT INTO notes (body) VALUES (?1)",
                [format!("live-{i}")],
            )
            .unwrap();
        }
        let z = make_export(7);
        // Staging while the live connection is open and writing.
        stage_import(&z, &data).unwrap();
        live.execute(
            "INSERT INTO notes (body) VALUES ('written-after-staging')",
            [],
        )
        .unwrap();
        assert_eq!(count(&live), 21, "live DB untouched by staging");
        // `app.restart()` exits without closing connections: on Unix leave the
        // -wal/-shm on disk exactly like a real restart (Windows cannot rename
        // an open file, and the shell's restart closes handles there).
        #[cfg(unix)]
        std::mem::forget(live);
        #[cfg(not(unix))]
        drop(live);
        let notice = apply_pending_import_at(&data, 7).unwrap().unwrap();
        assert!(notice.contains(".import-backup-7"));
        let now = Connection::open(data.join(DB_NAME)).unwrap();
        assert_eq!(count(&now), 7, "imported data in place");
        // The previous database, including its WAL, is preserved in full.
        let backup = data.join(".import-backup-7");
        let old = Connection::open(backup.join(DB_NAME)).unwrap();
        assert_eq!(
            count(&old),
            21,
            "nothing lost: the pre-import data incl. WAL rows is in the backup"
        );
        assert!(!data.join(PENDING_DIR).exists());
    }

    #[test]
    fn corrupt_or_hostile_archives_are_errors_and_leave_live_data_alone() {
        let data = tmp("hostile");
        let live = open_shared_db(&data, DDL).conn;
        live.execute("INSERT INTO notes (body) VALUES ('keep')", [])
            .unwrap();

        // Not a zip at all.
        let junk = tmp("junk").join("x.zip");
        fs::write(&junk, b"PK\x03\x04 broken").unwrap();
        assert!(stage_import(&junk, &data)
            .unwrap_err()
            .contains("not a valid XR export"));

        // A zip whose xr.db is garbage.
        let bad = tmp("baddb").join("bad.zip");
        {
            let mut zw = zip::ZipWriter::new(fs::File::create(&bad).unwrap());
            zw.start_file("xr.db", zip::write::SimpleFileOptions::default())
                .unwrap();
            std::io::Write::write_all(&mut zw, &b"garbage".repeat(1000)).unwrap();
            zw.finish().unwrap();
        }
        let err = stage_import(&bad, &data).unwrap_err();
        assert!(err.contains("xr.db in the archive"), "{err}");

        // Path traversal.
        let evil = tmp("evil").join("evil.zip");
        {
            let mut zw = zip::ZipWriter::new(fs::File::create(&evil).unwrap());
            zw.start_file("../escape.txt", zip::write::SimpleFileOptions::default())
                .unwrap();
            std::io::Write::write_all(&mut zw, b"x").unwrap();
            zw.finish().unwrap();
        }
        assert!(stage_import(&evil, &data)
            .unwrap_err()
            .contains("outside the data folder"));
        assert!(!data.parent().unwrap().join("escape.txt").exists());

        // Nothing staged, nothing applied, live row intact.
        assert!(!data.join(PENDING_DIR).exists());
        assert_eq!(apply_pending_import(&data).unwrap(), None);
        assert_eq!(count(&live), 1);
    }

    #[test]
    fn interrupted_staging_is_discarded_on_next_launch() {
        let data = tmp("interrupted");
        fs::create_dir_all(data.join(PENDING_DIR)).unwrap();
        fs::write(data.join(PENDING_DIR).join(DB_NAME), b"half").unwrap(); // no .ready marker
        fs::write(data.join("settings.json"), b"{}").unwrap();
        assert_eq!(apply_pending_import(&data).unwrap(), None);
        assert!(!data.join(PENDING_DIR).exists());
        assert_eq!(fs::read(data.join("settings.json")).unwrap(), b"{}");
    }

    #[test]
    fn a_failed_apply_rolls_back_keeps_the_staging_and_gives_up_after_three_launches() {
        let data = tmp("retry");
        let live = open_shared_db(&data, DDL).conn;
        live.execute("INSERT INTO notes (body) VALUES ('keep')", [])
            .unwrap();
        drop(live);
        fs::write(data.join("settings.json"), b"{\"mine\":1}").unwrap();
        stage_import(&make_export(3), &data).unwrap();
        // Force the backup move to fail: the target name is a non-empty dir.
        let jam = |ts: u128| {
            let d = data
                .join(format!("{BACKUP_PREFIX}{ts}"))
                .join("settings.json");
            fs::create_dir_all(d.join("x")).unwrap();
        };
        for (launch, ts) in [(1u32, 100u128), (2, 200)] {
            jam(ts);
            let err = apply_pending_import_at(&data, ts).unwrap_err();
            assert!(
                err.contains("try again the next time"),
                "launch {launch}: {err}"
            );
            assert!(
                has_pending_import(&data),
                "staging kept for the next launch"
            );
            let c = Connection::open(data.join(DB_NAME)).unwrap();
            assert_eq!(count(&c), 1, "live data unchanged after rollback");
            assert_eq!(
                fs::read(data.join("settings.json")).unwrap(),
                b"{\"mine\":1}"
            );
        }
        jam(300);
        let err = apply_pending_import_at(&data, 300).unwrap_err();
        assert!(err.contains("discarded"), "{err}");
        assert!(!data.join(PENDING_DIR).exists());
        let c = Connection::open(data.join(DB_NAME)).unwrap();
        assert_eq!(count(&c), 1);
    }

    #[test]
    fn a_transient_failure_succeeds_on_retry_within_one_launch() {
        let data = tmp("transient");
        fs::write(data.join("settings.json"), b"{}").unwrap();
        stage_import(&make_export(2), &data).unwrap();
        let jammed = data
            .join(format!("{BACKUP_PREFIX}500"))
            .join("settings.json");
        fs::create_dir_all(jammed.join("x")).unwrap();
        // Another thread "releases the file" shortly after the first attempt.
        let release = jammed.clone();
        let t = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(60));
            fs::remove_dir_all(release).unwrap();
        });
        let notice =
            apply_pending_import_with(&data, 500, 20, std::time::Duration::from_millis(25))
                .unwrap()
                .unwrap();
        t.join().unwrap();
        assert!(notice.contains("Import finished"));
        let c = Connection::open(data.join(DB_NAME)).unwrap();
        assert_eq!(count(&c), 2);
    }

    #[test]
    fn old_backups_are_pruned_to_two() {
        let data = tmp("prune");
        for ts in [1u128, 2, 3] {
            let z = make_export(1);
            stage_import(&z, &data).unwrap();
            apply_pending_import_at(&data, ts).unwrap();
        }
        let mut names: Vec<String> = fs::read_dir(&data)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with(BACKUP_PREFIX))
            .collect();
        names.sort();
        assert_eq!(names, vec![".import-backup-2", ".import-backup-3"]);
    }

    #[test]
    fn export_skips_internal_dirs() {
        let data = tmp("internal");
        fs::create_dir_all(data.join(".import-backup-1")).unwrap();
        fs::write(data.join(".import-backup-1").join(DB_NAME), b"old").unwrap();
        fs::write(data.join("xr.db.corrupt-5"), b"bad").unwrap();
        fs::write(data.join("approvals.json"), b"{}").unwrap();
        assert_eq!(
            export_entries(&data).unwrap(),
            vec![PathBuf::from("approvals.json")]
        );
    }
}
