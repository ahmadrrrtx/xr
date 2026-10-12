# Packaging XR for Linux

Three targets ship from CI (`.deb`, `.rpm`, AppImage), one is built here from a
manifest (`packaging/flatpak/`). This document covers what is specific to Linux:
the Flatpak build, what the desktop entry has to say for a window to behave, the
tray situation under GNOME, and the sandbox the engine actually runs skills in.

## Flatpak

```sh
# One-time: the GNOME runtime, not the freedesktop one — org.gnome.Platform is
# the runtime that ships webkit2gtk-4.1, which is what a Tauri v2 app needs at
# both build and run time. The two SDK extensions are the freedesktop ones.
flatpak install flathub org.gnome.Platform//46 org.gnome.Sdk//46 \
  org.freedesktop.Sdk.Extension.rust-stable//46 org.freedesktop.Sdk.Extension.node22//46

# Build + install locally
cd /path/to/xr
flatpak-builder --user --install --force-clean build-dir packaging/flatpak/ai.rrrtx.xr-desktop.yml
flatpak run ai.rrrtx.xr-desktop

# Validate the metadata the way Flathub does (both tools are in the Debian/Ubuntu
# package `appstream` + `desktop-file-utils`; no runtime needed for these two)
desktop-file-validate packaging/flatpak/ai.rrrtx.xr-desktop.desktop
appstreamcli validate --no-net packaging/flatpak/ai.rrrtx.xr-desktop.metainfo.xml
```

**Status of this manifest.** Its metadata is validated in CI on every PR (both
commands above), and `test/desktop/flatpak-metainfo.test.ts` pins the same rules
offline. A full from-source `flatpak-builder` run has **not** been executed here:
it needs the GNOME runtime and, for Flathub, vendored sources. CI runs it on
`workflow_dispatch`, not on PRs — see *Before a Flathub submission* below.

The manifest builds the **engine sidecar and the shell in one module**, because
the shell without its engine is not a smaller XR — it is a window that cannot
answer.

Bun is a real requirement of this build, not a preference: the repo locks with
`bun.lock` (there is no `package-lock.json`), and `scripts/compile-sidecar.ts`
calls `Bun.spawnSync`. So rather than downloading a runtime mid-build — which is
exactly the supply-chain hole a Flatpak manifest exists to avoid — bun is a
**checksummed source** (`type: archive`, `sha256`, pinned to `.bun-version`), and
flatpak-builder verifies it before anything runs. The Rust step is a plain
`cargo build --release --locked` rather than `tauri build`: there is no `.deb` to
produce inside the sandbox, and the frontend is built by the `beforeBuildCommand`
in `tauri.conf.json` (`bun run build`) one command earlier.

**Permissions, and why each one is there** (all in the manifest, none implicit):

| Permission | Reason |
| --- | --- |
| `--filesystem=home` | XR is a coding agent: reading and writing the user's projects is the product. It does **not** get `host`. |
| `--share=network` | Provider calls, the update channel, the user's own MCP servers. The engine still binds loopback only. |
| `--socket=wayland`, `--socket=fallback-x11` | Wayland first; X11 only where there is no Wayland session. |
| `--device=dri` | WebKit renders through GL — without it the window comes up blank, which looks like an app crash. |
| `--socket=pulseaudio`, `--device=all`, `--filesystem=xdg-run/pipewire-0` | Voice: capture and playback. Flatpak has no finer-grained microphone permission than `--device=all`; that is recorded here rather than hidden. |
| `--talk-name=org.kde.StatusNotifierWatcher`, `--talk-name=org.ayatana.indicator.application` | The tray (AppIndicator) talks over the session bus. |
| `--talk-name=org.freedesktop.Notifications` | The "update downloaded" OS notification when the window is hidden. |
| `--filesystem=xdg-run/tray-icon:create` | Tray hosts that export the icon over a socket instead of the session bus. |
| `--env=XR_HOME=/var/data/xr` | Keeps app data in the per-app directory instead of a sandboxed `$HOME/.xr`. |

**PipeWire note.** XR's voice path asks for the default input device and does not
touch the server's configuration. On PipeWire systems `pulseaudio` is provided by
`pipewire-pulse`; the socket name is historical, the permission is the same. If
capture returns silence under Flatpak, the failure is almost always the portal or
a missing `pipewire-pulse`, not the app: `pactl info` inside
`flatpak run --command=sh ai.rrrtx.xr-desktop` says which server it found.

**What Flatpak does not get.** No `host` filesystem, no `--socket=system-bus`, no
`--allow=devel`, no device access beyond the microphone. A skill that wants to
escape the project cannot use the sandbox's own mount namespace to do it — which
is the point of shipping this as a Flatpak rather than a tarball.

## Desktop entry

`packaging/flatpak/ai.rrrtx.xr-desktop.desktop` is the canonical entry; the
`.deb`/`.rpm` bundlers generate their own from `tauri.conf.json`, so the two must
agree on the fields that change behaviour:

| Field | Value | Why it matters |
| --- | --- | --- |
| `Categories` | `Development;Utility;` | Matches `bundle.category = DeveloperTool`. A missing `Development` puts XR in the wrong menu and breaks `gtk-launch` lookups by category. There is deliberately **no `AI` entry**: it is not a registered freedesktop category, so `desktop-file-validate` fails on it and menus ignore it — "AI" lives in `Keywords`, where it is actually searchable. (This was caught by CI, not by eye.) |
| `MimeType` | `x-scheme-handler/xr` | From `bundle.fileAssociations` (Phase 27). Without it, `xr://` links open a browser. |
| `StartupWMClass` | `xr-desktop` | Without it a taskbar shows a second, unnamed icon and the tray grouping looks broken. |
| `Exec` | `xr-desktop %u` | `%u` carries the deep link as a URL. |
| `StartupNotify` | `true` | One spinner while the shell boots rather than a silent pause. |

Verify on a real session with:

```sh
desktop-file-validate packaging/flatpak/ai.rrrtx.xr-desktop.desktop
xdg-mime query default x-scheme-handler/xr      # → ai.rrrtx.xr-desktop.desktop
xdg-open 'xr://open'                            # → focuses the running app
```

## The tray

| Desktop | Behaviour |
| --- | --- |
| KDE Plasma, XFCE, Cinnamon, MATE | AppIndicator works out of the box; the icon set in `desktop/src-tauri/icons/tray/` covers 22–128 px so the panel picks its own size. |
| GNOME 45+ | Needs the **AppIndicator and KStatusNotifierItem Support** extension. Without it there is no tray host on the bus: the app runs, but the icon has nowhere to draw. XR's tooltip and menu are correct; the host is simply absent. |
| Sway / Hyprland (wlroots) | Waybar's `tray` module hosts it; `grim` covers the screenshot shortcut. |
| GNOME without the extension | Closing the window hides the app, and there is no tray to get it back from — so `Settings → General` keeps "quit on window close" available as an explicit choice. |

The tray checker items are honest about state: **Pause agents** reflects the
Shield's pause flag, and the approvals count is the real queue depth, not a
decoration.

## Portal notes

- **File dialogs** go through `xdg-desktop-portal` (the dialog plugin uses the
  portal on Wayland). A minimal session with no portal installed falls back to the
  toolkit's own dialog; on a Wayland session without one, the fallback may not
  appear at all.
- **Screenshot-and-ask** does not use the portal yet: it drives `grim`,
  `gnome-screenshot`, `spectacle`, `maim` or `scrot` directly, in that order, and
  picks a Wayland-safe subset when `XDG_SESSION_TYPE=wayland`. The Settings row
  reports which tool was found, or names the install command when none was.
- **Global shortcuts** on Wayland are compositor-owned. XR registers through
  XDG's global-shortcut portal where available; a compositor that does not expose
  it will refuse the registration, and the Settings → Shortcuts row will show the
  chord as unavailable rather than pretending.

## The skill sandbox (default on Linux)

Skills do not run as loose processes on Linux. The default is **bubblewrap plus a
seccomp profile**:

- each skill run gets its own mount namespace with the project bind-mounted
  read-write and the rest of the system read-only or absent;
- `gen-seccomp.ts` (`scripts/gen-seccomp.ts`) generates the syscall filter, and
  the profile is applied to the skill process, not the engine;
- network access follows the approval, not the sandbox: a skill that wants the
  network asks for it and the request is audited;
- `xr env capabilities --json` reports what the current environment actually
  supports, and **Landlock** is the second layer where the kernel offers it
  (5.13+) — bubblewrap for the namespace, Landlock for the filesystem rules, and
  a seccomp filter for the syscalls none of them cover.

Inside a Flatpak, bwrap still runs (user namespaces are available); the outer
sandbox narrows what the inner one can reach, which is the intended layering
rather than a conflict.

## Before a Flathub submission

Three things stand between this manifest and a Flathub PR, and none of them are
code changes to the app:

1. **Vendor the Rust sources.** Flathub's builders have no network, so
   `cargo build` cannot reach crates.io. Generate `cargo-sources.json` with
   flathub's `flatpak-cargo-generator.py` and add it as the first source of the
   module; that is what every Rust app on Flathub does.
2. **Vendor the JavaScript dependencies.** Either a generated
   `flatpak-node-generator` sources file, or the bun offline cache, so
   `bun install --frozen-lockfile` resolves without a registry.
3. **Real screenshots.** The metainfo currently points at the committed preview
   renders under `previews/implementation/`, because those URLs resolve today and
   a release-asset URL does not exist until its tag is cut. Replace them with
   on-device captures before submitting.

Until (1) and (2) exist, a `flatpak-builder` run works only on a machine with
network access — which is what the `workflow_dispatch` CI job provides.

## Verifying a Linux package

```sh
# .deb (the install test CI runs on every PR)
sudo dpkg -i xr-desktop_*.deb && xr-desktop --version && sudo dpkg -r xr-desktop

# AppImage
chmod +x XR_*.AppImage && ./XR_*.AppImage

# Flatpak
desktop-file-validate packaging/flatpak/ai.rrrtx.xr-desktop.desktop
appstreamcli validate --no-net packaging/flatpak/ai.rrrtx.xr-desktop.metainfo.xml
flatpak-builder --user --install --force-clean build-dir packaging/flatpak/ai.rrrtx.xr-desktop.yml
flatpak run ai.rrrtx.xr-desktop
```

The AppImage self-updates; the `.deb`, `.rpm` and Flatpak builds delegate
updating to their package manager. XR detects which it is running under and shows
the corresponding instruction instead of trying to replace a file it does not own
— that rule is enforced in the updater's channel handling, not by trusting the
user to read this document.
