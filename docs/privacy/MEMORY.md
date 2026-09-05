# Memory — what XR stores, where, who can read it, and how to delete it

*Phase 7 (F-21) — the memory policy layer. This is the privacy contract for
durable memory; every statement below is pinned by a test named in the last
section or by a code reference. Where a mechanism is deterministic rather than
intelligent, this page says so.*

## 1. What is stored

Durable memory is the `user_memory` table in your local workspace database
(`$XR_HOME/xr.db`, SQLite, WAL, single writer — ADR-0001). Nothing leaves the
machine unless *you* export it.

| Column group | Contents | Since |
| --- | --- | --- |
| content | `content` (≤ 2,000 chars), `category` (fact · preference · project · workflow · exclusion), `scope` (`global` or a project key), `tags`, `importance` (1–5), TTL (`expires_at`) | 4.4 |
| consent & trust | `consent_state` (approved · limited · proposed · quarantined · revoked · deleted · not_eligible · `legacy_unknown`), `trust_status`, `sensitivity`, `revoked_at`/`revoked_reason` | 4.5 |
| provenance | `provenance_kind`, `provenance_ref`, `actor_kind`, `actor_name`, `source_observed_at`, `confidence` | 4.5 |
| lineage | `superseded_by` (the entry that corrected, out-arbitrated, or consolidated this one) | 4.5 / real from 7 |
| **policy (Phase 7)** | `agent_visibility` (JSON role list, default `["*"]`), `kind` (fact · preference · episode · procedure · summary), `confidence_score` (numeric projection of `confidence`; `unknown` stays NULL), `provenance_event_id` (audit-chain hash of the `memory.add` event that created the row) | 7 |
| index cache | `embedding`, `embedding_model`, `embedding_dim`, `content_hash`, `index_state` — a local vector cache, rebuilt on demand | 4.5 |

Also on disk:

- `memory_conflicts` — the contradiction ledger (ids, similarity, status; **never content**).
- `context_items` / `context_provenance` — the typed projection of memory the
  context assembler reads (migration 2 re-uses the memory id).
- `context_ops` — the undo ledger: before/after images of undoable memory
  operations (`remove`, `edit`, `resolve`). **These images contain content** —
  see §5 for why `forget` purges them.
- `audit_log` — hash-chained events. Memory events carry ids, lengths, and
  labels, never content (pinned by test).

**What is never stored:** raw conversation transcripts as memory (only what you
or a run explicitly `remember`), secrets recognised by the scanner (masked at
export; quarantined at write when they look like an instruction), and any
memory when `XR_MEMORY_DISABLED=1` or `memory.enabled=false`.

## 2. Who wrote it — provenance is mandatory

Every write passes `resolveWriteProvenance()` (`src/context/memory/provenance.ts`):

| Write channel (`source`) | Required `provenance.ref` | Stored as | Trust ceiling | Consent |
| --- | --- | --- | --- | --- |
| `user` (CLI `xr memory add`, shell `remember …`) | optional | `user_input` / actor `user` | `approved_memory` | approved |
| `chat`, `voice` | optional | `user_input` / `user` | `approved_memory` | approved |
| `research` (`xr research remember`) | optional | `research` / `system` | `generated_synthesis` | approved (you commanded it) |
| `import` (`xr memory import`) | optional | `import` / `system` | `unknown` | approved |
| **`tool`** (plugins, tool outputs) | **required** — e.g. `plugin:<id>`, `tool:<name>` | `tool_output` / `agent` | `untrusted_external` | **proposed** (an agent actor cannot self-approve) |
| **`agent`** (worker roles) | **required** — `agent:<role>` | `model_synthesis` / `agent` | `generated_synthesis` | proposed |
| **`schedule`** (consolidation job) | **required** — job id | `model_synthesis` / `system` | `generated_synthesis` | approved (maintenance you ran) |

A `tool`/`agent`/`schedule` write with no reference is **rejected**
(`provenance required: …`), never defaulted to "user". A provenance source that
contradicts the channel (`source:"tool"` claiming `provenance.source:"user"`) is
rejected. The admission gate (`admitContextWrite`) then clamps trust to the
provenance ceiling and quarantines poisoning signatures — the caller cannot
assert trust.

Every row's `provenance_event_id` is the audit hash of its `memory.add` row, so
`xr audit` can show the exact ledger entry that created any memory.

## 3. Who can read it — the retrieval ACL

`MemoryStore.recall / recallExplain / recallSemantic / recallSemanticExplain`
take an optional `principal` (default `"user"`) and apply, per candidate
(`src/context/memory/acl.ts`, pure, no model):

