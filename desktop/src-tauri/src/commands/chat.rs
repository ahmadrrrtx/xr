/*
 * Phase 4 — chat persistence (SQLite via rusqlite).
 *
 * One connection guarded by a Mutex, managed as Tauri state; WAL journal;
 * DB file lives in the app data dir (`xr.db`). Schema is idempotent
 * (CREATE TABLE IF NOT EXISTS) — no migration framework at this scale.
 * The frontend talks to these through src/lib/chat-db.ts, which mirrors the
 * same contract with a localStorage impl for plain-browser dev.
 */
use rusqlite::Connection;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{Manager, State};

pub struct ChatDb(pub Mutex<Connection>);

/// Called once from the Tauri setup hook.
pub fn init(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let conn = Connection::open(dir.join("xr.db"))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sessions (
            id         TEXT PRIMARY KEY,
            title      TEXT NOT NULL DEFAULT 'New chat',
            model      TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            archived   INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
        CREATE TABLE IF NOT EXISTS messages (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            role        TEXT NOT NULL,
            content     TEXT NOT NULL,
            metadata    TEXT,
            tool_calls  TEXT,
            created_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at DESC);",
    )?;
    app.manage(ChatDb(Mutex::new(conn)));
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: String,
    pub model: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub metadata: Option<serde_json::Value>,
    pub tool_calls: Option<serde_json::Value>,
    pub created_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagePage {
    pub messages: Vec<ChatMessage>,
    pub has_more: bool,
}

fn row_to_session(row: &rusqlite::Row) -> rusqlite::Result<Session> {
    Ok(Session {
        id: row.get(0)?,
        title: row.get(1)?,
        model: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        archived: row.get::<_, i64>(5)? != 0,
    })
}

fn row_to_message(row: &rusqlite::Row) -> rusqlite::Result<ChatMessage> {
    let metadata: Option<String> = row.get(4)?;
    let tool_calls: Option<String> = row.get(5)?;
    Ok(ChatMessage {
        id: row.get(0)?,
        session_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        metadata: metadata.and_then(|m| serde_json::from_str(&m).ok()),
        tool_calls: tool_calls.and_then(|t| serde_json::from_str(&t).ok()),
        created_at: row.get(6)?,
    })
}

#[tauri::command]
pub fn chat_list_sessions(db: State<ChatDb>) -> Result<Vec<Session>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, title, model, created_at, updated_at, archived FROM sessions WHERE archived = 0 ORDER BY updated_at DESC LIMIT 1000")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_session)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chat_get_session(db: State<ChatDb>, id: String) -> Result<Option<Session>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, title, model, created_at, updated_at, archived FROM sessions WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map([&id], row_to_session)
        .map_err(|e| e.to_string())?;
    // rusqlite 0.37: MappedRows::next() → Option<Result<Session>>
    match rows.next() {
        Some(Ok(session)) => Ok(Some(session)),
        Some(Err(e)) => Err(e.to_string()),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn chat_create_session(
    db: State<ChatDb>,
    id: String,
    title: String,
    model: Option<String>,
    now: i64,
) -> Result<Session, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        rusqlite::params![id, title, model, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(Session {
        id,
        title,
        model,
        created_at: now,
        updated_at: now,
        archived: false,
    })
}

#[tauri::command]
pub fn chat_update_session_title(db: State<ChatDb>, id: String, title: String, now: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE sessions SET title = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, title, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn chat_update_session_model(db: State<ChatDb>, id: String, model: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE sessions SET model = ?2 WHERE id = ?1",
        rusqlite::params![id, model],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn chat_archive_session(db: State<ChatDb>, id: String, archived: bool) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE sessions SET archived = ?2 WHERE id = ?1",
        rusqlite::params![id, archived as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn chat_delete_session(db: State<ChatDb>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sessions WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Cursor pagination: newest-first internally, `limit + 1` fetched to detect
/// `hasMore`. `cursor` = created_at ms of the oldest already-loaded message
/// (None on first load). Returned oldest→newest for direct rendering.
#[tauri::command]
pub fn chat_list_messages(
    db: State<ChatDb>,
    session_id: String,
    cursor: Option<i64>,
    limit: i64,
) -> Result<MessagePage, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, role, content, metadata, tool_calls, created_at
             FROM messages
             WHERE session_id = ?1 AND (?2 IS NULL OR created_at < ?2)
             ORDER BY created_at DESC
             LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![session_id, cursor, limit + 1], row_to_message)
        .map_err(|e| e.to_string())?;
    let mut all = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    let has_more = all.len() as i64 > limit;
    if has_more {
        all.truncate(limit as usize);
    }
    all.reverse(); // oldest → newest
    Ok(MessagePage { messages: all, has_more })
}

#[tauri::command]
// 8 fields is the shape of a persisted message row; the flat args ARE the
// wire contract with the frontend (desktop/src/lib/chat-db.ts invokes this
// command with exactly these camelCase keys, covered by the Phase-4 e2e
// suite). Collapsing them into a struct would change the IPC shape for a
// lint preference, so the boundary is allowed explicitly instead.
#[allow(clippy::too_many_arguments)]
pub fn chat_save_message(
    db: State<ChatDb>,
    id: String,
    session_id: String,
    role: String,
    content: String,
    metadata: Option<serde_json::Value>,
    tool_calls: Option<serde_json::Value>,
    created_at: i64,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO messages (id, session_id, role, content, metadata, tool_calls, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            content = excluded.content,
            metadata = excluded.metadata,
            tool_calls = excluded.tool_calls",
        rusqlite::params![
            id,
            session_id,
            role,
            content,
            metadata.map(|m| m.to_string()),
            tool_calls.map(|t| t.to_string()),
            created_at
        ],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE sessions SET updated_at = ?2 WHERE id = ?1",
        rusqlite::params![session_id, created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn chat_delete_message(db: State<ChatDb>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM messages WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
