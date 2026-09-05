# XR 4.5.0 Release Checklist — Knowledge and Context OS

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


## Version

- [x] `package.json` → 4.5.0
- [x] `src/core/version.ts` → 4.5.0 "Knowledge and Context OS"
- [x] `website/src/lib/site.ts` stamped
- [x] `bun run set-version:check` green

## Quality gates

- [x] `bun run typecheck` — no errors
- [x] `bun test` — 939 pass / 2 fail (pre-existing OS-sandbox env, unchanged from Phase 5)
- [x] 190 new context tests across 8 suites, all green
- [x] Test suite grew 748 → 941
- [x] Repeated-run stability verified (no fixture leakage)

## §18 release criteria

| Criterion | Status | Evidence |
|---|---|---|
| No critical cross-workspace leakage | ✅ | workspace fence is the first check; retrieval proof test |
| No critical memory poisoning / instruction escalation | ✅ | 39 security tests; type+trust+tier triple gate |
| Consent / revocation / deletion tested | ✅ | 25 migration tests + live CLI verification |
| Provenance and uncertainty not falsely represented | ✅ | `legacy_unknown`, null refs, confidence ≠ truth |
| Retrieval / injection scope correct | ✅ | authorization precedes ranking, asserted |
| Compression preserves required evidence | ✅ | fail-safe; 21 compression tests |
| Phase 0–5 validation green | ✅ | Stage A |
| Local-only operation works | ✅ | lexical route, zero network; whole suite is offline |
| Durable resume / context invalidation works | ✅ | 20 durable tests incl. revoked-before-resume |
| Performance and storage measured | ✅ | Stage F table |
| Migration and rollback tested | ✅ | real 4.4 DB + 3 rollback levers |
| No Phase 7+ capability presented as shipped | ✅ | non-goals documented in ARCHITECTURE §18 |

## Security

- [x] Only `instruction` type + `trusted_instruction` trust can direct behavior
- [x] Untrusted content quarantined in the **user** role, fenced, emitted last
- [x] Instructions cannot be created through the context write path at all
- [x] Provenance trust ceilings can only lower trust, never raise it
- [x] Plugins/MCP forced to `proposed` + `untrusted_external`; no memory tier
- [x] Model actors clamped to `generated_synthesis`
- [x] Revocation destroys cached vectors and writes an append-only ledger
- [x] Rejection records carry no item content
- [x] Secrets and external paths masked before prompt entry
- [x] Resumed tasks revalidate consent, revocation, scope, and freshness
- [x] `enforceScope: false` is documented as unsafe and never a rollback path

## Compatibility

- [x] All XR 4.4 `MemoryStore` methods preserved (read methods return a superset type)
- [x] `buildMemoryBlock()` unchanged
- [x] `runAgent()` without a context package behaves exactly as 4.4
- [x] `UserMemoryRepo` still registered
- [x] Config migration 14 → 15 additive; memory settings untouched
- [x] Legacy memory readable, recallable, and never re-consented automatically
- [x] 4.5 database opens under a 4.4 binary (additive columns ignored)

## Intentional behavior changes (documented)

- [x] Plugin memory writes land as `proposed` and require user approval
- [x] Multi-agent workers get enforced `MemoryScope` tiers instead of memory-off
- [x] Embedding model selection moved to the Phase 5 plane
- [x] Message compaction preserves evidence up to 400 chars

## Documentation

- [x] `PHASE6_AUDIT_DELIVERABLE.md` — 11-part pre-implementation audit
- [x] `docs/phase6/ARCHITECTURE.md`
- [x] `docs/phase6/DEVELOPER_GUIDE.md`
- [x] `docs/phase6/USER_GUIDE.md`
- [x] `docs/phase6/MIGRATION_4.4_to_4.5.md`
- [x] `docs/phase6/VALIDATION_REPORT.md`
- [x] `docs/phase6/RELEASE_CHECKLIST.md`
- [x] `CHANGELOG.md` 4.5.0 entry
- [x] Limitations stated honestly in user guide, migration guide, and validation report

## Rollback readiness

- [x] Lever 1 — `knowledge.injectionMode: "legacy"` (4.4 injection)
- [x] Lever 2 — `knowledge.enabled: false` (disable the layer)
- [x] Lever 3 — `memory.enabled: false` (the original 4.4 switch)
- [x] Lever 4 — restore DB from backup
- [x] Provenance and revocation records survive levers 1–3
- [x] Rollback never restores silent capture or unscoped retrieval

## Sign-off

| Role | Status | Note |
|---|---|---|
| Runtime | Ready | typecheck + 939 tests green |
| Security | Ready | 39 poisoning/isolation tests; no escalation path found |
| Knowledge | Ready | taxonomy, provenance, evidence, compression validated |
| Release | Ready | migration + rollback verified on a real 4.4 database |
