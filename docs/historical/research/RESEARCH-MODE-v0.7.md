# XR v0.7 — Research Mode

XR research mode is a **source-first, citation-aware** research workflow. It gathers,
ranks, verifies, and synthesizes information into a structured report — and refuses to
fabricate sources or fake certainty.

## Why a separate module

Research is a clean abstraction (`src/research/`) that is decoupled from provider auth,
budget logic, voice, and control. Each layer takes its inputs explicitly and returns
plain data, which keeps the workflow **deterministic, repeatable, and testable**. It
reuses XR's existing systems instead of duplicating them:

- **Provider routing & local fallback** — via `buildProvider` (same as the agent).
- **Spend caps** — via `CostGovernor` + `BudgetManager` (`GovernedResearchBudget`).
- **Egress allow-list** — via the existing `web_search` / `fetch_url` tools.
- **Tamper-evident audit log** — every step is audited via `Store.audit`.

## The flow

```
topic
  │
  ├─ 1. plan        makePlan()        → objective, research questions, queries, strategy
  ├─ 2. search      WebSearchCapability → raw hits per query (egress-gated)
  ├─ 3. rank        rankSources()     → trust-scored, de-duplicated Source[]
  ├─ 4. fetch       fetch top sources → full text (best effort)
  ├─ 5. extract     extractFromSource → Notes, each tied to a source + verified flag
  ├─ 6. synthesize  synthesize()      → short answer, summary, report, contradictions
  └─ export         renderReport()    → signed markdown (+ JSON sidecar)
```

Each step **persists** the session to SQLite, so `status` / `sources` / `summarize` /
`export` always have something to show even if a later step fails.

## Integrity guarantees

- **Source-first, not answer-first.** Sources are collected before any conclusions.
- **Citation-aware.** Every note references a `sourceId`; the report cites `[s1]`, `[s2]`.
- **No fake verification.** A note is `verified` **only** if XR actually *fetched* the
  page. Snippet-only notes are flagged `unverified` and their confidence is downgraded.
- **Honest uncertainty.** Facts / inference / opinion are distinguished; contradictions
  and open questions are surfaced, not hidden.
- **Deterministic ranking.** Trust scores come from transparent domain heuristics
  (`scoreDomain`), never from an LLM, so they're repeatable and auditable.
- **No silent spend.** Token/$ usage is recorded and shown in the meter; if a cap would
  be breached, research stops gracefully with partial results saved.
- **Graceful degradation.** If search is unavailable, XR says so and produces an honest
  "no conclusion" report rather than inventing an answer.
- **Tamper-evident reports.** Each markdown report carries a SHA-256 signature
  (`verifyReport`).

## Commands

```bash
xr research "topic"            # quick research (default)
xr research quick "topic"      # fast: fewer sources, faster summary
xr research deep "topic"       # deeper: more sources, richer synthesis
xr research plan "topic"       # generate research questions + strategy only
xr research status [id]        # show current/most-recent session
xr research sources [id]       # list collected sources + trust
xr research summarize [id]     # (re)synthesize a report from collected notes
xr research export [id] [path] # write the report to markdown (+ json sidecar)
xr research list               # recent research sessions
```

Flags: `--provider`, `--model`, `--budget <usd>` (per-research ceiling for cloud).

`xr doctor` reports research health (is a search host on the egress allow-list?) and the
number of stored sessions.

## Depth budgets (deterministic)

| depth | queries | results/query | max sources | fetched | questions |
|-------|---------|---------------|-------------|---------|-----------|
| quick | 3       | 5             | 8           | 3       | 3         |
| deep  | 6       | 6             | 16          | 8       | 6         |

Defined in `src/research/types.ts` (`DEPTH_BUDGETS`).

## Search backend

Research uses the same SearXNG-backed `web_search` tool as the agent. The configured host
(default `searx.be`, override with `XR_SEARXNG`) **must be on the egress allow-list**:

```jsonc
// ~/.xr/config.json
"security": { "egressAllowlist": ["searx.be", "..."] }
```

## File map

| File | Responsibility |
|------|----------------|
| `src/research/types.ts` | Data model + depth budgets |
| `src/research/search.ts` | Egress-gated search/fetch capability + SearXNG parsing |
| `src/research/ranking.ts` | Deterministic trust scoring + dedupe |
| `src/research/llm.ts` | Tools-free structured LLM call + JSON extraction |
| `src/research/plan.ts` | Plan generation (+ deterministic fallback) |
| `src/research/extract.ts` | Per-source evidence extraction (verified flagging) |
| `src/research/synthesize.ts` | Synthesis + contradiction detection (+ fallback) |
| `src/research/report.ts` | Citation-aware markdown rendering + signing |
| `src/research/budget.ts` | Adapts CostGovernor to the engine's budget guard |
| `src/research/engine.ts` | The orchestrator (the flow above) |
| `src/research/cli.ts` | `xr research …` command handlers |

## Extensibility (built in, not implemented yet)

The plain-data model and decoupled layers are designed to support later work without a
rewrite: persisted JSON sessions feed a **dashboard research workspace**; `sourceId`-tied
notes form the basis of a **citation graph**; `contradictions` + claim tags enable a
**fact-checking mode**; and the plan/questions structure maps onto **multi-step agent
plans** and a **comparison mode**.

## Tests

`test/research.test.ts` covers the deterministic layers (parsing, ranking, plan
flattening, JSON extraction), a full engine run against in-memory fakes (sources →
verified notes → synthesis), the verified/unverified integrity rule, graceful
degradation when search is unavailable, and report signing/verification.
