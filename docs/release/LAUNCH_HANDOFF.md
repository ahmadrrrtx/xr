# XR 7.1.0 — Launch Handoff (maintainer runbook)

**Scope:** everything the maintainer (with GitHub/npm credentials — the launch
engineering sandbox has none) must do to cut the signed `v7.1.0` release and
close VALIDATED finding **A-2 / F-3** — npm `@rrrtx/xr` still serves 3.1.5 (4
versions behind), no `v7.1.0` tag exists.

**Verified in-sandbox on `chore/xr-launch-cleanup`:** all 14 local ci-parity
gates PASS at every batch (publisher-parity, binary-attestation, channel-matrix
contracts, SBOM/manifest/attestation refs, homebrew/scoop/winget formulas on
this machine); full `bun test` green throughout the program (latest: **2,795
pass / 13 skip / 0 fail** — 13 live-browser a11y skips); 13/13 check gates
PASS; `bun run baseline:inventory` regenerates clean. Re-run the gate list
below before tagging — the launch-gates checklist lives in
[`../IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) §Launch-gates.

---

## 1. Prepare (local, one command)

```bash
# on the release branch, clean tree
bun install --frozen-lockfile
bun run typecheck && bun test && bun run release:check && bun run channel:check
bash scripts/_prepare-release-handoff.sh   # writes release-handoff/<UTC>/
```

The script already runs each packaging gate and writes its output into the
handoff dir. Review the printout before proceeding.

## 2. Tag + push

```bash
git tag -s v7.1.0 -m "XR 7.1.0 (Truth)"          # GPG/SSH-signed tag
git push origin chore/xr-launch-cleanup v7.1.0   # or merge to main first per repo flow
```

`.github/workflows/release.yml` builds on the tag: linux-x64/arm64/musl,
darwin-arm64(x64), windows-x64(zipped), optics gate per artifact, sqlite-vernal
probe double-run (flaky-network retry), release-notes gate, then **the pinned
attestation step**: `actions/attest-build-provenance@674c6b4a431ff21b8b0b3eb14712d8b1693544cb # v4.0.0`, `subject-path: dist/binaries/**`.

## 3. Verify artifact channels

From the run's artifacts (and the checksums in `release-handoff/<UTC>/`):

```bash
./install.sh --dry-run --channel stable     # what users will resolve
bun scripts/channel-matrix-contracts.ts --release-type production --check
bun scripts/binary-attestation.ts           # provenance record verification
bun scripts/publisher-parity.ts             # brew/scoop/winget formula parity
```

## 4. Publish to npm (closes A-2)

```bash
npm publish --access public --otp <otp>     # dist-tag: latest
npm view @rrrtx/xr version                   # expect 7.1.0
```

Note the historical drift this closes: `latest` has been 3.1.5 while source was
7.1.0. After publish, the channel manifest (`release.channels.json`,
stable→7.1.0) and npm agree.

## 5. GitHub Release body

Use `docs/release/7.1.0/` (INVENTORY.md + known-limitations.md) as the honest
source: supported platforms table comes from `docs/release/SUPPORT_MATRIX.md`;
do not paste benchmark numbers that are not in `docs/release/7.1.0/` artifacts.

## 6. Cosign / Rekor proof (KNOWN_LIMITATIONS #6)

`docs/security/KNOWN_LIMITATIONS.md` entry #6 stays **open until the first real
signed tag exists**: after step 2, verify and attach a Rekor log proof
(`rekor-cli get --log-index …` / `cosign verify-blob`), then close the entry
with the proof reference. The sandbox already verified the *wiring* of the
attestation step (pinned action, subject glob) — only the real tag can produce
the real proof.

## 7. Cosmetic follow-ups (safe anytime)

`packaging/winget/` license/author/publisher strings use a neutral
`ahmadrrrtx` GitHub URL — cosmetics only; the winget validator gate
(`bun scripts/winget-val.ts`) passes either way. Homebrew formula class-name
map lives in `scripts/homebrew-publish.ts` (verified vs `packaging/homebrew/`).
