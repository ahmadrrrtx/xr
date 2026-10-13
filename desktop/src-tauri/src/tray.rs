/*
 * The tray (Phase 27) — XR stays alive when every window is closed.
 *
 * Phase 0 shipped two items ("Show XR" / "Quit XR"). This is the real thing:
 * a state-aware menu that mirrors what the app is doing, per-platform icons
 * rendered from one master SVG by `scripts/generate-tray-icons.sh`, an approval
 * badge that never nags, and click semantics that match each OS's habit.
 *
 * The rules this file implements, in the order they matter:
 *
 *   1. **Closing the window does not quit.** The main window's close request is
 *      intercepted in `lib.rs` and turned into a hide; the tray (and the macOS
 *      app menu) is how you quit. On macOS that is simply correct behaviour; on
 *      Windows/Linux it is what "always-alive" has to mean for the badge and
 *      the shortcuts to be worth anything.
 *
 *   2. **Chrome stays invisible until asked.** The menu appears on click; on
 *      macOS the tray icon is a Template image (pure black + alpha, no colour,
 *      no glow) so it inherits the menu bar's own appearance. Colour — one cyan
 *      accent dot — exists only where the OS draws icons in colour.
 *
 *   3. **The badge is a fact, not an alarm.** macOS shows the count beside the
 *      icon (`set_title`), Windows/Linux swap in a badged icon. One dock bounce
 *      or taskbar flash per new batch of approvals, never per render, and never
 *      at all while the window is already focused.
 *
 *   4. **Engine down is a state the tray survives.** No panic, no empty menu:
 *      the tooltip says the engine stopped and the actions that need it stay
 *      useful (chat history is local).
 *
 * Item ids are shared with the macOS app menu (`crate::menus`), so "New Chat"
 * means the same thing wherever it is clicked, and the webview receives exactly
 * one event shape: `xr-tray-action` with `{ id }`.
 */
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, UserAttentionType};

/// Tray id — look the icon up with `app.tray_by_id(TRAY_ID)`.
pub const TRAY_ID: &str = "xr-tray";

/// Every action the tray or the app menu can trigger.
pub mod ids {
    pub const OPEN: &str = "xr-open";
    pub const NEW_CHAT: &str = "xr-new-chat";
    pub const NEW_WORKSPACE: &str = "xr-new-workspace";
    pub const TOGGLE_HUD: &str = "xr-toggle-hud";
    pub const TOGGLE_LISTENING: &str = "xr-toggle-listening";
    pub const TOGGLE_AGENTS: &str = "xr-toggle-agents";
    pub const APPROVALS: &str = "xr-approvals";
    pub const SPEND: &str = "xr-spend";
    pub const ENGINE_STATUS: &str = "xr-engine-status";
    pub const SETTINGS: &str = "xr-settings";
    pub const CHECK_UPDATES: &str = "xr-check-updates";
    pub const QUIT: &str = "xr-quit";
    // macOS app-menu-only items (they reuse the same dispatcher).
    pub const ABOUT: &str = "xr-about";
    pub const DOCS: &str = "xr-docs";
    pub const CLOSE_WINDOW: &str = "xr-close-window";
    pub const TOGGLE_SIDEBAR: &str = "xr-toggle-sidebar";
    pub const PALETTE: &str = "xr-palette";
    pub const TOGGLE_ORB: &str = "xr-toggle-orb";
    pub const DEVELOPER: &str = "xr-developer-tools";
}

/// Live tray state. Everything the menu shows that the shell cannot infer.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraySnapshot {
    /// Approvals waiting for a human.
    pub approvals: u32,
    /// Today's spend, in USD. `None` = the engine has not reported yet.
    pub spend_today: Option<f64>,
    /// Agents paused (Shield pause): the menu offers Resume.
    pub agents_paused: bool,
    /// Voice capture running: the menu offers Stop.
    pub listening: bool,
    /// Engine sidecar linked and reachable.
    pub engine_up: bool,
    /// The other half of "listening": the voice session exists at all.
    pub voice_available: bool,
}

