# Channel Authoring Guide (Phase 9)

> **Current candidate authority (2026-10-27):** development1.1.1-rc.1 is not
> published; public defaults remain1.0.0. Tag pushes prepare only private drafts.
> Explicit owner publication stages beta/candidate/version artifacts; default
> promotion is separately owner-dispatched in Publish Channels, with exact
> signed metadata bytes/native CI/immutable registry proof. Preview never moves
> stable/latest/updater defaults. See [current verification](VERIFYING_RELEASES.md)
> and [candidate report](RELEASE_CANDIDATE_REPORT.md); these supersede historical
> automatic tag-publication assumptions below.


One canonical build → many channels. Every channel file is **generated** by
`scripts/channel-manifest.ts` from `release.manifest.json`; never edit
generated files by hand — `bun run channel:check` fails CI on drift, and the
release stamps real checksums from the signed `SHA256SUMS`.

## Public version

`release.manifest.json` carries two versions on purpose:

| Field | Meaning | Who reads it |
|---|---|---|
| `identity.version` | the line in development on `main` (stamped into `package.json`, the desktop app, the site's "in development" label) | build, release workflow |
| `channels.publicVersion` | the version **every public install path serves today** | `install.sh`, `install.ps1`, the README identity block, the site's "available" label, `bun run channel:live` |

`publicVersion` only moves forward after the new version is verified **live on
every claimed channel** (launch audit XR-LAUNCH-001: v1.1.0 was announced while
no channel served it). Today it is **1.0.0**.

`channels.claimed` lists every channel the project publicly claims.
`bun run channel:live` (scheduled daily by `.github/workflows/channel-live.yml`)
resolves each one against the live registry and fails when any claimed channel
does not serve `publicVersion` with bytes that match that release's signed
`SHA256SUMS`:

| Channel | What is checked |
|---|---|
| `github-releases` | the release exists, is not a draft/pre-release, carries the 9 installer assets, every asset is in `SHA256SUMS`, it is GitHub's "Latest", and every withdrawn tag is a pre-release |
| `npm` | `dist-tags.latest` = publicVersion; no withdrawn version is on the registry |
| `homebrew` | `<tap>/Formula/xr.rb` declares publicVersion; every url is pinned to the tag and its sha256 matches `SHA256SUMS` |
| `winget` | `microsoft/winget-pkgs` has `manifests/a/ahmadrrrtx/XR/<v>/` with the signed `xr-windows-x64.zip` sha256 |
| `scoop` | the release's `xr.json` declares publicVersion and its hash matches `SHA256SUMS` |
| `docker` | `ghcr.io/ahmadrrrtx/xr:<v>` exists and `:latest` has the same digest |

Channels that are claimed but not live yet are shown as ⏳ in the README install
table; `channel:live` stays red until they are live. Fix the channel or the
claim, never the check.

### Withdrawn tags

A tag whose release pipeline failed before anything was published (v1.1.0:
release run 38663173550 failed in its gates job, so no npm/GHCR/CLI assets
exist) is listed in `channels.withdrawnTags` with the evidence. Effects:

- the Supply Chain tag ⇔ npm invariant excuses it from "must exist on npm", and
  **fails** if that version ever appears on npm;
- `channel:live` requires its GitHub release to be marked **pre-release**, so it
  can never be GitHub's "Latest";
- tags are never deleted or moved to make a gate pass.

### Promotion runbook (moving `publicVersion` forward)

1. Tag `vX.Y.Z`; the release workflow must finish green (GitHub assets, npm,
   GHCR, signatures, independent verification).
2. Run **Publish Channels** (`.github/workflows/publish-channels.yml`,
   `version = X.Y.Z`). It downloads `SHA256SUMS` + its cosign bundle, verifies
   the keyless signature, checks every channel file is pinned and matches the
   sums (`scripts/channel-publish-verify.ts`), pushes `Formula/xr.rb` to the tap
   (secret `TAP_GITHUB_TOKEN`), smoke-installs it with `brew` on macOS, and
   submits the WinGet manifests with `wingetcreate` (secret `WINGET_TOKEN`).
3. Run `bun run channel:live --version X.Y.Z` (or the **Channel Live**
   workflow with `version`). Every claimed channel must pass. A brand-new
   WinGet package waits for moderator review of the first PR, which can take days;
   until it merges, either wait or temporarily drop `winget` from `claimed`
   and mark it ⏳.
4. Only then set `channels.publicVersion` to `X.Y.Z`, run
   `bun run release:stamp` (re-stamps the installers, README and site) and
   merge.

Secrets: `TAP_GITHUB_TOKEN` is a fine-grained token with `contents: write` on
`ahmadrrrtx/homebrew-tap` only. `WINGET_TOKEN` is a classic PAT with
`public_repo` (wingetcreate forks `microsoft/winget-pkgs` and opens the PR).
Neither is used by the tag-triggered release workflow.

## Channel anatomy

| Channel | Template (committed, version/URL only) | Stamped at release (checksums) | Manager |
|---|---|---|---|
| Homebrew | `packaging/homebrew/xr.rb` | `dist/channels/homebrew/xr.rb` | `brew` |
| WinGet | `packaging/winget/manifests/a/ahmadrrrtx/XR/<v>/` (3 files) | `dist/channels/winget/...` | `winget` |
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

- **Homebrew tap** (`ahmadrrrtx/homebrew-tap`, installed as
  `brew install ahmadrrrtx/tap/xr`): pushed by **Publish Channels** after the
  release verifies, never by the tag run. The tap repository must exist with
  at least one commit (e.g. a README) before the first publish.
- **WinGet community repo** (`microsoft/winget-pkgs`): **Publish Channels**
  submits `manifests/a/ahmadrrrtx/XR/<v>/` with `wingetcreate submit`; the
  first submission of a new package gets moderator review. Release assets carry
  the three manifest files flat (`ahmadrrrtx.XR.yaml`,
  `ahmadrrrtx.XR.installer.yaml`, `ahmadrrrtx.XR.locale.en-US.yaml`).
- **Scoop**: user-side `scoop install ./xr.json` with the release asset
  `xr.json` works today; a project bucket repo can mirror the generated
  manifest later.
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
