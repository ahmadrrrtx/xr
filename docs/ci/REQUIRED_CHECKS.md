# Required checks on `main`

Status: **proposed by Phase 3 (XR-LAUNCH-012, decision D7); applied by the owner.**
Source of truth: [`.github/required-checks.json`](../../.github/required-checks.json).
`bun run ci:policy` (part of the Quality Gate) fails if this file, the JSON and the
workflows disagree.

Each required check is a single **aggregate gate job** whose name is the
branch-protection context. A gate runs with `if: always()`, needs every job in
its workflow, and fails unless all of them report `success` (a skipped or
cancelled job fails the gate too). Branch protection therefore never has to list
matrix legs, and a renamed leg cannot silently drop out of the gate.

| Context (exact) | Workflow | Covers |
|---|---|---|
| `Quality Gate` | `ci.yml` | typecheck, truth gate, VS Code extension tests + package, unit / security / reliability / e2e suites, size + boundaries, perf, a11y, API contract, support-matrix `--check`, `ci:policy` |
| `Cross-Platform gate` | `cross-platform.yml` | full parity suite + golden path on Linux, macOS, Windows |
| `Supply Chain gate` | `supply-chain.yml` | install hygiene, gitleaks, osv + `bun audit`, licenses, SBOM drift, tag⇔npm invariant, trivy, container `--version` + file-tool smoke |
| `npm Pack Smoke gate` | `npm-pack-smoke.yml` | packed tarball: global install + `update --check` on Linux, macOS, Windows |
| `Desktop gate (bundles + latest.json + journey)` | `desktop-app.yml` | cargo check / clippy / test on every OS leg, bundles per OS, `latest.json` assemble + verify, desktop clean-machine journey, Flatpak metadata |
| `Clean-Machine Journey gate` | `journey.yml` | CLI binary + npm journeys on every hosted target; Docker image journey (amd64, arm64) |

None of these workflows has a `paths:` filter: a required check that never runs
blocks a PR forever, so `ci:policy` rejects path filters on required workflows.

## Not required (report-only)

| Workflow / leg | Why it is not gating |
|---|---|
| `Provider Canaries (non-gating)` | live providers need owner secrets; the keyless fixture leg proves the harness and must pass inside the run |
| `Real-Device Matrix (non-gating)` | physical-device evidence, owner-run |
| `Soak (non-gating)` | multi-hour endurance run (5 h nightly), trend evidence |
| `OS sandbox (experimental) (non-gating)` | native sandboxes (D3), security review pending |
| `Windows ARM64 (file authority) (non-gating)` | Windows ARM64 is unverified without hardware (D4) |
| `Workflow Audit (non-gating)` | zizmor workflow-security report (XR-LAUNCH-032); findings are triaged, not gating |
| `windows-11-arm` leg of the CLI journey; `windows-arm64` bundle + journey legs of the desktop workflow | same (D4); `continue-on-error` is scoped to that leg only |
| `test / quarantine (non-blocking)` in `ci.yml` | runs the quarantined flaky files (see [CI.md](CI.md#flaky-tests-no-retries-quarantine)) |
| `test / e2e-blackbox-proof` in `ci.yml` | Exit-Gate proof lane, red by design until F-02/F-03 land |

## Applying it (owner)

```bash
bun run ci:policy                          # every context is a real gate job
bash scripts/apply-branch-protection.sh    # PRINTS the gh api command; review, then run it
```

The script never calls the API itself. Changing this list is an owner decision;
update the JSON, this page and branch protection together.

## Release gating

`release.yml` calls `journey.yml` and `supply-chain.yml` as reusable workflows
on the tagged commit. `publish-npm` and `publish-docker` need `assemble`,
`sign`, `release`, `verify-release`, `journey` and `supply-chain`, so nothing
reaches npm or GHCR unless the journeys and supply-chain checks pass on the
exact release commit.
