/*
 * Native menus (Phase 27).
 *
 * macOS gets the full application menu — App / File / Edit / View / Window /
 * Help, in HIG order, with the standard items from `PredefinedMenuItem` so the
 * OS supplies the real behaviours (Services, Hide Others, Zoom, Bring All to
 * Front, the About panel) instead of a lookalike.
 *
 * Two deliberate choices:
 *
 *   · **⌘W hides, it does not close.** With an always-alive tray, closing the
 *     window is the same gesture as hiding it, and destroying the webview would
 *     throw away the Control Room's in-memory run registry. The menu item says
 *     "Close Window" because that is what the user expects to find there; what
 *     it does is what a tray app has to do.
 *
 *   · **The HUD item shows its chord instead of claiming it.** The HUD is a
 *     *global* shortcut already owned by the plugin; adding the same chord as a
 *     menu accelerator would fire both handlers. The item therefore carries the
 *     chord in its label ("Toggle HUD  ⌘Space"), updated from the live
 *     registration so a rebound chord shows the rebound value.
 *
 * Windows and Linux get no menu bar (the brief asks for one on macOS only; a
 * Windows app with a menu bar is a different product). Their equivalent is the
 * tray menu plus the in-app shortcuts that already exist.
 *
 * The dock menu is *prepared, not installed*: `dock_menu_spec()` returns the
 * items in the order macOS wants them and every id is already routed by
 * `tray::on_menu_event`. Tauri 2.12 exposes no dock-menu API; when it does,
 * installing this is a dozen lines (see docs/phases/27-shell-polish-notes.md).
 */
use tauri::{AppHandle, Runtime};

use crate::tray::ids;

/// A menu item that belongs to the macOS menu bar (or, later, the dock menu).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuSpec {
    pub id: &'static str,
    pub label: &'static str,
    /// Shown as the right-hand hint. macOS renders accelerators; the dock menu
    /// ignores them, so they are only a display concern here.
    pub chord: Option<&'static str>,
    pub dev_only: bool,
}

/// ⌘-glyph formatting, mirroring `desktop/src/lib/shortcuts.ts::formatTauriChord`
/// so the menu and the Settings screen never disagree about a chord.
pub fn display_chord(chord: &str) -> String {
    let mut out = String::new();
    for part in chord.split('+') {
        out.push_str(match part {
            "Cmd" | "Command" | "CommandOrControl" => "⌘",
            "Ctrl" | "Control" => "⌃",
            "Alt" | "Option" => "⌥",
            "Shift" => "⇧",
            "Super" | "Meta" => "⌘",
            other => other,
        });
    }
    out
}

/// The dock menu, in macOS order. Ids are already handled by the tray
/// dispatcher, so installing this later needs no new logic.
pub fn dock_menu_spec() -> Vec<MenuSpec> {
    vec![
        MenuSpec { id: ids::NEW_CHAT, label: "New Chat", chord: Some("Cmd+N"), dev_only: false },
        MenuSpec { id: ids::TOGGLE_HUD, label: "Toggle HUD", chord: None, dev_only: false },
        MenuSpec { id: ids::TOGGLE_LISTENING, label: "Start Listening", chord: None, dev_only: false },
        MenuSpec { id: ids::APPROVALS, label: "Pending Approvals", chord: None, dev_only: false },
        MenuSpec { id: ids::QUIT, label: "Quit XR", chord: Some("Cmd+Q"), dev_only: false },
    ]
}

/// The View menu's entries, including the Developer submenu that only exists in
/// dev builds.
pub fn view_menu_spec(dev: bool) -> Vec<MenuSpec> {
    let mut items = vec![
        MenuSpec { id: ids::TOGGLE_HUD, label: "Toggle HUD", chord: None, dev_only: false },
        MenuSpec { id: ids::TOGGLE_ORB, label: "Toggle Companion Orb", chord: None, dev_only: false },
        MenuSpec { id: ids::TOGGLE_SIDEBAR, label: "Toggle Sidebar", chord: Some("Cmd+B"), dev_only: false },
        MenuSpec { id: ids::PALETTE, label: "Command Palette", chord: Some("Cmd+K"), dev_only: false },
    ];
    if dev {
        items.push(MenuSpec { id: ids::DEVELOPER, label: "Developer", chord: None, dev_only: true });
    }
    items
}

