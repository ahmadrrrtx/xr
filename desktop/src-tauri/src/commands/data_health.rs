/*
 * XR-LAUNCH-021 — startup data-safety notices.
 *
 * Recovery (a damaged xr.db moved aside, an in-memory fallback) and a staged
 * import being applied all happen in the setup hook, before any window can
 * show a message. They are collected here and the main window reads them
 * once with `db_health` and shows them to the user.
 */
use std::path::Path;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, Runtime, State};

#[derive(Default)]
pub struct DataHealth(Mutex<Vec<String>>);

impl DataHealth {
    pub fn push(&self, notice: String) {
        if let Ok(mut v) = self.0.lock() {
            if !v.contains(&notice) {
                v.push(notice);
            }
        }
    }
}

/// Record a notice from any init path (no-op if the state is not managed yet).
pub fn note<R: Runtime>(app: &AppHandle<R>, notice: Option<String>) {
    if let Some(n) = notice {
        eprintln!("[xr] data: {n}");
        if let Some(state) = app.try_state::<DataHealth>() {
            state.push(n);
        }
    }
}

/// Setup hook, BEFORE any database connection is opened: apply a staged
/// import (see `data_safety::stage_import`), then the integrity preflight.
pub fn startup<R: Runtime>(app: &AppHandle<R>, data_dir: &Path) {
    app.manage(DataHealth::default());
    match crate::data_safety::apply_pending_import(data_dir) {
        Ok(notice) => note(app, notice),
        Err(e) => note(app, Some(e)),
    }
    note(app, crate::data_safety::preflight(data_dir));
}

/// Notices from this launch (empty on a clean start).
#[tauri::command]
pub fn db_health(state: State<'_, DataHealth>) -> Vec<String> {
    state.0.lock().map(|v| v.clone()).unwrap_or_default()
}