1. **scope** — `global` + the requested project scope (unchanged).
2. **role visibility** — `agent_visibility`:
   - `["*"]` (the default and the migration backfill) → every principal. **Existing memories are not restricted by Phase 7.**
   - a list without `*` → *sequestered*: only the listed roles. Coordinators (`supervisor`, `synthesizer`, `memory_manager`) are **not** exempt — a sequestered row must list them too.
   - principal `"user"` (CLI, shell, voice, research) → sees everything. It is your memory; hiding rows from the owner would be theatre.
3. **consent** — `quarantined`, `proposed`, `revoked`, `deleted`, `not_eligible` never retrieve (they are visible only through `xr memory pending` / `xr memory list --json` / labelled export).
4. **lineage / TTL** — superseded and expired rows are not current.

Trust does **not** gate retrieval; it labels the hit's channel: `data` for
approved/generated trust, `quarantine` for `untrusted_external`/`unknown`.
Retrieved memory can never occupy the instruction channel — recall has no
instruction path by construction, and `channelFor()` in the context assembler
quarantines untrusted items in every tier (poisoning-corpus property test).

Where the principal comes from today:

| Caller | Principal |
| --- | --- |
| `xr memory recall`, voice, research CLI | `"user"` |
| agent loop legacy block (`src/core/agent.ts`) | the run's `AgentIdentity` (role) or `"user"` |
| context assembler (`ContextService.assembleWithGrant`) | the grant's requester (`agent` kind + role → role principal) |
| agent tools `memory_search` / `memory_get` / `memory_navigate` | the tool set's requester (the run's role) — search through the assembler; by-id reads through `adaptedMemoryItem(id, store, requester)`, so a row the ACL hides is reported as absent rather than fetched by id |
| multi-agent memory-manager task | `memory_manager` |
| plugin `host.memory.recall` | `plugin` role (hits carry their `channel` label) |

Sequester a note: `xr memory add "…" --visible-to builder,reviewer`. A
correction (`xr memory correct`) inherits the original's visibility; a
consolidation summary carries its group's visibility — neither ever widens it.

## 4. Contradictions — arbitration on write

A new row is compared with the retrievable rows of the same scope + category
using the **lexical** vector (`lexicalVector`/`cosine` — token overlap, no
model). Cosine ≥ `0.6` opens an `open` row in `memory_conflicts` (at most the 3
most similar peers per write, bounded work) and one `memory.conflict.detected`
audit. **Nothing is overwritten and nothing auto-wins.** Both rows keep
retrieving until you decide:

```
xr memory conflicts                     # open contradictions
xr memory resolve <a> <b> --keep a      # b is SUPERSEDED (kept, inspectable, undoable via xr memory undo)
xr memory resolve <a> <b> --keep both   # closes the conflict, both stay current
```

Honest limits: token overlap flags *near-duplicates that differ* (Friday vs
Thursday; tabs vs spaces), which is the contradiction shape that matters for a
preference store, but it also flags harmless paraphrases and misses semantic
contradictions with different wording. It is a detector for you to review, not
a judge.

## 5. Deleting — three different verbs

| Command | Effect | Undo | Audit |
| --- | --- | --- | --- |
| `xr memory revoke <id>` | consent → `revoked`; row stays for lineage, never retrieves | re-add only | `memory.revoked` |
| `xr memory remove <id>` | row deleted; a **before-image is kept in the undo ledger** | `xr memory undo` | `memory.removed` |
| **`xr memory forget <id> \| --query "…" \| --scope <s>`** | **irreversible**: row deleted, cached vector nulled, undo-ledger images purged, context projection + provenance links deleted, open conflicts closed | **none** | `memory.forgotten` (ids + counts, `irreversible: true`) |
| `xr memory clear` | everything (confirmation) | ledger images may remain — use `forget --scope` for an irreversible wipe | `memory.cleared` |

`forget` asks for confirmation (`-y` to skip) and writes its audit row **last**,
so the ledger only ever claims what actually happened. The audit row never
contains the forgotten content. What `forget` cannot do: erase rows that were
already **exported**, copies inside a provider's logs from earlier prompts, or
the hash-chain entries that recorded the write (those hold ids and lengths, not
text).

## 6. Exporting — portability with labels

```
xr memory export notes.json                       # xr-memory v2 (v1 bundles still import)
xr memory export notes.md --md                     # human-readable
xr memory export --scope acme --include-quarantined
xr memory export --no-redact                       # keep secret-looking substrings
```

- Scoped export follows recall semantics (project rows **plus** `global`).
- Quarantined / revoked / proposed rows are exported **only** with
  `--include-quarantined`, and always with a `quarantineLabel`
  (`QUARANTINED`, `REVOKED`, `PROPOSED (not yet approved)`, `UNTRUSTED`). A
  poisoned item leaves the system as evidence, never laundered as a fact.