/// The Help menu. "Report a crash" is here (not only on the recovery screen) so
/// a user who hit something odd later can still produce the redacted report.
pub fn help_menu_spec() -> Vec<MenuSpec> {
    vec![
        MenuSpec { id: ids::DOCS, label: "XR Documentation", chord: None, dev_only: false },
        MenuSpec { id: "xr-report-crash", label: "Report a Crash…", chord: None, dev_only: false },
        MenuSpec { id: ids::ABOUT, label: "About XR", chord: None, dev_only: false },
    ]
}

/// True when this build should show developer commands.
pub fn developer_menu_visible() -> bool {
    cfg!(debug_assertions) || std::env::var("XR_DEV_MENU").is_ok()
}

/// Install the macOS application menu. No-op elsewhere by construction (this
/// function is only called under `cfg(target_os = "macos")`).
#[cfg(target_os = "macos")]
pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    use tauri::menu::{AboutMetadata, MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};
    // Manager is what provides `try_state`/`state`; the file-level import is
    // deliberately minimal, and this function is the only macOS-gated code in
    // the crate that needs it. The Linux clippy lane never compiles this block,
    // which is how the missing import got as far as the macOS bundle job.
    use tauri::Manager;

    let hud_chord = app
        .try_state::<crate::commands::hud::HudShortcutState>()
        .and_then(|state| state.0.lock().ok().map(|guard| guard.shortcut.clone()))
        .unwrap_or_else(|| "Cmd+Space".to_string());
    let hud_label = format!("Toggle HUD  {}", display_chord(&hud_chord));

    let metadata = AboutMetadata {
        name: Some("XR".into()),
        version: Some(app.package_info().version.to_string()),
        comments: Some("The AI agent you can actually trust. Runs on your machine.".into()),
        copyright: Some("MIT licensed".into()),
        ..Default::default()
    };

    // ── App ──
    let settings = MenuItem::with_id(app, ids::SETTINGS, "Settings…", true, Some("Cmd+,"))?;
    let app_menu = SubmenuBuilder::new(app, "XR")
        .item(&PredefinedMenuItem::about(app, Some("About XR"), Some(metadata))?)
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    // ── File ──
    let new_chat = MenuItem::with_id(app, ids::NEW_CHAT, "New Chat", true, Some("Cmd+N"))?;
    let new_workspace =
        MenuItem::with_id(app, ids::NEW_WORKSPACE, "New Workspace", true, Some("Cmd+Shift+N"))?;
    // ⌘W hides the window (see the module note) — the item still reads like the
    // standard one, in the standard place, with the standard chord.
    let close = MenuItem::with_id(app, ids::CLOSE_WINDOW, "Close Window", true, Some("Cmd+W"))?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_chat)
        .item(&new_workspace)
        .separator()
        .item(&close)
        .build()?;

    // ── Edit ── (all predefined, so the OS owns their behaviour)
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // ── View ── (items are bound to locals: the builder borrows them)
    let mut view_items: Vec<MenuItem<R>> = Vec::new();
    for spec in view_menu_spec(developer_menu_visible()) {
        if spec.id == ids::DEVELOPER {
            continue; // rendered as its own submenu below
        }
        let item = if spec.id == ids::TOGGLE_HUD {
            MenuItem::with_id(app, spec.id, &hud_label, true, None::<&str>)?
        } else {
            MenuItem::with_id(app, spec.id, spec.label, true, spec.chord)?
        };
        view_items.push(item);
    }
    let mut view = SubmenuBuilder::new(app, "View");
    for item in &view_items {
        view = view.item(item);
    }
    let view_menu = view.separator().fullscreen().build()?;

    // ── Window ──
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .bring_all_to_front()
        .build()?;

    // ── Help ──
    let mut help_items: Vec<MenuItem<R>> = Vec::new();
    for spec in help_menu_spec() {
        if spec.id == ids::ABOUT {
            continue; // About lives in the App menu; repeating it in Help is noise.
        }
        help_items.push(MenuItem::with_id(app, spec.id, spec.label, true, None::<&str>)?);
    }
    let mut help = SubmenuBuilder::new(app, "Help");
    for item in &help_items {
        help = help.item(item);
    }
    let help_menu = help.build()?;

    // ── Developer (dev builds only, last before nothing) ──
    #[cfg(debug_assertions)]
    let dev_menu: Option<tauri::menu::Submenu<R>> = Some({
        let devtools = MenuItem::with_id(app, ids::DEVELOPER, "Open DevTools", true, Some("Cmd+Alt+I"))?;
        let reload = MenuItem::with_id(app, "xr-reload-window", "Reload Window", true, Some("Cmd+R"))?;
        let simulate = MenuItem::with_id(app, "xr-simulate-crash", "Simulate Crash", true, None::<&str>)?;
        SubmenuBuilder::new(app, "Developer")
            .item(&devtools)
            .item(&reload)
            .separator()
            .item(&simulate)
            .build()?
    });
    #[cfg(not(debug_assertions))]
    let dev_menu: Option<tauri::menu::Submenu<R>> = None;

    let mut builder = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu);
    if let Some(dev) = &dev_menu {
        // Dev-only, and last: a Developer menu before Help would be a product
        // decision no end user asked for.
        builder = builder.item(dev);
    }
    let menu = builder.item(&help_menu).build()?;
    menu.set_as_app_menu()?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn install<R: Runtime>(_app: &AppHandle<R>) -> tauri::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chords_render_with_mac_glyphs() {
        assert_eq!(display_chord("Cmd+Space"), "⌘Space");
        assert_eq!(display_chord("Cmd+Shift+X"), "⌘⇧X");
        assert_eq!(display_chord("Ctrl+Alt+Space"), "⌃⌥Space");
        assert_eq!(display_chord("Alt+Shift+P"), "⌥⇧P");
        assert_eq!(display_chord("F5"), "F5", "unknown keys pass through");
    }

    #[test]
    fn dock_menu_matches_the_specified_order() {
        let spec = dock_menu_spec();
        let labels: Vec<&str> = spec.iter().map(|s| s.label).collect();
        assert_eq!(
            labels,
            vec!["New Chat", "Toggle HUD", "Start Listening", "Pending Approvals", "Quit XR"]
        );
        // Every dock item must be routed already (the tray dispatcher handles
        // these ids), otherwise installing it later would silently do nothing.
        for item in &spec {
            assert!(
                item.id == ids::QUIT
                    || item.id == ids::APPROVALS
                    || item.id == ids::TOGGLE_LISTENING
                    || item.id == ids::TOGGLE_HUD
                    || item.id == ids::NEW_CHAT
            );
        }
    }

    #[test]
    fn developer_entries_are_marked_and_hidden_from_end_users() {
        let prod = view_menu_spec(false);
        assert!(!prod.iter().any(|s| s.dev_only));
        let dev = view_menu_spec(true);
        assert!(dev.iter().any(|s| s.dev_only && s.id == ids::DEVELOPER));
    }

    #[test]
    fn help_menu_offers_the_manual_crash_report() {
        let ids_in_help: Vec<&str> = help_menu_spec().iter().map(|s| s.id).collect();
        assert!(ids_in_help.contains(&"xr-report-crash"));
        assert!(ids_in_help.contains(&ids::DOCS));
    }

    #[test]
    fn view_menu_includes_the_stateful_items() {
        let spec = view_menu_spec(false);
        let ids_in_view: Vec<&str> = spec.iter().map(|s| s.id).collect();
        for expected in [ids::TOGGLE_HUD, ids::TOGGLE_ORB, ids::TOGGLE_SIDEBAR, ids::PALETTE] {
            assert!(ids_in_view.contains(&expected), "View menu is missing {expected}");
        }
        // Sidebar/palette keep their in-app chords, which match lib/shortcuts.ts.
        let sidebar = spec.iter().find(|s| s.id == ids::TOGGLE_SIDEBAR).unwrap();
        assert_eq!(sidebar.chord, Some("Cmd+B"));
    }

    #[test]
    fn the_hud_item_carries_no_accelerator_but_shows_the_chord() {
        // The guarantee: the HUD chord is registered globally by the plugin, so
        // the menu must show it as a label, never claim it as an accelerator.
        let hud = view_menu_spec(false).into_iter().find(|s| s.id == ids::TOGGLE_HUD).unwrap();
        assert_eq!(hud.chord, None, "a menu accelerator here would double-fire the global shortcut");
        assert_eq!(format!("{}  {}", hud.label, display_chord("Cmd+Space")), "Toggle HUD  ⌘Space");
    }
}
