# XR 1.1.0: withdrawn tag (not published)

**Status:** withdrawn. No public channel serves 1.1.0. The public version is
**1.0.0** (`release.manifest.json` → `channels.publicVersion`).

## What happened (evidence)

- `v1.1.0` was tagged at `776d6f67`. Release workflow run **38663173550**
  failed in its first job (`gates`, step "Identity + claim + channel gates", exit 2).
  Every downstream job was skipped, so 1.1.0 has **no** npm package, GHCR image,
  CLI binaries, `SHA256SUMS`, Homebrew formula, WinGet or Scoop manifest.
- The desktop workflow separately created a GitHub release `v1.1.0` with five
  desktop-only assets. It was marked as GitHub's "Latest", so links to
  "latest" and the bootstrap installers (which then installed whatever the
  manifest version was) pointed at a release that had no CLI assets
  (launch audit XR-LAUNCH-001/002).
- The Supply Chain tag ⇔ npm invariant went red because tag `v1.1.0` has no npm
  `1.1.0` (run 39588225502).

## Resolution (Phase 1, launch audit)

- `v1.1.0` is listed in `channels.withdrawnTags`. The tag ⇔ npm invariant excuses
  it, and **fails** if 1.1.0 ever appears on npm. The tag is not deleted or moved.
- The installers, README and website pin the public version (1.0.0).
- Owner action: `gh release edit v1.1.0 --prerelease` so that `v1.0.0` is
  GitHub's "Latest" again. `bun run channel:live` fails until this is done.
- The desktop artifacts on the `v1.1.0` release remain available as a
  **pre-release** for testing. They are not a supported channel.

The 1.1.0 line continues on `main`. It will be published as a new tag only through
the promotion runbook in [CHANNELS.md](../CHANNELS.md#promotion-runbook-moving-publicversion-forward).
