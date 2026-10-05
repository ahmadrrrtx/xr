/*
 * Phase 10 — WorkspaceDb.
 *
 * Same house pattern as ChatDb (chat.rs): a `Mutex<Connection>` on the shared
 * xr.db file, initialized once from the app setup hook, idempotent DDL.
 * WAL is enabled by the shared open helper, so the two connections coexist.
 */
use std::collections::HashMap;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension, Row};
use tauri::{AppHandle, Manager};

use super::model::{WindowBounds, Workspace, WorkspaceKind, WorkspacePatch};

const MIGRATIONS: &str = include_str!("migrations.sql");

pub struct WorkspaceDb {
    conn: Mutex<Connection>,
}

impl WorkspaceDb {
    pub fn init(app: &AppHandle) -> Self {
        let dir = app
            .path()
            .app_data_dir()
            .expect("tauri app_data_dir must resolve");
        std::fs::create_dir_all(&dir).expect("create app data dir");
        let path = dir.join("xr.db");
        let conn = Connection::open(&path).expect("open xr.db");
        conn.pragma_update(None, "journal_mode", "WAL")
            .expect("enable WAL (shared with chat)");
        conn.execute_batch(MIGRATIONS).expect("apply workspace DDL");
        WorkspaceDb {
            conn: Mutex::new(conn),
        }
    }
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn slugify(name: &str) -> String {
    name.trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

pub fn unique_slug(conn: &Connection, name: &str) -> String {
    let base = if slugify(name).is_empty() {
        "workspace".to_string()
    } else {
        slugify(name)
    };
    let mut candidate = base.clone();
    let mut n = 2;
    while conn
        .query_row(
            "SELECT 1 FROM workspaces WHERE slug = ?1",
            params![candidate],
            |_| Ok(()),
        )
        .optional()
        .ok()
        .flatten()
        .is_some()
    {
        candidate = format!("{base}-{n}");
        n += 1;
    }
    candidate
}

fn row_to_workspace(row: &Row) -> rusqlite::Result<Workspace> {
    let icon: Option<String> = row.get("icon")?;
    let stack_json: String = row.get("stack")?;
    let stack: Vec<String> = serde_json::from_str(&stack_json).unwrap_or_default();
    let pos_x: Option<i64> = row.get("window_pos_x")?;
    let pos_y: Option<i64> = row.get("window_pos_y")?;
    let w: i64 = row.get("window_w")?;
    let h: i64 = row.get("window_h")?;
    Ok(Workspace {
        id: row.get("id")?,
        name: row.get("name")?,
        slug: row.get("slug")?,
        path: row.get("path")?,
        kind: row.get::<_, String>("kind")?.parse().unwrap_or(WorkspaceKind::Custom),
        icon,
        stack,
        pinned: row.get::<_, i64>("pinned")? != 0,
        last_opened_at: row.get("last_opened_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        window_bounds: match (pos_x, pos_y) {
            (Some(x), Some(y)) => Some(WindowBounds {
                x: x as i32,
                y: y as i32,
                w: w as i32,
                h: h as i32,
            }),
            _ => None,
        },
        // Filled by the caller after the folder stat.
        path_exists: true,
    })
}

impl WorkspaceDb {
    fn mark_exists(list: &mut [Workspace]) {
        for ws in list.iter_mut() {
            ws.path_exists = std::path::Path::new(&ws.path).is_dir();
        }
    }

    pub fn list(&self) -> Result<Vec<Workspace>, String> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn
            .prepare(
                "SELECT * FROM workspaces ORDER BY pinned DESC, last_opened_at DESC, name ASC",
            )
            .map_err(|e| e.to_string())?;
        let mut rows: Vec<Workspace> = stmt
            .query_map([], row_to_workspace)
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        Self::mark_exists(&mut rows);
        Ok(rows)
    }

    pub fn get(&self, id: &str) -> Result<Option<Workspace>, String> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let row = conn
            .query_row(
                "SELECT * FROM workspaces WHERE id = ?1",
                params![id],
                row_to_workspace,
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(row.map(|mut ws| {
            ws.path_exists = std::path::Path::new(&ws.path).is_dir();
            ws
        }))
    }

    /// Insert a workspace. `path` must already exist on disk (created by the
    /// caller: scaffold / clone / picker).
    pub fn create(
        &self,
        name: &str,
        path: &str,
        kind: WorkspaceKind,
        stack: &[String],
    ) -> Result<Workspace, String> {
        let now = now_ms();
        let (id, slug) = {
            let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
            (uuid::Uuid::new_v4().to_string(), unique_slug(&conn, name))
        };
        let stack_json =
            serde_json::to_string(stack).map_err(|e| e.to_string())?;
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "INSERT INTO workspaces
               (id, name, slug, path, kind, icon, stack, pinned, created_at, updated_at, window_w, window_h)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8, 1280, 800)",
            params![
                id,
                name,
                slug,
                path,
                kind.as_str(),
                kind.default_icon(),
                stack_json,
                now
            ],
        )
        .map_err(|e| format!("insert workspace: {e}"))?;
        Ok(Workspace {
            id,
            name: name.to_string(),
            slug,
            path: path.to_string(),
            kind,
            icon: Some(kind.default_icon().to_string()),
            stack: stack.to_vec(),
            pinned: false,
            last_opened_at: None,
            created_at: now,
            updated_at: now,
            window_bounds: None,
            path_exists: true,
        })
    }

    pub fn update(&self, id: &str, patch: &WorkspacePatch) -> Result<Workspace, String> {
        let now = now_ms();
        {
            let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
            // Name changes keep the slug stable (slug is a URL key, not display).
            if let Some(name) = &patch.name {
                if !name.trim().is_empty() {
                    conn.execute(
                        "UPDATE workspaces SET name = ?1, updated_at = ?2 WHERE id = ?3",
                        params![name.trim(), now, id],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
            if let Some(path) = &patch.path {
                conn.execute(
                    "UPDATE workspaces SET path = ?1, updated_at = ?2 WHERE id = ?3",
                    params![path, now, id],
                )
                .map_err(|e| e.to_string())?;
            }
            if let Some(icon) = &patch.icon {
                conn.execute(
                    "UPDATE workspaces SET icon = ?1, updated_at = ?2 WHERE id = ?3",
                    params![icon, now, id],
                )
                .map_err(|e| e.to_string())?;
            }
            if let Some(stack) = &patch.stack {
                let json = serde_json::to_string(stack).map_err(|e| e.to_string())?;
                conn.execute(
                    "UPDATE workspaces SET stack = ?1, updated_at = ?2 WHERE id = ?3",
                    params![json, now, id],
                )
                .map_err(|e| e.to_string())?;
            }
            if let Some(pinned) = patch.pinned {
                conn.execute(
                    "UPDATE workspaces SET pinned = ?1, updated_at = ?2 WHERE id = ?3",
                    params![pinned as i64, now, id],
                )
                .map_err(|e| e.to_string())?;
            }
            if let Some(ts) = patch.last_opened_at {
                conn.execute(
                    "UPDATE workspaces SET last_opened_at = ?1, updated_at = ?2 WHERE id = ?3",
                    params![ts, now, id],
                )
                .map_err(|e| e.to_string())?;
            }
            if let Some(bounds) = &patch.window_bounds {
                match bounds {
                    Some(b) => {
                        conn.execute(
                            "UPDATE workspaces
                             SET window_pos_x = ?1, window_pos_y = ?2, window_w = ?3, window_h = ?4
                             WHERE id = ?5",
                            params![b.x, b.y, b.w, b.h, id],
                        )
                        .map_err(|e| e.to_string())?;
                    }
                    None => {
                        conn.execute(
                            "UPDATE workspaces
                             SET window_pos_x = NULL, window_pos_y = NULL WHERE id = ?1",
                            params![id],
                        )
                        .map_err(|e| e.to_string())?;
                    }
                }
            }
        }
        // Fresh read after the guard is down (re-entrant lock would deadlock).
        self.get(id)?.ok_or_else(|| format!("workspace {id} not found after update"))
    }

    /// Re-insert a previously deleted row (frontend "Undo" — only offered
    /// when the files were left in place, so nothing can be half-true).
    pub fn restore(&self, ws: &Workspace) -> Result<(), String> {
        let now = now_ms();
        let stack_json = serde_json::to_string(&ws.stack).map_err(|e| e.to_string())?;
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "INSERT OR REPLACE INTO workspaces
               (id, name, slug, path, kind, icon, stack, pinned, last_opened_at,
                created_at, updated_at, window_pos_x, window_pos_y, window_w, window_h)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                ws.id,
                ws.name,
                ws.slug,
                ws.path,
                ws.kind.as_str(),
                ws.icon,
                stack_json,
                ws.pinned as i64,
                ws.last_opened_at,
                ws.created_at,
                now,
                ws.window_bounds.map(|b| b.x),
                ws.window_bounds.map(|b| b.y),
                ws.window_bounds.map(|b| b.w).unwrap_or(1280),
                ws.window_bounds.map(|b| b.h).unwrap_or(800),
            ],
        )
        .map_err(|e| format!("restore workspace: {e}"))?;
        Ok(())
    }

    /// `delete_files = true` → the folder goes to the platform trash first.
    /// Returns whether the folder (if any) actually moved to trash.
    pub fn delete(&self, id: &str, delete_files: bool) -> Result<bool, String> {
        let (path, exists) = {
            let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
            let row: Option<String> = conn
                .query_row(
                    "SELECT path FROM workspaces WHERE id = ?1",
                    params![id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            match row {
                Some(p) => {
                    let exists = std::path::Path::new(&p).is_dir();
                    (p, exists)
                }
                None => return Err(format!("workspace {id} not found")),
            }
        };
        let trashed = if delete_files && exists {
            trash::DEFAULT_TRASH_CTX.delete(&path).map(|_| true).unwrap_or(false)
        } else {
            false
        };
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute("DELETE FROM workspaces WHERE id = ?1", params![id])
            .map_err(|e| format!("delete workspace: {e}"))?;
        Ok(trashed)
    }

    /// Metadata-only duplicate (brief: no file copy — fs_extra intentionally
    /// not added). The duplicate points at the SAME folder; the honest toast
    /// lives in the frontend.
    pub fn duplicate(&self, id: &str) -> Result<Workspace, String> {
        let new_id = {
            let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
            let src: Option<Workspace> = conn
                .query_row(
                    "SELECT * FROM workspaces WHERE id = ?1",
                    params![id],
                    row_to_workspace,
                )
                .optional()
                .map_err(|e| e.to_string())?;
            let src = src.ok_or_else(|| format!("workspace {id} not found"))?;
            let name = format!("{} (copy)", src.name);
            let slug = unique_slug(&conn, &name);
            let now = now_ms();
            let new_id = uuid::Uuid::new_v4().to_string();
            let stack_json = serde_json::to_string(&src.stack).map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO workspaces
                   (id, name, slug, path, kind, icon, stack, pinned, created_at, updated_at, window_w, window_h)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8, 1280, 800)",
                params![
                    new_id,
                    name,
                    slug,
                    src.path,
                    src.kind.as_str(),
                    src.icon,
                    stack_json,
                    now
                ],
            )
            .map_err(|e| format!("duplicate workspace: {e}"))?;
            new_id
        };
        // Fresh read after the guard is down (re-entrant lock would deadlock).
        self.get(&new_id)?.ok_or_else(|| "duplicate vanished".into())
    }

    /// Latest saved bounds per workspace id (for spawn + cascade logic).
    pub fn bounds_map(&self) -> Result<HashMap<String, WindowBounds>, String> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn
            .prepare(
                "SELECT id, window_pos_x, window_pos_y, window_w, window_h
                 FROM workspaces WHERE window_pos_x IS NOT NULL",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    WindowBounds {
                        x: r.get::<_, i32>(1)?,
                        y: r.get::<_, i32>(2)?,
                        w: r.get::<_, i32>(3)?,
                        h: r.get::<_, i32>(4)?,
                    },
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut map = HashMap::new();
        for row in rows {
            let (id, b) = row.map_err(|e| e.to_string())?;
            map.insert(id, b);
        }
        Ok(map)
    }
}

