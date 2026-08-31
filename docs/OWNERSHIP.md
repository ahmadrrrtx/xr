# Ownership Map — XR

**Generated from [`CODEOWNERS`](../CODEOWNERS) by `scripts/ownership-map.ts` — do not edit by hand.**
Regenerate with `bun run scripts/ownership-map.ts`; CI's `--check` fails on drift.

Every top-level area of `src/`, `test/`, `scripts/`, and `extensions/` has exactly one
accountable owner at PR-review time (Constitution: *one responsibility, one owner per subsystem*).
"Default" means the catch-all `*` owner in `CODEOWNERS`; "explicit" means a dedicated entry.

## Areas

| Area | Owner(s) | Coverage |
|---|---|---|
| `src/agents/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/automation/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/capabilities/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/cli/` | @ahmadrrrtx | explicit entry |
| `src/clients/` | @ahmadrrrtx | explicit entry |
| `src/commands/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/computer/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/config/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/context/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/control/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/core/` | @ahmadrrrtx | explicit entry |
| `src/cost/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/daemon/` | @ahmadrrrtx | explicit entry |
| `src/enterprise/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/execution/` | @ahmadrrrtx | explicit entry |
| `src/export/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/i18n/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/index.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/install/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/integrations/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/intelligence/` | @ahmadrrrtx | explicit entry |
| `src/interfaces/` | @ahmadrrrtx | explicit entry |
| `src/local/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/mcp/` | @ahmadrrrtx | explicit entry |
| `src/observability/` | @ahmadrrrtx | explicit entry |
| `src/platform/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/plugins/` | @ahmadrrrtx | explicit entry |
| `src/providers/` | @ahmadrrrtx | explicit entry |
| `src/reliability/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/repo/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/research/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/runtime/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/schemas/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/security/` | @ahmadrrrtx | explicit entry |
| `src/services/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/skills/` | @ahmadrrrtx | explicit entry |
| `src/state/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/telegram/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/templates/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/tools/` | @ahmadrrrtx | explicit entry |
| `src/ui/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/update/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/util/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `src/voice/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/a11y/` | @ahmadrrrtx | explicit entry |
| `test/agent-cancel.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/agent.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/api/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/architecture/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/baseline/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/business/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/capabilities/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/config/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/context/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/control-memory.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/control-plan.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/control.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/control/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/core/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/cost.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/daemon.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/daemon/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/deployment/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/e2e-blackbox/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/ecosystem.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/enterprise/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/environment/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/evaluation/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/execution/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/fixtures/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/helpers/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/intelligence/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/memory-semantic.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/memory-stage6.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/memory-summarize.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/memory-v09.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/memory.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/multi-agent-e2e.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/multi-agent.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/observability/` | @ahmadrrrtx | explicit entry |
| `test/one-agent/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/perf/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/phase0/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/phase1/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/platform/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/plugins.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/plugins/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/polish.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/providers/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/release/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/reliability.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/reliability/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/repo-map/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/research.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/research/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/security.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/security/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/services/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/skills-loader.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/skills-marketplace-backend.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/skills-marketplace.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/skills-official-packs.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/skills-sdk-2.1b.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/skills-unified-runtime.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/skills.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/skills/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/state/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/supply-chain/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/telegram.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/tools.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/tools/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/trust.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/trust/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/update/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/util/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/ux-status.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/ux/` | @ahmadrrrtx | explicit entry |
| `test/voice.test.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `test/workflow/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/api-compat.ts` | @ahmadrrrtx | explicit entry |
| `scripts/baseline-inventory.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/benchmark-ttft.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/beta-install-survey.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/build-deb.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/build-matrix.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/changelog.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/channel-manifest.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/ci-capability-gate.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/claim-lint.ts` | @ahmadrrrtx | explicit entry |
| `scripts/dashboard-csp-convert.py` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/e2e-artifact.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/first-task-survey.ts` | @ahmadrrrtx | explicit entry |
| `scripts/gen-dashboard-dispatcher.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/gen-seccomp.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/generate-client.ts` | @ahmadrrrtx | explicit entry |
| `scripts/generate-openapi.ts` | @ahmadrrrtx | explicit entry |
| `scripts/golden-path.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/guarantee-matrix.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/hot-path-lint.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/license-check.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/make-preview.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/measure-baseline.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/measure-trust-perf.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/memory-recall-bench.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/mutate.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/ownership-map.ts` | @ahmadrrrtx | explicit entry |
| `scripts/parity-suite-runner.sh` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/perf-baseline.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/perf-daemon-routes.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/perf-gate.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/perf/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/phase00/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/phase2-move-module.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/platform-parity.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/profile-gate.ts` | @ahmadrrrtx | explicit entry |
| `scripts/provider-canaries.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/recall-benchmark.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/release-manifest.ts` | @ahmadrrrtx | explicit entry |
| `scripts/repo-intelligence-bench.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/sbom.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/size-gate.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/sums.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/sus.ts` | @ahmadrrrtx | explicit entry |
| `scripts/unit-tier.ts` | @ahmadrrrtx | explicit entry |
| `scripts/ux/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/validate-baseline.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/verify-release.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `scripts/verify-security.ts` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `extensions/business-os/` | @ahmadrrrtx | default (@ahmadrrrtx) |
| `extensions/vscode/` | @ahmadrrrtx | default (@ahmadrrrtx) |

## How ownership is exercised

- **Reviews:** GitHub requests the listed owners on any PR touching the area (`CODEOWNERS`).
- **Trust boundary areas** (`src/security/`, `src/trust/`, `src/core/`, credential and release
  surfaces) carry explicit entries and demand adversarial tests with any change — see
  [CONTRIBUTING.md](../CONTRIBUTING.md).
- **Generated surfaces** (release identity, API schema/client, this map) have exactly one
  generator script each; editing generated output by hand is a drift violation.

## Adding an area

1. Create the directory under its architectural layer (see CONTRIBUTING.md §Architecture boundaries).
2. If it is a new accountable ownership boundary, add an explicit `CODEOWNERS` entry with a
   comment naming the owning responsibility. Otherwise the default owner covers it.
3. Run `bun run scripts/ownership-map.ts` to regenerate this file. CI enforces sync.
