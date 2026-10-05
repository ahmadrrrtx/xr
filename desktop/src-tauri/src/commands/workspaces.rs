/*
 * Phase 10 — Workspaces command surface (docs/SCREEN-BRIEFS.md · SCREEN 3).
 *
 * Command list (mirrors the frontend contract in src/lib/workspace-db.ts):
 *   list_workspaces / get_workspace / create_workspace / update_workspace /
 *   delete_workspace / duplicate_workspace / reveal_in_finder /
 *   pick_folder / move_workspace_window / spawn_workspace_windows /
 *   check_git_available / clone_git_workspace / detect_stack /
 *   scaffold_workspace
 *
 * All commands are app-defined (like chat), so they need no extra capability
 * grant — only the `workspace-*` window wildcard (spawn.rs) is added.
 */
pub mod clone;
mod db;
mod model;
mod scaffold;
mod spawn;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub use model::{Workspace, WorkspaceKind, WorkspacePatch};
pub use spawn::SpawnState;

pub(crate) use db::WorkspaceDb;
pub(crate) use spawn::{flush_all_bounds, flush_window_bounds, note_window_moved};

use crate::commands::workspaces::clone::{check_git_available, detect_stack as detect_stack_fn};
use crate::commands::workspaces::clone::clone_git_workspace as do_clone;
use crate::commands::workspaces::scaffold::{scaffold, slugify};
use crate::commands::workspaces::spawn::spawn_workspace_windows as do_spawn;

// Default creation root: ~/xr/workspaces (kept out of the user's project dirs).
fn default_root(app: &AppHandle) -> std::path::PathBuf {
    let home = app
        .path()
        .home_dir()
        .expect("home dir must resolve");
    home.join("xr").join("workspaces")
}

#[tauri::command]
pub fn list_workspaces(state: State<'_, WorkspaceDb>) -> Result<Vec<Workspace>, String> {
    state.list()
}

#[tauri::command]
pub fn get_workspace(
    state: State<'_, WorkspaceDb>,
    id: String,
) -> Result<Option<Workspace>, String> {
    state.get(&id)
}

/// Create from a template. `folder` defaults to ~/xr/workspaces/<slug>;
/// `custom`/`blank` scaffold a README, web/python/research scaffold real files.
#[tauri::command]
pub fn create_workspace(
    app: AppHandle,
    state: State<'_, WorkspaceDb>,
    name: String,
    template_id: String,
    folder: Option<String>,
) -> Result<Workspace, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Give the workspace a name".into());
    }
    let slug = slugify(&name);
    if slug.is_empty() {
        return Err("Name needs at least a letter or number".into());
    }
    let root = match folder {
        Some(f) if !f.trim().is_empty() => std::path::PathBuf::from(f.trim()),
        _ => default_root(&app).join(&slug),
    };
    // Never clobber an existing folder unless it's exactly our target.
    if root.exists() && root.read_dir().map(|mut d| d.next().is_some()).unwrap_or(false) {
        return Err("That folder already has files in it — pick a different path".into());
    }
    let files = scaffold(root.to_str().unwrap_or(""), &template_id, &name)?;
    if files.is_empty() {
        return Err("Nothing was written — scaffold failed".into());
    }
    let kind = kind_for_template(&template_id);
    let stack = detect_stack_fn(&root);
    state.create(&name, root.to_str().unwrap_or(""), kind, &stack)
}

fn kind_for_template(template_id: &str) -> WorkspaceKind {
    match template_id {
        "web" => WorkspaceKind::Web,
        "python" => WorkspaceKind::Python,
        "research" => WorkspaceKind::Research,
        "git" => WorkspaceKind::Git,
        "scratch" => WorkspaceKind::Scratch,
        _ => WorkspaceKind::Custom,
    }
}

#[tauri::command]
pub fn update_workspace(
    state: State<'_, WorkspaceDb>,
    id: String,
    patch: WorkspacePatch,
) -> Result<Workspace, String> {
    state.update(&id, &patch)
}

/// `delete_files = true` → folder to the platform trash (trash crate).
/// Returns whether the folder actually moved to trash (frontend Undo toast).
#[tauri::command]
pub fn delete_workspace(
    state: State<'_, WorkspaceDb>,
    id: String,
    delete_files: bool,
) -> Result<bool, String> {
    state.delete(&id, delete_files)
}

