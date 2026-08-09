# Known Limitations — Phase 6 (Memory, Knowledge & Context Quality)

Honest edges of what Phase 6 shipped. None of these are silent: each points
at the test or code that pins current behavior.

---

## 1. The mandatory retrieval route is lexical — paraphrase robustness is routed

The offline baseline is a hashing-vector cosine: it matches terms, not
meanings (no stemming, no embeddings). Queries that paraphrase an item
without sharing vocabulary recall it only when the optional semantic channel
is active (routed embedding configured) — and that channel *abstains*
otherwise, never faking a score. The benchmark asserts floors on the lexical
route accordingly (`docs/phase6/BENCHMARK-METHODOLOGY.md` §5).

## 2. Benchmarks are floors, not distributions

Four fixtures × 11–13 items assert competency floors (R@5 1.000 measured on
them) — they cannot estimate recall on an arbitrary real memory. LLM-judged
lanes (full MemoryAgentBench, LongMemEval, LOCOMO) require a judge model or
network corpora, which the mandatory-offline gate forbids; they are future
work and are not claimed anywhere.

## 3. Selective forgetting is expiry-based, not byte-erasure

`xr context forget` hard-expires an item: it leaves every retrieval/index
path immediately and the op is recorded (undo restores it). The row's bytes
remain until a retention-policy prune removes them — `pruneExpired` only
hard-deletes rows whose retention is `ttl`/`session`/`task`, so a `durable`
forgotten row persists as an expired tombstone by design (evidence
preservation; `repository.ts::pruneExpired`).

## 4. Conflict *detection* is heuristic, resolution is exact

Open-contradiction surfacing relies on metadata signals (supersession chains,
`contradicted_by` pointers, task/tag co-membership — `poison.ts::detectConflicts`).
Two facts that contradict with no lexical/metadata overlap are not detected.
Once a conflict is surfaced, resolution is exact, recorded, and undoable.

## 5. Summaries are evidence-preserving, not prose

Promotion preserves the invariant evidence classes (decisions, corrections,
sources, dates, uncertainty, open questions — tested verbatim in
`test/context/lifecycle.test.ts`) and fails closed otherwise. It does not
guarantee narrative quality; nothing here is an LLM summary. Generation is
capped, and condensed summaries never exceed their sources in trust.

## 6. Pattern-based integrity has an obfuscation frontier

Admission and render-time scans use pattern classes. Deliberately obfuscated
payloads (spacing/encoding games) can evade a given pattern; containment then
rests on consent state, quarantine channels, and the never-authority rule
(Art. VIII.3). The corpus (30 attacks, 100% quarantined) is the detection
guarantee — not a real-world attack-success estimate.

## 7. The ops ledger grows; reads are bounded, storage is not yet pruned

Every mutation appends a before-image to `context_ops`. Listing is hard-limited
(`listOps`), but a prune/archival policy for the ledger itself is not yet
implemented — same posture as the revocation ledger it mirrors. Flagged for
the operator-docs prune pass.

## 8. Statement caching covers the context repository only

The prepare-once cache (ADR 0013) fixes the measured WriteGate-retention leak
for every context table. Other repositories still prepare per call; over very
long daemon uptimes their tracked-statement sets grow. The pattern to port is
documented in `src/context/repository.ts`; a wholesale port is a later-phase
refactor with its own regression budget.

## 9. Undo covers the recorded op set only

`undo` restores ops that wrote before/after images (context
approve/correct/revoke/delete/resolve/forget; legacy user_memory add/edit/remove).
Any future mutating path must go through the ledger to be undoable — enforced
by review + `test/context/undo.test.ts`, not by the compiler.

## 10. Memory tools require explicit enablement

`memory_search`/`memory_get`/`memory_navigate`/`memory_conflicts` register
only when `knowledge.enabled && memory.enabled` (fail closed — no config, no
memory-in-loop). Single-shot `requestContext` pre-run assembly is unaffected.

## 11. Deferred by constitution, not by omission

Phase-8 observability surfaces for memory metrics and Phase-10/11 remote or
multi-tenant memory are explicitly out of scope; no doc or CLI surface claims
them. The T8 guard (`test/architecture/one-store.test.ts`) fails CI if a
bare recall/accuracy percentage ever appears without a harness or citation
anchor.