- Secret-looking substrings are masked by default (`maskSecrets`); the count is
  reported.
- `agent_visibility` and `kind` round-trip through export/import; an imported
  bundle cannot bypass write validation.

## 7. Consolidation — supersede, never destroy

`xr memory consolidate [--dry-run] [--days 30] [--max-importance 3] [--scope s] [--max-tokens n] [-y]`

Folds groups (same scope + category + visibility, ≥ 3 rows, older than N days,
importance ≤ 3) into one `kind: summary` row (`source: schedule`, provenance
`consolidate:<timestamp>`) that **cites every original id**. Originals are
**superseded, never deleted** — they leave retrieval but remain in
`xr memory list --json`, export, and `superseded()`.

- **Idempotent:** superseded rows and summaries are never candidates; a group
  whose summary already exists is skipped. Running twice yields the same state
  (pinned by test).
- **Budgeted:** the job meters itself through its own `CostGovernor` envelope
  (`--max-tokens`, default 200k). The default summariser is **deterministic**
  (bullet list with citations, $0, tokens counted as chars/4). A model-backed
  summariser can be supplied programmatically; every group is admitted by
  `checkBeforeStep()` and the job stops honestly at the ceiling, reporting the
  untouched groups as `skipped`.
- **Audited:** `memory.consolidate.plan`, `memory.consolidate.applied` (summary
  id + superseded ids), `memory.consolidate.budget_stop`.
- **Manual only** in 1.0 (`suggestConsolidation()` is a read-only probe for a
  status hint; nothing runs unasked).

The older `xr memory summarize` remains and still *deletes* what it folds — its
contract is pinned by its own tests. Prefer `consolidate`.

## 8. Legacy injection is deprecated

`knowledge.injectionMode = "legacy" | "both"` injects recalled memory as an
unlabelled **system** message. It still works in 1.x but:

- `loadConfig()` emits a deprecation warning (shown by `xr doctor` / install health),
- `xr context status` marks the mode `DEPRECATED — removed in 2.0`,
- the legacy block is now principal-filtered and drops quarantine-channel hits,
  and its audit row carries `legacyInjection: true`.

`"context"` (channel-separated, ACL-gated, data-role) is the default and the
only path from 2.0.

## 9. Migration

Schema migration **9** (`phase7_memory_policy`) adds the four policy columns and
the conflict ledger. Backfill: `agent_visibility = ["*"]` for every existing row
(no silent restriction), `kind` inferred from category (`summary` tag → summary,
preference → preference, workflow → procedure, project/fact → fact, exclusion →
NULL because an exclusion is a policy, not a memory), `confidence_score` from the
textual `confidence` (`unknown` stays NULL — never invented),
`provenance_event_id` NULL for legacy rows (there is no honest event to point
at). Down-migration drops the table and columns. Content, ids and consent are
untouched (pinned by test).

## 10. What is real, partial, and not yet

| Claim | Status |
| --- | --- |
| Per-agent ACL enforced at retrieval | **Real** at `MemoryStore.recall*`, the context assembler and the agent tools (search, by-id read, navigation); callers that construct a `MemoryStore` and call `recall` without a principal get owner semantics (`"user"`) — deliberate, documented above |
| Provenance mandatory | **Real** for the three non-human channels; human channels default to `user` (the 70+ existing call sites are the human) |
| Contradiction arbitration | **Real, lexical** — a detector with a review UX, not semantic understanding |
| Consolidation | **Real, deterministic** by default; model-backed summariser is an optional hook, no CLI flag yet |
| Forget irreversibility | **Real** for the workspace DB (row, vectors, ledger images, projection); cannot reach exported copies or provider-side logs |
| Export with quarantine labels | **Real** |
| Legacy injection retired | **Deprecated with working warning**; removal is 2.0 |
| Migration backfill | **Real**, tested against a 4.4-shape database |

## 11. Tests

`test/context/phase7-memory-policy.test.ts` — ACL matrix; worker-cannot-recall-
sequestered (lexical + semantic); correction inherits ACL; legacy default keeps
visibility; provenance rejection + schema-level event id; tool/agent clamping;
conflict detect (idempotent, bounded) / resolve; consolidation supersede,
idempotence, visibility split, budget stop; forget by id/query/scope with
audit; export scope/labels/redaction/round-trip; poisoning-corpus property
(every entry × every channel × every principal × every tier ⇒ never
`instruction`); migration-9 backfill on a 4.4 database; architecture (policy
columns read only by the memory policy modules; capability policy / guard /
agent loop never consult them; the ACL decision type carries no grant).
