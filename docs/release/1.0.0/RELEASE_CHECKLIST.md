# XR 1.0.0 — Release Checklist

**Release identity:** `@rrrtx/xr` **1.0.0 "Truth"** (deliberate semver rebaseline of 7.1.0) · stability `public-beta`.
**Runbook:** [`docs/release/LAUNCH_HANDOFF.md`](../LAUNCH_HANDOFF.md) · **Do not tag/publish without explicit maintainer authorization.**

## A. Verified in-sandbox (2026-08-13, Bun 1.3.14, Linux x64)

| # | Check | Status |
|---|---|---|
| A1 | `bunx tsc --noEmit` (strict) | ✅ PASS |
| A2 | Full `bun test` (239 files) | ✅ 2938 pass / 13 skip / 0 fail |
| A3 | Golden path (`bun run golden-path`) | ✅ ok:true, chain valid |
| A4 | `release:check` | ✅ 6/6 surfaces in sync at 1.0.0 |
| A5 | `channel:check` | ✅ 5 channel configs in sync |
| A6 | `changelog:check` | ✅ §1.0.0 present |
| A7 | `claim-lint` | ✅ 10 evidenced claims, 0 unsupported |
| A8 | `platform-parity --validate` | ✅ 239 files · linux 239 · darwin 239 · win32 234 |
| A9 | `baseline:inventory` | ✅ regenerated at docs/release/1.0.0/ |
| A10 | `api:schema:check` + `client:check` + `api:compat` | ✅ |
| A11 | `boundaries` + `size-gate` + `ownership:check` + `hot-path-lint` | ✅ |
| A12 | `perf:baseline` + `perf:gate` + `profile:gate` + `unit-tier` | ✅ all budgets met |
| A13 | `license-check` + `sbom` | ✅ 53 pkgs clean; SBOM written |
| A14 | `.deb` build + real `dpkg -i` + smoke + `md5sum` verify + `dpkg -r` | ✅ (v1.0.0) |
| A15 | Website marketplace check (`website:marketplace:check`) | ✅ 67 items |
| A16 | All 7 workflow YAML files parse | ✅ |

## B. Cross-platform CI (must run on GitHub-hosted runners)

| # | Check | Status |
|---|---|---|
| B1 | `Cross-Platform CI` — Linux (reference) | ⏳ pending CI re-run (root causes fixed: CF-1) |
| B2 | `Cross-Platform CI` — macOS | ⏳ pending CI re-run (root causes fixed: CF-2) |
| B3 | `Cross-Platform CI` — Windows | ⏳ pending CI re-run (root causes fixed: CF-3) |
| B4 | `CI` — all lanes + Quality Gate | ⏳ pending push |
| B5 | `channel-install.yml` — .deb / brew / winget-scoop | ⏳ pending push |

## C. Maintainer-only publication (requires credentials; NOT done here — RULE 15)

| # | Action | Command / location |
|---|---|---|
| C1 | GPG/SSH-signed tag | `git tag -s v1.0.0 -m "XR 1.0.0 (Truth)"` |
| C2 | Push tag | `git push origin main v1.0.0` (triggers `release.yml`) |
| C3 | npm publish | `npm publish --access public --otp <otp>` |
| C4 | **Re-point `latest`** (3.1.5 sorts > 1.0.0) | `npm dist-tag add @rrrtx/xr@1.0.0 latest` |
| C5 | GitHub Release body | from `docs/release/1.0.0/RELEASE_NOTES.md` |
| C6 | cosign/Rekor proof | verify + close KNOWN_LIMITATIONS #6 |
| C7 | Channel publication (brew tap / GHCR / winget) | release.yml, operator-gated |

## D. Known limitations carried into 1.0.0 (honest, owned)

See `docs/security/KNOWN_LIMITATIONS.md` (canonical) and
`docs/release/1.0.0/known-limitations.md` (frozen excerpt). Highlights: no independent
pentest (#5), env-hydrated provider keys (#4), cosign/Rekor proof pending first tag (#6),
no rpm/snap (#12), no enterprise identity (#8).

**Verdict:** code-complete and green on Linux; release-blocking work is (1) the Windows/macOS
CI confirmation and (2) the maintainer publication steps in section C.
