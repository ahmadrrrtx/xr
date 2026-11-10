# XR Preview 1 — known limitations

Version `1.2.0-preview.1` · public beta · called **XR Preview 1** everywhere a person reads it.

> **Why 1.2.0-preview.1 and not 0.1.0.** Plan section 3/D4 asked for `0.1.0-preview.1` with a
> documented fallback to `1.2.0-preview.1`. The 0.x line was attempted first and fought the
> release-coherence suite: 16 tests in `test/release`, plus `test/update` and `test/phase0`,
> encode the previous release line's invariants ("1.0.0 stays public", "a pre-release public
> version is rejected", the six-channel live checks), and `release.manifest.json` rejects a
> pre-release `publicVersion` for any channel set wider than GitHub. Re-baselining that suite was
> judged out of proportion to the half-day cap D4 sets, so the documented fallback was taken. The
> public name is unchanged: **XR Preview 1**.

This page lists what does **not** work in Preview 1. The authoritative register with owners,
expiry dates and evidence links is
[`docs/security/KNOWN_LIMITATIONS.md`](../../security/KNOWN_LIMITATIONS.md).

## Distribution

- **GitHub pre-release only.** Preview 1 is not published to npm, Homebrew, WinGet, Scoop or
  Docker. The npm registry already carries `1.0.0` as `latest` plus `3.x` versions; a pre-release
  cannot become `latest` and publishing it beside that line would create a second truth.
- **Builds are unsigned.** Windows SmartScreen and macOS Gatekeeper will warn. No signing
  certificate is part of this release.
- **No automatic upgrade from 1.0.0.** The updater never moves anyone down a version, and Preview 1
  is a pre-release, so installing it is a deliberate choice. Back up `~/.xr` first.

## Desktop uninstall data

Preview 1 is intended to remove the installed desktop binaries and registration on uninstall
while preserving the desktop engine home (`~/.xr-desktop`, or `XR_DESKTOP_HOME` when set).
The Windows installer workflow tests this with an isolated sentinel; this does not assert that
OS-managed settings or keychain credentials are deleted or preserved. Current installer
lifecycle evidence remains pending until a matching build runs successfully.

## Agent command execution

- **Windows and macOS: sandbox only for agent shell.** The canonical shell requires a wired isolated
  execution backend; the compatibility host fallback is blocked even if hardened mode is off. Docker/
  Podman availability is not by itself proof that a particular command is isolated. macOS Seatbelt is
  experimental; Windows AppContainer is disabled pending per-execution SID/ACL lifecycle verification.
- **Computer control is unavailable on Windows and macOS in Preview 1.** Direct OS automation,
  screenshot capture and system-control tools are not wired to an isolated backend and refuse rather
  than execute with host authority. Linux behavior is unchanged; this is not a claim that every other
  possible subprocess is sandboxed.
- **Windows command execution is Experimental** unless the Windows-runner evidence in the readiness
  report says otherwise.
- **Linux** uses the kernel namespace sandbox (`unshare`). Where `bwrap` is absent, the
  bwrap-based tests skip rather than pass; skips are listed, never counted as passes.

## Models and providers

- **Price facts ship for a minority of providers.** XR refuses to run a model it cannot price
  (unpriced is never free). A provider without shipped facts needs an operator-declared rate under
  `providerEngine.providerCapabilities.<provider>.models.<model>.cost`; the refusal message names
  that path. Only openai, anthropic and google currently ship price facts.
- **A shell-exported API key is not used by default.** The secret broker ignores ambient
  `process.env`; use `xr onboarding`, or set `XR_SECRETS_ENV_COMPAT=1` to opt into shell-profile
  keys (with a boot warning).
- **Live provider quality is only lightly verified.** Preview 1 includes one real provider run
  (Groq) as part of the release checks. That is a smoke test, not a quality claim.

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

The readiness report states, per item, what was verified, with which command, and what was not.

## Code health (recorded, deliberately not changed this week)

- **`src/state/workspace-store.ts` is 2,550 lines** — the largest module in the tree, and it owns
  the audit chain, the workspace database and the migration path. `src/clients/daemon-client.generated.ts`
  is 1,529 lines but generated. Plan section 3/D9 says record these and do **not** refactor them
  before the preview: a rewrite of the module everything else depends on, in the same week as the
  first public release, is a risk with no user-visible benefit. It is a maintenance note, not a
  defect, and it is written down here so nobody discovers it by surprise.

## Chat history

- **No archived-chats list.** Archiving a conversation would hide it with no way back — both
  session queries filter `archived = 0`, and an archived list needs a Rust query change — so the
  Archive action and its "coming soon" button are both withdrawn in Preview 1. Deleting a session
  remains available and asks first.
