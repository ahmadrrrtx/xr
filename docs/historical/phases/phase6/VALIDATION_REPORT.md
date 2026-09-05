# XR 4.5 — Phase 6 Validation Report

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


**Product:** XR 4.5.0 Knowledge and Context OS
**Date:** 2026-07-26
**Baseline:** XR 4.4.0 Universal Intelligence Plane @ `9eeb2ad`
**Environment:** Bun 1.3.14, x64 Linux container
**Result:** **READY**

---

## Stage A — Prior phases

| Gate | Result | Evidence |
|---|---|---|
| Frozen install | ✅ | `bun install --frozen-lockfile`, 8 packages |
| Version sync | ✅ | `set-version:check` → v4.5.0 Knowledge and Context OS |
| Typecheck | ✅ | `tsc --noEmit`, no errors |
| Phase 0 baseline | ✅ | `test/baseline/*` green |
| Phase 1 kernel | ✅ | `test/core/*` — 99 pass / 0 fail |
| Phase 2 + 4 execution | ✅ | `test/execution/*` — 61 pass / 0 fail |
| Phase 3 trust | ⚠️ green-with-known-env | 108 pass / 2 fail |
| Phase 5 intelligence | ✅ | `test/intelligence/*` — 34 pass / 0 fail |

The 2 trust failures require OS user namespaces, unavailable in this container.
They are byte-identical to the failures recorded in `PHASE5_VALIDATION_REPORT.md`
and are **not** regressions.

---

## Stage B — Static and schema validation

| Check | Result |
|---|---|
| Typecheck (whole repo) | ✅ |
| Additive-only migration | ✅ no `DROP`, no `ALTER … DROP`, no destructive rewrite |
| Idempotent migration | ✅ verified by reopening the same DB three times |
| Schema/metadata validation | ✅ every enum has a type guard and an `unknown` member |
| Scope/policy checks | ✅ `enforceScope` defaults on; disabling prints a red warning |
| Docs/path consistency | ✅ `docs/phase6/*` + `PHASE6_AUDIT_DELIVERABLE.md` |

---

## Stage C — Retrieval and context validation

Full suite: **190 pass / 0 fail** across 8 files.

| Suite | Tests | Result |
|---|---:|---|
| `taxonomy.test.ts` | 35 | ✅ |
| `security.test.ts` | 39 | ✅ |
| `retrieval.test.ts` | 21 | ✅ |
| `compression.test.ts` | 21 | ✅ |
| `durable.test.ts` | 20 | ✅ |
| `migration.test.ts` | 25 | ✅ |
| `injection.test.ts` | 18 | ✅ |
| `performance.test.ts` | 11 | ✅ |

Key assertions proven:

- exactly one type (`instruction`) may carry authority;
- exactly one tier (`instructions`) may instruct;
- **no** `memory`-typed item reaches the instruction channel at **any** trust level;
- an unauthorized item that would rank #1 is never scored;
- `legacy_unknown` is retrievable but flagged, and is never relabelled `approved`.

---

## Stage D — Security and privacy validation

| Threat (§7.9) | Test | Result |
|---|---|---|
| Untrusted → standing instruction | quarantine channel + role assertions | ✅ |
| Malicious memory insertion | 7 signature families, benign text unaffected | ✅ |
| Source spoofing | provenance ceilings clamp, never raise | ✅ |
| Stale overriding newer evidence | supersession + freshness conflicts | ✅ |
| Model claims as user facts | model actor → `generated_synthesis` | ✅ |
| Plugin/MCP escalation | forced `proposed` + `untrusted_external` | ✅ |
| Cross-workspace contamination | first check in `authorize()`; retrieval proof | ✅ |
| Unauthorized agent access | enforced `MemoryScope`, unknown fails closed | ✅ |
| Revoked item in cache/index | vector destroyed, ledger written | ✅ |
| Sensitive data in explanations | rejections contain no content | ✅ |

Verified additionally:

- quarantine blocks are emitted in the **user** role and **last**, so untrusted
  text cannot reframe trusted content;
- secrets (5 formats + PEM blocks) are masked before reaching a prompt;
- out-of-workspace paths are masked; in-workspace paths are preserved;
- a false-positive check confirms ordinary preferences are **not** quarantined.

---

## Stage E — Durable and intelligence integration

| Check | Result |
|---|---|
| Package checkpoint (id, version, hash) | ✅ |
| Package stores ids/metadata, **not** bodies | ✅ asserted with a canary string |
| Resume with unchanged context | ✅ `stillValid: true` |
| **Revoked memory before resume** | ✅ dropped, named, package re-versioned |
| Deleted source before resume | ✅ dropped |
| Consent withdrawn before resume | ✅ dropped |
| Content drift on resume | ✅ newer version used, drift recorded |
| Grant expiry on resume | ✅ everything dropped |
| Retrieval failure during recovery | ✅ degraded + stated reason, never wrong items |
| Embedding route via Phase 5 | ✅ |
| No second router | ✅ `embed.ts` is transport only |
| Provider unavailable | ✅ lexical fallback, **no silent cloud escalation** |
| Local-only policy honoured | ✅ |
| Embedding space mismatch | ✅ lexical on both sides, mode recorded |
| Index invalidation | ✅ workspace-wide |

---

## Stage F — Performance

Measured on this container (1,000-item corpus unless noted):

