/*
 * Phase 10 — real multi-window spawn (the heart of this phase).
 *
 * Each workspace opens in its own Tauri window:
 *   - label  `workspace-<uuid>`  (capabilities use the `workspace-*` wildcard)
 *   - URL    `#/workspaces/<id>` landing route (hash router)
 *   - frameless, like main, 1280×800 default
 *   - bounds: last saved position, or a 40px cascade from the main window
 *
 * Position updates ride a small in-memory map (SpawnState) keyed by window
 * label, flushed to the DB when a workspace window closes (RunEvent in
 * lib.rs) — the app's existing layout-persistence approach, no window manager.
 */
use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::db::WorkspaceDb;
use super::model::{WindowBounds, WorkspacePatch};

pub struct SpawnState {
    /// label → current bounds (updated on Moved/Resized).
    pub bounds: Mutex<HashMap<String, WindowBounds>>,
}

impl SpawnState {
    pub fn new() -> Self {
        SpawnState {
            bounds: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for SpawnState {
    fn default() -> Self {
        Self::new()
    }
}

const CASCADE: i32 = 40;

/// Spawn one window per workspace id. Already-open windows get focused
/// instead of duplicated. Returns (opened, failed) counts.
pub fn spawn_workspace_windows(app: &AppHandle, ids: &[String]) -> Result<(u32, u32), String> {
    let db: &WorkspaceDb = &app.state::<WorkspaceDb>();
    let saved = db.bounds_map()?;
    let spawn_state = app.state::<SpawnState>();
    let mut live = spawn_state
        .bounds
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    let origin = next_cascade_origin(app);
    let mut opened = 0u32;
    let mut failed = 0u32;

    for id in ids {
        let Some(ws) = db.get(id)? else {
            failed += 1;
            continue;
        };
        // Touch last_opened so "Recent" filters stay honest.
        let _ = db.update(
            id,
            &WorkspacePatch {
                last_opened_at: Some(super::db::now_ms()),
                ..Default::default()
            },
        );

        let label = format!("workspace-{}", ws.id);
        if let Some(existing) = app.get_webview_window(&label) {
            let _ = existing.set_focus();
            opened += 1;
            continue;
        }

        let (x, y, w, h) = live
            .get(&label)
            .or_else(|| saved.get(id))
            .copied()
            .map(|b| (b.x, b.y, b.w, b.h))
            .unwrap_or({
                let step = opened as i32 * CASCADE;
                (origin.0 + step, origin.1 + step, 1280, 800)
            });

        match WebviewWindowBuilder::new(
            app,
            &label,
            WebviewUrl::App(format!("#/workspaces/{}", ws.id).into()),
        )
        .title(format!("XR · {}", ws.name))
        .inner_size(w as f64, h as f64)
        .min_inner_size(960.0, 600.0)
        .position(x as f64, y as f64)
        .decorations(false)
        .build()
        {
            Ok(_win) => {
                live.insert(label, WindowBounds { x, y, w, h });
                opened += 1;
            }
            Err(e) => {
                eprintln!("workspace spawn failed for {id}: {e}");
                failed += 1;
            }
        }
    }
    Ok((opened, failed))
}

/// Next cascade origin: main window position when resolvable, else 80,80.
fn next_cascade_origin(app: &AppHandle) -> (i32, i32) {
    if let Some(main) = app.get_webview_window("main") {
        if let (Ok(pos), Ok(scale)) = (main.outer_position(), main.scale_factor()) {
            return (
                (pos.x as f64 / scale).round() as i32,
                (pos.y as f64 / scale).round() as i32,
            );
        }
    }
    (80, 80)
}

/// Record a moved/resized workspace window (RunEvent hooks in lib.rs).
pub fn note_window_moved(app: &AppHandle, label: &str, x: i32, y: i32, w: i32, h: i32) {
    app.state::<SpawnState>()
        .bounds
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(
            label.to_string(),
            WindowBounds { x, y, w, h },
        );
}

/// Flush every live window's bounds (app exit — a window never gets the
/// chance to close first during process teardown).
pub fn flush_all_bounds(app: &AppHandle) {
    let pending: Vec<(String, WindowBounds)> = app
        .state::<SpawnState>()
        .bounds
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .drain()
        .collect();
    let db: &WorkspaceDb = &app.state::<WorkspaceDb>();
    for (label, b) in pending {
        if let Some(ws_id) = label.strip_prefix("workspace-") {
            let _ = db.update(
                ws_id,
                &WorkspacePatch {
                    window_bounds: Some(Some(b)),
                    ..Default::default()
                },
            );
        }
    }
}

/// Flush one window's latest bounds into its workspace row, then drop the
/// in-memory entry (the window is closing).
pub fn flush_window_bounds(app: &AppHandle, label: &str) {
    let Some(ws_id) = label.strip_prefix("workspace-") else {
        return;
    };
    let Some(b) = app
        .state::<SpawnState>()
        .bounds
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(label)
    else {
        return;
    };
    let db: &WorkspaceDb = &app.state::<WorkspaceDb>();
    let _ = db.update(
        ws_id,
        &WorkspacePatch {
            window_bounds: Some(Some(b)),
            ..Default::default()
        },
    );
}
