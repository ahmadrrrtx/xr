# XR Support Matrix (current — regenerated at every release gate change)

**Rule (Constitution Art. XIX/XX + "supported means validated"):** a platform or
channel appears here only with the exact CI evidence that validates it.
`partial` is never rounded up to `supported`. If evidence is missing, the
status says so — silently degrading at action time is a defect, report it via
the [false-claim template](../../.github/ISSUE_TEMPLATE/false_claim.yml).

**Generated section (XR-LAUNCH-011/022):** the *Launch journeys* table below is
rendered by `scripts/support-matrix.ts` from clean-machine journey evidence
(`docs/release/evidence/*.json`, CI artifacts `journey-evidence-*`) and the
claimed-target list `docs/release/support-targets.json`; the Quality Gate fails
if it is edited by hand or stale. The narrative tables after it describe the
CI lanes per platform; where they disagree, the generated table wins.

**Release label: Public beta** (owner decision D2, 2026-10-22). The label stays
until every gate in [launch-gates.json](launch-gates.json) is green with evidence;
`bun run claim-lint` enforces it on the README, this page and the website.


<!-- BEGIN GENERATED: journey matrix (scripts/support-matrix.ts) — do not edit by hand -->

## Launch journeys — generated from gate evidence

One row per claimed target (ledger §2.1). ✅ = a journey record passed that step (**CI** = hosted-runner run, **LR** = local run on real hardware); ➖ = explicitly de-scoped (reason below); ⏳ = no evidence yet; ❌ = the latest evidence failed. ¹ = non-gating (reported only, decision D7).
Regenerate with `bun run support-matrix` after copying journey evidence into `docs/release/evidence/`; CI checks this block is current (`--check`).

| Surface | Target | Build | Package | Install | Launch | Core-agent smoke | Update | Uninstall | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| npm CLI | Linux x64 | ✅ LR | ✅ LR | ✅ LR | ✅ LR | ✅ LR | ✅ LR | ✅ LR | LR 14e0d4c5 |
| npm CLI | Linux arm64 | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | — |
| npm CLI | macOS arm64 | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | — |
| npm CLI | macOS x64 | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | — |
| npm CLI | Windows x64 | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | — |
| npm CLI | Windows ARM64 ¹ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | — |
| Installer binary | Linux x64 | ✅ LR | ✅ LR | ✅ LR | ✅ LR | ✅ LR | ✅ LR | ✅ LR | LR 14e0d4c5 |
| Installer binary | Linux arm64 | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | — |
| Installer binary | macOS arm64 | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | — |
| Installer binary | macOS x64 | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | — |
| Installer binary | Windows x64 | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | — |
| Installer binary | Windows ARM64 ¹ | ➖ [1] | ➖ [1] | ➖ [1] | ➖ [1] | ➖ [1] | ➖ [1] | ➖ [1] | — |
| Desktop | Linux x64 (.deb) | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ➖ [2] | ⏳ | — |
| Desktop | Linux x64 (AppImage, .rpm) | ⏳ | ⏳ | ➖ [3] | ➖ [4] | ➖ [5] | ➖ [2] | ➖ [6] | — |
| Desktop | Windows x64 (NSIS) | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ➖ [2] | ⏳ | — |
| Desktop | Windows ARM64 (NSIS) ¹ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ➖ [2] | ⏳ | — |
| Desktop | macOS arm64 (dmg) | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ➖ [2] | ⏳ | — |
| Desktop | macOS x64 (dmg) | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ➖ [2] | ⏳ | — |
| Docker/GHCR | linux/amd64 | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ➖ [7] | ⏳ | — |
| Docker/GHCR | linux/arm64 | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ➖ [7] | ⏳ | — |
| VS Code extension | Marketplace / VSIX | ➖ [8] | ➖ [8] | ➖ [8] | ➖ [8] | ➖ [8] | ➖ [8] | ➖ [8] | — |

[1] no compiled windows-arm64 release asset; install.ps1 installs the verified source archive there — use the npm CLI row (decision D4)  
[2] desktop auto-update needs the XR-LAUNCH-008 updater signing key (owner-provisioned)  
[3] the journey installs the .deb flavour; AppImage/.rpm Build/Package evidence is the desktop journey's -appimage record (artifact presence + sha256)  
[4] same binary as the .deb row; not separately launched  
[5] same engine sidecar as the .deb row  
[6] not separately exercised (see install)  
[7] containers are updated by pulling a new tag; no in-place update path  
[8] no Phase 3 journey (proposed de-scope, owner to confirm); not to be advertised until it has its own journey  

Launch gate (`--require-complete`): **incomplete** — 94 gating cell(s) without evidence or failing.

<!-- END GENERATED: journey matrix -->

## Platform tiers (agent runtime)

