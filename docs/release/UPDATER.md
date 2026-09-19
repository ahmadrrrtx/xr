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

- `desktop-app.yml` bundle job passes `TAURI_SIGNING_PRIVATE_KEY` to
  `tauri build`; signed updater artifacts (`*.tar.gz` + `.sig`, `*.msi.zip` +
  `.sig`) are uploaded alongside installers. Empty secret ⇒ no `.sig` files,
  by tauri's own behavior.
- `updater-manifest` job (tag pushes only) downloads the sig artifacts and
  runs `scripts/make-updater-manifest.ts`; zero platforms ⇒ publish skipped
  with a warning (honest). Otherwise `latest.json` is attached to the release.
- The shell's `check_update` command + Settings "check" button then work
  end-to-end; installs are passive-mode on Windows, standard elsewhere.

## Verification without the secret (what CI proves today)

- `cargo check` + `clippy -D warnings` compile the updater wiring on every PR
  (`desktop-app.yml` shell-check job).
- `test/release/updater-manifest.test.ts` dry-runs the manifest assembler:
  platform-key mapping, repo asset URLs, and the empty-manifest honesty rule.
- `scripts/generate-updater-keys.ts` format is pinned by the same test
  (raw 32-byte Ed25519 pubkey extraction).

## Autostart + OS notifications

Both ship active but **opt-in**: `tauri-plugin-autostart` (Settings toggle,
disabled by default) and `tauri-plugin-notification` behind the Settings
notifications opt-in (browser host falls back to the Notification API when
permitted; outside both, the UI states the channel is unavailable).
