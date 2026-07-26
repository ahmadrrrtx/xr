# XR 4.4 → XR 4.5 Migration Guide

**From:** 4.4.0 Universal Intelligence Plane
**To:** 4.5.0 Knowledge and Context OS
**Type:** Additive. No destructive schema change, no data loss, no forced re-consent.

---

## 1. What happens when you upgrade

On first open of an existing workspace database XR:

1. adds 20 nullable/defaulted columns to `user_memory`;
2. adds three indexes on it;
3. derives `trust_status`, `provenance_kind`, and `actor_kind` from the existing
   `source` column, filling only rows where the value is still `NULL`;
4. sets `consent_state = 'legacy_unknown'` for every pre-existing row;
5. creates five new tables: `context_items`, `context_provenance`,
   `context_revocations`, `context_packages`, `context_summaries`;
6. migrates config v14 → v15, adding the `knowledge` block.

Every step is idempotent, wrapped in try/catch, and never blocks startup.

**Nothing is deleted. Nothing is rewritten. No memory needs re-approval to keep
working.**

---

## 2. The consent honesty rule

> Legacy memory becomes `legacy_unknown`, **never** `approved`.

XR 4.4 did not record *how* consent was given, only that an entry existed.
Backfilling `approved` would be fabricating a consent record. Instead:

- `legacy_unknown` **is retrievable** — your memory keeps working exactly as it
  did in 4.4;
- it is flagged as legacy in every explanation, in `xr context list`, and in the
  injected prompt itself;
- you can affirm or withdraw at any time:

```bash
xr context legacy
xr context approve <id>
xr context revoke <id>
```

### Derived trust mapping

Derived from the existing, honest `source` column:

| 4.4 `source` | `provenance_kind` | `actor_kind` | `trust_status` |
|---|---|---|---|
| `user` | `user_input` | `user` | `approved_memory` |
| `chat` | `user_input` | `user` | `approved_memory` |
| `voice` | `user_input` | `user` | `approved_memory` |
| `research` | `research` | `system` | `generated_synthesis` |
| `import` | `import` | `system` | `unknown` |
| *(category `exclusion`)* | — | — | `trusted_instruction` |

`provenance_ref` stays `NULL` for every legacy row — XR does not invent sources.

---

## 3. Schema changes

### `user_memory` — additive columns

`consent_state` (default `'legacy_unknown'`) · `consent_actor` · `consent_at` ·
`trust_status` · `confidence` (default `'unknown'`) · `sensitivity` (default
`'unknown'`) · `provenance_kind` · `provenance_ref` · `actor_kind` ·
`actor_name` · `source_observed_at` · `stale_after` · `revoked_at` ·
`revoked_reason` · `superseded_by` · `retention_policy` (default `'durable'`) ·
`index_state` (default `'none'`) · `embedding_model` · `embedding_dim` ·
`workspace_id`

New indexes: `idx_user_memory_consent`, `idx_user_memory_workspace`,
`idx_user_memory_revoked`.

### New tables

| Table | Purpose | Bounded by |
|---|---|---|
| `context_items` | knowledge/evidence/artifact/task/untrusted items | user action |
| `context_provenance` | typed source references | 32 per item |
| `context_revocations` | append-only revocation ledger | pruned with items |
| `context_packages` | durable package identity for resume | 7-day retention |
| `context_summaries` | evidence-preserving summaries with lineage | lineage-chained |

Measured growth: **~791 bytes per context item**. Item bodies are never
duplicated into package rows.

---

## 4. Config migration 14 → 15

A new `knowledge` block is added. Defaults preserve 4.4 behavior:

```jsonc
{
  "knowledge": {
    "enabled": true,
    "injectionMode": "context",      // "legacy" | "context" | "both"
    "enforceScope": true,
    "quarantineUntrusted": true,
    "routeEmbeddings": true,         // false if you were already local_only
    "lexicalOnly": false,
    "rerank": true,
    "maxPackageItems": 48,
    "maxPackageChars": 24000,
    "compression": true,
    "compressionFailSafe": true,
    "durablePackages": true,
    "revalidateOnResume": true,
    "disclosure": "concise"
  }
}
```