| Platform | Tier | Validated by | Evidence |
|---|---|---|---|
| Linux x64 (glibc) | **Tier 1 — primary** | full unit suite (every test file), typecheck, golden path, nightly golden path, first-task survey, deb install test, binary smoke | `ci.yml`, `cross-platform.yml`, `nightly.yml`, `channel-install.yml` |
| Linux arm64 | Tier 2 | canonical build cross-compiles + container path linux/arm64; full-suite parity pending a native arm runner | `release.yml` matrix (build-only, smoke skipped — recorded) |
| macOS arm64 | **Tier 1** | typecheck + full unit suite (the same files as Linux) + golden path on every push/PR; binary build + native smoke in release matrix | `cross-platform.yml`, `release.yml` |
| macOS x64 (Intel) | Tier 2 | canonical build cross-compiles; native smoke unavailable on arm64 runners (recorded honestly) | `release.yml` |
| Windows x64 | **Tier 1*** | typecheck + unit suite (every file except the Windows exclusions below, each with a reason) + golden path on every push/PR; binary build + native smoke; winget/scoop manifest binding tests | `cross-platform.yml`, `channel-install.yml`, `test/platform/exclusions.json` |
| Windows ARM64 | **unverified (non-gating)** | file authority accepts arm64 (same LLP64 layouts as x64) behind a once-per-process FFI self-test that fails closed. The CLI runtime pin is now **Bun 1.4.2** (decision D4), the first line that ships oven-sh/bun#33696 (`bun:ffi` on native windows-aarch64) — so file tools should work natively, but this is unverified until `windows-arm64.yml` and the Windows ARM64 journey legs are green. No hardware run; reported, never gating (D7). | `windows-arm64.yml`, `journey.yml` (`windows-11-arm`, native Bun) |
| Termux (Android) | Tier 3 | installer path only (community) | `install.sh` termux branch |

\* "Tier" is the support level XR commits to. This page does not record whether
the latest macOS/Windows parity run is green; that is the `cross-platform.yml`
run history, and the generated journeys table above is the launch evidence. The
suite's own OS-guards (playwright skips, bwrap detection) keep it honest — a test
may skip, never fake-green.

Exclusions — the *only* files not executed on an OS — live in
[`test/platform/exclusions.json`](../../test/platform/exclusions.json): a pattern,
a reason and a `since` tag per entry, all POSIX-only by construction (signal and
path semantics, the POSIX policy corpus, `bun build --compile` on hosted Windows).
Linux and macOS run every file; Windows skips only those. `bun run
platform:parity:check` (part of `bun run ci`) prints the per-OS file counts —
they are not copied here, and `claim-lint` rejects a hand-typed count on this
page (XR-LAUNCH-022).

## Distribution channels (install/update/uninstall)

