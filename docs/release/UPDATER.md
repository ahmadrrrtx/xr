# Signed auto-updater (Tauri) — provisioning runbook

Status: **wired, inert until provisioned**. The Rust shell registers
`tauri-plugin-updater` and exposes the full command surface (`check_update`,
`download_update`, `install_update`, `updates_state`, channel + auto-download +
skip preferences — `desktop/src-tauri/src/commands/updates.rs`); the release
pipeline assembles and publishes `latest.json` **only** when the operator
secret exists. An unprovisioned install never half-updates: every command
returns `provisioned: false` with the reason and the operator command, and the
Settings "updates" card lights up by itself once a pubkey is present — no code
change, no rebuild flag.

## The four rules the shell holds to

1. **Unprovisioned is a state, not an error.** Nothing throws, nothing spins,
   and the copy names the fix (`bun run scripts/generate-updater-keys.ts --apply`).
2. **Channels are real at runtime.** `UpdaterBuilder::endpoints` follows the
   user's Stable/Beta/Nightly choice (with an optional operator override under
   `plugins.updater.channels`), instead of the endpoint being frozen at build
   time. A prerelease version defaults to its own channel, so a beta tester is
   not dragged onto Stable by the first stable release.
3. **Bytes are never persisted.** `Update::download` is where the Ed25519
   signature is checked; `install` trusts what it is handed. Writing a payload to
   disk and installing it on the next launch would mean installing bytes that
   skipped verification, so "Later" hides the banner for the session and a fresh
   launch re-checks (and, with auto-download on, re-fetches) instead.
4. **Auto-download is not auto-apply.** The toggle (default ON on Stable, opt-in
   on Beta/Nightly) fetches and verifies in the background; the modal is the only
   path that installs. Release CI, the signature check and the UI all assume a
   human is in the loop.

Windows installs hand over to the installer (`restart_after_install` is true by
default); macOS and Linux relaunch the shell after a successful install. A
channel switch discards anything already downloaded — those bytes came from the
other channel's manifest.

## Why manual provisioning

The updater verifies every artifact against an Ed25519 pubkey baked into
`tauri.conf.json` at build time. The matching private key signs `latest.json`
assets in CI. Committing the private key would be a credential-in-repo
violation, so the pair is created once by the operator:

## One-time setup (trusted machine)

1. `bun run scripts/generate-updater-keys.ts --apply`
   - prints the PRIVATE key (PKCS#8 PEM) to stdout — **never written anywhere**
   - patches `plugins.updater` (pubkey + endpoint
     `…/releases/latest/download/latest.json`) AND `bundle.createUpdaterArtifacts:
     true` into `desktop/src-tauri/tauri.conf.json` — one step, because either
     half alone is a broken pipeline (see below)
2. Commit the `tauri.conf.json` change.
3. Store the printed private key as the repo secret `TAURI_UPDATER_KEY`
   (Settings → Secrets → Actions). Delete the terminal scrollback.

## What CI then does, automatically

- Until provisioned, `tauri.conf.json` is deliberately **inert**: no
  `plugins.updater`, no `bundle.createUpdaterArtifacts`. Tauri v2 needs both
  together — `createUpdaterArtifacts` without the plugin block makes `tauri
  build` refuse to start ("plugins > updater doesn't exist"), and the plugin
  block without a real pubkey makes every check fail. `--apply` sets both.
  (Before Phase 1 the runbook set only the plugin block, so even a provisioned
  build would have produced **no** updater artifacts and **no** signatures.)
- `desktop-app.yml` bundle job passes `TAURI_SIGNING_PRIVATE_KEY` to
  `tauri build`. Tauri v2 shapes: the installer **is** the updater payload —
  `*.AppImage` + `.sig`, `*.app.tar.gz` + `.sig`, `*-setup.exe` + `.sig`,
  `*.msi` + `.sig`. No pubkey configured ⇒ no `.sig` files (tauri skips
  signing). Pubkey configured but secret missing ⇒ `tauri build` **fails**,
  loudly — a provisioned updater is never shipped unsigned.
- On tag runs the bundle job attaches every installer (and `.sig`) to the
  GitHub release. GitHub renames assets on upload (spaces → periods), and
  `scripts/make-updater-manifest.ts` writes URLs the same way.
- `updater-manifest` job (tag pushes only) downloads the sig artifacts and
  runs `scripts/make-updater-manifest.ts`; zero platforms ⇒ publish skipped
  with a warning (honest). Otherwise `latest.json` is attached to the release.
- The shell's update surface then works end-to-end (Settings card, pending-update
  banner, release-notes modal, Install & restart); installs are passive-mode on
  Windows, standard elsewhere.
- Before the keys exist there is nothing to fake, and the phase says so out
  loud: `docs/release/DESKTOP-SUPPORT-MATRIX.md` records the provisioned path as
  operator-run rather than tested.

## Windows: two installer flavours, one rule

Windows ships **both** an MSI (WiX, per-machine — what every existing install
has) and an NSIS `-setup.exe` (`installMode: currentUser` — per-user, no UAC
prompt; the flavour new installs, the updater and winget `Scope: user` want).
An update must hand a user the flavour they already have, or they end up with
two copies in *Apps*. `tauri-plugin-updater` ≥ 2.10 (we lock 2.11) asks for
`windows-x86_64-nsis` / `windows-x86_64-msi` first and falls back to the
generic `windows-x86_64`; the manifest therefore lists both specific keys and
points the generic key at the **MSI** while one exists (older clients that only
read the generic key are MSI installs). The bundle job asserts both flavours
were produced so a silently-missing one is a red run, not a release-day
surprise. Coexistence: MSI-installed users stay on the MSI path; NSIS is for new
installs. Both are pinned by `test/release/updater-manifest.test.ts`.

## Verification without the secret (what CI proves today)

- `cargo check` + `clippy -D warnings` + `cargo test` compile and unit-test the
  shell on every PR (`desktop-app.yml` shell-check job); `shell-test-windows`
  runs the `#[cfg(windows)]` code's tests on a real Windows kernel.
- `test/release/updater-manifest.test.ts` dry-runs the manifest assembler:
  platform-key mapping, repo asset URLs, and the empty-manifest honesty rule.
- `scripts/generate-updater-keys.ts` format is pinned by the same test
  (raw 32-byte Ed25519 pubkey extraction).

## Autostart + OS notifications

Both ship active but **opt-in**: `tauri-plugin-autostart` (Settings toggle,
disabled by default) and `tauri-plugin-notification` behind the Settings
notifications opt-in (browser host falls back to the Notification API when
permitted; outside both, the UI states the channel is unavailable).