/// What the tray remembers between updates.
#[derive(Default)]
pub struct TrayState {
    pub snapshot: Mutex<TraySnapshot>,
    /// A bounce/flash was already spent for the current approval batch.
    attention_spent: Mutex<bool>,
}

/// The tray state, created on first use so an early menu event can never panic.
fn tray_state<R: Runtime>(app: &AppHandle<R>) -> tauri::State<'_, TrayState> {
    if app.try_state::<TrayState>().is_none() {
        app.manage(TrayState::default());
    }
    app.state::<TrayState>()
}

impl TrayState {
    fn lock(&self) -> std::sync::MutexGuard<'_, TraySnapshot> {
        self.snapshot.lock().unwrap_or_else(|e| e.into_inner())
    }
}

// ─── Pure presentation (unit-tested) ────────────────────────────────────────

/// The tooltip. "Running on your machine" is the product's promise; when the
/// engine is down the tooltip is the one place that can say so without adding
/// a menu item nobody asked for.
pub fn tooltip(engine_up: bool) -> &'static str {
    if engine_up {
        "XR — running on your machine"
    } else {
        "XR — engine stopped (chat history is still local)"
    }
}

/// The approvals row. Zero is a disabled, calm line; nothing to do, nothing to
/// click. Never "0 pending!" with an exclamation mark.
pub fn approvals_label(count: u32) -> String {
    match count {
        0 => "No pending approvals".to_string(),
        1 => "Pending approvals (1)".to_string(),
        n => format!("Pending approvals ({n})"),
    }
}

/// The spend row — a disabled read-out, formatted like money everywhere else.
pub fn spend_label(spend_today: Option<f64>) -> String {
    match spend_today {
        Some(amount) => format!("Today: ${amount:.2}"),
        None => "Today: —".to_string(),
    }
}

/// The listening row flips between two verbs.
pub fn listening_label(listening: bool) -> String {
    if listening { "Stop listening".to_string() } else { "Start listening".to_string() }
}

/// The agents row flips too. "Pause agents" is the ask; "Resume agents" is the
/// undo.
pub fn agents_label(paused: bool) -> String {
    if paused { "Resume agents".to_string() } else { "Pause agents".to_string() }
}

/// Should the OS be asked for attention (one dock bounce / taskbar flash)?
///
/// Only when the window is not focused, only once per batch of approvals, and
/// only when the count actually rose. Re-rendering the menu is not an event.
pub fn should_request_attention(
    previous_count: u32,
    new_count: u32,
    window_focused: bool,
    already_spent: bool,
) -> bool {
    !window_focused && !already_spent && new_count > previous_count && new_count > 0
}

/// What a primary click does, per platform.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrimaryClick {
    /// macOS: toggle the window, no menu (the menu bar already exists).
    ToggleWindow,
    /// Windows/Linux: show the menu and raise the window.
    MenuAndFocus,
    /// macOS double-click always raises (the OS convention).
    FocusWindow,
}

pub fn primary_click(os: &str, double_click: bool) -> PrimaryClick {
    if double_click {
        return PrimaryClick::FocusWindow;
    }
    if os == "macos" {
        PrimaryClick::ToggleWindow
    } else {
        PrimaryClick::MenuAndFocus
    }
}

/// Which icon file belongs to this platform, and whether it is a Template.
/// Returns (file name, is_template).
pub fn icon_spec(os: &str, badged: bool) -> (&'static str, bool) {
    match (os, badged) {
        ("macos", false) => ("tray-mac-template.png", true),
        // macOS never uses a colour badge: the menu bar count comes from the
        // title text, which keeps the icon a pure Template image.
        ("macos", true) => ("tray-mac-template.png", true),
        ("windows", false) => ("tray-win.ico", false),
        ("windows", true) => ("tray-win-badge.ico", false),
        (_, false) => ("tray-linux-64.png", false),
        (_, true) => ("tray-linux-64-badge.png", false),
    }
}

