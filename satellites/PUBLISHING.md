# Publishing the satellites

Phase 5 extracted two packages from XR core ([ADR-0028](../docs/adr/0028-satellite-extraction.md)).
They are complete and tested in-tree, but **not yet published** — this is
recorded honestly as row #19 in the [known-limitations register](../docs/security/KNOWN_LIMITATIONS.md).

Until they are published, the install lines printed by `xr enterprise`,
`xr business` and `xr evaluate` describe the intended state, not a fetchable
package. Publishing is a maintainer action requiring npm and GitHub credentials
this branch does not have.

---

## 1. Create the standalone repositories

```bash
# from the xr checkout
cd satellites/xr-enterprise

git init
git add -A
git commit -m "feat: extract XR Enterprise from xr core (ADR-0028)

Organization policy, delegated authority, audit export/retention, SLOs,
incidents, supply-chain response, disaster recovery, release/support,
certification evidence, deployment profiles and the evaluation harness.

Extracted from ahmadrrrtx/xr at Phase 5. 23,393 LOC source, 634 tests.
Core imports nothing from this package (enforced in xr CI three ways)."

gh repo create ahmadrrrtx/xr-enterprise --public \
  --description "XR Enterprise — governance, operability and the evaluation harness for @rrrtx/xr"
git remote add origin git@github.com:ahmadrrrtx/xr-enterprise.git
git branch -M main
git push -u origin main
```

Repeat for `satellites/business-os` → `ahmadrrrtx/business-os`.

## 2. Verify each package in isolation

Do this **before** publishing. The point of extraction is that these stand alone.

```bash
cd satellites/xr-enterprise
bun install
bun run typecheck
bun test                    # expect 634 pass
npm pack --dry-run          # inspect the file list
```

```bash
cd satellites/business-os
bun install
bun run typecheck
bun test                    # expect 65 pass
npm pack --dry-run
```

## 3. Publish

```bash
npm publish --access public   # in each package dir
```

Both declare `"@rrrtx/xr": ">=1.0.0"` as a **peer** dependency, so npm will warn
rather than install a second copy of core.

> **Order matters.** Publish `@rrrtx/xr` 1.0.0 first. The satellites' peer range
> points at it, and the relocation notices in core tell users to install it.

## 4. Verify the round trip

```bash
cd "$(mktemp -d)"
bun add @rrrtx/xr @rrrtx/xr-enterprise
xr-enterprise evaluate run --offline
xr enterprise               # should still print the relocation notice, exit 2
```

The last line is the one people forget. Core's notice must stay correct **after**
the satellite exists — it points to the package, it does not shell out to it.

## 5. Close the loop in core

Once both are on npm:

1. Delete row #19 from `docs/security/KNOWN_LIMITATIONS.md`.
2. Note the publication in `CHANGELOG.md` under the release that ships the
   relocation shims.
3. Leave the shims in place until **2.0.0** (Art. XXVII: announce → warn →
   migrate → remove). They are the migration.

---

## Why the satellites live in `satellites/` right now

Keeping them in-tree until they are published means the extraction is
**verifiable**: `bun run boundaries`, `test/architecture/boundaries.test.ts` and
`test/architecture/satellite-isolation.test.ts` all prove core imports nothing
from them, on every PR, today. Deleting them from core before the repos exist
would have made that claim unfalsifiable and risked losing the code.

They are excluded from the npm tarball (`package.json#files`), and the release
workflow asserts it:

```bash
bun run scripts/consumer-smoke.ts --tarball dist/rrrtx-xr-1.0.0.tgz
```

After step 1 succeeds, `satellites/` can be removed from core in a follow-up PR
that also drops the tarball allowlist entries it no longer needs.
