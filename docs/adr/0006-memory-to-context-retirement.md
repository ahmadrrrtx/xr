# ADR 0006 — Retiring `src/memory/` into the canonical `context/` store

**Status:** Ratified (Phase 2, 2026-07-31)
**Applies to:** All durable context and long-term memory
**Supersedes:** `src/memory/` as a top-level module — **removed**
**Constitutional basis:** Art. V "Compliant Designs" (*"A `context/` module that
owns all durable context, with `memory/` retired on a dated schedule"*),
Art. III.2, Art. XXIII (reversibility), Art. IV.5 + Inviolable P5 (consent is
never fabricated), Art. XXVII (deprecation cycle)

The Constitution names this exact consolidation as the compliant design. This
ADR executes it.

---

## Context

Two durable-context authorities existed:

| Module | Files | LOC | Surface |
|---|---|---|---|
| `src/memory/` | 9 | 2 646 | table `user_memory`; CLI `xr memory` |
| `src/context/` | 15 | 6 679 | typed `ContextItem`; CLI `xr context` |

Both were CLI-exposed (`cli/router.ts:143-147`), both were injected into the
agent (`core/agent.ts` imported from **both**), and 18 production files imported
`memory/*`. `context/memory-adapter.ts` already mapped `MemoryEntry →
ContextItem`, which is evidence the seam was already painful.

## Decision — expand → migrate → contract

### EXPAND — a reversible, numbered migration

`MIGRATION_2` (`memory_to_context_projection`) in `src/state/migrations.ts`
projects every `user_memory` row into `context_items`.

- **Additive.** `up()` never mutates or deletes a legacy row. The legacy table
  survives untouched, which is what makes `down()` exact.
- **Exactly reversible.** `down()` deletes only what `up()` created, identified
  by the `legacy:user_memory` tag marker. Rows authored natively in the context
  store are untouched.
- **Transactional across processes.** Both directions run inside the Phase-1
  `WriteGate` — one serialized `BEGIN IMMEDIATE` per migration — so a concurrent
  XR process can never observe a half-migrated store.
- **Never blocks startup.** If the context tables are absent, the migration is a
  no-op.

### Migration honesty (Art. IV.5, Inviolable P5)

XR cannot reconstruct how consent was given for a legacy row. Therefore
`consent_state` is **`legacy_unknown`** — never `approved`. Items stay
retrievable and are flagged for re-affirmation. Trust and provenance are derived
from the existing, honest `source` column; nothing is invented. Sensitivity is
inferred conservatively — nothing is optimistically labelled "public".

An `exclusion` becomes an `instruction` with `trusted_instruction` trust: it is
a user policy directive, and storing it as "memory" was the taxonomy error the
context model already identified.

### MIGRATE

All 31 importing files repointed.

### CONTRACT

`src/memory/` is **deleted**. The engine moved to `src/context/memory/` and is
re-exported from `context/index.ts`. Durable context now has exactly one home.

**Why the engine still serves `user_memory`:** a lossless migration must not
delete its source, and Art. XXIII requires a downgraded database to remain
readable by code that does not know the migration. The legacy table is the
system of record for pre-Phase-2 rows until the deprecation window closes.

## Enforcement

`test/state/memory-to-context-migration.test.ts` — 17 tests against a real
SQLite store, no mocks:

- every legacy row becomes a context item;
- **`user_memory` is byte-identical before and after `up()`** (losslessness);
- consent is `legacy_unknown` for every projected row — never `approved`;
- `down()` removes exactly what `up()` created and **nothing natively authored**;
- `up() → down() → up()` is stable;
- a downgraded database is **still readable by the legacy memory engine**;
- `up()` is idempotent and is a no-op when context tables are absent.

`test/architecture/boundaries.test.ts` fails the build if any module imports
`src/memory/` again.

## Consequences

**Positive.** One durable-context authority, as the Constitution specifies. No
user data lost or reinterpreted. The consent-honesty rule is now enforced by a
test rather than by a comment.

**Negative.** Two storage shapes coexist during the compatibility window
(`user_memory` rows plus their `context_items` projection). That is the cost of
a reversible migration; the alternative — deleting the source — would make
rollback impossible.

## Removal schedule

| Item | Status | Removal |
|---|---|---|
| `src/memory/` as a top-level module | **removed** in Phase 2 | done |
| `xr memory` CLI | **kept** as a working alias (Art. XXVII) | no earlier than **8.0.0** |
| `user_memory` table + `context/memory/*` engine | retained as system of record | **8.0.0**, only after a dated deprecation notice and a second reversible migration that drops it |

The table is deliberately **not** dropped in Phase 2. Dropping it would make
`down()` lossy and break the documented downgrade path — a retirement must not
buy tidiness with irreversibility.