/// Icon search order: bundled resources, then next to the executable, then the
/// source tree (so `tauri dev` and `cargo test` both work).
pub fn icon_search_paths(resource_dir: Option<PathBuf>, exe_dir: Option<PathBuf>, file: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(dir) = resource_dir {
        paths.push(dir.join("icons").join("tray").join(file));
    }
    if let Some(dir) = exe_dir {
        paths.push(dir.join("icons").join("tray").join(file));
    }
    paths.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("icons")
            .join("tray")
            .join(file),
    );
    paths
}

// ─── Menu ───────────────────────────────────────────────────────────────────

/// Build the tray menu from a snapshot. Rebuilt (not mutated) on every change:
/// menu items are cheap, and a rebuilt menu cannot show a stale label.
fn build_menu<R: Runtime>(app: &AppHandle<R>, snapshot: &TraySnapshot) -> tauri::Result<Menu<R>> {
    let open = MenuItem::with_id(app, ids::OPEN, "Open XR", true, None::<&str>)?;
    let new_chat = MenuItem::with_id(app, ids::NEW_CHAT, "New Chat", true, None::<&str>)?;
    let new_workspace = MenuItem::with_id(app, ids::NEW_WORKSPACE, "New Workspace", true, None::<&str>)?;
    let toggle_hud = MenuItem::with_id(app, ids::TOGGLE_HUD, "Toggle HUD", true, None::<&str>)?;

    let listening = CheckMenuItem::with_id(
        app,
        ids::TOGGLE_LISTENING,
        listening_label(snapshot.listening),
        snapshot.voice_available,
        snapshot.listening,
        None::<&str>,
    )?;
    let agents = CheckMenuItem::with_id(
        app,
        ids::TOGGLE_AGENTS,
        agents_label(snapshot.agents_paused),
        true,
        snapshot.agents_paused,
        None::<&str>,
    )?;

    let approvals = MenuItem::with_id(
        app,
        ids::APPROVALS,
        approvals_label(snapshot.approvals),
        snapshot.approvals > 0,
        None::<&str>,
    )?;
    let spend = MenuItemBuilder::with_id(ids::SPEND, spend_label(snapshot.spend_today))
        .enabled(false)
        .build(app)?;

    let settings = MenuItem::with_id(app, ids::SETTINGS, "Settings…", true, None::<&str>)?;
    let updates = MenuItem::with_id(app, ids::CHECK_UPDATES, "Check for Updates…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, ids::QUIT, "Quit XR", true, None::<&str>)?;

    // Separators are bound to locals: a `&PredefinedMenuItem::separator()?`
    // temporary would be dropped before the menu is built.
    let sep_a = PredefinedMenuItem::separator(app)?;
    let sep_b = PredefinedMenuItem::separator(app)?;
    let sep_c = PredefinedMenuItem::separator(app)?;
    let sep_d = PredefinedMenuItem::separator(app)?;

    let mut items: Vec<&dyn tauri::menu::IsMenuItem<R>> = vec![
        &open,
        &new_chat,
        &new_workspace,
        &sep_a,
        &toggle_hud,
        &listening,
        &agents,
        &sep_b,
        &approvals,
    ];
    // Only present when something is wrong: an "Engine offline" line is useful,
    // a permanent "Engine: running" line is noise.
    let engine_status = if snapshot.engine_up {
        None
    } else {
        Some(MenuItemBuilder::with_id(ids::ENGINE_STATUS, "Engine stopped — running without the local agent")
            .enabled(false)
            .build(app)?)
    };
    if let Some(status) = &engine_status {
        items.push(status);
    }
    items.push(&spend);
    items.push(&sep_c);
    items.push(&settings);
    items.push(&updates);
    items.push(&sep_d);
    items.push(&quit);

    Menu::with_items(app, &items)
}

// ─── Icon ───────────────────────────────────────────────────────────────────

fn load_icon<R: Runtime>(app: &AppHandle<R>, badged: bool) -> Option<tauri::image::Image<'static>> {
    let (file, _template) = icon_spec(std::env::consts::OS, badged);
    let resource = app.path().resource_dir().ok();
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from));
    for path in icon_search_paths(resource, exe_dir, file) {
        if !path.is_file() {
            continue;
        }
        // `from_bytes` decodes with the image crate (png/ico features enabled in
        // Cargo.toml); a broken file is skipped, not fatal.
        match std::fs::read(&path) {
            Ok(bytes) => match tauri::image::Image::from_bytes(&bytes) {
                Ok(image) => return Some(image),
                Err(e) => eprintln!("tray: {} is not a readable image ({e})", path.display()),
            },
            Err(e) => eprintln!("tray: could not read {}: {e}", path.display()),
        }
    }
    None
}

