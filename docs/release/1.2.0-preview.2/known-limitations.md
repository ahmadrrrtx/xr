# XR Preview 2 — known limitations

Version `1.2.0-preview.2` · public beta · called **XR Preview 2** everywhere a person reads it.

Preview 2 continues the `1.2.0-preview` line; the [Preview 1 page](../1.2.0-preview.1/known-limitations.md)
explains why that line is not 0.x. Preview 2 is a stabilization release. It fixes the defects and security
findings of the external audit (B1–B20, C1–C18), each with a regression test, and adds no features. The
evidence ledger, item by item, is [`HARDENING_LOG.md`](../../../HARDENING_LOG.md).

This page lists what does **not** work in Preview 2. The authoritative register with owners,
expiry dates and evidence links is
[`docs/security/KNOWN_LIMITATIONS.md`](../../security/KNOWN_LIMITATIONS.md).

## Distribution

- **GitHub pre-release only, and only after owner promotion.** The `v1.2.0-preview.2` tag builds the
  release, signs its checksums with cosign (keyless) and verifies it as a private draft. It becomes a
  public GitHub pre-release only when the owner promotes it. Preview 2 is not published to npm,
  Homebrew, WinGet, Scoop or Docker: the npm registry carries `1.0.0` as `latest` plus retired `3.x`
  versions, and the installers keep installing `1.0.0`.
- **Builds are unsigned.** Windows SmartScreen and macOS Gatekeeper will warn. No code-signing
  certificate is part of this release. The cosign signature on the release checksums is not an OS
  code signature.
- **No automatic upgrade from 1.0.0.** The updater never moves anyone down a version, and Preview 2
  is a pre-release, so installing it is a deliberate choice. Back up `~/.xr` first.
- **The live check of the public channels is red.** `bun run channel:live` fails because the retired
  npm versions 3.0.0, 3.0.1, 3.0.2, 3.0.3 and 3.1.5 carry deprecation messages that point to `@beta`
  instead of `@latest`. Correcting them needs the package owner's npm credentials
  (`bun run npm:ghosts -- --print-commands` prints the commands).

## Desktop uninstall data

Preview 2 is intended to remove the installed desktop binaries and registration on uninstall
while preserving the desktop engine home (`~/.xr-desktop`, or `XR_DESKTOP_HOME` when set).
The Windows installer workflow tests this with an isolated sentinel; this does not assert that
OS-managed settings or keychain credentials are deleted or preserved. Current installer
lifecycle evidence remains pending until a matching build runs successfully.

## Agent command execution

- **Windows and macOS: sandbox only for agent shell.** The canonical shell requires a wired isolated
  execution backend; the compatibility host fallback is blocked even if hardened mode is off. Docker/
  Podman availability is not by itself proof that a particular command is isolated. macOS Seatbelt is
  experimental; Windows AppContainer is disabled pending per-execution SID/ACL lifecycle verification.
- **Computer control is unavailable on Windows and macOS.** Direct OS automation, screenshot capture
  and system-control tools are not wired to an isolated backend and refuse rather than execute with
  host authority. Linux behavior is unchanged; this is not a claim that every other possible
  subprocess is sandboxed.
- **Windows command execution is Experimental** unless the Windows-runner evidence in the readiness
  report says otherwise.
- **Linux** uses the kernel namespace sandbox (`unshare`). Where `bwrap` is absent, the
  bwrap-based tests skip rather than pass; skips are listed, never counted as passes.

## Models and providers

- **Two hosted presets ship without price facts.** XR refuses to run a model it cannot price
  (unpriced is never free) and stops with its own `unpriced` state, never as a budget stop. Every
  hosted preset's default model is priced from the provider's official page except **Hugging Face**
  (the router bills each routed provider's own rate, so there is no single price) and **AWS
  Bedrock** (its default still maps to a retired Claude id; current Claude models are reachable only
  through inference profiles, which the Bedrock adapter does not address yet). Both need an
  operator-declared rate under `providerEngine.providerCapabilities.<provider>.models.<model>.cost`;
  the refusal message names that path. See `docs/budget-semantics.md`.
- **A shell-exported API key is not used by default.** The secret broker ignores ambient
  `process.env`; use `xr onboarding`, or set `XR_SECRETS_ENV_COMPAT=1` to opt into shell-profile
  keys (with a boot warning).
- **Live provider quality is only lightly verified.** Preview 1 included one real provider run
  (Groq) as part of its release checks; Preview 2 adds none. That is a smoke test, not a quality claim.

## Updates on Windows

- **One npm update failure on Windows is not explained yet.** In one CI journey on a windows-latest
  runner, `xr status --json` exited 1 right after `xr update --yes` on an npm install. It has not
  recurred in later runs, and its cause is unknown (logged as NEW-3, npm mode, in the hardening log).

## Platforms

Linux x64 and Windows x64 are the targets; macOS is best-effort. Per-platform tiers are in
[`docs/release/SUPPORT_MATRIX.md`](../SUPPORT_MATRIX.md).

## MicroVM isolation

Firecracker and Kata are **detection hooks only**. Orchestration is not implemented; when a backend
is absent the policy fails closed. No page of this release may present them as working.

## Not verified in this release

Recorded as NOT RUN rather than assumed:

- Windows installer install/uninstall, tray behaviour and global hotkeys on a real Windows machine.
- macOS native run and signing.
- Voice input with a real microphone.
- Computer-control and vision agent on Windows.
- Any performance or quality comparison against another agent on the same task and model.
- Any run on physical hardware: the desktop and CLI journeys of this release ran on CI runners only.

The readiness report states, per item, what was verified, with which command, and what was not.

## Code health (recorded, deliberately not changed)

- **`src/state/workspace-store.ts` is 2,518 lines** (its size waiver allows 2,550). It is the largest
  module in the tree, and it owns the audit chain, the workspace database and the migration path.
  Preview 2 kept it from growing rather than refactoring it in a stabilization release.

## Chat history

- **No archived-chats list.** Archiving a conversation would hide it with no way back — both
  session queries filter `archived = 0`, and an archived list needs a Rust query change — so the
  Archive action and its "coming soon" button stay withdrawn. Deleting a session remains available
  and asks first.
