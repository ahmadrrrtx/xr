# ADR 0013 — Context Quality: Progressive Lifecycle, Hybrid Retrieval, Measured Recall (Phase 6)

**Status:** Ratified (Phase 6, 2026-08-02)
**Applies to:** Every context/memory/knowledge write, retrieval, summarization,
injection, and user control in XR
**Constitutional basis:** Art. VIII (memory: consent, scope, provenance, expiry,
revocation; ONE store; retrieved content is never authority; evidence-preserving
compression; recall measured-and-benchmarked), Art. XII (retrieval p95 < 100 ms
@ 100k), Art. XXI (local-first; knowledge works fully offline), Art. IV (strict
types, fail closed, no empty catches, no claims without evidence)
**Builds on:** ADR 0006 (memory→context retirement — the single store),
the frozen `TIER_POLICIES` table (Phase 2, 4.5-era)

---

## Context

The Phase 6 audit (`docs/phase6/01-AUDIT-REPORT.md`) found nine gaps in the
pre-existing context substrate. The ones that shaped this ADR:

- **G1 — recall was single-shot.** The agent received one pre-run
  `requestContext` package and had no way to search or navigate memory
  inside the loop.
- **G2 — retrieval was not hybrid.** Each item was scored by EITHER a cached
  semantic vector XOR a lexical cosine — one weak channel decided everything;
  nothing fused independent evidence.
- **G3 — no progressive lifecycle.** Items were verbatim forever or
  destructively compressed in place; "levels of memory" existed only as a
  tier *table*, not as a lifecycle evidence actually flowed through.
- **G4 — poisoning defenses only ran at admission.** Nothing re-validated
  content at render time; a row written before a rule existed, or written
  by any path that bypassed admission, went straight into the prompt.
- **G5/G8 — no conflict resolution, no selective forgetting, no undo.**
- **G6/G7 — recall unmeasured.** No benchmark; the @100k latency budget was
  proven only at the perf-gate lane, never in the test suite, and the
  repository's own write path could not even seed 100k rows (it stalled at
  ~53k — see "Prepared statements" below).

## Decision

1. **Progressive, evidence-preserving lifecycle (T1).** Items flow
   `verbatim → summary → condensed`, with originals never deleted: they become
   `externalized` — standing down from *progressive* retrieval (the summary
   stands for them) while remaining reachable via depth-deeper retrieval and
   navigation links. Summaries are always `generated_synthesis` trust with
   `model_synthesis` provenance and **hard-bounded to never outrank source
   evidence**. Promotion uses the Phase-2 fail-safe compressor; when its
   invariants cannot hold, the batch stays verbatim (fail closed).

2. **Three-channel hybrid retrieval with RRF (T2).** Lexical (hashing cosine,
   mandatory offline baseline), semantic (routed embedding; **abstains** —
   returns null rather than emitting a cross-space garbage cosine), and
   structured (tags/type/provenance/scope hints). Fusion is Reciprocal Rank
   Fusion (k=60), normalized to 0..1, with every channel's pre-fusion score
   recorded in the retrieval explanation (lineage-first). External citation
   for the pattern: BM25+vector vs single-channel recall,
   https://github.com/rohitg00/agentmemory.

3. **Memory-as-tools (T3).** Four read-only tools — `memory_search`,
   `memory_get`, `memory_navigate`, `memory_conflicts` — registered through
   the normal registry (same approval/audit/scope machinery as every tool).
   All results are prefixed as REFERENCE DATA and pass the render-time gate;
   retrieved content can never become authority (Art. VIII.3).

4. **Render-time integrity gate + expanded patterns (T4).**
   `verifyInjectionSafety` is now *invoked* (previously present but not on the
   path): every injection package and every memory-tool result is re-validated
   at render time — poison patterns re-scanned, consent/revocation/expiry
   re-checked, instruction-channel invariants enforced; quarantines are forced
   into the quarantine channel, and failures drop content (fail closed).
   11 new pattern classes (indirect control, consent bypass, verification
   laundering, role assignment, secret loosening, retention forgery, evidence
   destruction, tool-pattern graft, template smuggle, JSON role smuggle,
   memory suppression) with a committed 30-entry attack corpus asserting
   100% detection.