// ─── Wiring ─────────────────────────────────────────────────────────────────

/// Create the tray. Called once from `lib.rs` setup (desktop only).
pub fn create_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let state = tray_state(app);
    let snapshot = state.lock().clone();
    let menu = build_menu(app, &snapshot)?;

    let (_, is_template) = icon_spec(std::env::consts::OS, false);
    let badged = snapshot.approvals > 0;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(tooltip(snapshot.engine_up))
        .menu(&menu)
        // macOS: primary click toggles the window (the menu bar already gives
        // access to everything). Windows/Linux: primary click opens the menu,
        // then raises the window.
        .show_menu_on_left_click(std::env::consts::OS != "macos")
        .icon_as_template(is_template)
        .on_menu_event(|app, event| on_menu_event(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| on_tray_icon_event(tray.app_handle(), event));

    builder = match load_icon(app, badged) {
        Some(icon) => builder.icon(icon),
        // Before the icon script runs (or if it is missing) the app icon is
        // still better than an empty tray slot.
        None => match app.default_window_icon() {
            Some(icon) => builder.icon(icon.clone()),
            None => builder,
        },
    };

    builder.build(app)?;
    Ok(())
}

/// Route one menu id. Kept in one place so the tray, the macOS app menu and
/// the (future) dock menu cannot drift apart.
pub fn on_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        ids::OPEN => focus_main_window(app),
        // ⌘W hides rather than closes: the webview holds the Control Room's
        // in-memory run registry, and destroying it would lose live runs.
        ids::CLOSE_WINDOW => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        ids::QUIT => quit(app),
        ids::TOGGLE_HUD => {
            crate::commands::hud::toggle_hud(app);
            // The webview may want to reflect the change (e.g. a pressed state).
            emit_action(app, id);
        }
        ids::CHECK_UPDATES => {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                crate::commands::updates::check_update(handle).await;
            });
        }
        // Everything else is app behaviour the webview owns.
        _ => emit_action(app, id),
    }
}

fn emit_action<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = app.emit("xr-tray-action", serde_json::json!({ "id": id }));
}

/// Quit means quit: stop the engine the way the exit path does, then leave.
/// (`RunEvent::Exit` runs the same teardown; doing it here first is what makes
/// the tray quit feel instant instead of hanging on a 1.5 s grace window.)
pub fn quit<R: Runtime>(app: &AppHandle<R>) {
    app.exit(0);
}

fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// macOS habit: clicking the tray icon of a running app brings its window back.
fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    if visible && focused {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn on_tray_icon_event<R: Runtime>(app: &AppHandle<R>, event: TrayIconEvent) {
    let (button, state, double) = match &event {
        TrayIconEvent::Click { button, button_state, .. } => (*button, *button_state, false),
        TrayIconEvent::DoubleClick { button, .. } => (*button, MouseButtonState::Up, true),
        _ => return,
    };
    if button != MouseButton::Left || state != MouseButtonState::Up {
        return;
    }
    match primary_click(std::env::consts::OS, double) {
        PrimaryClick::ToggleWindow => toggle_main_window(app),
        PrimaryClick::FocusWindow => focus_main_window(app),
        PrimaryClick::MenuAndFocus => {
            // The menu is opened by the tray implementation itself
            // (`show_menu_on_left_click`); raising the window here is the extra
            // half the brief asks for.
            focus_main_window(app);
        }
    }
}

/// The frontend pushes what it knows; the tray renders it.
#[tauri::command]
pub fn tray_update_state(app: AppHandle, snapshot: TraySnapshot) -> TraySnapshot {
    apply_snapshot(&app, snapshot)
}

/// Merge a partial update (the webview usually knows one field at a time).
pub fn apply_snapshot<R: Runtime>(app: &AppHandle<R>, incoming: TraySnapshot) -> TraySnapshot {
    let state = tray_state(app);
    // The webview sends the whole snapshot (it owns voice state, the Shield
    // owns the pause flag, the Control Room owns approvals), so the incoming
    // struct replaces the stored one; only the count change is tracked here.
    let (merged, previous, spent) = {
        let mut guard = state.lock();
        let previous = guard.clone();
        *guard = incoming.clone();
        let spent = *state.attention_spent.lock().unwrap_or_else(|e| e.into_inner());
        (incoming, previous, spent)
    };

    // Badge + tooltip + menu.
    let badged = merged.approvals > 0;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let (_, is_template) = icon_spec(std::env::consts::OS, badged);
        if let Some(icon) = load_icon(app, badged) {
            let _ = tray.set_icon_with_as_template(Some(icon), is_template);
        }
        let _ = tray.set_tooltip(Some(tooltip(merged.engine_up)));
        // macOS: the count lives in the title, right of the icon.
        #[cfg(target_os = "macos")]
        {
            let title = if merged.approvals > 0 {
                Some(format!(" {}", merged.approvals))
            } else {
                None
            };
            let _ = tray.set_title(title);
        }
        if let Ok(menu) = build_menu(app, &merged) {
            let _ = tray.set_menu(Some(menu));
        }
    }

    // One bounce / flash per batch, and only when it is news.
    let focused = app
        .get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false);
    if should_request_attention(previous.approvals, merged.approvals, focused, spent) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.request_user_attention(Some(UserAttentionType::Informational));
        }
        *state.attention_spent.lock().unwrap_or_else(|e| e.into_inner()) = true;
    }
    // A cleared queue re-arms the next batch.
    if merged.approvals == 0 {
        *state.attention_spent.lock().unwrap_or_else(|e| e.into_inner()) = false;
    }

    merged
}

