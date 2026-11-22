# Desktop signing, notarization and updates — owner runbook

Current candidate: **1.2.0-preview.4 / public beta**, 2026-11-21.
**No OS signing material exists for this project.** By owner decision
(2026-11-21) preview tags ship **unsigned** desktop installers; a stable tag
still requires the owner's signing material and is NOT READY.

# # Enforced policy (supersedes historical unsigned-tag behavior)

* Ordinary development/PR builds may be clearly **UNSIGNED development**
  artifacts. Raw Apple/Windows/updater private signing values are tag-only
  environment inputs, not PR values. Presence flags are not signatures.
* **Stable desktop tags** (a version without a pre-release suffix) require valid
  macOS Developer ID + notarization and Windows Authenticode prerequisites.
  Missing owner material blocks early, before expensive native builds. Removing
  a certificate is not a way to publish an unsigned stable tag.
* **Preview tags** (`x.y.z-…`, read from the committed release identity) may
  ship **unsigned** installers. Owner decision, 2026-11-21: there is no budget
  for certificates. The switch is `UNSIGNED_PREVIEW_INSTALLERS` in
  `scripts/desktop-signing-plan.ts`. Windows installers carry no Authenticode
  signature. The macOS app is **ad-hoc sealed** (`signingIdentity: "-"`,
  hardened runtime off) and never notarized; the bundle job checks the seal with
  `codesign --verify --deep --strict` on the `.app` and inside every `.dmg`.
  Integrity comes from the cosign-signed `DESKTOP-SHA256SUMS` and the GitHub
  build-provenance attestation, not from an OS signature. Half-provisioned
  material still fails a preview tag: an Apple certificate without the
  notarization secrets, a Windows certificate without a valid thumbprint, or a
  committed updater public key without its private key.
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

# # Installing an unsigned preview (users)

Check the download first. The checksum list is signed, the installer is not:

```bash
shasum -a 256 -c DESKTOP-SHA256SUMS --ignore-missing     # macOS / Linux
cosign verify-blob --bundle DESKTOP-SHA256SUMS.bundle \
  --certificate-identity "https://github.com/ahmadrrrtx/xr/.github/workflows/desktop-app.yml@refs/tags/<tag>" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com DESKTOP-SHA256SUMS
```

On Windows, `Get-FileHash <file> -Algorithm SHA256` prints the hash to compare.

* **Windows** — SmartScreen shows "Windows protected your PC". Click
  **More info**, then **Run anyway**. The publisher reads "Unknown publisher".
* **macOS 15 (Sequoia) and later** — open the app once; macOS refuses it. Then
  open **System Settings → Privacy & Security**, scroll to the message about
  XR, click **Open Anyway** and confirm with your password. You do this once
  per installed version.
* **macOS 14 and earlier** — Control-click (right-click) XR in Applications,
  choose **Open**, then **Open** again.
* **Terminal alternative (macOS)**, only after the checksum matched:
  `xattr -dr com.apple.quarantine /Applications/XR.app`
* **Linux** — packages are never OS-signed; the checksum and the cosign
  signature are the check. Install the `.deb` or `.rpm`, or make the
  `.AppImage` executable (`chmod +x`).

# # Free signing options (owner, researched 2026-11-21)

* **Windows — SignPath Foundation** (signpath.org): free code signing for
  open-source projects. The repository's MIT licence is OSI-approved. The
  certificate is issued to "SignPath Foundation", so that is the publisher
  Windows shows. The key stays in SignPath's HSM, and signing runs from GitHub
  Actions (`signpath/github-action-submit-signing-request`), with a manual
  approval for every release. The terms require: the software already released
  in the form to be signed, its functionality described on the download page,
  MFA for every team member, a code-signing-policy section with the attribution
  line, a privacy statement, and "a certain verifiable reputation". Projects
  with little public visibility have been refused, so apply after Preview 4 has
  been public for a while (stars, downloads, mentions). Signed binaries still
  build SmartScreen reputation over time.
* **Windows — Azure Artifact Signing** (formerly Trusted Signing): US$9.99 a
  month, and individuals qualify only in the USA and Canada.
* **Windows — commercial certificates**: since June 2023 the private key must
  live in a hardware or cloud HSM, so no downloadable `.pfx` is issued any more.
  The cloud services cost roughly US$100–300+ a year, and this workflow's
  `.pfx` import cannot use them as written (NEW-16 in `HARDENING_LOG.md`).
* **macOS**: there is no free way to notarize. A Developer ID certificate and
  notarization need the Apple Developer Program (US$99 a year). Ad-hoc sealing,
  which previews use, is free; it only turns "damaged" into "unidentified
  developer".
* **Linux**: nothing to buy; checksums plus cosign.

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

Presence-only blocker. With a preview identity and no material it exits 0 and
prints the unsigned-preview notice; with a stable identity it exits 1:

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

WiX accepts a numeric version, not a semver pre-release: Tauri's bundler
refused `1.1.1-rc.1` ("optional pre-release identifier in app version must be
numeric-only"), blocking the preview `.msi`. `bundle.windows.wix.version` is
therefore DERIVED from the release identity by `scripts/release-manifest.ts`
(`tauri-conf` surface) instead of being typed by hand:

| identity | MSI product version |
|---|---|
| `1.1.1-rc.1` | `1.1.0.1` |
| `1.1.1-rc.2` | `1.1.0.2` |
| `2.1.0-beta.3` | `2.0.65535.3` |
| `2.0.0-rc.1` | `1.255.65535.1` |
| `1.1.1` (stable) | field removed — the bundler derives `1.1.1` |

**This is not proof of safe upgrades.** [Windows Installer compares only the
first three fields](https://learn.microsoft.com/en-us/windows/win32/msi/productversion),
so it sees `1.1.0`, `1.1.0.1` and `1.1.0.2` as the same ProductVersion. The
preview sorts below `1.1.1`, but the mapping does not establish an upgrade
from the previous stable or between RCs, nor does it prevent all downgrades.
A reviewed versioning/installation policy and actual native upgrade/rollback
tests remain prerequisites; do not publish on the strength of this mapping.
Major/minor are bounded to 255 and the build/revision fields to 65535.

The override is installer metadata only: the application, `latest.json` and
every other surface keep reporting the real identity. `bun run release:check`
fails if the committed value drifts from the manifest.

The separately built, test-signed **MSIX** is not a production artifact.
MSIX requires four numeric fields, so its test packaging maps both
`1.1.1-rc.1` and `1.1.1` to `1.1.1.0`. This intentionally does not establish
upgrade ordering or a release policy. The real Windows SDK packer and signer
remain the native validation; Linux regressions use fake SDK processes only.

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
