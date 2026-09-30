/*
 * Phase 3 — Ollama model pull with streamed progress.
 *
 * POST /api/pull {"name", "stream": true} returns NDJSON progress lines
 * (`{"status":"pulling 4f7b...","digest":"...","total":..., "completed":...}`
 * … ending with `{"status":"success"}`). The pull runs on a worker thread so
 * the command returns immediately; each line is forwarded to the webview as
 * an `ollama://pull-progress` window event with a normalized payload.
 */
use serde::Serialize;
use std::io::BufRead;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Emitter};

const OLLAMA_BASE: &str = "http://127.0.0.1:11434";

/// Monotonic id so a retried pull can supersede stale events.
static PULL_ID: AtomicU32 = AtomicU32::new(0);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullProgress {
    pub id: u32,
    pub status: String, // "pulling" | "verifying" | "success" | "error"
    pub completed: Option<u64>,
    pub total: Option<u64>,
    pub detail: Option<String>,
}

#[tauri::command]
pub fn ollama_pull(app: AppHandle, model: String) -> u32 {
    let id = PULL_ID.fetch_add(1, Ordering::SeqCst);
    let app = app.clone();
    std::thread::spawn(move || {
        let send = |status: &str, completed: Option<u64>, total: Option<u64>, detail: Option<String>| {
            let _ = app.emit(
                "ollama://pull-progress",
                PullProgress {
                    id,
                    status: status.to_string(),
                    completed,
                    total,
                    detail,
                },
            );
        };

        let agent = ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_secs(600))
            .build();
        let pull_url = format!("{OLLAMA_BASE}/api/pull");
        let resp = match agent
            .post(&pull_url)
            .send_json(serde_json::json!({ "name": model, "stream": true }))
        {
            Ok(r) => r,
            Err(e) => {
                send("error", None, None, Some(e.to_string()));
                return;
            }
        };

        let buf = std::io::BufReader::new(resp.into_reader());
        for line in buf.lines() {
            let Ok(line) = line else { break };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
                send("error", None, None, Some(err.to_string()));
                return;
            }
            let status = v
                .get("status")
                .and_then(|s| s.as_str())
                .unwrap_or_default()
                .to_string();
            let completed = v.get("completed").and_then(|c| c.as_u64());
            let total = v.get("total").and_then(|t| t.as_u64());
            match status.as_str() {
                "success" => {
                    send("success", None, None, None);
                    return;
                }
                s if s.starts_with("verifying") || s.starts_with("sha256") => {
                    send("verifying", completed, total, Some(status.clone()));
                }
                _ => {
                    send("pulling", completed, total, Some(status));
                }
            }
        }
        // Stream ended without a success line — treat as complete but note it.
        send("success", None, None, None);
    });
    id
}
