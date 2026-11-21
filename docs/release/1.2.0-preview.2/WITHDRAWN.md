# XR 1.2.0-preview.2: withdrawn tag (not published)

**Status:** withdrawn. Nothing was built or published for 1.2.0-preview.2. The public version is
**1.0.0** (`release.manifest.json` → `channels.publicVersion`). Preview 2's changes ship in
**1.2.0-preview.3**.

## What happened (evidence)

- `v1.2.0-preview.2` was tagged at `08a04cd`, after all six required checks had passed on that commit.
- Release workflow run **44917320963** failed in its first job (`gates`). The step "Behavioral security +
  deterministic agent smoke (real Linux isolation required)" reported `unshare=false,bwrap=false`: the job ran
  `bun run security:check` on a stock runner, without the Linux isolation that `ci.yml`'s Truth gate provisions
  first (NEW-12 in `HARDENING_LOG.md`). Every build, signing and publishing job was skipped.
- So 1.2.0-preview.2 has **no** GitHub release or draft, CLI binaries, `SHA256SUMS`, npm version, Docker image or
  channel manifest.
- The desktop workflow's tag run **44917320668** stopped at its signing preflight, because no signing secrets are
  provisioned. No desktop bundle was attached anywhere.
- The jobs that did run on the tag passed: every clean-machine journey and the whole supply chain.

## Resolution

- `v1.2.0-preview.2` is listed in `channels.withdrawnTags`. `validateReleaseTag` refuses to release it again, and the
  tag ⇔ npm invariant fails if it ever appears on npm. The tag is not deleted or moved.
- The release gates now provision the same Linux isolation as the Truth gate. The asset-completeness gate finds the
  private draft a tag push prepares (NEW-13).
- The next tag is `v1.2.0-preview.3`, and it too prepares a verified private draft only. Promoting it is the owner's
  decision.
