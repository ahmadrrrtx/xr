# XR version history (the ladder)

This is the **honest** map of names XR has worn. It exists so a git tag, an
npm version, and a README badge cannot silently disagree.

Nothing here is a capability claim. Historical 3.x / 4.x / 7.x tags are
**out of band** for the 1.x tag ⇔ npm invariant (`scripts/tag-npm-invariant.ts`).

| Line | What it was | npm | git tags | Status |
|---|---|---|---|---|
| **0.2.x** | First published package | `0.2.0` on npm | none matching | historical |
| **3.x** | Pre-rebaseline published line | `3.0.0`–`3.0.3`, **`3.1.5` = npm `latest` today** | `v3.0.0` | **stale `latest`** — semver-sorts *above* 1.0.0, so the first 1.0.0 publish must re-point `latest` explicitly |
| **4.x** | Internal line, not an npm channel | not on npm as 4.x | `v4.3.0`, `v4.5.0` | historical / out of band |
| **7.x** | Pre-rebaseline source (7.1.0 = the 1.0.0 codebase) | **never published as 7.x** | `v7.0.0` (no `v7.1.0`) | historical / out of band |
| **1.0.0** | Deliberate semver rebaseline of 7.1.0 ("Truth") | **not on npm yet** | **no `v1.0.0` / `v1.0.0-beta.1` tag yet** | Public Beta in source. Phase 3 publishes `1.0.0-beta.1` to the npm `beta` dist-tag. Stable `1.0.0` + `latest` repoint wait for P2. |

## Dist-tags (operator, not CI)

`3.1.5` remaining on `latest` is **intentional until stable 1.0.0**. Auto-repointing
`latest` to a `1.0.0-beta.*` would ship a prerelease to every `npm i @rrrtx/xr`
user. The repair commands are print-only in CI:

```bash
bun run scripts/tag-npm-invariant.ts --repair
# then, as the package owner, after the stable 1.0.0 publish:
npm dist-tag add @rrrtx/xr@1.0.0 latest
```

See [`docs/release/RELEASING.md`](release/RELEASING.md).

---

## Structural ladder (what the repo *was*, phase by phase)

The table above tracks version identity. This one tracks **shape** — so a reader
who finds a moved module knows when and why it moved.

| Phase | Landed | Structural change |
|---|---|---|
| P0–P2 | 2026-06 → 08 | Truth reset · one execution envelope (ADR-0002) · one tool registry (ADR-0003) · enforced boundaries (ADR-0005) |
| P3 | 2026-08 | Artifact truth — signed per-target distribution (ADR-0022), one canonical build → many channels (ADR-0023) |
| P4 | 2026-09 | Evidence integrity — Ed25519-signed audit chain (F-08); CI repair |
| **P5** | **2026-09** | **Scope shrink & naming truth** — `src/enterprise` + `extensions/business-os` extracted to satellites ([ADR-0028](adr/0028-satellite-extraction.md)); scanner renamed `shield`→`hygiene` and the boundary named ([ADR-0027](adr/0027-xr-shield-is-the-enforcement-boundary.md)); `docs/CONSTITUTION.md` published; core **154,426 → 130,742 LOC** |

### Where things went in Phase 5

| Was | Is |
|---|---|
| `src/enterprise/**` | `@rrrtx/xr-enterprise` (satellite) |
| `src/enterprise/baseline/status.ts` | `src/install/baseline-status.ts` — **repatriated to core**, it was never enterprise code |
| `extensions/business-os/**` | `@rrrtx/business-os` (satellite) |
| `src/security/shield.ts` | `src/hygiene/scanner.ts` (+ re-export shim until 2.0.0) |
| — | `src/xr-shield/` — the enforcement boundary, named at last |
| — | `docs/CONSTITUTION.md` — the law, previously cited from nowhere |

Full migration guide: [`docs/migration/PHASE-5-SATELLITES.md`](migration/PHASE-5-SATELLITES.md).
