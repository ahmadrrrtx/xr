/*
 * Control Room commands (Phase 11, SCREEN 9).
 *
 * The shell is the contract, not the source of truth yet: the run registry
 * lives in the webview's `runsStore` (deterministic demo history + the
 * Brain's mock streams) until the agent runtime lands in Phase 14. What
 * ships here is the IPC surface that runtime will fill in:
 *
 *   list_runs                         — the host's known runs (empty for now)
 *   cancel_run(id, reason)            — re-broadcast as `run:cancelled`
 *   bulk_cancel_runs(ids, reason)     — same, one event for the whole batch
 *   save_runs_export(filename, text)  — native save dialog → file on disk
 *
 * `run:cancelled` is emitted to EVERY webview, so a stop issued in the main
 * window also halts a workspace window that happens to be streaming the
 * same run, and vice versa (src/runs/bridge.ts listens on both sides).
 */
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;

pub const RUN_CANCELLED_EVENT: &str = "run:cancelled";

/// Mirror of `RunSummary` in src/brain/types.ts (camelCase on the wire).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub id: String,
    pub short_id: String,
    pub title: String,
    pub agent: String,
    pub agent_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    pub model: String,
    pub status: String,
    pub started_at: u64,
    pub ended_at: Option<u64>,
    pub duration_ms: Option<u64>,
    pub tokens_in: u64,
    pub tokens_out: u64,
    pub cost_usd: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_summary: Option<String>,
    pub surface: String,
}

/// Payload of `run:cancelled`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCancelled {
    pub ids: Vec<String>,
    pub reason: Option<String>,
    /// ms since epoch, host clock.
    pub at: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Trim, drop empties, keep first occurrence (order preserved).
pub fn normalize_ids(ids: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(ids.len());
    for id in ids {
        let id = id.trim();
        if id.is_empty() || out.iter().any(|x| x == id) {
            continue;
        }
        out.push(id.to_string());
    }
    out
}

/// Empty reasons are no reasons.
pub fn normalize_reason(reason: Option<String>) -> Option<String> {
    reason
        .map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty())
}

fn broadcast_cancel(
    app: &AppHandle,
    ids: Vec<String>,
    reason: Option<String>,
) -> Result<usize, String> {
    let ids = normalize_ids(ids);
    if ids.is_empty() {
        return Ok(0);
    }
    let n = ids.len();
    let payload = RunCancelled {
        ids,
        reason: normalize_reason(reason),
        at: now_ms(),
    };
    app.emit(RUN_CANCELLED_EVENT, &payload)
        .map_err(|e| e.to_string())?;
    Ok(n)
}

/// Runs the host knows about. Phase 11: none — the webview owns the
/// registry. Phase 14 reads the runtime's ledger here.
#[tauri::command]
pub fn list_runs() -> Vec<RunSummary> {
    Vec::new()
}

/// Stop one run. Today this only re-broadcasts; the in-process mock stream
/// is already halted by the caller.
#[tauri::command]
pub fn cancel_run(app: AppHandle, id: String, reason: Option<String>) -> Result<(), String> {
    broadcast_cancel(&app, vec![id], reason).map(|_| ())
}

/// Emergency stop. Returns how many distinct ids were broadcast.
#[tauri::command]
pub fn bulk_cancel_runs(
    app: AppHandle,
    ids: Vec<String>,
    reason: Option<String>,
) -> Result<usize, String> {
    broadcast_cancel(&app, ids, reason)
}

/// Native save dialog (defaults to the suggested filename) → write `contents`.
/// Sync on purpose: dialogs must stay off the main thread and commands run
/// on the worker pool (same pattern as settings::export_all_data).
/// Returns the saved path, or None when the user cancelled.
#[tauri::command]
pub fn save_runs_export(
    app: AppHandle,
    filename: String,
    contents: String,
) -> Result<Option<String>, String> {
    let ext = extension_of(&filename).unwrap_or("txt");
    let label = match ext {
        "csv" => "CSV",
        "json" => "JSON",
        _ => "Text",
    };
    let picked = app
        .dialog()
        .file()
        .add_filter(label, &[ext])
        .set_file_name(&filename)
        .blocking_save_file();
    let Some(path) = picked else {
        return Ok(None);
    };
    let dest = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&dest, contents.as_bytes()).map_err(|e| e.to_string())?;
    Ok(Some(dest.display().to_string()))
}

/// Lower-cased extension without the dot, if any.
pub fn extension_of(filename: &str) -> Option<&str> {
    let (_, ext) = filename.rsplit_once('.')?;
    if ext.is_empty() || ext.contains('/') || ext.contains('\\') {
        return None;
    }
    Some(ext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_ids_dedupes_and_trims() {
        let ids = vec![
            " run-1 ".to_string(),
            "".to_string(),
            "run-2".to_string(),
            "run-1".to_string(),
        ];
        assert_eq!(normalize_ids(ids), vec!["run-1", "run-2"]);
    }

    #[test]
    fn normalize_reason_drops_blank() {
        assert_eq!(normalize_reason(Some("   ".into())), None);
        assert_eq!(normalize_reason(None), None);
        assert_eq!(
            normalize_reason(Some(" runaway loop ".into())),
            Some("runaway loop".to_string())
        );
    }

    #[test]
    fn extension_of_handles_edges() {
        assert_eq!(extension_of("xr-runs-2026-10-05-1200.csv"), Some("csv"));
        assert_eq!(extension_of("archive.tar.json"), Some("json"));
        assert_eq!(extension_of("noext"), None);
        assert_eq!(extension_of("trailing."), None);
    }

    #[test]
    fn run_summary_round_trips_camel_case() {
        let json = r#"{"id":"run-1","shortId":"#1","title":"t","agent":"Main","agentKind":"chat","model":"gpt-4o","status":"completed","startedAt":1,"endedAt":2,"durationMs":1,"tokensIn":10,"tokensOut":20,"costUsd":0.01,"surface":"chat"}"#;
        let r: RunSummary = serde_json::from_str(json).expect("parse");
        assert_eq!(r.short_id, "#1");
        assert_eq!(r.workspace, None);
        let back = serde_json::to_string(&r).expect("serialize");
        assert!(back.contains("\"shortId\":\"#1\""));
        assert!(!back.contains("workspaceId"));
    }

    #[test]
    fn cancelled_payload_shape() {
        let p = RunCancelled {
            ids: vec!["a".into()],
            reason: None,
            at: 5,
        };
        let s = serde_json::to_string(&p).expect("serialize");
        assert_eq!(s, r#"{"ids":["a"],"reason":null,"at":5}"#);
    }
}
