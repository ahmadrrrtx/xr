# Updater provisioning runbook (Phase 4 · native GA)

Honest status: the Tauri updater **code path** ships (desktop-app.yml builds
per-OS bundles and an `updater-manifest` job validates the manifest shape),
but the release-signing material is **not provisioned in the dev sandbox**.
This runbook is the exact, ordered list an operator follows to flip it on.
Nothing here is faked: until step 6 lands, the Settings → Updates card says
"updates managed by your package manager / channel", never a fake check.

## 1. Keys (once, offline-capable)

1. `cd desktop/src-tauri && cargo tauri signer generate -w ~/.xr/updater.key`
   (Tauri v2 `tauri-plugin-updater` keypair; write the **private** key to the
   repo secrets as `TAURI_SIGNING_PRIVATE_KEY`, password as
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
2. The public key goes into `tauri.conf.json → plugins.updater.pubkey`.
   Committing the public key is safe and required.

## 2. Endpoint

- Static JSON per channel at a release host (GitHub Releases works day one):
  `https://releases.<host>/xr/<channel>/<os-arch>/latest.json`.
- Shape (Tauri v2): `{ version, date, url, signature, notes }`; `url` points
  at the bundle artifact produced by desktop-app.yml's `bundle` job
  (.nsis.zip / .msi / .dmg / .deb / .AppImage — the same artifacts the
  real-device matrix installs).

## 3. Per-OS install/upgrade paths (what the updater invokes)

| OS | Installer | Upgrade semantics |
|---|---|---|
| Windows | NSIS per-user (primary) | no UAC; replaces in place; MSI-installed users keep MSI path (both flavours asserted in CI) |
| Windows | MSI per-machine | existing installs only; major-upgrade table |
| macOS | .dmg + app swap | quarantined re-sign check; Sparkle not used |
| Linux | .deb / .AppImage | deb via apt channel; AppImage self-replace + relaunch script |

## 4. Rollback

- Every install writes `~/.xr/update-journal.jsonl` (from-version, to-version,
  bundle sha256, timestamp) before swap; on boot the shell reads it and, if
  the previous version's bundle still exists under `~/.xr/rollback/`,
  Settings → Updates offers "Restore <prev>" — one click, same code path as
  install, engine state untouched (XR_HOME is version-independent by law).

## 5. CI wiring

- `desktop-app.yml → updater-manifest` already validates manifest shape and
  signature presence on tag builds; add the signing secrets in repo settings,
  re-run a tag build, then the real-device matrix's `upgraded` lane exercises
  install(vN) → install(vN+1) → journal + state assertions for real.

## 6. GA gate

GA claim requires one green `upgraded` lane per OS in the real-device matrix
(see `.github/workflows/real-device-matrix.yml`). Until then the limitation
stays registered (KNOWN-LIMITATIONS L-02/L-03).
