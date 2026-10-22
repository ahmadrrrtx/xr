# XR Support Matrix (current — regenerated at every release gate change)

**Rule (Constitution Art. XIX/XX + "supported means validated"):** a platform or
channel appears here only with the exact CI evidence that validates it.
`partial` is never rounded up to `supported`. If evidence is missing, the
status says so — silently degrading at action time is a defect, report it via
the [false-claim template](../../.github/ISSUE_TEMPLATE/false_claim.yml).

**Release label: Public beta** (owner decision D2, 2026-10-22). The label stays
until every gate in [launch-gates.json](launch-gates.json) is green with evidence;
`bun run claim-lint` enforces it on the README, this page and the website.

## Platform tiers (agent runtime)

| Platform | Tier | Validated by | Evidence |
|---|---|---|---|
| Linux x64 (glibc) | **Tier 1 — primary** | full unit suite (239 files), typecheck, golden path, nightly golden path, first-task survey, deb install test, binary smoke | `ci.yml`, `cross-platform.yml`, `nightly.yml`, `channel-install.yml` |
| Linux arm64 | Tier 2 | canonical build cross-compiles + container path linux/arm64; full-suite parity pending a native arm runner | `release.yml` matrix (build-only, smoke skipped — recorded) |
| macOS arm64 | **Tier 1** | typecheck + full unit suite (239 files, POSIX-compatible) + golden path on every push/PR; binary build + native smoke in release matrix | `cross-platform.yml`, `release.yml` |
| macOS x64 (Intel) | Tier 2 | canonical build cross-compiles; native smoke unavailable on arm64 runners (recorded honestly) | `release.yml` |
| Windows x64 | **Tier 1*** | typecheck + unit suite (234 files; 5 documented exclusions with reasons) + golden path on every push/PR; binary build + native smoke; winget/scoop manifest binding tests | `cross-platform.yml`, `channel-install.yml`, `test/platform/exclusions.json` |
| Windows ARM64 | **unverified** | file authority accepts arm64 (same LLP64 layouts as x64) behind a once-per-process FFI self-test that fails closed; **Bun 1.3.14 (the pinned CLI runtime) disables `bun:ffi` on native windows-aarch64** (oven-sh/bun#28055, fixed by #33696), so CLI file tools report `unsupported` there until the pin is raised; the desktop sidecar is compiled with Bun 1.4.2, which should carry the fix — unverified until the lane is green. No hardware run. | `windows-arm64.yml` (`windows-11-arm`, native Bun, not a required check) |
| Termux (Android) | Tier 3 | installer path only (community) | `install.sh` termux branch |

\* The full-parity Windows/macOS jobs are introduced by Phase 9; the first green
runs land with the Phase-9 merge. The suite's own OS-guards (playwright skips,
bwrap detection) keep it honest — a test may skip, never fake-green.

Exclusions (the *only* files not executed per OS; each must carry a reason and a
`since` tag, guarded by `bun run platform:parity:check` in CI):
Linux: none · macOS: none · Windows: `crash-injection.test.ts`,
`policy-gate-adversarial.test.ts`, `cli-spine.test.ts`,
`update-uninstall.test.ts` (POSIX signal/path semantics) and
`binary-smoke.test.ts` (`bun build --compile` panics on Windows hosted runners —
Bun runtime defect; the Windows binary is still built + natively smoke-tested by
`release.yml` and `channel-install.yml`).

## Distribution channels (install/update/uninstall)

