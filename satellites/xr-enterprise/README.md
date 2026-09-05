# @rrrtx/xr-enterprise

**XR Enterprise** — organizational governance and the evaluation harness for
[XR](https://github.com/ahmadrrrtx/xr).

```bash
bun add -g @rrrtx/xr @rrrtx/xr-enterprise
xr-enterprise enterprise policy show
xr-enterprise evaluate run --offline
```

---

## What it is

| Area | What it does |
|---|---|
| **Policy & authority** | Organization policy sets, delegated authority, approval escalation |
| **Audit** | Export, retention windows, tamper-evident bundles |
| **Operability** | SLOs, incident response, supply-chain response, disaster recovery (RPO/RTO drills) |
| **Release & support** | Release governance, support tiers, certification evidence packs |
| **Deployment profiles** | Typed profiles for how XR is deployed in an org |
| **Evaluation harness** | 14 suites, 38 scenarios, offline by default — outcome-based scoring, provenance, regression gates, hash-verifiable evidence bundles |

**23,393 LOC of source, 8,629 LOC of tests (634 tests).**

## Why it isn't in XR core

It was, for several releases. It contributed **22,010 LOC**, **zero** daemon
routes, **zero** public API operations and **zero** agent tools — and had no
users. XR is maintained by one person; that surface was pure carrying cost.

Phase 5 extracted it ([ADR-0028](https://github.com/ahmadrrrtx/xr/blob/main/docs/adr/0028-satellite-extraction.md)).
Nothing was deleted. Every module and every test moved intact.

### One module deliberately stayed behind

`src/enterprise/baseline/status.ts` looked like enterprise code because of where
it lived. It was 313 LOC of Phase-0 health helpers consumed by `xr doctor`,
`src/install/system.ts` and four baseline scripts. Extracting it would have made
**`xr doctor` — XR's central honesty command — depend on an optional enterprise
package.** It was repatriated to core as `src/install/baseline-status.ts`
instead. Read the whole ADR before moving anything else back.

## `xr evaluate` lives here now

The evaluation harness moved with the rest. On core, `xr evaluate` prints a
relocation notice and exits 2 — a moved feature must not look like a working one.

```bash
xr-enterprise evaluate run --offline    # 14 suites, 38 scenarios, no network
xr-enterprise evaluate claims           # every public claim mapped to its evidence
xr-enterprise evaluate limitations      # what the benchmarks do NOT measure
xr-enterprise evaluate compare <a> <b>  # regression detection between releases
xr-enterprise evaluate export <runId>   # hash-verifiable evidence bundle
```

It is outcome-based: a scenario passes only when reality is inspected — an
artifact on disk, a durable record, a state transition, an audit-chain entry.

## Boundary with core

XR core imports **nothing** from this package, enforced three independent ways in
XR's CI: a `no-satellite-imports` dependency-cruiser rule, `boundaries.test.ts`,
and `satellite-isolation.test.ts`.

This package depends on `@rrrtx/xr` as a **peer**: it borrows core's kernel and
execution envelope rather than shipping a second one (Art. VI).

## Develop

```bash
bun install
bun test
bun run typecheck

# working on core and this together:
bun link
cd ../../ && bun link @rrrtx/xr-enterprise
```

## License

MIT © Muhammad Ahmad ([@ahmadrrrtx](https://github.com/ahmadrrrtx))
