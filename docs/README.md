# XR Documentation

One navigation map. Three classes of material:

1. **Current** — authoritative for the shipped runtime (`1.x`; 1.0.0 is a deliberate semver rebaseline of 7.1.0).
2. **Audits** — external/verification audits this project acts on.
3. **Historical** — completed campaign deliverables, phase reports, and
   superseded docs. Preserved, not deleted — but they do not govern claims.

---

## 1. Current documentation

| Area | Document |
|---|---|
| Getting started (install → first task) | [`development/GETTING_STARTED.md`](development/GETTING_STARTED.md) |
| Architecture (entry) | [`RUNTIME_KERNEL_ARCHITECTURE.md`](RUNTIME_KERNEL_ARCHITECTURE.md) |
| Execution model | [`EXECUTION_FABRIC.md`](EXECUTION_FABRIC.md) |
| Capability model | [`CAPABILITIES.md`](CAPABILITIES.md) · [`PLUGINS.md`](PLUGINS.md) · [`SKILLS-MARKETPLACE.md`](SKILLS-MARKETPLACE.md) |
| Ownership map | [`OWNERSHIP.md`](OWNERSHIP.md) |
| Business OS extension | [`business-os-extension.md`](business-os-extension.md) |
| Design system (CLI/website) | [`xr-3.1/`](xr-3.1/) |
| Architecture decisions | [`adr/`](adr/) (ADRs 0001–0012+) |
| API / OpenAPI | [`api/`](api/) |
| CLI reference | [`cli/`](cli/) |
| Developer docs | [`developer/`](developer/) · [`development/`](development/) |
| Environment interaction | [`environment/`](environment/) |
| Enterprise readiness & ops | [`enterprise-readiness/`](enterprise-readiness/) — incident response, governance, SLOs, supply-chain response, certification evidence |
| Observability | [`observability/`](observability/) |
| Performance | [`perf/`](perf/) — budgets, waivers (`SIZE-WAIVERS.json`), measured recall |
| Migration guides | [`migration/`](migration/) (per-version upgrade guides + storage-format migrations: credential vault, secrets at rest) |
| Guides | [`guides/`](guides/) — [CLI compatibility & scripting](guides/cli-compat.md) |
| Accessibility | [`a11y/`](a11y/) |
| UX research | [`ux/`](ux/) |
| Security | [`security/`](security/) — security model, threat model, known limitations, pentest register, guarantee matrix |
| Release | [`release/`](release/) — RELEASING, channels, support matrix, verifying releases, per-version notes, [release-candidate notes](release/RELEASE_CANDIDATE_NOTES.md), [launch handoff](release/LAUNCH_HANDOFF.md), [remote-hygiene runbook](release/REMOTE_HYGIENE.md) |
| Implementation tracker | [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) |

## 2. Audits

| Audit | Scope | Date |
|---|---|---|
| [`audits/XR_RUNTIME_AUDIT.md`](audits/XR_RUNTIME_AUDIT.md) | Consolidated runtime audit: the 3.1.5 deep audit, the 2026-08 independent verification audit, and the launch-engineering verification ledger with discrepancy register | 2026-08 |

## 3. Historical

Everything under [`historical/`](historical/) is preserved for provenance:

- `historical/phase-deliverables/` — Phase 4–13 deliverable/validation reports
  and the XR 2.1 / Stage-era implementation reports previously at repo root.
- `historical/phases/phase-*` — per-phase working papers (audit reports, gap
  analyses, research notes, test results) for the roadmap campaigns.
- `historical/planning-3.1/` — the original 3.1 product-planning set.
- `historical/research/` — early agent-research notes.
- `historical/stage0/` — Stage 0 audit and proposed-refactor artifacts.

Nothing in `historical/` is a current claim surface. The claim-lint and
version-drift gates (`bun run claim-lint`, `bun run release:check`) govern
`README.md`, `package.json`, `install.sh`, `install.ps1`, and `website/src/**`
only.
