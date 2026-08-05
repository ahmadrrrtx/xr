# Channel Authoring Guide (Phase 9)

One canonical build → many channels. Every channel file is **generated** by
`scripts/channel-manifest.ts` from `release.manifest.json`; never edit
generated files by hand — `bun run channel:check` fails CI on drift, and the
release stamps real checksums from the signed `SHA256SUMS`.

## Channel anatomy

| Channel | Template (committed, version/URL only) | Stamped at release (checksums) | Manager |
|---|---|---|---|
| Homebrew | `packaging/homebrew/xr.rb` | `dist/channels/homebrew/xr.rb` | `brew` |
| WinGet | `packaging/winget/manifests/r/ahmadrrrtx/XR/<v>/` (3 files) | `dist/channels/winget/...` | `winget` |
| Scoop | `packaging/scoop/xr.json` | `dist/channels/scoop/xr.json` | `scoop` |
| .deb | built by `scripts/build-deb.ts` | the artifact itself (signed via sums) | `dpkg`/`apt` |
| npm | `package.json` (stamped surface) | registry provenance | `npm`/`bun` |
| Docker | `Dockerfile` | GHCR digest + cosign signature | `docker` |

Templates carry **no checksums** (none exist pre-build). Stamping
(`channel-manifest.ts --stamp --sums dist/SHA256SUMS`) binds every channel to
the signed canonical build and **fails closed** when any required artifact is
missing from the sums — a channel can never point at unsigned bytes.

## Adding a channel (the checklist)

1. Add the descriptor/generator to `scripts/channel-manifest.ts` (single
   authority) emitting version + canonical-url fields.
2. Add rendering + stamping tests to `test/release/channels.test.ts`
   (including fail-closed cases).
3. Add an install-validation path to `.github/workflows/channel-install.yml`
   — a channel without an install test is **not shippable** ("supported"
   means validated).
4. Extend `src/update/channels.ts` detection + rollback/uninstall semantics
   for the new manager, with effect tests in `test/update/channels-update.test.ts`.
5. Update `docs/release/SUPPORT_MATRIX.md` and README's install table
   (status column must match CI evidence).

## Publishing topology

- **Homebrew tap** (`ahmadrrrtx/homebrew-tap`): release workflow pushes the
  stamped formula (operator opt-in: `HOMEBREW_TAP_PUBLISH` + scoped token).
  Without it, the stamped formula ships as a release asset and installs with
  `brew install --formula <path>`.
- **WinGet community repo** (`microsoft/winget-pkgs`): submission is a PR from
  the stamped manifests (`wingetcreate` flow) — external review applies;
  interim install = `winget install --manifest dist/channels/winget/...` on
  release assets.
- **Scoop**: user-side `scoop install <release-asset-scoop/xr.json>` works
  today; a project bucket repo can mirror the generated manifest later.
- **Debian**: the `.deb` works with `dpkg -i` directly (no self-hosted apt
  repository this phase — recorded honestly in the support matrix).

## Update/rollback contract (per channel, Art. XXIII)

`xr update` detects the manager (`src/update/channels.ts`) and delegates with
the Phase-1 contract: config backup → manager upgrade → health canary → on
failure, dispatch the channel's own pinned downgrade:

| Channel | Upgrade | Rollback to previous |
|---|---|---|
| homebrew | `brew upgrade xr` | `brew install xr@<prev>` |
| scoop | `scoop update xr` | `scoop install xr@<prev>` |
| winget | `winget upgrade ahmadrrrtx.XR -e` | `winget install ahmadrrrtx.XR --version <prev> --force` |
| apt | `apt-get install --only-upgrade xr` | `apt-get install xr=<prev> --allow-downgrades` |
| npm | `npm i -g @rrrtx/xr@latest` | `npm i -g @rrrtx/xr@<prev>` |
| binary (default) | verified download + atomic swap | previous binary restored by the swapper (auto-rollback) |
| git | fetch + clone-slot | previous checkout restored (Phase-1) |

Forced-failure rollback is tested per channel
(`test/update/channels-update.test.ts`).
