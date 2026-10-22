# Desktop signing, notarization and updates — owner runbook

Launch audit **XR-LAUNCH-008**, owner decision **D5**: signing is wired in
`.github/workflows/desktop-app.yml` and **gated on owner secrets**. With no
secrets, every desktop build is an honest **unsigned** build and the job prints
a notice saying so; nothing claims to be signed. No key or certificate is
ever in the repository, and none was handled while wiring this.

Current state (2026-10-22): **no secrets provisioned → desktop builds are
unsigned and there is no auto-update.** README and the release notes must keep
saying so until the gates below are green.

## Secrets

| Secret | What | Used for |
|---|---|---|
| `TAURI_UPDATER_KEY` | content of the private key from `tauri signer generate` | signs updater payloads (`.sig`) |
| `TAURI_UPDATER_KEY_PASSWORD` | its password | — |
| `APPLE_CERTIFICATE` | base64 of the Developer ID Application `.p12` | macOS codesign (hardened runtime) |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` password | — |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` | — |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Apple ID, app-specific password, team ID | notarization + stapling |
| `WINDOWS_CERTIFICATE` | base64 of the Authenticode `.pfx` (OV/EV) | Windows Authenticode |
| `WINDOWS_CERTIFICATE_PASSWORD` | `.pfx` password | — |

The `Signing plan` step (`scripts/desktop-signing-plan.ts`) only sees whether
each secret is present. Rules:

- missing secrets on a PR → unsigned build, notice, green;
- tag build with the updater pubkey committed but no `TAURI_UPDATER_KEY` → **fails**
  (it would ship installers the shipped updater rejects);
- tag build signed for macOS but without notarization secrets → **fails**;
- `WINDOWS_CERTIFICATE` set but no thumbprint imported → **fails**.

## Order of operations

1. **Updater key** — follow [UPDATER.md](UPDATER.md) "One-time setup"
   (`tauri signer generate`, `generate-updater-keys.ts --apply <.pub>`, commit,
   two secrets).
2. **Key backup (gate):** store the updater private key and its password offline in
   two places (e.g. password manager + encrypted offline media). Record the date
   and the key id (`untrusted comment: minisign public key: <ID>` in the `.pub`)
   in the release checklist. A lost key means no installed copy can ever update
   again; a leaked key means anyone can push an update — rotate by shipping a
   release whose config carries the new pubkey, signed with the old key.
3. **Apple** — Developer ID Application certificate + notarization credentials
   → the six `APPLE_*` secrets.
4. **Windows** — Authenticode certificate → the two `WINDOWS_*` secrets. (An EV
   certificate on a hardware token cannot be used from a hosted runner; use a
   cloud HSM/signing service and a custom `signCommand` instead.)
5. Push a pre-release tag (`v1.2.0-beta.1`). The tag pipeline then:
   - signs each leg and **verifies it with the OS tools** (`codesign --verify
     --deep --strict`, `spctl --assess`, `xcrun stapler validate`, `signtool
     verify /pa`);
   - builds `latest.json`, **verifies every signature in it against the committed
     pubkey** (`scripts/verify-updater-signatures.ts`), and only then publishes it
     to the tag's release and, for pre-release tags, to the rolling
     `updater-beta` release (the beta channel endpoint).

## Acceptance (owner-run; cannot be done without the keys and hardware)

- [ ] `codesign` / `spctl` / `stapler` steps green on the macOS legs.
- [ ] `signtool verify /pa` green on the Windows legs.
- [ ] N → N+1: install build N on macOS, Windows and Linux (AppImage), publish
      N+1, Settings → Updates → Check → Download → Restart; the app comes back on
      N+1.
- [ ] Tampered manifest rejected on a real install: serve a `latest.json` whose
      signature or URL was altered (e.g. via a `plugins.updater.channels`
      override build); the app must refuse the download ("signature" error) and
      stay on N. (CI already refuses to publish such a manifest.)
- [ ] Key backup recorded (step 2).

Until every box is ticked, `docs/release/launch-gates.json` keeps XR-LAUNCH-008
below `green` and the release stays labelled **Public beta**.
