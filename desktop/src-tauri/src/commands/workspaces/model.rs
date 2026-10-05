/*
 * Phase 10 — workspace data model (docs/SCREEN-BRIEFS.md · SCREEN 3).
 *
 * Serde emits camelCase to mirror the frontend types in
 * src/workspaces/types.ts exactly (same convention as chat.rs Session).
 */
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceKind {
    Web,
    Python,
    Research,
    Custom,
    Git,
    Scratch,
}

impl WorkspaceKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            WorkspaceKind::Web => "web",
            WorkspaceKind::Python => "python",
            WorkspaceKind::Research => "research",
            WorkspaceKind::Custom => "custom",
            WorkspaceKind::Git => "git",
            WorkspaceKind::Scratch => "scratch",
        }
    }

    /// Frontend default icon (emoji is user-chosen territory, but every kind
    /// ships one so cards are never bare).
    pub fn default_icon(&self) -> &'static str {
        match self {
            WorkspaceKind::Web => "\u{1F310}",     // 🌐
            WorkspaceKind::Python => "\u{1F40D}",  // 🐍
            WorkspaceKind::Research => "\u{1F52C}",// 🔬
            WorkspaceKind::Custom => "\u{2728}",   // ✨
            WorkspaceKind::Git => "\u{1F4C1}",     // 📁 (UI draws GitBranch instead)
            WorkspaceKind::Scratch => "\u{1F4C4}", // 📄
        }
    }
}

impl std::str::FromStr for WorkspaceKind {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "web" => Ok(WorkspaceKind::Web),
            "python" => Ok(WorkspaceKind::Python),
            "research" => Ok(WorkspaceKind::Research),
            "custom" => Ok(WorkspaceKind::Custom),
            "git" => Ok(WorkspaceKind::Git),
            "scratch" => Ok(WorkspaceKind::Scratch),
            other => Err(format!("unknown workspace kind: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Wire shape — what the frontend store consumes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub path: String,
    pub kind: WorkspaceKind,
    pub icon: Option<String>,
    pub stack: Vec<String>,
    pub pinned: bool,
    pub last_opened_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub window_bounds: Option<WindowBounds>,
    /// Computed at read time (never stored): the folder still exists.
    #[serde(default = "default_true")]
    pub path_exists: bool,
}

fn default_true() -> bool {
    true
}

/// Partial update — every field optional so PATCH-style calls stay simple.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePatch {
    pub name: Option<String>,
    pub path: Option<String>,
    pub icon: Option<String>,
    pub stack: Option<Vec<String>>,
    pub pinned: Option<bool>,
    pub last_opened_at: Option<i64>,
    pub window_bounds: Option<Option<WindowBounds>>,
}
