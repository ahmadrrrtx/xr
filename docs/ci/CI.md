# CI at a glance

This page explains how XR's CI decides whether a change can merge or ship. The
required checks themselves are listed in [REQUIRED_CHECKS.md](REQUIRED_CHECKS.md).

## Principles

1. **A required check is one aggregate gate job.** It needs every job in its
   workflow and fails on any result other than `success`.
2. **No retries.** A failing test fails its lane on the first run. There is no
   automatic re-run of failing tests or crashed segments. If a test is flaky,
   quarantine it (below) and fix it; do not re-run until green.
3. **Pinned inputs.** Every third-party action is pinned to a full commit SHA
   with a `# vX` comment. The one exception is `slsa-github-generator`, which
   must be referenced by tag for its provenance verification. Bun comes from
   `.bun-version` (currently 1.4.2) via `bun-version-file`; Dependabot proposes
   action bumps weekly. Runner images are named (`ubuntu-24.04`, never
   `ubuntu-latest`), and first-party `actions/*` stay on their Node-24 majors.
4. **Evidence over claims.** The support matrix is generated from journey
   evidence (below). A hand edit fails the Quality Gate.

`bun run ci:policy` enforces 1–3 mechanically: gate shape, no `paths:` filter
on required workflows, no job-level `continue-on-error` except on listed
non-gating legs, step-level `continue-on-error` only on failure-only diagnostic
steps, SHA pins, the Bun pin source, quarantine validity, the Dependabot
config, and (rule 7) named runner images plus the Node-24 action floor:
checkout/cache/setup-node v5, upload-artifact v6, download-artifact v7,
github-script v8. The floor reads the `# vX` comment that Dependabot keeps in
step with the SHA.

## Workflow lint and audit (XR-LAUNCH-032)

- **actionlint (gating).** The truth-gate job runs actionlint 1.7.12 with
  shellcheck 0.11.0 over every workflow and every `run:` block. Both binaries
  are downloaded at fixed versions and sha256-checked. Run it locally:
  `actionlint -shellcheck=$(command -v shellcheck) -pyflakes=`. Intentional
  shell patterns carry an inline `# shellcheck disable=SCxxxx # reason`.
- **zizmor (report only).** `Workflow Audit (non-gating)` runs zizmor 1.31.1
  (pinned, sha256-checked) on workflow changes and weekly, and posts the counts
  to the run summary with the full report as an artifact. Findings do not fail
  it; a zizmor that cannot run does. Baseline with offline audits at
  XR-LAUNCH-032: 115 findings (27 high), mostly `artipacked` (checkout
  credentials persisted) and `cache-poisoning` in release paths. Real-Device
  Matrix's `workflow_run` trigger stays flagged, but its job now only installs
  bundles built from this repository, never from a fork PR.
- **Orphan registration.** `zz-probe-native-fs.yml` no longer exists in the
  tree, but GitHub still lists it (workflow id 386530097) because its old runs
  remain. Only the owner can remove it, as deleting runs destroys history:

  ```bash
  gh workflow disable 386530097 -R ahmadrrrtx/xr
  gh run list -R ahmadrrrtx/xr --workflow 386530097 --limit 500 --json databaseId -q '.[].databaseId' \
    | xargs -n1 gh run delete -R ahmadrrrtx/xr
  ```

## Flaky tests: no retries, quarantine

The quarantine lives in [`test/quarantine.json`](../../test/quarantine.json):

```json
{ "file": "test/daemon/phase2b.test.ts", "owner": "@handle", "issue": "XR-LAUNCH-012 or https://github.com/…/issues/N",
  "added": "YYYY-MM-DD", "expires": "YYYY-MM-DD", "reason": "what fails and why" }
```

- Every entry has an **owner**, an **issue** and an **expiry** at most 45 days
  after it was added. `ci:policy` fails the Quality Gate on an expired entry, a
  missing field, or a file that no longer exists. Renew deliberately, with a
  reason, or fix the test.
- Quarantined files are removed from the blocking lanes (`test / core` via
  `scripts/parity-suite-runner.sh`, `test / security`) and run in
  `test / quarantine (non-blocking)`. Their results stay visible.
- To quarantine, add an entry in the same PR that links the issue. To release,
  delete the entry once the file has been green in the quarantine job for 10
  consecutive `main` runs.

Locally: `bun run scripts/quarantine.ts --check` (validate), `--files` (list),
`--run` (run the quarantined files).

The parity runner used to retry a crashed segment once. It now reports the
crash, bisects the segment to name the culprit file, and fails. The old retry
exists only behind `XR_PARITY_ALLOW_CRASH_RETRY=1`, for local diagnosis; CI
never sets it.

## Clean-machine journeys (XR-LAUNCH-011)

A journey takes one claimed target from nothing to uninstalled on a fresh
runner. It isolates `HOME` and serves every remote from loopback fixtures, so
it needs no network, keys or paid calls:

| Step | CLI (`scripts/journey/cli-journey.ts`) | Desktop (`desktop-journey.ts`) | Docker (`docker-journey.ts`) |
|---|---|---|---|
| Build / Package | release binary or `npm pack` tarball + SHA256SUMS | Tauri bundle + `latest.json` | image build |
| Install | `install.sh` / `install.ps1` against a loopback release mirror, or `npm i -g` from a loopback registry | `.deb` / NSIS (silent) / dmg (XR.app copied out) | data volume created |
| Launch | the installed `xr --version` (must report the installed version) and `--help` | GUI window via tauri-driver (Linux, Windows); process + sidecar health on macOS; the sidecar must exit with the app | `--version`, then `serve` answers `/api/v1/health` |
| Core-agent smoke | a real agent run against the deterministic fixture provider, which must write a proof file | the bundled engine against the same fixture | the same, inside the container |
| Update | N → N+1 (`1.x.y-journey.1`, never a real version) | **de-scoped** until the XR-LAUNCH-008 updater key exists; `latest.json` is assembled + verified in desktop-app.yml | **de-scoped**: pull a new tag |
| Uninstall | `xr uninstall`; asserts files, the PATH block and the Windows Path entry are gone | OS uninstaller (`apt-get remove`, NSIS `/S`, remove XR.app) | container + volume + image removed |

Each run writes a JSON evidence record (commit, runner, class `CI` or `LR`,
per-step status). CI uploads them as `journey-evidence-*` artifacts.

## Support matrix (XR-LAUNCH-022)

`docs/release/support-targets.json` lists every claimed target and its explicit
de-scopes. `bun run support-matrix` renders the *Launch journeys* table in
`docs/release/SUPPORT_MATRIX.md` from `docs/release/evidence/*.json`:

- `--check` fails if the committed block is stale. It runs in the Quality Gate.
- `--require-complete` fails while any gating cell lacks a pass or a de-scope.
  This is the launch criterion, not a merge criterion.

To record new evidence, download the `journey-evidence-*` artifacts from a
green run on `main`, copy them into `docs/release/evidence/`, run
`bun run support-matrix` and commit. A local hardware run counts as `LR` and
must say where it ran.

## Report-only workflows

Provider Canaries, Real-Device Matrix, Soak, OS sandbox, Windows ARM64 and
Workflow Audit carry `(non-gating)` in their names. They must still complete:

- canaries run a keyless fixture leg (`scripts/canary-fixture.ts`) that must
  pass. The live leg is an audited skip without owner secrets;
- Real-Device Matrix downloads the `xr-desktop-<slug>` bundle artifacts that
  desktop-app.yml actually uploads;
- Soak runs 5 h under a 330-minute timeout, so it finishes and writes its report
  instead of being cancelled at the 6 h hosted-runner limit.
