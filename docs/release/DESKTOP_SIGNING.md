# Desktop signing, notarization and updates — owner runbook

Current candidate: **1.1.1-rc.1 / developer-preview**, 2026-10-27.
**No production signing material or native-platform signing result was supplied
in this workspace. Public preview/stable publication is NOT READY.**

# # Enforced policy (supersedes historical unsigned-tag behavior)

* Ordinary development/PR builds may be clearly **UNSIGNED development**
  artifacts. Raw Apple/Windows/updater private signing values are tag-only
  environment inputs, not PR values. Presence flags are not signatures.
* **Every desktop tag candidate**, including preview tags, requires valid
  macOS Developer ID + notarization and Windows Authenticode prerequisites.
  Missing owner material blocks early, before expensive native builds. Removing
  a certificate is not a way to publish an unsigned tag.
* A tag with a committed updater public key also requires its private signing
  key. Missing/wrong signatures fail. If no updater is provisioned, updating
  remains explicitly disabled; no fake working updater/feed is published.
* Native bundles remain private workflow artifacts until build, native unit,
  installed GUI/engine/agent and journey gates pass. Production installers are
  architecture-qualified; test MSIX/test certificates/development portable
  outputs are excluded from production collection.
* The final desktop aggregate includes collection and applicable tag signing/
  provenance jobs. Desktop attachments are **PRIVATE draft only**. Public
  promotion is separately owner-triggered in the existing Release workflow,
  with same-tag/same-commit completed native CI evidence, independent signed
  artifact verification, supply chain and CLI journeys.
* Repo environments must be configured by the owner: `desktop-signing`,
  `release-promotion`, `npm-publish`, `release-channels`. Merely naming them in
  YAML is NOT proof that required reviewers/tag restrictions exist.

# # Owner secrets — configure directly in GitHub, never in chat or source

| Name | Purpose |
|---|---|
| `APPLE_CERTIFICATE` | base64 Developer ID Application p12 |
| `APPLE_CERTIFICATE_PASSWORD` | p12 password |
| `APPLE_SIGNING_IDENTITY` | Developer ID identity |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | notarization account/app-specific password/team |
| `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD` | Authenticode pfx and password |
| `TAURI_UPDATER_KEY`, `TAURI_UPDATER_KEY_PASSWORD` | matching Tauri updater private key/password, only after public-key provisioning |
| `TAP_GITHUB_TOKEN` | Homebrew tap only, minimum repository scope |
| `WINGET_TOKEN` | owner-authorized WinGet fork/PR account |
| `NPM_TOKEN` | separately authorized stable dist-tag operations; trusted npm publication itself uses OIDC |

The planner receives booleans/public thumbprints, not key contents. Windows
imports a private temporary pfx into the runner store and removes the file in
`finally`; the command line carries a public thumbprint, not its password.
No owner key/certificate was generated, inspected, committed or handled by this
agent. Treat runner/dependency code allowed to sign as trusted code; enforce
protected refs/reviewers and short-lived/minimal account privileges.

Presence-only blocker (expected exit1 with this workspace's absent material):

```bash
bun scripts/desktop-signing-plan.ts --preflight --tag true
```

This is **not** an actual signature verification. The real platform steps run:
macOS `codesign --verify --deep --strict`, `spctl --assess`, `stapler validate`;
Windows `signtool verify /pa /v`. A green Linux renderer, fixture crypto test,
planner or pure Rust module cannot replace these.

# # Native artifacts and provenance

The existing desktop workflow collects only production installer/updater
payload types, rejects links/credential artifacts/orphan signatures and prevents
arm/intel app.tar.gz overwrite. It writes `DESKTOP-SHA256SUMS` and the combined
locked application inventory, signs/verifies them with exact tag workflow
identity, attests the checksum subject and verifies exact workflow/ref/source
commit via GitHub attestation verification. This is implemented automation,
not a claim that it executed for the uncommitted candidate.

CLI release proofs are separate `SHA256SUMS`/cosign/SLSA subjects. CLI binaries
are authenticated by those release proofs, not inferred desktop OS signatures.
See [verification](VERIFYING_RELEASES.md) and [current evidence](RELEASE_CANDIDATE_REPORT.md).

# # Windows MSI version for pre-release tags

MSI (WiX) product versions are four numeric fields, so a semver pre-release
cannot be expressed: Tauri's bundler refuses `1.1.1-rc.1` ("optional pre-release
identifier in app version must be numeric-only"), which blocked the preview
tag's `.msi` while the NSIS installer built fine. `bundle.windows.wix.version`
is therefore DERIVED from the release identity by `scripts/release-manifest.ts`
(`tauri-conf` surface) instead of being typed by hand:

| identity | MSI product version |
|---|---|
| `1.1.1-rc.1` | `1.1.0.1` |
| `1.1.1-rc.2` | `1.1.0.2` |
| `2.1.0-beta.3` | `2.0.65535.3` |
| `1.1.1` (stable) | field removed — the bundler derives `1.1.1` |

The mapping steps the patch down and uses the pre-release counter as the build
field, so a pre-release sorts below the release it precedes (installing the
stable over the RC is an upgrade, not a downgrade) and above the previous
release. It is installer metadata only: the application, `latest.json` and every
other surface keep reporting the real identity. `bun run release:check` fails if
the committed value drifts from the manifest.

# # Updates and lifecycle

Current updater pubkey/endpoints are unprovisioned. Keep that state until the
owner commits the real public key/channel endpoints and executes a signed
update between different installed versions, signature/key-swap negatives,
data preservation, interruption/recovery and compatible rollback. Never put a
preview on the stable/default feed. The workflow no longer automatically
mutates a rolling beta feed merely because a tag exists.

The source native journey now pins an absolute scratch XR_DESKTOP_HOME,
passes it through WebDriver and the installed engine, reinstalls the same
version and checks retained data/version before uninstall. **That source was
not executed on GUI platforms here and same-version reinstall is not a
cross-version/automatic-update PASS.** CLI binary/npm synthetic next-version
journeys were executed locally and are separately scoped in the report.

Manual updates require authenticated artifacts of the same product/channel and
safe data backup while closed. Desktop engine home is independent of CLI;
OS-store namespace changes when that home moves. Re-enter credentials as needed.
Sealed-file backup contains a nearby key; do not describe it as protection
against complete home compromise or as a portable OS-keychain export.