#[tauri::command]
pub fn duplicate_workspace(
    state: State<'_, WorkspaceDb>,
    id: String,
) -> Result<Workspace, String> {
    state.duplicate(&id)
}

/// Undo for a row-only delete (files were left in place).
#[tauri::command]
pub fn restore_workspace(
    state: State<'_, WorkspaceDb>,
    ws: Workspace,
) -> Result<(), String> {
    state.restore(&ws)
}

#[tauri::command]
pub fn reveal_in_finder(app: AppHandle, path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err("That path no longer exists".into());
    }
    app.opener()
        .reveal_item_in_dir(p)
        .map_err(|e| e.to_string())
}

/// Folder picker for "locate" — sync command; blocking dialogs follow the
/// settings.rs pattern (dialog off the main thread, command on the pool).
#[tauri::command]
pub fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    let Some(path) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None); // user cancelled
    };
    let p = path.into_path().map_err(|e| e.to_string())?;
    Ok(Some(p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn move_workspace_window(
    app: AppHandle,
    label: String,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
) -> Result<(), String> {
    note_window_moved(&app, &label, x, y, w, h);
    if let Some(win) = app.get_webview_window(&label) {
        let scale = win.scale_factor().unwrap_or(1.0);
        let _ = win.set_position(tauri::Position::Physical(
            tauri::PhysicalPosition::new((x as f64 * scale) as i32, (y as f64 * scale) as i32),
        ));
        let _ = win.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
            (w as f64 * scale) as u32,
            (h as f64 * scale) as u32,
        )));
    }
    Ok(())
}

#[tauri::command]
pub fn spawn_workspace_windows(
    app: AppHandle,
    ids: Vec<String>,
) -> Result<SpawnResult, String> {
    let (opened, failed) = do_spawn(&app, &ids)?;
    // Let the renderer show the result immediately.
    let _ = app.emit(
        "workspace:windows-launched",
        LaunchPayload { opened, failed },
    );
    Ok(SpawnResult { opened, failed })
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnResult {
    pub opened: u32,
    pub failed: u32,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchPayload {
    opened: u32,
    failed: u32,
}

#[tauri::command]
pub fn git_available() -> bool {
    check_git_available()
}

/// Clone `url` into a fresh folder under ~/xr/workspaces (or `dest`),
/// streaming `workspace:clone-progress` {percent, stage} to the window.
#[tauri::command]
pub async fn clone_git_workspace(
    app: AppHandle,
    state: State<'_, WorkspaceDb>,
    url: String,
    name: String,
    dest: Option<String>,
) -> Result<Workspace, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("Enter a git URL to clone".into());
    }
    let name = name.trim();
    let base_name: String = if name.is_empty() {
        url.rsplit('/')
            .next()
            .map(|s| s.trim_end_matches(".git"))
            .unwrap_or("repo")
            .to_string()
    } else {
        name.to_string()
    };
    if base_name.trim().is_empty() {
        return Err("Could not derive a name from that URL — give the workspace a name".into());
    }
    let base_name: &str = &base_name;
    let root = match dest {
        Some(d) if !d.trim().is_empty() => std::path::PathBuf::from(d.trim()),
        _ => default_root(&app).join(slugify(base_name)),
    };
    if root.exists() && root.read_dir().map(|mut d| d.next().is_some()).unwrap_or(false) {
        return Err("That folder is not empty — pick a different path".into());
    }

    let target = root.to_string_lossy().to_string();
    let target_for_db = target.clone();
    let spawn = app.clone();
    // tauri::async_runtime::spawn_blocking keeps this off the event loop
    // without a direct tokio dependency (house policy: no direct tokio).
    let stack = tauri::async_runtime::spawn_blocking(move || {
        do_clone(
            &url,
            &target,
            Box::new(move |percent, stage| {
                let _ = spawn.emit(
                    "workspace:clone-progress",
                    CloneProgress { percent, stage: stage.to_string() },
                );
            }),
        )
    })
    .await
    .map_err(|e| e.to_string())??;

    state.create(base_name, &target_for_db, WorkspaceKind::Git, &stack)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneProgress {
    pub percent: u8,
    pub stage: String,
}

#[tauri::command]
pub fn detect_stack(path: String) -> Vec<String> {
    detect_stack_fn(std::path::Path::new(&path))
}

#[tauri::command]
pub fn scaffold_workspace(
    path: String,
    template_id: String,
    name: String,
) -> Result<Vec<String>, String> {
    scaffold(&path, &template_id, &name)
}


