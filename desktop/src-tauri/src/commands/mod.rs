pub mod approvals;
pub mod chat;
/// XR-LAUNCH-021: startup data-safety notices (recovery, staged import).
pub mod data_health;
pub mod hud;
pub mod ollama;
#[cfg(desktop)]
pub mod orb;
/// Crash recovery: the pre-router screen's commands (Phase 27).
pub mod recovery;
/// Screenshot-and-ask: global chord + region capture (Phase 27).
pub mod screenshot;
/// Shell glue: shortcut inventory + reset, tray state (Phase 27).
pub mod shell;
pub mod runs;
pub mod settings;
pub mod system;
#[cfg(desktop)]
pub mod theater;
/// Auto-update: channels, check/download/install (Phase 27).
pub mod updates;
pub mod window;
pub mod workspaces;
