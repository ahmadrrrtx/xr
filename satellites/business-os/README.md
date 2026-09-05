# @rrrtx/business-os

**Business OS** — an optional, **default-off**, effect-verified extension for
[XR](https://github.com/ahmadrrrtx/xr) that runs a business operating layer over
local-first records.

No hosted service. No SLA. No paid tier. It is code that runs on your machine.

```bash
bun add -g @rrrtx/xr @rrrtx/business-os
xr-business status
```

---

## What it is

A governed **L5 extension** over XR's thin **L0 contract** (records, artifacts,
identity, audit). Fifteen modules — CRM, sales, marketing, support, projects,
knowledge, finance, HR, analytics, automation, scheduling, communication,
documents, meetings, AI workers — plus journeys, outcomes, approvals, a work
queue and an audit trail.

## Why it isn't in XR core

Core carried it for several releases. It contributed **11,749 LOC**, zero agent
tools, and had **no users** — it is default-off, and nobody had turned it on. On
a project maintained by one person, that is review time, security-audit surface,
CI minutes and release-gate weight spent on capability nobody had asked for.

Phase 5 moved it here, where it can be found, installed and maintained on its
own schedule ([ADR-0028](https://github.com/ahmadrrrtx/xr/blob/main/docs/adr/0028-satellite-extraction.md)).

**Nothing was deleted and nothing was weakened.** Same modules, same 65 tests,
same gates.

## Default-off is a feature, not a stub

A module loads only when **both** hold:

1. it is enabled in XR config, **and**
2. its deterministic **effect verification** passes against a scratch database —
   the module must demonstrate it actually writes the records it claims to.

A module that cannot prove its effects is **excluded from the default load**,
and the exclusion reason is reported rather than hidden. This is
`pkg/effect-verification.ts` and `pkg/effect-specs.ts`; the policy is recorded in
`pkg/manifest.json`.

## Boundary with core

Core never imports this package. It declares the shapes it consumes at L0
(`BusinessOsView`, `BusinessSqlDatabase` in `src/core/business-l0.ts`) and this
package satisfies them **structurally** — no `implements`, no import in either
direction. Core's isolation is enforced three ways in XR's own CI
(dependency-cruiser rule, boundary test, satellite-isolation test).

The `/api/v1/business/*` endpoints stay in core: they are committed contract, and
they answer honest empty/503 payloads when this extension is absent.

## Develop

```bash
bun install
bun test
bun run typecheck

# working on core and this together — link, do not path-reference:
bun link
cd ../../ && bun link @rrrtx/business-os
```

A relative path back into an XR checkout would recreate exactly the coupling the
extraction removed. `bun link` exercises the same resolution path a real user takes.

## License

MIT © Muhammad Ahmad ([@ahmadrrrtx](https://github.com/ahmadrrrtx))
