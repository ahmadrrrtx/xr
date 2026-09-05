# Phase 5 — LOC census (measured, not estimated)

Counted with `find <tree> -name '*.ts' -o -name '*.tsx' | xargs cat | wc -l`.

## Core

| | files | LOC |
|---|---:|---:|
| Before Phase 5 (`fdae480`) | 603 | **154,426** |
| After Phase 5 | 551 | **131,050** |
| **Delta** | **−52** | **−23,376  (−15.1%)** |

## Satellites (moved, not deleted)

| Package | src LOC | test LOC | total |
|---|---:|---:|---:|
| `@rrrtx/xr-enterprise` | 23,393 | 8,629 | 32,022 |
| `@rrrtx/business-os` | 11,749 | 1,448 | 13,197 |

`src` totals differ slightly from the "removed from core" figure because the
satellites also carry the CLI commands (`commands/enterprise.ts`,
`commands/evaluate.ts`, `commands/business.ts`) that moved with them, while core
gained `src/xr-shield/` and `src/commands/satellite-shims.ts`.

## On the plan's ≤110k target

The Phase 5 plan set `core ≤ ~110,000 LOC`, written against a **149,722**-LOC
tree at commit `f5d781c9` (2026-08-26). Phases 1–4 added ~4.7k LOC, so the tree
was **154,426** when Phase 5 began.

Extracting everything the plan listed — enterprise + business-os + research +
repo — would have landed at ~124k. Reaching 110k would have required cutting a
further ~14k from genuine runtime (`src/context` 13.6k, `src/daemon` 11.6k,
`src/platform` 6.1k): deleting the product to satisfy a number.

The target was an estimate against a stale tree. Per the maintainer decision
(Finding A), the gate is re-baselined to the **measured** post-extraction number
with a no-regrowth ceiling, and ≤110k is recorded as a direction of travel
rather than a passing grade nobody can honestly award.