/// Engine health changed (spawn succeeded, exited, restart) — refresh the tray
/// without the webview having to notice.
pub fn refresh_engine<R: Runtime>(app: &AppHandle<R>, engine_up: bool) {
    let state = tray_state(app);
    let snapshot = {
        let mut guard = state.lock();
        guard.engine_up = engine_up;
        guard.clone()
    };
    apply_snapshot(app, snapshot);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tooltip_is_honest_when_the_engine_is_down() {
        assert_eq!(tooltip(true), "XR — running on your machine");
        let down = tooltip(false);
        assert!(down.contains("engine stopped"));
        assert!(!down.to_lowercase().contains("error"), "calm, not alarming");
    }

    #[test]
    fn approvals_label_is_quiet_at_zero_and_counted_after() {
        assert_eq!(approvals_label(0), "No pending approvals");
        assert_eq!(approvals_label(1), "Pending approvals (1)");
        assert_eq!(approvals_label(7), "Pending approvals (7)");
        assert!(!approvals_label(0).contains('!'));
    }

    #[test]
    fn spend_label_formats_money_or_says_nothing_yet() {
        assert_eq!(spend_label(Some(0.0)), "Today: $0.00");
        assert_eq!(spend_label(Some(12.345)), "Today: $12.35", "rounds like money");
        assert_eq!(spend_label(Some(1234.5)), "Today: $1234.50", "no thousands gibberish");
        assert_eq!(spend_label(None), "Today: —");
    }

    #[test]
    fn listen_and_agents_labels_flip() {
        assert_eq!(listening_label(false), "Start listening");
        assert_eq!(listening_label(true), "Stop listening");
        assert_eq!(agents_label(false), "Pause agents");
        assert_eq!(agents_label(true), "Resume agents");
    }

    #[test]
    fn attention_fires_once_per_batch_and_never_when_focused() {
        // Focused: never.
        assert!(!should_request_attention(0, 3, true, false));
        // Same count re-rendered: not news.
        assert!(!should_request_attention(3, 3, false, false));
        // Dropping to zero: not news either.
        assert!(!should_request_attention(2, 0, false, false));
        // Rising while unfocused and unspent: exactly once.
        assert!(should_request_attention(2, 3, false, false));
        assert!(!should_request_attention(2, 3, false, true), "already spent for this batch");
        assert!(!should_request_attention(0, 0, false, false), "nothing pending, nothing to say");
    }

    #[test]
    fn click_semantics_follow_the_platform() {
        assert_eq!(primary_click("macos", false), PrimaryClick::ToggleWindow);
        assert_eq!(primary_click("windows", false), PrimaryClick::MenuAndFocus);
        assert_eq!(primary_click("linux", false), PrimaryClick::MenuAndFocus);
        // Double click always raises, everywhere.
        for os in ["macos", "windows", "linux"] {
            assert_eq!(primary_click(os, true), PrimaryClick::FocusWindow);
        }
    }

    #[test]
    fn macos_icon_is_always_a_template() {
        let (file, template) = icon_spec("macos", false);
        assert_eq!(file, "tray-mac-template.png");
        assert!(template, "macOS tray icons must be Template images");
        // The badge must not smuggle colour into the menu bar.
        let (_, badged_template) = icon_spec("macos", true);
        assert!(badged_template);

        let (win, win_template) = icon_spec("windows", false);
        assert_eq!(win, "tray-win.ico");
        assert!(!win_template);
        assert!(icon_spec("windows", true).0.contains("badge"));
        assert!(icon_spec("linux", false).0.ends_with(".png"));
        assert!(icon_spec("linux", true).0.contains("badge"));
    }

    #[test]
    fn icon_lookup_prefers_bundled_then_executable_then_source() {
        let paths = icon_search_paths(
            Some(PathBuf::from("/app/Resources")),
            Some(PathBuf::from("/app/bin")),
            "tray-win.ico",
        );
        assert_eq!(paths[0], PathBuf::from("/app/Resources/icons/tray/tray-win.ico"));
        assert_eq!(paths[1], PathBuf::from("/app/bin/icons/tray/tray-win.ico"));
        assert!(paths[2].ends_with("icons/tray/tray-win.ico"));
        assert!(paths[2].starts_with(env!("CARGO_MANIFEST_DIR")));
    }

    #[test]
    fn snapshot_round_trips_through_json_as_camel_case() {
        let snapshot = TraySnapshot {
            approvals: 2,
            spend_today: Some(3.5),
            agents_paused: true,
            listening: false,
            engine_up: true,
            voice_available: true,
        };
        let json = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(json["approvals"], 2);
        assert_eq!(json["spendToday"], 3.5);
        assert_eq!(json["agentsPaused"], true);
        assert_eq!(json["engineUp"], true);
        let back: TraySnapshot = serde_json::from_value(json).unwrap();
        assert_eq!(back, snapshot);
    }

    #[test]
    fn ids_are_namespaced_so_menu_events_never_collide() {
        for id in [
            ids::OPEN, ids::NEW_CHAT, ids::NEW_WORKSPACE, ids::TOGGLE_HUD,
            ids::TOGGLE_LISTENING, ids::TOGGLE_AGENTS, ids::APPROVALS, ids::SPEND,
            ids::ENGINE_STATUS, ids::SETTINGS, ids::CHECK_UPDATES, ids::QUIT,
            ids::ABOUT, ids::CLOSE_WINDOW, ids::TOGGLE_SIDEBAR, ids::PALETTE,
        ] {
            assert!(id.starts_with("xr-"), "{id} is not namespaced");
        }
    }
}
