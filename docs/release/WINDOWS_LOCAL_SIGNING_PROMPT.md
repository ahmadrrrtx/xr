# Owner prompt: Windows-local signing with Antigravity

Use the **actual PR head commit/run URL** supplied in the GitHub handoff, not an
unverified branch name or an arbitrary downloaded installer. This is a local
owner-controlled procedure, not proof that this Linux assistant signed Windows.

Antigravity can orchestrate approved terminal commands on your Windows machine;
its permission modes do not supply a code-signing certificate or confer publisher
trust. Keep **Request Review** for sensitive host/certificate/signing operations,
not Turbo/Always Proceed. [3](https://antigravity.google/docs/settings/)

Authenticode requires an appropriate certificate/private-key provider. SignTool
supports explicit certificate selection and verification; SHA-256 plus an
RFC3161 timestamp is the intended policy. [2](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)
[8](https://learn.microsoft.com/en-us/windows/win32/seccrypto/time-stamping-authenticode-signatures)

## Paste the following into Antigravity on Windows

```text
You are helping me, the owner of ahmadrrrtx/xr, sign Windows artifacts LOCALLY.
Do not publish, push, create/retag releases, merge PRs, upload certificates,
change account settings, or change production release gates.

Inputs I must supply/confirm before you proceed:
- The exact reviewed PR head COMMIT_SHA and GitHub Actions run URL.
- Whether I want a local build of that commit or an exact CI artifact.
- The Windows architecture and an owner-approved output folder outside Git.
- An existing legitimate code-signing certificate/key provider, or confirmation
  that none is available. My GitHub username/token is NOT a signing identity.

Safety rules:
1. Keep Request Review for installation, certificate access, private-key use,
   timestamp network access, signing and any command outside the workspace.
   If the sandbox blocks certificate-store/HSM access, request approval for the
   specific host command; do not switch globally to Turbo or bypass policies.
2. Do not ask for or print a GitHub PAT, PFX password, PIN, private key, exported
   PFX or Windows credentials. Do not put any secret in argv, repo/config,
   terminal history, transcripts, environment files or uploaded artifacts.
3. Never export a private key. Use an already-installed CurrentUser\My
   certificate/HSM provider by an explicitly approved public thumbprint.
   Hardware PINs/passwords stay in an owner-operated OS/provider dialog.
4. Do not create a self-signed certificate and call it production trusted.
   If no valid production-capable certificate/private key is available, stop
   with BLOCKED and explain the missing certificate/provider. Do not disable
   Defender, SmartScreen, Secure Boot, certificate validation or test-signing
   restrictions to manufacture a pass.
5. Preserve my existing workspace, installed XR application, CLI home, desktop
   home and profiles. No reset/clean/force push, automatic uninstall, recursive
   ownership change or credential-store deletion. Stop on unrelated changes.

Phase A — read-only inventory and provenance:
- Show git status and the exact current commit. If the workspace is dirty or
  is not COMMIT_SHA, stop and ask; use a separate clean worktree if I approve.
- Read the repository's release manifest, .bun-version, .rust-version,
  docs/release/RELEASE_CANDIDATE_REPORT.md, DESKTOP_SIGNING.md,
  VERIFICATION_COMMANDS.md, and the Windows bundle steps in desktop-app.yml.
- Inventory installed Bun/Rust/MSVC/Windows SDK/WebView2 and machine resources.
  Do not upgrade/install tools or download model weights without approval.
- Find the installed Microsoft SDK SignTool of the correct architecture;
  record its path/version. Do not download an executable from an unverified
  shortcut URL or run an arbitrary signing script.
- If using a CI artifact, verify its repository, workflow, head SHA, run
  conclusion and artifact/archive digest against the real GitHub metadata.
  Development CI artifacts are not automatically publisher-authenticated.
  A filename or an unsigned checksum alone is not sufficient provenance.
  Do not reuse an artifact from a different commit/OS/architecture.

Phase B — certificate readiness (public metadata only):
- Enumerate only candidate CODE SIGNING certificates in Cert:\CurrentUser\My.
  Check HasPrivateKey, validity dates and the Code Signing EKU
  1.3.6.1.5.5.7.3.3. Inspect public Subject/Issuer/Thumbprint only.
- Confirm the publisher identity and selected thumbprint with me explicitly.
  Do not assume the legal certificate subject is my GitHub nickname.
- Check the certificate chain/trust and revocation using supported Windows/
  issuer tools. If the key is on hardware, confirm the supported CSP/KSP and
  let me approve its use/PIN locally. Missing access or unverifiable trust is
  BLOCKED, not a reason to export a key or skip verification.
- Ask me to approve the CA-supported RFC3161 timestamp endpoint. Prefer a
  supported HTTPS endpoint. Do not silently replace a failing timestamp server.

Phase C — use the project's existing signing path:
- Prefer building from the reviewed exact commit with frozen root/desktop
  lockfiles, dependency scripts disabled for install, and one Cargo build job.
  Inspect the pinned Tauri CLI help before selecting supported flags.
- Compile the standalone sidecar using scripts/compile-sidecar.ts. The source
  handoff fixes real Windows process.platform=win32 native target selection;
  do not rename a foreign-platform binary to .exe.
- Use a PRIVATE TEMPORARY Tauri configuration overlay, not a tracked edit to
  tauri.conf.json. The project already has scripts/desktop-signing-plan.ts.
  After actual certificate readiness is confirmed, its public thumbprint and
  a local presence flag may configure Windows signing without exporting PFX.
  A planner/presence flag is NEVER proof of a valid signature.
- An untagged local PR build must not be described as a tagged release. Do not
  invent a Git tag or set flags claiming a missing updater/private key exists.
  Leave the updater unprovisioned unless the owner separately provisions it.
- For a supported certificate-store signer, use the Windows configuration
  certificateThumbprint/digestAlgorithm=sha256/timestampUrl overlay with the
  existing Tauri build/bundle pipeline, so application/sidecar payloads are
  signed before they are packaged and MSI/NSIS installers are signed afterward.
  Inspect the actual generated signing command/config before authorizing it.
  Do not sign only an outer installer and assume its embedded executables
  were signed, or modify payloads after packaging without rebuilding installers.
- Do not use SignTool /p PASSWORD or a secret-bearing command string. Explicit
  thumbprint selection is intended; avoid /a auto-selection choosing a wrong
  certificate. If an issuer requires a custom HSM command, inspect its official
  instructions and ask me before configuring the existing signCommand hook.
- If signing exact already-built CI outputs instead, preserve their unsigned
  inputs and hashes, sign copies only, and verify embedded payload signatures.
  If payloads are unsigned and cannot be correctly rebuilt/repackaged from the
  reviewed commit, stop instead of claiming an installer is fully validated.

Phase D — verify actual outputs, then optional owner-approved smoke:
- Limit production outputs to supported .exe/.dll/.msi and NSIS/MSI bundle
  payloads from this build. Do not distribute the test-signed MSIX/test .cer,
  development portable outputs or any credential material as production.
- Verify EVERY relevant app/sidecar/installer with both:
    signtool verify /pa /all /v /tw <exact-file>
    Get-AuthenticodeSignature -LiteralPath <exact-file>
  Require success/Valid, the owner-approved signer thumbprint/subject, an
  appropriate trusted chain, and a cryptographically verified timestamp.
  Treat warnings, missing timestamps, unknown/revoked trust or unavailable
  verification as FAIL/BLOCKED; do not hide nonzero exits.
- Do not Authenticode-sign a ZIP/hash list and pretend it signs its contents.
  Verify the executable contents, then hash the final signed archive/installer.
- Verify the embedded app/engine release identity matches COMMIT_SHA's manifest.
- Only after I approve installation, use a clean test account and a dedicated
  absolute XR_DESKTOP_HOME. Test install, GUI startup/engine health, a safe
  disposable-workspace action, close/reopen, preservation and uninstall.
  Do not touch my existing valuable app data. Do not infer macOS/Linux/update
  lifecycle success from a Windows signing test.

Phase E — receipts, not publication:
- Write LOCAL_WINDOWS_SIGNING_RECEIPT.json and WINDOWS-LOCAL-SHA256SUMS in the
  approved output folder outside Git. Record commit/run/artifact identity,
  pre/post-signing hashes, target architecture, public signer thumbprint,
  timestamp evidence, tool versions, exact nonsecret commands/exits and
  per-file PASS/FAIL/BLOCKED. Leave unavailable fields null, not invented.
- Signing changes bytes. Never reuse the unsigned pre-signing hash or overwrite
  the project's published/signed SHA256SUMS with locally signed bytes.
- Do not upload outputs anywhere without separate owner review/approval.
- Report local Authenticode results separately from overall release readiness.
  Local signing does NOT automatically satisfy this repository's GitHub
  production signing/provenance/native-CI gates. A hardware-only local key may
  need a separately reviewed external-signing workflow; do not weaken gates or
  mark missing GitHub signing secrets as provisioned to make CI green.
- Stop and show my next required action if any step cannot be verified.
```

## Current project-specific caveats

The release remains developer-preview. A successful local Windows signature does
not supply macOS notarization, updater signatures, production GitHub provenance,
installer/update validation on every supported platform, or stable channel
coherence. Keep local signed outputs separate until an owner-approved workflow
accepts and independently verifies them.

Project configuration options and certificate-store integration are described
in the official [Tauri Windows signing guide](https://v2.tauri.app/distribute/sign/windows/).
Its historical examples are not permission to export this owner's key, paste a
password into a command, use floating CI actions, or bypass the current project's
tighter policy. The prompt deliberately requires review and store/HSM signing.
