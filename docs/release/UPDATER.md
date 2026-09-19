# Signed auto-updater (Tauri) — provisioning runbook

Status: **wired, inert until provisioned**. The Rust shell registers
`tauri-plugin-updater` and exposes a `check_update` command; the release
pipeline assembles and publishes `latest.json` **only** when the operator
secret exists. An unprovisioned install never half-updates: `check_update`
returns an honest error and the Settings "updates" row says so.

## Why manual provisioning

The updater verifies every artifact against an Ed25519 pubkey baked into
`tauri.conf.json` at build time. The matching private key signs `latest.json`
assets in CI. Committing the private key would be a credential-in-repo
violation, so the pair is created once by the operator:

## One-time setup (trusted machine)

1. `bun run scripts/generate-updater-keys.ts --apply`
   - prints the PRIVATE key (PKCS#8 PEM) to stdout — **never written anywhere**
   - patches the pubkey + endpoint (`…/releases/latest/download/latest.json`)
     into `desktop/src-tauri/tauri.conf.json`
2. Commit the `tauri.conf.json` change.
3. Store the printed private key as the repo secret `TAURI_UPDATER_KEY`
   (Settings → Secrets → Actions). Delete the terminal scrollback.

## What CI then does, automatically

- `tauri.conf.json` sets `bundle.createUpdaterArtifacts: true`. Without it
  Tauri v2 produces **no** updater artifacts and **no** signatures even when
  the key is present (that was the state before Phase 1: the pipeline could
  never have shipped an update, provisioned or not).
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
- The shell's `check_update` command + Settings "check" button then work
  end-to-end; installs are passive-mode on Windows, standard elsewhere.

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
