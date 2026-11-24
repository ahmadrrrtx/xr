# XR 1.2.0-preview.4: withdrawn tag (not published)

**Status:** withdrawn. Nothing was published for 1.2.0-preview.4. The public version is
**1.0.0** (`release.manifest.json` → `channels.publicVersion`). Preview 4's changes ship in
**1.2.0-preview.5**.

## What happened (evidence)

- `v1.2.0-preview.4` was tagged at `f2569d0`, after all six required checks had passed on that commit.
- Its tag run of the release workflow, **45076830475**, succeeded and prepared a verified private draft
  (release 454793101, 33 assets). The desktop workflow's tag run **45076830152** passed all 20 jobs and attached
  the unsigned desktop installers to that draft.
- On 2026-11-24 the owner started the promotion run: release workflow run **45402937080**, dispatched on the tag
  with `publish=true`. Both of its attempts failed the same way. 37 of 45 jobs passed, including the rebuilt and
  re-signed assets, the verification, the journeys and the exact-tag desktop evidence. Two failed:
  "Vulnerability scan (osv-scanner + bun audit)", at its OSV scanner step, and the "Supply Chain gate" that
  requires it.
- The scanner was right. **RUSTSEC-2026-0594** (GHSA-8wcq-xq25-7fhm), published on 2026-11-23, the day after the
  draft was built, affects `cookie` 0.18.2, which the tag's `desktop/src-tauri/Cargo.lock` locks. `cookie` 0.18.3
  is the fixed version (NEW-19 in `HARDENING_LOG.md`).
- The draft job, the promotion job and the npm, Docker and consumer-smoke jobs depend on that gate, so all 6 were
  skipped. The draft is still a private draft, and there is no public GitHub release, npm version or Docker image
  for 1.2.0-preview.4.
- A promotion run always uses the tag's own workflow and tree. Without moving the tag, which the release policy
  forbids, 1.2.0-preview.4 can never pass this gate again.

## Resolution

- `v1.2.0-preview.4` is listed in `channels.withdrawnTags`. `validateReleaseTag` refuses to release it again, and the
  tag ⇔ npm invariant fails if it ever appears on npm. The tag is not deleted or moved, and its draft stays a
  private pre-release draft.
- The desktop lock now takes `cookie` 0.18.3 (the only change to the dependency tree), and
  `test/supply-chain/cookie-advisory.test.ts` fails on any locked version the advisory covers (NEW-19).
- The next tag is `v1.2.0-preview.5`, and it too prepares a verified private draft only. Promoting it is the owner's
  decision.
