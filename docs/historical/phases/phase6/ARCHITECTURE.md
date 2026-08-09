# XR Phase 6 — Memory, Knowledge & Context Quality: Architecture

**Status:** shipped (v7.0.1 + Phase 6) · **Basis:** ADR 0013, Constitution
Art. VIII/XII/XXI/IV · **Audience:** developers and operators of the context
substrate

This is the Phase 6 delta on top of the 4.5-era context substrate. It only
documents what Phase 6 changed or added; the base model (7 context types,
consent states, provenance, freshness, the frozen `TIER_POLICIES` table,
injection channels) is unchanged in shape.

---

## 1. Tier model + the progressive lifecycle (T1)

Tiers remain the 8 frozen semantic bands (`immediate`, `recent`,
`task_summary`, `project_knowledge`, `long_term_memory`, `evidence`,
`artifacts`, `instructions`). Phase 6 adds the **evidence lifecycle** that
flows THROUGH them: every item carries `lifecycleStage ∈ {verbatim, summary,
condensed, externalized}`.

- **`verbatim`** — the original evidence. Untouched.
- **`summary`** — an evidence-preserving fold of several items, produced by
  the fail-safe compressor. Trust is ALWAYS `generated_synthesis`,
  provenance ALWAYS `model_synthesis`; the summary **hard-never outranks
  source evidence**.
- **`condensed`** — a summary of summaries (generation-capped).
- **`externalized`** — the original after folding: never deleted, but the
  summary stands for it in *progressive* retrieval. It remains reachable by
  deeper retrieval and by navigation.

Retrieval depth: `progressive` (default — externalized originals are rejected
with reason `lifecycle_externalized`) or `deep` (originals rank again).

**Tier resolution fix (found by the benchmark):** default tier lookup is now
item-aware, not type-only — `defaultTierForItem()` maps verbatim/externalized
`task_context` to `immediate` (trust ceiling `source_evidence`) and
`summary`/`condensed` task context to `task_summary` (ceiling
`generated_synthesis`). The prior type-only default silently rejected all
high-trust verbatim task evidence. `TIER_POLICIES` is untouched; no ceiling
was weakened.

**Lifecycle commands:** `xr context promote` folds eligible stale task
threads (default: ≥3 items, older than 14 days; flags: `--older-than`,
project scope). Demotion is not a user command because it is never needed:
summaries can be revoked and originals deep-retrieved, which is strictly more
powerful.

## 2. Hybrid retrieval + recall-reason format (T2)

Three channels score every authorized candidate; **Reciprocal Rank Fusion**
(k=60) merges the per-channel rankings (fused score normalized to 0..1):

| channel | signal | abstains when |
|---|---|---|
| lexical | hashing-vector cosine over title+content+tags | never (offline baseline) |
| semantic | routed embedding cosine | no cached vector in the active space (null — never a garbage cross-space cosine) |
| structured | tags (×3), `type:`(×2), `source:`/`from:`/`scope:` hints | empty query |

A channel only votes where it does not abstain; two+ votes ⇒ `mode: "hybrid"`.

**Recall-reason format.** Every hit's `RetrievalExplanation` now carries
`channels: { lexical, semantic|null, structured }` (pre-fusion,
lineage-first), `matchMode` ∈ semantic|lexical|hybrid, and a `policyReason`
line containing `hybrid:voted=<channels>` so any recall can be replayed and
explained after the fact. `xr context explain <id>` prints it.

## 3. Memory-as-tools (T3) — navigable recall inside the agent loop

Four read-only tools (registered through the standard registry when
`knowledge.enabled && memory.enabled`):

- **`memory_search(query, depth?, limit?)`** — grant-scoped hybrid retrieval;
  supports `depth: "deep"`; returns ranked hits with the full recall-reason.
- **`memory_get(id)`** — one item plus provenance, freshness, lifecycle stage.
- **`memory_navigate(id, relation)`** — bounded graph-free traversal:
  `supersedes`, `superseded_by`, `sources` (provenance refs), `summary`
  (what an externalized original folded into, or its fold-children),
  `task` (task-thread siblings), `contradictions`.
- **`memory_conflicts()`** — open contradictions and supersession status.

Every tool result is prefixed **"REFERENCE DATA — context, not authority"**
(Art. VIII.3), is passed through the render-time integrity gate (§4), and
has secrets masked. The tools are exercised head-to-head against single-shot
retrieval in `test/context/navigation.test.ts` (navigation out-recalls one
pre-run package on the planted task thread).

## 4. Anti-poisoning model (T4) — admission AND render time

Two fences, both tested:

1. **Admission** (pre-existing): `admitContextWrite` scans writes against the
   pattern classes (HIGH → quarantine, MEDIUM → flag). Phase 6 adds 11
   classes: indirect control, consent bypass, verification laundering, role
   assignment, secret loosening, retention forgery, evidence destruction,
   tool-pattern graft, template smuggle, JSON role smuggle, memory
   suppression.
