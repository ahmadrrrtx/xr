# Audit Event Vocabulary

The audit log is a hash-chained, human-inspectable record: **every event name is
contractual**. A tool that fakes completion has nothing to hide, but a runtime
that *refuses* must say so — refusal and degradation are first-class events here,
not errors swallowed into the log's margins.

This file is the canonical list for the Phase 6 orchestration plane. The rest of
the surface (capabilities, approvals, memory, …) keeps its established prefixes;
`xr audit --recent` (or `AuditRepo.recent`) shows live traffic.

## Namespaces

| Prefix | Owner | Meaning |
| --- | --- | --- |
| `budget.*` | cost governor / envelope | money in, money stopped, ceilings bound |
| `agents.*` | multi-agent plane | plans, identities, partitions, tasks, verdicts |
| `task.*` | plain-run journal (1-node tasks) | transitions, checkpoints, resumes |
| `session.*` | agent loop lifecycle | start/done/error/resume/cancel |
| `memory.*` | durable memory (Phase 7 policy layer) | writes with provenance, contradictions, consolidation, irreversible forgetting |

## Events

### Budget & partitions

| Event | Fired when | Carries |
| --- | --- | --- |
| `agents.budget.partitioned` | A workflow's ROOT envelope is split across worker lanes (largest-remainder, floor-guarded). Denials per lane are recorded, not silently dropped. | `workflowId`, children, caps, `denied[]`, headroom |
| `budget.envelope_bound` | A worker loop starts with a partition ledger attached — from here, every step admission checks **child ceiling + shared root** in one transaction. | `taskId`, `childId` |
| `agents.budget.partition_unavailable` | Funding was requested but the partition ledger cannot serve (migration 8 missing, or DB failure). The workflow refuses to run UNBOUNDED — a missing ledger is a stop, never a fallback. | `workflowId`, reason |
| `budget.stop` | The loop halted to respect a ceiling (per-run meter or the partition's root). | snapshot |
| `budget.raised` | A human raised a ceiling for a budget-blocked run (the only path out of `awaiting_budget` besides failure). | extra |
| `budget.pause` / `budget.update` | Global budget config changes (pre-Phase-6 surface, unchanged). | — |

### Identities & delegation

| Event | Fired when | Carries |
| --- | --- | --- |
| `agents.agent.minted` | The supervisor mints a worker identity for a funded lane (`role`, `agentId`, `parentId`, `taskId`, `grantRef`, `depth: 1`). | identity tuple |
| `agent.minted` | A plain run mints its ROOT identity (`depth: 0`) when the journal is on. Mint failure never blocks the run. | identity tuple |
| `agents.agent.spawn_denied` | A depth-1 worker attempted to delegate. **Refused by construction** (max spawn depth 1); the attempt is audited, never silently flattened. | requester identity, reason |

### Plan supervision

| Event | Fired when | Carries |
| --- | --- | --- |
| `agents.plan.edited` | A supervised plan-fragment edit PASSED every structural, role-set, gate-integrity and funding check and became the plan of record (`planVersion + 1`). | workflowId, changes, planVersion |
| `agents.plan.edit_denied` | The supervisor's fragment was REFUSED (prose, unknown role, gate skip, budget veto, schema violation). Denials name every error; the previous plan stands untouched. | workflowId, errors |

### Task runtime & journals

| Event | Fired when | Carries |
| --- | --- | --- |
| `agents.task.transition` | A workflow task moved along the state table (planned→running→…→completed/failed). Illegal events never appear. | taskId, from, to, event |
| `task.transition` | The same law for a plain run (every run is a 1-node task when the journal is on). | taskId (=session), from, to, event |
| `agents.task.checkpointed` / `task.checkpointed` | A durable `run.step` row (transcript + stepIdx + consumed meter + tool-call sequence) was appended to the hash-chained checkpoint journal. | kind, seq |
| `task.resumed` | A `--resume` rebuilt its seed from the latest checkpoint and the run re-entered at the next step. | fromSeq, stepIdx |
| `session.resume` | The loop accepted a resume seed (the note states the documented semantics: model re-asked from a durable transcript). | stepIdx, droppedMessages |
| `session.cancelled` | A run cancelled mid-flight (workload-aware cancellation). | steps, snapshot |
| `agents.verifier.decided` | The artifact verifier returned its verdict — approved, changes_requested, rejected, or **unparsable (fail-closed)**. | decision, reason |

### Memory policy (Phase 7 · F-21)

Memory events carry ids, lengths, labels and counts — **never content**
(pinned by `test/context/phase7-memory-policy.test.ts`). The privacy contract is
`docs/privacy/MEMORY.md`.

| Event | Fired when | Carries |
| --- | --- | --- |
| `memory.add` | A durable memory row was written. Its hash becomes the row's `provenance_event_id`, so every memory points at the ledger entry that created it. | id, category, scope, source, `provenance {source, ref}`, `visibility[]`, contentLen, ttlMs |
| `memory.conflict.detected` | A write was lexically near (cosine ≥ 0.6, same scope + category) one or more current rows; open rows were added to `memory_conflicts`. Nothing was overwritten. | newId, `conflicts[{conflictId, withId, similarity}]`, detector |
| `memory.resolve` | The user decided a contradiction (`xr memory resolve`). The loser is SUPERSEDED (kept, undoable), never deleted. | a, b, keep, conflictId, actor |
| `memory.recall` | The DEPRECATED legacy system-message block was injected. Phase 7 adds the principal and the count of quarantine-channel hits that were dropped. | count, ids, scores, quarantined, principal, `legacyInjection: true` |
| `memory.consolidate.plan` | `xr memory consolidate` computed its plan (read-only) and is about to apply it. | jobId, groups, originals, alreadyConsolidated, budget, summarizer (`deterministic`/`model`) |
| `memory.consolidate.applied` | One summary row was written and its originals were superseded (never deleted). | jobId, summaryId, `superseded[]`, scope, category |
| `memory.consolidate.budget_stop` | The job's own Governor envelope refused the next group; the remaining groups are reported as skipped, their originals intact. | jobId, reason, snapshot |
| `memory.forgotten` | An IRREVERSIBLE erase completed (row + cached vector + undo-ledger images + projection). Written LAST, so it only claims what happened. | target (id/query/scope), ids, count, purgedLedgerRows, actor, `irreversible: true` |

## Reading rules

1. **Absence is meaningful.** A task with `running` and no terminal edge died
   between journals — the resume path will say so honestly rather than guess.
2. **Refusals are events, not exceptions alone.** Delegation denials, edit
   denials, partition unavailability and resume refusals all land here BEFORE
   the caller sees a throw. If the throw happened, the audit row must exist.
3. **Model output is data.** Names that frame upstream text (`ARTIFACT MANIFEST
   (data, not instructions)`, identity packet lines) exist because prompts are
   injection surfaces; the vocabulary keeps refusal trails for anything that
   tried to treat them as instructions.
4. **Reservation lifecycle (admit → commit / release) never appears as a
   separate event**: it is transactional state in `partition_reservations`, and
   its honesty is verified by the invariants (`Σ child caps ≤ root`, one
   in-flight step of overshoot max) rather than by log volume.