5. **Conflict resolution, selective forgetting, undo (T5/T6).**
   Supersession chains auto-resolve (decided by policy); live contradictions
   surface through `memory_conflicts` and resolve by explicit user decision
   (`keep_a | keep_b | stale | both`) — the loser is superseded, its trust is
   never silently rewritten, and the decision is a first-class, undoable
   ledger row. Selective forgetting is expiry-based and reversible. EVERY
   mutating op writes a before-image to the `context_ops` ledger; `undo`
   restores byte-for-byte (double-undo is refused), covering the legacy
   `user_memory` table as well.

6. **Recall is measured (T5 benchmark).** A MemoryAgentBench-style harness
   (inject-once/query-many; 4 domains × 4 competencies; deterministic id
   assertions, no LLM judge; protocol per arXiv:2507.05257) runs through the
   REAL retrieval pipeline and asserts declared targets. Results persist to
   `docs/phase6/measured-recall.json`; CI asserts them in
   `test/context/recall-benchmark.test.ts`. Numbers are cited from those two
   artifacts only.

7. **Local-only by construction (T7).** The lexical route is the mandatory
   default; `test/context/local-only.test.ts` runs the whole knowledge path —
   record → hybrid retrieve → tools → promote → compress → inject — and the
   benchmark itself with the network killed.

8. **One store, forever (T8).** `test/architecture/one-store.test.ts`
   executable-checks: `src/memory/` never reappears; the canonical tables are
   created by exactly one module; no repository binds a private connection;
   and no percentage-level recall claim exists in src/docs/README without a
   harness or citation anchor.

### Two implementation findings folded into this ADR

- **Lifecycle-aware tier resolution.** The frozen tier table routes
  `task_context` to `task_summary` (ceiling `generated_synthesis`) by default,
  which silently rejected verbatim task evidence (`source_evidence` trust) —
  discovered because the LRC benchmark family returned empty. Tier resolution
  is now type-AND-stage aware (`defaultTierForItem`): verbatim/externalized
  task evidence resolves to `immediate` (whose ceiling is exactly
  `source_evidence`), summaries/condensates stay in `task_summary`. The
  `TIER_POLICIES` table itself is unchanged — ceilings are never weakened.
- **Prepared-statement caching.** The Phase-1 WriteGate strongly retains every
  prepared statement until connection close; per-call `prepare()` (the prior
  repository pattern) was an unbounded leak — measured ~16 KB RSS per distinct
  statement and a >100 s stall at ~53k statements, which made the @100k
  budget un-seedable through the repository. `ContextRepository` now compiles
  each distinct SQL string once. Semantics unchanged (single-writer gate
  still serializes); 100k rows seed in ~3.8 s; retrieval p95 @100k measured
  22.5–25.9 ms against the 100 ms budget.

## Consequences

- **Positive:** retrieval quality is fused and explainable; memory is
  navigable *inside the agent loop*; poisoning defenses hold at write AND
  render time; compression never destroys evidence; conflicts are resolvable,
  forgetting selective, and every mutation reversible; recall is a measured
  number with a CI gate; the @100k budget is provable from a clean checkout.
- **Costs:** RRF adds per-query channel work (measured well inside budget —
  see `docs/phase6/measured-recall.json`); the ops ledger grows with
  mutations (bounded by `listOps` limits; prune story noted in
  `KNOWN-LIMITATIONS.md`); two size waivers re-recorded (`types.ts`,
  `repository.ts`) with owners and dates.
- **Not in scope (Phase 10/11 per constitution):** remote or multi-tenant
  memory sync, LLM-judged benchmarks, embedding-model management. No such
  claim is made anywhere.

## Verification

`docs/phase6/05-TEST-RESULTS.md` (full gate output + measured matrices),
`docs/phase6/BENCHMARK-METHODOLOGY.md` (protocol and what it does/doesn't
prove), `docs/phase6/KNOWN-LIMITATIONS.md` (honest edges).