Every public channel serves **v1.0.0** (`channels.publicVersion`;
see [CHANNELS.md § Public version](CHANNELS.md#public-version)). `v1.1.0` is a
withdrawn tag: its release pipeline failed before publishing, and it is not served
by any channel. "Live status" is what `bun run channel:live` reported on
2026-10-22. It is re-checked daily by `.github/workflows/channel-live.yml`.

| Channel | Platform | Live status (v1.0.0) | Install validation | Update/rollback |
|---|---|---|---|---|
| Bootstrap installer `install.sh` | Linux x64/arm64 · macOS arm64/x64 · WSL; Termux/musl via verified source | ✅ live | pinned release, `SHA256SUMS`-verified, fails closed with nothing installed (`test/release/installer-behavior.test.ts`: the fail-closed cases plus one case per environment combination of `XR_INSTALL_DIR`, `XR_HOME` and `HOME`, XR-LAUNCH-025); clean-HOME install of the real v1.0.0 verified on Linux x64 (sandbox, 2026-10-22); macOS clean-HOME smoke in `channel-live.yml` (**added, first CI run pending**) | re-run the installer / `xr update` |
| Bootstrap installer `install.ps1` | Windows x64 (PowerShell 5.1/7+) | ✅ live | pinned release, `Get-FileHash` against `SHA256SUMS`, fails closed; pwsh 7.4 parse + function tests on Linux, including the install-dir/profile/launcher rules per environment combination (`installer-powershell.test.ts`; no full Windows install run, known-limitations row #28); Windows clean-profile smoke in `channel-live.yml` (**added, first CI run pending**) | re-run the installer / `xr update` |
| GitHub release binary | linux-x64/arm64, darwin-arm64/x64, windows-x64 | ⚠️ assets live; `v1.1.0` must be marked pre-release (owner action) so `v1.0.0` is "Latest" | 9 required assets + signed `SHA256SUMS` (`channel:live`); release-matrix native smoke | `xr update` — atomic swap, sha256-verified, canary + auto-rollback |
| npm (`@rrrtx/xr`) | any OS with **Bun ≥ 1.3** on `PATH` (the package's launcher is `#!/usr/bin/env bun`) | ✅ live (`latest` = 1.0.0) | release workflow publish with OIDC provenance; artifact E2E (`test/reliability/artifact-e2e.test.ts`) | `xr update` (from the next release on): registry check, delegated `npm i -g` / `bun add -g`, installed version verified, previous version re-installed on mismatch; `xr update --check` reports only. **1.0.0's own `xr update` fails on npm installs** — run `npm i -g @rrrtx/xr@latest` once. Packed-tarball smoke: `npm-pack-smoke` job (Linux/macOS/Windows) |
| Docker (`ghcr.io/ahmadrrrtx/xr`) | linux/amd64+arm64 | ✅ live (`:1.0.0` == `:latest`) | image build + trivy scan every PR; from the next release the image is Debian slim (glibc) and CI runs `xr --version` plus a file read/write smoke in it (XR-LAUNCH-020; not built locally, first CI run pending); cosign-signed digest at release | bare-version tags (`:1.0.0`, `:1.0`, `:latest`) — there is no `v`-prefixed tag |
| Scoop (release asset `xr.json`) | Windows x64 | ✅ live | manifest hash = signed `SHA256SUMS` (`channel:live`); weekly real install of the public version (`channel-install.yml`) | `scoop update xr` / `scoop install xr@<prev>` |
| .deb (release asset) | Debian/Ubuntu x64 | ✅ live | **real `dpkg -i` install, `md5sums` verify, smoke, and `dpkg -r` removal on every PR**; weekly real install of the public version | `apt-get install --only-upgrade xr` / pinned downgrade (delegated) |
| Homebrew (`ahmadrrrtx/tap`) | macOS arm/x64 · Linux x64/arm64 | ⏳ **not live** — the tap repository does not exist yet (owner action, then **Publish Channels**) | formula stamped from signed sums and verified before publish (`channel-publish-verify.ts`); `brew install` + `brew test` on macOS in `publish-channels.yml` and weekly in `channel-install.yml` | `brew upgrade xr` / `brew install xr@<prev>` (delegated by `xr update`) |
| WinGet (`ahmadrrrtx.XR`) | Windows x64 | ⏳ **not live** — first submission to `microsoft/winget-pkgs` pending (owner action via **Publish Channels**, then moderator review) | manifests verified against signed sums before `wingetcreate submit` | `winget upgrade ahmadrrrtx.XR` / `winget install ... --version <prev>` |
| VS Code extension (`.vsix`) | VS Code 1.85+ (local daemon) | ⏳ **not published** — preview; not listed on the Marketplace or Open VSX, and no release has a `.vsix` attached yet (owner runs `publish-vscode.yml`) | typecheck, tests and `vsce package` in the Quality Gate; durable pairing across daemon restarts tested against a real daemon (XR-LAUNCH-034, known-limitations row #27) | install a newer `.vsix` |
| git checkout / source | contributor | ✅ (`git clone --branch v1.0.0`) | full CI floor | `git fetch` + atomic swap (Phase-1 contract) |

Known v1.0.0 behaviour: on a machine without Bun, the setup wizard that the
installers run at the end reports Bun as missing and exits non-zero. The
installers report this as "setup wizard reported issues" and still finish; the
compiled binary itself does not need Bun.

**Deferred channels (recorded, not claimed):** an agent-runtime (CLI) `.rpm`
(needs the rpmbuild toolchain in CI for structural validation — tracked) and Snap
(needs snapcraft — tracked). The desktop app's `.rpm` bundle is a different
artifact: it is a desktop package, listed in the generated table above.
They land only when install tests exist; see the known-limitations register.

**Flatpak (Phase 27):** the desktop shell now ships a Flathub-ready manifest
(`packaging/flatpak/`), AppStream metainfo and the permissions it needs written
out one by one, plus a desktop entry that carries the `xr://` scheme and
`StartupWMClass`. This is a *desktop shell* package, not an agent-runtime
channel: its manifest, desktop entry and AppStream metadata are validated on
every PR that touches `packaging/**`, and a full `flatpak-builder` run — which
needs the GNOME runtime and, for Flathub, vendored sources — is wired to
`workflow_dispatch` in `.github/workflows/desktop-app.yml`. It has not been built
or installed in this repository's CI yet, and is recorded that way in
[DESKTOP-SUPPORT-MATRIX.md](DESKTOP-SUPPORT-MATRIX.md) rather than here.

## Uninstall

`xr uninstall` removes only the marked `# >>> XR launcher >>>` … `# <<< XR launcher <<<`
block the installer appended to shell startup files (plus the legacy single line
from older installers). Ubuntu-default `.profile`, `.bashrc` and `.zshrc` fixtures
are byte-identical after install → uninstall (`test/reliability/uninstall-rc.test.ts`,
Linux; the macOS lane runs the same suite in `cross-platform.yml`).

## Support contract

- `xr doctor` exit codes and the golden path hold on every Tier 1 platform.
- Security/isolation guarantees follow `docs/release/7.0.1/known-limitations.md`
  §1: policy gate on all platforms; bubblewrap/namespace confinement is
  Linux-only and honestly probed (`xr env capabilities --json`).
- Every channel's checksums come from the same signed `SHA256SUMS`
  (one canonical build, many channels). A channel binding different bytes
  fails `channel:check`.