Every public channel serves **v1.0.0** (`channels.publicVersion`;
see [CHANNELS.md § Public version](CHANNELS.md#public-version)). `v1.1.0` is a
withdrawn tag: its release pipeline failed before publishing, and it is not served
by any channel. "Live status" is what `bun run channel:live` reported on
2026-10-22. It is re-checked daily by `.github/workflows/channel-live.yml`.

| Channel | Platform | Live status (v1.0.0) | Install validation | Update/rollback |
|---|---|---|---|---|
| Bootstrap installer `install.sh` | Linux x64/arm64 · macOS arm64/x64 · WSL; Termux/musl via verified source | ✅ live | pinned release, `SHA256SUMS`-verified, fails closed with nothing installed (`test/release/installer-behavior.test.ts`, 11 behaviour cases); clean-HOME install of the real v1.0.0 verified on Linux x64 (sandbox, 2026-10-22); macOS clean-HOME smoke in `channel-live.yml` (**added, first CI run pending**) | re-run the installer / `xr update` |
| Bootstrap installer `install.ps1` | Windows x64 (PowerShell 5.1/7+) | ✅ live | pinned release, `Get-FileHash` against `SHA256SUMS`, fails closed; pwsh 7.4 parse + function tests on Linux (`installer-powershell.test.ts`); Windows clean-profile smoke in `channel-live.yml` (**added, first CI run pending**) | re-run the installer / `xr update` |
| GitHub release binary | linux-x64/arm64, darwin-arm64/x64, windows-x64 | ⚠️ assets live; `v1.1.0` must be marked pre-release (owner action) so `v1.0.0` is "Latest" | 9 required assets + signed `SHA256SUMS` (`channel:live`); release-matrix native smoke | `xr update` — atomic swap, sha256-verified, canary + auto-rollback |
| npm (`@rrrtx/xr`) | any OS with **Bun ≥ 1.3** on `PATH` (the package's launcher is `#!/usr/bin/env bun`) | ✅ live (`latest` = 1.0.0) | release workflow publish with OIDC provenance; artifact E2E (`test/reliability/artifact-e2e.test.ts`) | `xr update` (from the next release on): registry check, delegated `npm i -g` / `bun add -g`, installed version verified, previous version re-installed on mismatch; `xr update --check` reports only. **1.0.0's own `xr update` fails on npm installs** — run `npm i -g @rrrtx/xr@latest` once. Packed-tarball smoke: `npm-pack-smoke` job (Linux/macOS/Windows) |
| Docker (`ghcr.io/ahmadrrrtx/xr`) | linux/amd64+arm64 | ✅ live (`:1.0.0` == `:latest`) | image build + trivy scan every PR; cosign-signed digest at release | bare-version tags (`:1.0.0`, `:1.0`, `:latest`) — there is no `v`-prefixed tag |
| Scoop (release asset `xr.json`) | Windows x64 | ✅ live | manifest hash = signed `SHA256SUMS` (`channel:live`); weekly real install of the public version (`channel-install.yml`) | `scoop update xr` / `scoop install xr@<prev>` |
| .deb (release asset) | Debian/Ubuntu x64 | ✅ live | **real `dpkg -i` install, `md5sums` verify, smoke, and `dpkg -r` removal on every PR**; weekly real install of the public version | `apt-get install --only-upgrade xr` / pinned downgrade (delegated) |
| Homebrew (`ahmadrrrtx/tap`) | macOS arm/x64 · Linux x64/arm64 | ⏳ **not live** — the tap repository does not exist yet (owner action, then **Publish Channels**) | formula stamped from signed sums and verified before publish (`channel-publish-verify.ts`); `brew install` + `brew test` on macOS in `publish-channels.yml` and weekly in `channel-install.yml` | `brew upgrade xr` / `brew install xr@<prev>` (delegated by `xr update`) |
| WinGet (`ahmadrrrtx.XR`) | Windows x64 | ⏳ **not live** — first submission to `microsoft/winget-pkgs` pending (owner action via **Publish Channels**, then moderator review) | manifests verified against signed sums before `wingetcreate submit` | `winget upgrade ahmadrrrtx.XR` / `winget install ... --version <prev>` |
| git checkout / source | contributor | ✅ (`git clone --branch v1.0.0`) | full CI floor | `git fetch` + atomic swap (Phase-1 contract) |

Known v1.0.0 behaviour: on a machine without Bun, the setup wizard that the
installers run at the end reports Bun as missing and exits non-zero. The
installers report this as "setup wizard reported issues" and still finish; the
compiled binary itself does not need Bun.

**Deferred channels (recorded, not claimed):** `.rpm` (needs rpmbuild toolchain
in CI for structural validation — tracked) and Snap (needs snapcraft — tracked).
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
