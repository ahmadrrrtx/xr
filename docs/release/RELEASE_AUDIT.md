# Release identity and distribution audit

Date: 2026-10-26; baseline `e25afd362e80485340a322e60a97a04d41b6bd51`.

## Source-of-truth tuple (verified in checkout)

* `release.manifest.json:identity.version` = **1.1.0**, stability `public-beta`, codename Graphite; authoritative source.
* `channels.publicVersion` = **1.0.0**; intentionally separate from main. Bootstrap `install.sh`/`install.ps1` serve this version. Do **not** advance it just to make a check green.
* Eight stamped targets currently pass `bun run release:check`: npm metadata, runtime module, site identity, README generated region, two installers, Tauri config, Rust package manifest.
* `desktop/package.json` = 1.1.0 and own package entry in Cargo.lock = 1.1.0, but **not covered by stamp targets**. Passing existing check does not detect their future drift.
* Desktop and root Bun lockfiles are independent. Mobile/cloud/satellites version independently by design; do not normalize them to XR's product version. Website product identity is stamped, website package version need not be.
* Historical v7/v4/v3 tags reflect a documented semver rebaseline, not this release's version authority. `v1.1.0` already exists and is withdrawn in manifest; never reuse/rewrite it.

## Public leads checked (read-only network, no account changes)

GitHub public API on audit date lists `v1.1.0` as **draft=false / prerelease=false / 5 assets**, despite the withdrawn-tag register. `v1.0.0` has 21 assets; beta.1 is prerelease. Source: `GET https://api.github.com/repos/ahmadrrrtx/xr/releases?per_page=5`. This confirms an owner-controlled channel problem, not evidence that all install channels are verified. Public action-run summaries for the baseline commit show Supply Chain and Channel Live failure; no new working-tree CI run has been triggered.

The current registry/package-manager artifacts are checked structurally by `channel:check`; that is **not** proof the public channels serve those bytes. Existing `channel:live` must be executed separately before public promotion. Preserve legacy launch findings as history rather than changing their PASS labels retroactively.

## Confirmed release defects / validation gaps

| ID | Type / severity | Evidence | Required implementation |
|---|---|---|---|
| RC-REL-001 | Confirmed version-validation gap, medium | `scripts/release-manifest.ts`, `stampTargets` omit desktop JS package and own Cargo.lock package; `compareSemver` compares prerelease suffix lexically | Extend existing stamper/validator (no parallel version authority), validate locks read-only, semver precedence regression incl. rc.9/rc.10. |
| RC-REL-002 | Confirmed integrity defect, high | `release.yml` builds before assemble rewrites identity from tag; no universal early tag==manifest assertion | Reject mismatched/withdrawn tags **before compile**; remove late mutation. Binaries/tarballs/package versions must derive from the same committed manifest. |
| RC-REL-003 | Confirmed unsafe publication, high | `desktop-app.yml` bundle attaches files to release before journey/metadata gates; signing plan permits unsigned stable tag when no pubkey/cert configured | Build artifacts privately on PR; defer attach to gated draft job; stable platform-signature requirements fail closed; owner-authorized promotion separate from drafting. |
| RC-REL-004 | External blocker, high | Updater pubkey empty and endpoints empty in `tauri.conf.json`; no supplied production certificates/secrets | Keep updater off and document manual updates. Existing signing/verification machinery should be extended, not replaced. Production signing and full update lifecycle BLOCKED pending owner and OS runners. |
| RC-REL-005 | Missing validation, high for stable | Linux local only; native Rust/GTK absent initially; desktop install/update/rollback not run in this session | Minimal toolchain assessment; run possible Linux checks, platform CI evidence required for other targets. Artifact inventory must distinguish CLI, engine, renderer, native installer. |
| RC-REL-006 | Existing cosmetic debt, low | `bun run format:check` in desktop: 375 files fail; lint and build pass | Format touched files with existing Prettier; do not bury security fixes in mass cosmetic rewrite. Record baseline full formatting failure honestly. |

## Channel policy for this candidate

Keep public 1.0.0 unchanged. The existing 1.1.0 tag is unavailable for reuse. Prepare a **new prerelease identity** through the manifest/stamper once implementation is coherent; current stamped candidate `1.1.1-rc.1` (not published or tagged by this audit). Development artifacts identify base commit + dirty status; are not stable releases. Preview semver has a suffix, GitHub draft/prerelease and npm `beta` only. Stable semver requires stability `stable`, release gates, native signatures where applicable, trusted checksums, completed installation evidence and owner authorization. Never silently advance npm `latest`, brew/winget/scoop/docker public versions or stable updater feed from a preview.

Automatic desktop updating is **not currently a supported installed feature**: empty key/feed is intentional disabled state. A preview must not use the stable feed. Owner must provision a real key and separate channel endpoints and demonstrate signed update between two versions before enabling it. Manual update means verify artifact authenticity and reinstall the same product/channel, preserving data; rollback only with compatible state backup (no promise of arbitrary schema downgrade).

## Applicable existing release machinery

`release:stamp/check`, `channel:sync/check/live`, `write-sums`, `verify-release`, `verify-updater-signatures`, SBOM, license checks, signed channel publishing, journeys and cross-platform workflows already exist. Extend them and make a central resource-safe security entry point invoking real checks. No second publishing framework, container platform or paid release service is justified.

## Baseline disposition

**Not ready for public preview or stable** until local critical/high defects are resolved. New source-only changes cannot close owner-controlled release metadata/signing/platform evidence. No tag, push, release or package publication is authorized/executed here.

## Final candidate review — 2026-10-27

Identity is now **1.1.1-rc.1 / developer-preview**, not merely proposed. All10
mandatory product surfaces derive it; canonical stable installers/templates
remain **1.0.0**. A read-only name check found no RC tag/npm version at that
instant; it was not a reservation. No commit/tag/push/publication was performed.

The existing release system was hardened in place: tag push/private draft,
independent signed inventory/SBOM/SLSA verification, complete native gate and
explicit owner-dispatch public promotion. Candidate/beta/version staging does
not move stable defaults; the existing Publish Channels workflow separately
checks signed metadata, exact native CI and immutable bytes/digest before owner
promotion. WinGet no longer downloads an unverified executable or passes PATs
in argv. Cross-registry default changes are not claimed atomic.

Actual local evidence includes standalone engine/cache/authenticated smoke,
CLI binary/npm isolated install→real file effect→synthetic next-version update→
uninstall/profile restoration, tarball identity/scope, Debian extracted payload
byte match and no-global-Bun run, combined official-schema-valid locked inventory
and crypto mutation negatives. Debian version is derived1.1.1~rc.1, correctly
below stable1.1.1; no independent release identity or swallowed bogus write.

These do NOT prove native installer/GUI/update/keychain behavior or production
publisher authenticity. Local strict verification intentionally returned exit1
when real signatures/provenance were absent, while byte integrity passed.
Signing preflight and GTK3/WebKit4.1 prerequisites are explicit BLOCKED results.
Native same-version reinstall source is not a historical/automatic-update pass.
The renderer still has large-chunk/dynamic-import warnings, and the source tree
is close to its unchanged LOC ceiling; both are disclosed rather than waived.

Recommendation remains **NOT READY for public preview or stable** pending owner/
platform gates. Locally verified development source is suitable for engineering
review; publishing/install-default changes are owner actions only. The withdrawn
public1.1.0 repair is still outstanding and was not silently performed here.
