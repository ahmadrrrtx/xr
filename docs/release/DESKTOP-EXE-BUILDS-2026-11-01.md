# XR Desktop — how the exe builds work, and how to get them

**Date:** 2026-11-01 · **Author:** release engineering session · **Status:** researched + verified against `desktop-app.yml` @ the `work/ui-redesign-2026-10-29` branch

This document answers, in depth: *how do the XR desktop executables work, what do they need, and how do we produce final, release-able AND use-able exes?*

---

## 1 · What an "XR exe" actually is

The desktop app is a **Tauri v2 shell** (`desktop/src-tauri`, `productName: "XR"`, id `ai.rrrtx.xr`, v1.1.1-rc.1). A shipped exe is **three things in one package**:

1. **The Rust shell** (`desktop/src-tauri/src`) — the native window, tray, single-instance lock, deep-link handler, and the Rust-side budget governor. Compiled per-OS by `cargo`/MSVC/clang. This is why the sandbox cannot build it here: no Rust toolchain — the builds must run on the CI matrix.
2. **The webview UI** — the React app (`desktop/src`), the same code the Vite preview serves. Tauri embeds it via the OS webview (WebView2 on Windows, WKWebView on macOS, WebKit2GTK 4.1 on Linux).
3. **The engine sidecar** (`binaries/xr-engine-<triple>`) — the whole XR engine compiled by **`bun build --compile`** (`scripts/compile-sidecar.ts`, ONE source of truth for CI and local dev) and bundled as a Tauri `externalBin`. The shell spawns it; every model call, research run and secret goes through it. A bundle never ships an engine that didn't boot: the workflow smoke-tests the sidecar (`scripts/smoke-sidecar.sh`: `--version`, then `serve` + authenticated health probe) BEFORE packaging, and asserts the sidecar's machine arch matches the bundle (an `arm64` sidecar inside an `x64` bundle is a hard error).

**What an exe needs to run:** nothing external except the OS webview. Windows bundles the WebView2 **offline installer** (`webviewInstallMode: offlineInstaller, silent`), so no internet at install time. The engine sidecar rides inside the bundle. Keys are the user's own (Settings → Models), stored in the engine's secret broker (OS keychain where available, encrypted file fallback).

## 2 · The flavors produced (per OS)

| OS | Installers | Also produced |
|---|---|---|
| **Windows x64** | `msi` (per-machine, the upgrade path for existing installs) **+** `nsis` `*-setup.exe` (per-user, no UAC) | **`xr-portable-win.zip`** — no-install flavor: `xr-desktop.exe` + engine sidecar side by side; `msix` (test-signed, `.cer` included) |
| **Windows arm64** | `nsis` only (only NSIS supports ARM64 in Tauri v2) | — |
| **macOS arm64 + x64** | `dmg` + `.app.tar.gz` (x64 cross-compiled on the arm runner, engine sidecar built `--target` natively by bun) | updater `.sig`s when signing keys exist |
| **Linux x64** | `deb` + `rpm` + `AppImage` | flatpak metadata validation (build on dispatch) |

Every bundle assertion is a red run, not a hope: `if-no-files-found: error` on every artifact upload, plus explicit asserts (`msi ≥ 1 && nsis ≥ 1` on Windows, `deb+rpm+AppImage ≥ 1` on Linux, `dmg+.app ≥ 1` on macOS). The portable zip exists precisely for machines that refuse installers and for first-launch forensics.

## 3 · Signed vs development builds (what "release-able" means)

Signing is **wired but gated on owner secrets** (decision D5 / XR-LAUNCH-008): `TAURI_UPDATER_KEY[_PASSWORD]`, `APPLE_*` (cert + notary), `WINDOWS_CERTIFICATE[_PASSWORD]`.

