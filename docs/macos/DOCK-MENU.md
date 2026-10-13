# macOS Dock menu — not available

**Status: 🟡 blocked upstream.** Tauri 2 exposes no Dock API, so XR cannot
provide a dock menu today. This document exists so the gap is written down
rather than rediscovered.

---

## 1. What we wanted

A dock menu (right-click the XR icon in the Dock) with:

- New Chat
- New Voice Session
- Toggle HUD
- Pause All Agents
- Open Settings

…matching what the tray offers, since many Mac users reach for the Dock before
the menu bar.

## 2. Why it is not there

Tauri has no Dock API. The feature request,
[tauri#4520 — "[feat] macOS - Add a way to access Dock api"](https://github.com/tauri-apps/tauri/issues/4520),
has been open since 2022 and covers the dock menu, dock badge and dock progress
bar together.

This was verified directly against the vendored source rather than assumed:
grepping `tauri-2.12.0` for dock/menu/badge APIs returns nothing usable.

⚠️ **A caution about contradictory sources.** At least one third-party write-up
([electrobun#392](https://github.com/blackboardsh/electrobun/issues/392)) claims
Tauri "has similar (`app.dock.setMenu`, `set_progress_bar`)". That is **not
accurate** for Tauri 2 — do not plan work against it.

## 3. What XR does instead

The **tray** is the equivalent surface and is fully implemented
(`src/tray.rs`):

| Wanted in the dock | Available in the tray |
| --- | --- |
| New Chat | ✅ |
| New Voice Session | ✅ (with listening state) |
| Toggle HUD | ✅ |
| Pause / Resume All Agents | ✅ (with paused state) |
| Open Settings | ✅ |
| — | ✅ Pending approvals, with badge count |
| — | ✅ Today's spend |
| — | ✅ Check for Updates |
| — | ✅ Quit XR Desktop |

The tray also carries the approval badge, which a dock badge would otherwise
have been the natural home for. On macOS the badge renders as a count on the
menu-bar icon, which is idiomatic for a menu-bar-style app.

## 4. Options if this becomes important

1. **Wait for upstream.** Track [tauri#4520](https://github.com/tauri-apps/tauri/issues/4520).
2. **Objective-C bridge.** Call `NSApplication`'s dock menu via `objc2-app-kit`
   from a Tauri plugin. Real precedent exists — but note that
   [one project reverted this approach](https://github.com/s3ntin3l8/mullion-helper/pull/41)
   as fragile in favour of `LSUIElement`, so budget for maintenance.
3. **Tauri plugin.** Same work, packaged; appropriate if it should be reusable.

## 5. Related: hiding the dock icon

If XR ever needs to be tray-only (no Dock icon at all), the stable route is
`LSUIElement = true` in `src-tauri/Info.plist`, **not** a runtime
`setActivationPolicy` call. The runtime approach is a known source of
activation-ordering bugs.

That is not what XR does today: XR is a normal dock-present application, which
is correct for an app with a main window.
