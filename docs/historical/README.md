# Historical Archive

This tree preserves completed engineering-campaign material so the repository
root and `docs/` stay navigable. **Nothing here is a current, load-bearing
document**: no code imports it, no CI gate reads it, no release claim depends
on it. Living documents that were found inside campaign folders were relocated
instead of archived:

| Document | Relocated to |
|---|---|
| `phase2/SIZE-WAIVERS.json` (live size-gate register) | [`../perf/SIZE-WAIVERS.json`](../perf/SIZE-WAIVERS.json) |
| `phase3/THREAT_MODEL.md` | [`../security/THREAT_MODEL.md`](../security/THREAT_MODEL.md) |
| `phase*/MIGRATION_*.md` per-version guides | [`../migration/`](../migration/) |
| `phase12/*` enterprise ops guides (incident response, governance, SLOs, supply chain, certification evidence, …) | [`../enterprise-readiness/`](../enterprise-readiness/) |
| root `MIGRATION.md` (XR 5.2 capability ecosystem) | [`../migration/XR-5.2-CAPABILITY-ECOSYSTEM.md`](../migration/XR-5.2-CAPABILITY-ECOSYSTEM.md) |
| `CHANGELOG_4.0.md` | [`../release/4.0/CHANGELOG.md`](../release/4.0/CHANGELOG.md) |

Layout:

- `phase-deliverables/` — campaign-final reports (Phase 4–13, XR 2.1 A–E,
  Stage 0–15 era) that previously lived at the repository root.
- `phases/phase-*/` — per-phase working papers.
- `planning-3.1/` — original 3.1 PRD/TRD/planning set.
- `research/` — early agent-research notes.
- `stage0/` — Stage 0 audit + proposed refactors.

If a document here is found to be load-bearing, promote it out of the archive
and update its consumers — do not leave a live reference pointing into
`historical/`.