| Metric | Value | Threshold |
|---|---:|---:|
| Retrieval avg (1,000 items, lexical) | **14.5 ms** | < 250 ms |
| Retrieval single pass (5,000 items) | **13.0 ms** | < 1 500 ms |
| `authorize()` over 2,000 items | **2.1 ms** | < 500 ms |
| Package assembly (1,000 items) | **14.8 ms** | < 300 ms |
| Injection build (avg of 200) | **0.033 ms** | < 20 ms |
| Compression (100 items) | **4.0 ms** | < 500 ms |
| Compression ratio | **32.7%** of original | < 100% |
| Package revalidation | **0.56 ms** | < 100 ms |
| Assemble + persist | **6.3 ms** | < 300 ms |
| DB growth per context item | **791 bytes** | < 4 096 |
| DB size at 1,000 items | **776 KiB** | — |
| Legacy `MemoryStore.recall` (500 entries) | **5.3–6.2 ms** | < 200 ms |

**4.4 → 4.5 comparison:** the legacy recall path is unchanged in shape and still
runs in single-digit milliseconds with 20 additional columns present, so the
additive schema imposes no measurable regression on existing behavior. New
context assembly adds ~15 ms to a task's setup — well inside normal agent
latency and bounded by design.

---

## Stage G — UX and DX

| Surface | Result |
|---|---|
| `xr context` (status/list/inspect/explain/pending/legacy) | ✅ verified live |
| `xr context approve/revoke/correct/export/prune` | ✅ verified live |
| `--json` on every subcommand | ✅ |
| Daemon routes (8 endpoints) | ✅ all return 200 with expected shapes |
| Dashboard consent counters + pending queue | ✅ |
| Dashboard revoke with residual disclosure | ✅ |
| Accessibility: symbol-not-colour status | ✅ `[ok] [?] [legacy] [revoked] [!]` |
| Accessibility: destructive confirmation | ✅ states what is and is not removed |
| Developer guide answers all 11 source questions | ✅ |

Live CLI verification (excerpt):

```
$ xr context
XR Knowledge and Context OS
  policy            xr-4.5.0/context-v1
  scope enforcement on
User memory consent
  total             3 (2 in active use)
    [ok] approved         2
    [revoked] revoked          1
    [stale] superseded       1 (kept for correction history)
```

---

## Stage H — Migration and release

Verified against a **genuine XR 4.4-shaped database** (4 entries, no 4.5
columns, no context tables):

| Check | Result |
|---|---|
| Fresh database | ✅ all 5 context tables + 20 columns created |
| Existing 4.4 workspace | ✅ 4/4 rows preserved, zero loss |
| Consent migration | ✅ `{legacy_unknown: 4}` — **zero** `approved` |
| Trust derivation | ✅ user→approved_memory, research→generated_synthesis, exclusion→trusted_instruction |
| Provenance | ✅ mapped from `source`; `provenance_ref` **null** (nothing invented) |
| Recall after migration | ✅ works unchanged |
| 4.4-shaped SQL still valid | ✅ old column set selects cleanly |
| Idempotency | ✅ repeated opens are no-ops |
| Config v14 → v15 | ✅ additive; memory settings untouched |
| Backup/restore | ✅ file copy; 4.5 DB opens under 4.4 (extra columns ignored) |
| Rollback lever 1 (`injectionMode: legacy`) | ✅ |
| Rollback lever 2 (`knowledge.enabled: false`) | ✅ |
| Rollback lever 3 (`memory.enabled: false`) | ✅ |
| Revocation ledger survives rollback | ✅ |

---

## Full suite

```
939 pass
  2 fail   (pre-existing: OS namespace sandbox unavailable in this container)
Ran 941 tests across 81 files
```

Test growth: **748 → 941** (+193).

---

## Defects found and fixed during validation

| # | Defect | Severity | Fix |
|---|---|---|---|
| 1 | New 4.5 entries inherited the `legacy_unknown` column default, so a deliberate `xr memory add` was recorded as unknown consent | **High** (honesty) | `MemoryStore.add()` now stamps real consent/trust/provenance through the admission gate |
| 2 | `xr context status` hid revoked/superseded rows, concealing the very data the view exists to show | Medium | inspection surfaces now include revoked rows and report an "in active use" count |
| 3 | Rejection reason `trust_too_low_for_tier` was misnamed (it fires when trust is too **high** for a tier) | Low | renamed to `trust_not_permitted_in_tier` |
| 4 | Expired items were SQL-filtered before the rejection recorder, so users could not see that something was withheld | Low | expired ids are now reported (ids only, no content) |
| 5 | Backticks in a dashboard HTML comment terminated the template literal | Medium (build) | comment reworded |
| 6 | Phase 6 test fixtures were not cleaned up, exhausting the 993 MB `/tmp` tmpfs and causing 203 spurious failures | Medium (CI) | `afterEach` cleanup added to all 6 fixture-creating suites; verified stable across repeated runs |

Defect 6 is worth noting explicitly: the failures it produced looked like a
catastrophic code regression (`no such table: main.user_memory`). Root-causing
it to disk exhaustion rather than patching the symptom prevented a wrong fix.

---

## Known limitations (carried into release)

1. **Embedding vectors cannot be cryptographically un-learned.** XR deletes and
   invalidates stored vectors and states this plainly; it does not claim
   mathematical erasure.
2. **`rag_chunks` have no freshness column.** A chunk from an edited file can
   appear current until re-index. Deferred deliberately (touches the indexer
   contract) and documented in the user guide.
3. **Compression is deterministic, not model-assisted.** Summaries are
   structured and accurate rather than fluent.
4. **Legacy consent cannot be reconstructed** and remains `legacy_unknown` until
   the user reviews it.
5. **Sensitivity inference is conservative** — items default to `unknown` rather
   than being labelled safe without evidence.
6. **Two trust tests require OS user namespaces** and fail in this container;
   unchanged from Phase 5.

---

## Unresolved blockers

**None.**
