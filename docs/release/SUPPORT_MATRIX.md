# XR Support Matrix (current — regenerated at every release gate change)

**Rule (Constitution Art. XIX/XX + "supported means validated"):** a platform or
channel appears here only with the exact CI evidence that validates it.
`partial` is never rounded up to `supported`. If evidence is missing, the
status says so — silently degrading at action time is a defect, report it via
the [false-claim template](../../.github/ISSUE_TEMPLATE/false_claim.yml).

## Platform tiers (agent runtime)

| Platform | Tier | Validated by | Evidence |
|---|---|---|---|
| Linux x64 (glibc) | **Tier 1 — primary** | full unit suite (239 files), typecheck, golden path, nightly golden path, first-task survey, deb install test, binary smoke | `ci.yml`, `cross-platform.yml`, `nightly.yml`, `channel-install.yml` |
| Linux arm64 | Tier 2 | canonical build cross-compiles + container path linux/arm64; full-suite parity pending a native arm runner | `release.yml` matrix (build-only, smoke skipped — recorded) |
| macOS arm64 | **Tier 1** | typecheck + full unit suite (239 files, POSIX-compatible) + golden path on every push/PR; binary build + native smoke in release matrix | `cross-platform.yml`, `release.yml` |
| macOS x64 (Intel) | Tier 2 | canonical build cross-compiles; native smoke unavailable on arm64 runners (recorded honestly) | `release.yml` |
| Windows x64 | **Tier 1*** | typecheck + unit suite (234 files; 5 documented exclusions with reasons) + golden path on every push/PR; binary build + native smoke; winget/scoop manifest binding tests | `cross-platform.yml`, `channel-install.yml`, `test/platform/exclusions.json` |
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

| Channel | Platform | Install validation | Update/rollback |
|---|---|---|---|
| GitHub release binary (default) | all five targets | nightly beta install survey ≥ 99% (3 OS families) + release-matrix native smoke | `xr update` — atomic swap, sha256-verified, canary + auto-rollback |
| Homebrew (`ahmadrrrtx/tap`) | macOS arm/x64 · Linux x64/arm64 | formula generated + stamped from signed sums (CI); **real `brew install` runs in the weekly channel job after first tagged release** | `brew upgrade xr` / `brew install xr@<prev>` (delegated by `xr update`) |
| Scoop | Windows x64 | manifest generated + verified (CI + weekly real-install job) | `scoop update xr` / `scoop install xr@<prev>` |
| WinGet | Windows x64 | manifests generated + verified (CI); community-repo submission tracked | `winget upgrade ahmadrrrtx.XR` / `winget install ... --version <prev>` |
| .deb | Debian/Ubuntu x64 | **real `dpkg -i` install, `md5sums` verify, smoke, and `dpkg -r` removal on every PR** | `apt-get install --only-upgrade xr` / pinned downgrade (delegated) |
| npm (`@rrrtx/xr`) | any Bun-supported OS | release workflow publish with OIDC provenance; artifact E2E (`test/reliability/artifact-e2e.test.ts`) | `npm i -g @rrrtx/xr@latest` / pinned `@<prev>` (delegated) |
| Docker (`ghcr.io/ahmadrrrtx/xr`) | linux/amd64+arm64 | image build + trivy scan every PR; nightly golden path **inside** the image; cosign-signed digest at release | image tags (`:latest`, `:beta`, semver tags) |
| git checkout / source | contributor | full CI floor | `git fetch` + atomic swap (Phase-1 contract) |

**Deferred channels (recorded, not claimed):** `.rpm` (needs rpmbuild toolchain
in CI for structural validation — tracked) and Snap/Flatpak (needs snapcraft/
flatpak-builder — tracked). They land only when install tests exist; see the
known-limitations register.

## Support contract

- `xr doctor` exit codes and the golden path hold on every Tier 1 platform.
- Security/isolation guarantees follow `docs/release/7.0.1/known-limitations.md`
  §1: policy gate on all platforms; bubblewrap/namespace confinement is
  Linux-only and honestly probed (`xr env capabilities --json`).
- Every channel's checksums come from the same signed `SHA256SUMS`
  (one canonical build, many channels). A channel binding different bytes
  fails `channel:check`.