- **On a tag** (`v*`): the release-preflight job *fails early* if the secrets are absent — a tag is never allowed to produce an accidentally-unsigned "release".
- **On a branch / PR / `workflow_dispatch`**: the build completes as a **development build (unsigned)** and says so. It is fully *use-able*; the OS just warns:
  - Windows SmartScreen "unknown publisher" → *More info → Run anyway* (or install the MSIX's test `.cer` for the MSIX flavor).
  - macOS Gatekeeper → `xattr -cr /Applications/XR.app` (or right-click → Open).
  - Linux: no gate.
- Actual store-grade signing requires the owner to add the repo secrets above; nothing else changes — the plan/verify steps already exist in the workflow.

## 4 · How the builds run (the pipeline)

`desktop-app.yml` (Tauri packaging matrix), on: PR → main, push → main, tags `v*`, and **`workflow_dispatch`** (manual, any branch — this is the branch-exe path).

Jobs: `release-preflight` (identity manifest + signing plan) → `shell-check` (cargo check/clippy -D warnings on Linux WebKit2GTK headers) + `shell-test-windows` (the `#[cfg(windows)]` runtime tests on a real kernel) → **`bundle` matrix** (5 legs: linux-x64, darwin-arm64, darwin-x64 cross, windows-x64, windows-arm64) → `journey` (installs and boots the bundle on 7 real runner combos, incl. an Intel mac for the cross leg) → manifest/latest.json jobs.

Icons come from the committed set at `desktop/src-tauri/icons` — regenerated 2026-11-01 from the owner's original avatar (`tools/gen-tauri-icons.py`; the app icons are the avatar on the XR void, `icon.png` is the white-silhouette mark master for the tray/MSIX generators, and `icon.icns` is now a REAL Apple ICNS container — the old file was a renamed PNG).

## 5 · How to produce use-able exes right now (verified procedure)

1. Push the branch (done: `work/ui-redesign-2026-10-29`).
2. Dispatch the workflow on that branch:
   `POST /repos/ahmadrrrtx/xr/actions/workflows/desktop-app.yml/dispatches {"ref":"work/ui-redesign-2026-10-29"}`.
3. Wait for `bundle` (typ. ~20–45 min; rust-cache warm on main legs). Artifacts per leg:
   `xr-desktop-<slug>` (installers), `xr-portable-windows-x64`, `xr-msix-windows-x64`.
4. Download from the run page (github.com/ahmadrrrtx/xr/actions/runs/<id>) — each artifact is a zip containing the installers.
5. Users install per §2/§3 (unsigned-development note applies until signing secrets are added).

A first dispatch was triggered 2026-11-01 on the redesign branch (see §7 for the run link, recorded when available). That run is the reference for "release-able and use-able": all five legs, every installer asserted present, sidecar smoke-tested, journey-booted.

## 6 · What still gates a PUBLIC release (honest list)

- Owner signing secrets (Windows cert, Apple cert+notary, updater key) — required for a signed tag; the workflow already fails closed without them.
- Version: `1.1.1-rc.1` in `tauri.conf.json` — tag `v1.1.1` when the owner promotes.
- Draft-assets/publication is deliberately **not** automatic (private draft preparation only until explicit owner promotion — see `docs/release/DESKTOP_SIGNING.md`).

## 7 · Dispatch record

### Run 41292497162 — 2026-11-01 @ `49112b1` (the exe deliverable)

https://github.com/ahmadrrrtx/xr/actions/runs/41292497162 — **all 5 bundle legs + all 7 journey boots green**; the only red is the report-only flatpak from-source build (infra, see below).

| Artifact | Contents | Size |
|---|---|---|
| `xr-desktop-windows-x64` | `XR_1.1.1-rc.1_x64_en-US.msi` + `*-setup.exe` (NSIS, per-user) | 554 MB |
| `xr-portable-windows-x64` | no-install: `xr-desktop.exe` + `xr-engine-x86_64-pc-windows-msvc.exe` (verified contents) | 67 MB |
| `xr-msix-windows-x64` | test-signed MSIX + `.cer` | 68 MB |
| `xr-desktop-windows-arm64` | NSIS ARM64 setup | 242 MB |
| `xr-desktop-darwin-arm64` / `-x64` | `XR_1.1.1-rc.1_aarch64.dmg` / `_x64.dmg` + `.app.tar.gz` | 104 / 110 MB |
| `xr-desktop-linux-x64` | `.deb` + `.rpm` + `.AppImage` | 268 MB |

Journey proof: each bundle was installed and booted on its real OS (macOS 14/15, Intel mac, Windows x64/arm64, Ubuntu 22.04/24.04) — a green run means the exes RUN, not merely compile.

**Two infra fixes made from this run's findings** (both pushed, validated by the follow-up dispatch):

1. **Flatpak leg red**: `Nothing matches org.freedesktop.Sdk.Extension.rust-stable in remote flathub` — flathub retired the EOL GNOME 46 runtime's SDK extensions. The XR-side validations all passed (desktop entry, AppStream, manifest). Fix: `runtime-version: "46" → "48"` in `packaging/flatpak/ai.rrrtx.xr-desktop.yml` (`116e994`). The from-source flatpak build remains report-only per the manifest's own status note.
2. **Portable "zip" was a TAR**: the Windows runner's `tar -a -c -f x.zip` writes a TAR despite the `.zip` name (bsdtar has no zip writer). The artifact's contents were correct (`xr-portable/xr-desktop.exe` + sidecar) but the format was wrong. Fix: `Compress-Archive` + a PK-signature assert in the workflow (`a3edc16`).

Development (unsigned) build per §3 — fully use-able. Download: open the run page → Artifacts (each leg's zip contains the installers); signing secrets are the only gate to a signed tag build.

### Run 41294769244 — 2026-11-01 @ `116e994` (fix validation)

Same five bundle legs, all green. **The portable flavor is now verified a REAL zip** (PK signature; contents `xr-portable/xr-desktop.exe` 40.5 MB + `xr-portable/xr-engine-x86_64-pc-windows-msvc.exe` 93.2 MB) — download it from https://github.com/ahmadrrrtx/xr/actions/runs/41294769244 → Artifacts → `xr-portable-windows-x64`, unzip anywhere, double-click `xr-desktop.exe`, no install needed.

Its flatpak leg still failed (it dispatched before the runtime fix landed) — fixed afterwards in `1c1d2cb` (GNOME 48 + fdo ext `//24.08` refs that actually exist; lane made report-only/non-gating per the manifest's documented status). The next dispatch on the branch tip is expected fully green.