/// Test hook: same DDL bootstrap as init() but on a given path.
#[cfg(test)]
pub fn open_test_db(path: &str) -> WorkspaceDb {
    let conn = Connection::open(path).expect("open test xr.db");
    conn.pragma_update(None, "journal_mode", "WAL")
        .expect("enable WAL");
    conn.execute_batch(MIGRATIONS).expect("apply workspace DDL");
    WorkspaceDb {
        conn: Mutex::new(conn),
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_create_workspace_table() {
        let dir = std::env::temp_dir().join(format!("xr-wsdb-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("test.db");
        let _ = std::fs::remove_file(&path);
        let db = open_test_db(path.to_str().unwrap());
        assert!(db.list().unwrap().is_empty());

        let stack: Vec<String> = vec!["web".into(), "vite".into()];
        let ws = db
            .create("Test App", "/tmp/xr-test-app", WorkspaceKind::Web, &stack)
            .unwrap();
        assert_eq!(ws.slug, "test-app");
        assert!(db.list().unwrap().len() == 1);

        // Duplicate keeps the same folder, new row.
        let copy = db.duplicate(&ws.id).unwrap();
        assert_eq!(copy.path, ws.path);
        assert_eq!(db.list().unwrap().len(), 2);

        // Row-only delete (no files moved) → restore re-inserts.
        assert!(!db.delete(&copy.id, false).unwrap());
        assert!(db.list().unwrap().len() == 1);
        db.restore(&copy).unwrap();
        assert!(db.list().unwrap().len() == 2);

        let _ = db.delete(&ws.id, false).unwrap();
        let _ = db.delete(&copy.id, false).unwrap();
        assert!(db.list().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