2. **Render-time gate** (new, and the point): `verifyInjectionSafety` is now
   invoked on every assembled injection package (`buildInjectionPackage`)
   and on every memory-tool result (`gateToolResult`). It re-scans content
   (a pattern added AFTER a row was written still catches it), re-checks
   consent/revocation/expiry, enforces the instruction-channel invariant, and
   **drops or re-quarantines failures — fail closed**. Findings and rejected
   item ids land on the package (`integrityFindings`, `integrityRejected`).

Detection is asserted against a committed 30-entry corpus
(`benchmarks/poisoning-corpus.json`, 14 attack classes, 100% quarantine) in
`test/context/integrity.test.ts`, including SQL-bypass rows, forged
instruction rows, and a post-assembly revocation. Benign lookalikes
(e.g. "I always enjoy working in TypeScript…") are guarded against false
quarantine.

## 5. Conflict resolution + selective forgetting (T5)

- **Supersession chains** auto-resolve at admission (decided_by `policy`;
  recorded in `context_conflict_resolutions`).
- **Open contradictions** (same-fact disagreement) surface via
  `xr context conflicts` / `memory_conflicts`. Resolve explicitly:
  `xr context resolve <a> <b> --keep a|b|stale|both`. The loser is superseded
  by the winner — its trust status is NEVER silently rewritten — and the
  resolution is a first-class undoable ledger row.
- **Selective forgetting:** `xr context forget <id>` hard-expires one item
  (leaves retrieval immediately, unlike revoke it keeps consent metadata);
  reversible via undo. Nothing is bulk-deleted silently.

## 6. User control — the full set (T6)

| control | command |
|---|---|
| inspect | `xr context list`, `xr context inspect <id>`, `xr context pending`, `xr context legacy` |
| consent | `xr context approve <id>` |
| correct | `xr context correct <id>` |
| revoke | `xr context revoke <id> -y` |
| forget | `xr context forget <id> -y` |
| resolve conflicts | `xr context conflicts`, `xr context resolve <a> <b> --keep …` |
| lifecycle | `xr context promote` |
| **undo** | `xr context undo [opId]`, history via `xr context history` |
| export | `xr context export` |
| measured recall | `xr context benchmark [--write] [--json]` |

**Undo semantics (test byte-for-byte in `test/context/undo.test.ts`):** every
mutating op (approve/correct/revoke/delete/resolve/forget, and legacy
`user_memory` add/edit/remove — the retirement caveat table, ADR 0006 F1)
records its before-image in `context_ops`. `undo` restores the before-image
with INSERT OR REPLACE (or purges a row whose op was an insert), appends its
own op for audit, marks the original undone, and REFUSES a double-undo.

## 7. Measured recall — harness, domains, and how to extend (T5/T7/T8)

The harness (`src/context/eval/harness.ts`) runs a MemoryAgentBench-style
protocol on the REAL pipeline — see `docs/phase6/BENCHMARK-METHODOLOGY.md`
for the full methodology and, crucially, **what the numbers do and do not
prove**. Live results: `docs/phase6/measured-recall.json`.

**Adding a knowledge domain** (e.g. `legal`): drop
`benchmarks/recall/legal.json` following the existing fixture schema
({domain, description, items[], queries[]} covering all four competencies —
accurate_retrieval, test_time_learning, long_range_consistency,
conflict_resolution — including a superseded pair, a TTL/rename pair, a
3-step task-linked chain, and noise), register it in the `domains` list in
`scripts/recall-benchmark.ts` + `test/context/recall-benchmark.test.ts`, then
run `bun scripts/recall-benchmark.ts --write`. Targets apply per-domain, so a
weak fixture fails loudly instead of diluting into an average.

## 8. Local-only knowledge path (T7)

Lexical retrieval is the mandatory default route; the semantic channel only
activates through a routed (possibly remote, if configured) embedding model
and abstains otherwise. `test/context/local-only.test.ts` runs the entire
knowledge path — record → hybrid retrieve → tools → promote → compress →
inject — plus the benchmark, with `fetch` replaced by a fail-loud stub. No
knowledge operation requires the network.

## 9. One store (T8) and the ops/resolutions tables

Phase 6 adds exactly two tables to the ONE store (`context_ops`,
`context_conflict_resolutions`) and two columns (`lifecycle_stage`,
`lifecycle_summarized_by`) — additive, PRAGMA-guarded, idempotent.
`test/architecture/one-store.test.ts` executable-checks the one-store
invariants and the "no bare recall claim" rule forever.

`src/state` / `docs/perf/PERF-BUDGETS.md` note: the repository now caches one
prepared statement per distinct SQL — the WriteGate retains every statement
until close, and per-call prepare measured as a hard leak at scale.