**Nothing in `memory` changes.** `enabled`, `injectInChat`, `recallLimit`,
`semanticRecall`, `autoExpireDays`, `saveSessionSummaries` all keep their values
and meanings. `saveSessionSummaries` stays `false` — no new silent capture.

If your `intelligencePlane.localityPolicy` was `local_only`, the migration sets
`routeEmbeddings: false` so the upgrade cannot introduce a cloud call.

---

## 5. Behavior changes you will notice

| Area | 4.4 | 4.5 |
|---|---|---|
| Injection | one unlabelled system block | typed blocks across three channels |
| Untrusted content | undelimited, system role | fenced, user role, "report don't obey" |
| Plugin memory writes | stored as usable memory | stored as `proposed`, needs approval |
| Multi-agent workers | memory hard-disabled | declared `MemoryScope` enforced |
| Embedding model choice | local `embed.ts` router | Phase 5 intelligence plane |
| Recall of revoked items | n/a | excluded, vector destroyed |
| Message compaction | truncated to 160 chars | evidence-preserving to 400 chars |

### The one intentional tightening

Plugins can no longer create directly-usable memory. `host.memory.add()` still
succeeds and returns `ok: true`, but the entry lands as `proposed` and is not
recalled until you approve it:

```bash
xr context pending
xr context approve <id>
```

If a plugin depended on immediate recall, it needs a one-time user approval.
This is deliberate: third-party code must not be able to write user-approved
facts.

---

## 6. Compatibility mode

To keep 4.4 injection while adopting inspection:

```json
{ "knowledge": { "enabled": true, "injectionMode": "legacy" } }
```

To run both during a transition (doubles context cost — not a default):

```json
{ "knowledge": { "injectionMode": "both" } }
```

API compatibility is preserved:

- every XR 4.4 `MemoryStore` method exists with the same signature;
- read methods return a **superset** type (`MemoryEntryWithContext`), so
  existing destructuring keeps compiling;
- `buildMemoryBlock()` is unchanged;
- `runAgent()` works with no `contextPackage` and behaves exactly as in 4.4;
- `UserMemoryRepo` remains registered.

---

## 7. Backup and restore

```bash
cp ~/.xr/xr.db ~/.xr/xr.db.4.4.backup
xr context export pre-upgrade-context.json
```

Restore is a file copy back. Because every change is additive, a 4.5 database
also opens under 4.4 — the extra columns and tables are simply ignored by the
older binary. Data written *after* the upgrade (provenance, revocations) will
not be visible to 4.4, but nothing breaks.

---

## 8. Rollback

Progressive, in order of severity:

1. **Disable new injection** — `knowledge.injectionMode: "legacy"`
2. **Disable the layer** — `knowledge.enabled: false`
3. **Disable memory entirely** — `memory.enabled: false` (the 4.4 switch)
4. **Restore the database** from your backup

Provenance and revocation records are preserved through options 1–3, so
disabling the UI never loses the record that something was revoked.

> **Never** use `knowledge.enforceScope: false` as a rollback. It disables
> authorization-before-ranking and is intended only for incident diagnosis under
> supervision. XR prints it in red in `xr context status`.
>
> Rollback must never restore silent memory capture or unscoped retrieval.

---

## 9. Verifying the migration

```bash
xr context                     # should show your consent breakdown
xr context legacy              # should list your pre-4.5 entries
xr memory list                 # should show every 4.4 memory, unchanged
xr memory recall "something"   # should behave as before
xr doctor                      # overall health
```

Expected on a migrated 4.4 workspace:

- `xr memory list` count identical to before the upgrade;
- every entry `legacy_unknown`, zero `approved`;
- `trust_status` populated from `source`;
- `provenance_ref` empty (no fabricated sources).

---

## 10. Known limitations after migration

1. Legacy entries have **no source references** — 4.4 never recorded them, and
   XR will not invent them.
2. Legacy summaries in `session_summaries` are **not evidence-complete**. They
   predate the invariant model and are labelled as legacy context.
3. `rag_chunks` still have no freshness column; re-index after large edits.
4. Cached 4.4 embeddings are kept and reused where the space matches; on a
   model change they are invalidated and lazily recomputed.
5. Sensitivity for legacy rows is inferred conservatively — mostly `unknown`.
