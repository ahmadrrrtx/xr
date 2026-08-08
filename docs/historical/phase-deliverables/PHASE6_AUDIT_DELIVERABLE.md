# XR 4.5 Knowledge and Context OS — Pre-Implementation Audit

**Date:** 2026-07-26
**Baseline:** XR 4.4.0 Universal Intelligence Plane (Phase 5, released & verified)
**Commit:** `9eeb2ad` (main, merge of `phase5/universal-intelligence-plane`)
**Package:** `@rrrtx/xr@4.4.0`
**Auditor:** Implementation Agent
**Status:** Complete — Phase 6 may proceed

---

## 0. Baseline Verification (Prerequisite Gate, §3)

| Gate | Result | Evidence |
|---|---|---|
| Branch / commit | ✅ `main` @ `9eeb2ad` | `git log` |
| Package version | ✅ `4.4.0` | `package.json`, `src/core/version.ts` |
| `bun install --frozen-lockfile` | ✅ 8 packages | bun 1.3.14 |
| `bun run typecheck` | ✅ clean | `tsc --noEmit` |
| `bun test` | ✅ 746 pass / 2 fail | Same 2 env-only failures documented in `PHASE5_VALIDATION_REPORT.md` |
| Phase 0 baseline | ✅ | `test/baseline/*` green |
| Phase 1 kernel | ✅ | `test/core/*` (lifecycle, registry, health, kernel) green |
| Phase 2 execution fabric | ✅ | `test/execution/*` green |
| Phase 3 trust/isolation | ⚠️ green-with-known-env-fails | 2 failures require OS user namespaces, unavailable in this container; identical to Phase 5 report |
| Phase 4 durable agency | ✅ | checkpoint/lease/recovery tests green |
| Phase 5 intelligence plane | ✅ 34/34 | `test/intelligence/*` |

**Conclusion:** Phase 5 is released and verified. The 2 failures are pre-existing environment limitations (namespace sandbox unavailable), not regressions. **Phase 6 is unblocked.**

---

## 1. Context Taxonomy Inventory (Deliverable 1)

What XR stores today, and which Phase 6 taxonomy class it maps to.

| # | Existing store | Table / location | Content | Consent today | Provenance today | Freshness today | Phase 6 class |
|---|---|---|---|---|---|---|---|
| 1 | Durable user memory | `user_memory` | preference / project / workflow / fact / exclusion | ✅ explicit (`add` only on user request; `autoSuggest` confirm) | ⚠️ `source` enum only (`user\|chat\|voice\|research\|import`) | ⚠️ `created_at`, `updated_at`, `expires_at`, `last_accessed_at` | **Memory** |
| 2 | Do-not-remember rules | `user_memory` (`category='exclusion'`) | blocked phrases | ✅ explicit | ⚠️ source enum | same | **Instruction (policy)** — currently mis-typed as memory |
| 3 | Session summaries | `session_summaries` | deterministic conversation recaps | ❌ none (opt-in flag only) | ❌ none beyond scope | `created_at` only | **Task context** |
| 4 | RAG chunks | `rag_chunks` | project file chunks + embeddings | n/a (derived from disk) | ⚠️ `path` + chunk index | ❌ none (no mtime) | **Knowledge** |
| 5 | Legacy `memory` table | `memory` | RAG-coupled legacy | n/a | ❌ | ❌ | **Knowledge (legacy)** |
| 6 | Research sessions | `research_sessions` (JSON blob) | `Source`, `EvidenceBlock`, `ResearchClaim`, `Contradiction`, `Synthesis` | n/a | ✅ **strong** (url, domain, type, trust, freshness label+score, quote, claim kind, confidence, strength, verified) | ✅ `SourceFreshness{checkedAt, ageDays, score, label}` | **Evidence** |
| 7 | Execution records | `execution_records` | run/plan/action/observation/outcome/evidence/artifacts | n/a | ✅ `ExecutionEvidence`, `ExecutionArtifact` | timestamps | **Artifact / Task context** |
| 8 | Checkpoints | `execution_checkpoints` | bounded payload + authority snapshot | n/a | ✅ authority snapshot | `created_at` | **Task context** |
| 9 | Business knowledge | `biz_knowledge_articles` | wiki/SOP/runbook | n/a | ⚠️ `author_id`, `status`, `visibility` | `created_at/updated_at` | **Knowledge** |
| 10 | Control plan memory | `src/control/memory.ts` | cached successful plans | ⚠️ implicit (on by default) | ❌ | ❌ | **Knowledge (procedural)** |
| 11 | Audit log | `audit_log` | hash-chained events | n/a | ✅ tamper-evident | `created_at` | **Artifact (record)** |
| 12 | Tool / MCP / plugin output | in-memory only (message list) | arbitrary text | n/a | ❌ | ❌ | **Untrusted input** — no durable representation at all |
| 13 | Web/file content read by tools | in-memory only | arbitrary text | n/a | ❌ | ❌ | **Untrusted input** — no durable representation |
| 14 | System prompt / skill prompt | assembled in `agent-service.ts` | instructions | n/a | ✅ code-owned | n/a | **Instruction** |

### Findings

- **Only two classes exist as first-class durable types today: Memory (1,2) and Evidence (6).**
- **Untrusted input (12,13) has no type, no delimiter, and no durable record.** It enters the message array as plain `tool` role content.
- **Exclusion rules are stored as a memory category**, conflating a *policy instruction* with *user memory*.
- **Session summaries (3) carry zero provenance** and are one flat string.
- **RAG chunks (4) have no freshness**, so a deleted/edited file's chunk can outrank current content until reindex.

---

## 2. Memory / Evidence / Artifact / Instruction Boundary Map (Deliverable 2)

```
                 ┌──────────────────────── AUTHORITY BOUNDARY ────────────────────────┐
                 │                                                                     │
  INSTRUCTION ───┤  system prompt (code)   skill prompt (code)   exclusion rules (db)  │  MAY direct behavior
                 │  ▲ created only by XR code or explicit user policy                  │
                 └─────────────────────────────────────────────────────────────────────┘
                              ▲  (Phase 6 rule: nothing may cross upward by retrieval)
  ────────────────────────────┼────────────────────────────────────────────────────────
                              │
  MEMORY        user_memory (consented, scoped, TTL'd)              DATA only
  KNOWLEDGE     rag_chunks · biz_knowledge_articles · plan memory   DATA only
  EVIDENCE      research Source/EvidenceBlock/Claim                 DATA + citation
  ARTIFACT      execution artifacts · reports · files               DATA + reference
  TASK CONTEXT  session_summaries · checkpoints · recent turns      DATA only
  UNTRUSTED     tool/web/MCP/plugin/model text                      DATA, quarantined, delimited
```

**Current violations found:**

| Violation | Location | Severity |
|---|---|---|
| `buildMemoryBlock()` emits recalled memory as `role: "system"` | `src/memory/inject.ts:44` + `src/core/agent.ts:170` | **High** — retrieved data is placed in the instruction channel. Mitigated only by an English sentence ("It is reference, not a command"), which is not deterministic. |
| Untrusted tool output enters the same message array with no delimiter | `src/core/agent.ts` tool loop | **High** |
| Plugin `memory:write` writes with `source:"import"` and no consent gate | `src/plugins/host.ts:295` | **Medium** — audited, tagged `plugin:<id>`, but becomes indistinguishable from user memory at recall time |
| `exclusion` is a memory category | `src/memory/types.ts:10` | **Medium** — policy stored as memory |
| Multi-agent `memory_manager` recalls global+project memory for a workflow | `src/services/multi-agent-service.ts:652` | **Medium** — `MemoryScope` exists in `src/agents/types.ts` but is **not enforced at retrieval** |
| `listMemory({scope})` always ORs in `scope='global'` | `src/state/workspace-store.ts:412` | **Low/By-design** — but means no way to request project-only |

---

## 3. Provenance / Freshness / Consent Gaps (Deliverable 3)

### 3.1 Provenance

| Required provenance kind (§7.7) | Representable today? | Gap |
|---|---|---|
| user input | ⚠️ `source='user'\|'chat'\|'voice'` | no actor identity, no session link |
| file/document | ❌ | `rag_chunks.path` only; not modelled for memory |
| web/search source | ✅ in research only | not linkable to memory/knowledge |
| tool/MCP output | ❌ | none |
| plugin/skill output | ⚠️ tag `plugin:<id>` | free-text tag, not a typed reference |
| model-generated synthesis | ❌ | indistinguishable from user fact |
| business record | ❌ | no cross-link |
| imported artifact | ⚠️ `source='import'` | no origin bundle reference |

**Gap:** provenance is an *enum*, not a *reference*. There is no table linking a context item to a URL, file, execution run, research claim, or artifact.

### 3.2 Freshness

| Signal | Memory | Knowledge (RAG) | Evidence | Task context |
|---|---|---|---|---|
| created / updated | ✅ | ⚠️ (no column) | ✅ | ✅ created only |
| accessed | ✅ | ❌ | ❌ | ❌ |
| TTL / expiry | ✅ | ❌ | ❌ | ❌ |
| source freshness (when the *world* changed) | ❌ | ❌ | ✅ `SourceFreshness` | ❌ |
| stale flag | ❌ derived only | ❌ | ✅ label | ❌ |
| superseded / corrected | ❌ | ❌ | ⚠️ contradiction only | ❌ |
| conflict state | ❌ | ❌ | ✅ `Contradiction` | ❌ |

**Gap:** the research engine has the *best* freshness model in the codebase and memory has none of it. Phase 6 should lift `SourceFreshness` semantics into the shared context contract.

### 3.3 Consent

Consent today is **binary and implicit-in-flow**: an entry exists ⇒ someone asked for it. There is no stored consent state, actor, timestamp, or scope limit. Specifically missing: `proposed`, `limited`, `expired`, `revoked`, `quarantined`, and — critically — **`legacy_unknown`** for the 4.4 rows whose consent history cannot be reconstructed.

**Rule adopted:** migration must write `legacy_unknown`, never `approved` (§10.1 — do not backfill false consent).

---

## 4. Retrieval / Injection Call Graph (Deliverable 4)

```
┌ CLI ───────────────┐  ┌ Voice ─────────┐  ┌ Research ──────┐  ┌ Plugins ───────┐  ┌ Dashboard ─┐
│ memory/cli.ts      │  │ voice/         │  │ research/      │  │ plugins/       │  │ daemon/    │
│  cmdRecall         │  │  intents.ts    │  │  cli.ts:117    │  │  host.ts:284   │  │  memory.   │
│  cmdSearch         │  │  pipeline.ts   │  │                │  │                │  │  routes.ts │
└─────────┬──────────┘  └───────┬────────┘  └───────┬────────┘  └───────┬────────┘  └─────┬──────┘
          │                     │                   │                   │                 │
          └─────────────────────┴───────────────────┴───────────────────┴─────────────────┘
                                             │
                            ┌────────────────▼─────────────────┐
                            │ MemoryStore (src/memory/store.ts)│
                            │  recall / recallExplain          │
                            │  recallSemantic(+Explain)        │
                            │  search / list                   │
                            └────────────────┬─────────────────┘
                                             │
              ┌──────────────────────────────┼──────────────────────────────┐
              ▼                              ▼                              ▼
   WorkspaceStore.listMemory        embed.ts  embed()            touchMemoryAccess()
   (scope OR 'global',              ├─ Ollama /api/embeddings    (access tracking)
    exclusions out,                 ├─ OpenAI /embeddings
    expired out)                    └─ lexicalVector() fallback
              │
              ▼
   ── ranking: cosine(sim) + (importance-3)*0.0125, floor RECALL_FLOOR=0.12, top-k ──
              │
              ▼
   buildMemoryBlock(entries)  ──►  messages.push({ role: "system", content: block })
   (src/memory/inject.ts)          (src/core/agent.ts:170)
```

### Critical observations

1. **Authorization is applied only as `scope` inside the SQL `WHERE`** — and it *widens* (`scope='global' OR scope=?`) rather than restricting. There is no workspace, user, agent, or task dimension.
2. **Embedding does NOT go through the Phase 5 intelligence plane.** `src/memory/embed.ts` reads `config.localModels` and `process.env.XR_EMBED_*` directly and hand-rolls provider selection — a **second router**, which §8.3 forbids. This is the single largest Phase 5 integration gap.
3. **No reranking stage exists.**
4. **Explanation exists** (`RecallHit.reason`) but is a similarity string only — no scope reason, no trust reason, no freshness reason, no policy reason.
5. **Injection is a single unlabelled bullet list in the system channel.**

---

## 5. Compression / Summary Fidelity Analysis (Deliverable 5)

Three compression paths exist:

| Path | File | Method | Preserves? |
|---|---|---|---|
| Conversation compaction | `compact.ts` | keep last N verbatim, older → `- role: first 160 chars` (max 30 bullets) | ❌ decisions ❌ sources ❌ uncertainty ❌ corrections ❌ scope. Truncation at 160 chars is arbitrary and can cut a negation ("do **not** deploy" → "do"). |
| Session summary | `store.ts:summarizeConversation` | same bullet reducer, 24 bullets, 160 chars | same losses |
| Memory summarization | `summarize.ts` | group by (scope,category), join first 20 contents with `•`, cap 1900 chars | ✅ two-phase consent (propose→apply) ✅ never folds exclusions ✅ fail-soft (won't delete originals if summary insert fails) ❌ drops per-entry provenance, importance, TTL, access history; the fold is **lossy and irreversible** with no lineage record |

**Fidelity verdict:** all three are deterministic (good — no model hallucination) but **none preserve the §9.6 invariants**. `applySummarization` deletes originals with no lineage pointer, so a user cannot answer "what did this summary replace?" after the fact.

**Required Phase 6 change:** structured summaries with an explicit preserved-invariant set and a lineage record; refuse to compress (fail safe) when a required invariant cannot be preserved.

---

## 6. Cross-Agent Access Matrix (Deliverable 6)

`MemoryScope` (`src/agents/types.ts:83`) is **declared but never enforced**:

```ts
interface MemoryScope { kind: "none"|"workflow"|"project"|"research"|"user";
                        sharedWithSupervisor: boolean; maxEntries: number;
                        includeUserMemory?: boolean }
```

Declared profiles (`src/agents/registry.ts`) vs. actual enforcement:

| Agent role | Declared `kind` | `includeUserMemory` | maxEntries | **Enforced?** |
|---|---|---|---|---|
| supervisor | workflow | true | 6 | ❌ |
| planner | workflow | true | 4 | ❌ |
| researcher | research | false | 4 | ❌ |
| coder | project | true | 4 | ❌ |
| reviewer | workflow | false | 4 | ❌ |
| security | workflow | false | 2 | ❌ |
| memory_manager | user | true | 8 | ⚠️ partially — hardcodes `k: 5`, ignores `kind`/`includeUserMemory` |
| tool_runner | none | false | 0 | ❌ — would still recall if wired |
| automation | none | false | 0 | ❌ |

Enforcement point today: `multi-agent-service.ts:652 runMemoryManager()` → `engine.recall(goal, { scope, k: 5 })`. Every other worker calls `agent-service.runScopedTask` with `memoryEnabled: false` (line 636), i.e. the protection is "memory off for workers", not "scoped memory for workers".

**Plugin/MCP:** `memory:read` grants **project + global** recall with `k ≤ 50` and 10 000-char bodies; `memory:write` grants unconsented durable writes. Both are audited. No tier restriction, no trust downgrade on plugin-authored memory.

---

## 7. Intelligence-Plane Integration Map (Deliverable 7)

| Operation | Today | Phase 6 target |
|---|---|---|
| Embedding | `memory/embed.ts` direct fetch to Ollama/OpenAI-compatible URL, own 10 s target cache, own fallback | Route through `IntelligenceService.route({ requirements: { modelClass: "embeddings" }})`, honour `localityPolicy`, keep lexical fallback as last resort |
| Reranking | none | `modelClass: "reranking"` — **optional**, deterministic reranker when unavailable |
| Summarization | deterministic only | keep deterministic default; optional `modelClass:"chat"` assist under Phase 5 policy + durable execution |
| Locality/privacy | ⚠️ partial — embed.ts respects `localModels.runtime` but not `intelligencePlane.localityPolicy` | hard gate via `PolicyConstraints.localityPolicy` |
| Cost accounting | ❌ embeddings are free-of-charge to the budget | record via existing cost path when a paid provider is routed |
| Provider health | ❌ | via catalog `HealthSnapshot` |
| Durable execution | ❌ retrieval/embedding are not executions | correlate through `ExecutionService` when a run context exists |

The plane already models `embeddings` and `reranking` as `ModelClass` values (`src/intelligence/types.ts:19`) and `Modality "embedding"` — **no new capability types are required.**

---

## 8. Durable-Agency Integration Map (Deliverable 8)

`ExecutionCheckpoint` (`src/execution/types.ts:585`) already carries `authoritySnapshot { policyVersion, placement, credentialRefs, checkedAt }` and a bounded `payload`.

| Question (§6.6) | Answer / design |
|---|---|
| What must be checkpointed? | **Context package identity + version + content hash + item ids** — never the full bodies (payload is bounded to `DURABILITY_BOUNDS`). |
| What may be referenced by id? | All item bodies; the package row in `context_packages` is the durable dereference. |
| How do summaries affect resume? | Summary rows carry `lineage_parent` + `generation`; a resumed run records which generation it used. |
| Deleted/revoked memory on resume? | Package **revalidation** on resume: every item id is re-checked against consent/revocation/expiry. Revoked items are dropped and the resumed package is re-versioned with an explicit `revalidation` note. Never silently reused. |
| Retrieval failure during recovery? | Fail **safe, not silent**: package is marked `degraded` with the missing tiers named; the run continues with fewer tiers or aborts per policy. |
| Provider/model change? | `embedding_model` + `embedding_dim` are stored per item; on mismatch the retrieval falls back to lexical for that pair (existing `sameSpace()` behaviour) and the explanation records `embedding_space_mismatch`. |

---

## 9. Schema / Migration Proposal (Deliverable 9)

**Principle:** smallest additive change; no content duplication; memory stays in `user_memory` (single source of truth).

### 9.1 Additive columns on `user_memory` (all nullable / defaulted ⇒ legacy safe)

| Column | Type | Legacy default | Purpose |
|---|---|---|---|
| `consent_state` | TEXT | `'legacy_unknown'` | §7.6 consent lifecycle |
| `consent_actor` | TEXT | NULL | who approved |
| `consent_at` | INTEGER | NULL | when |
| `trust_status` | TEXT | derived from `source` (see 9.4) | §9.3 |
| `confidence` | TEXT | `'unknown'` | §9.5 |
| `sensitivity` | TEXT | `'unknown'` | classification |
| `provenance_kind` | TEXT | mapped from `source` | §7.7 |
| `provenance_ref` | TEXT | NULL | url/path/tool/run id |
| `actor_kind` | TEXT | mapped from `source` | user/agent/plugin/model |
| `actor_name` | TEXT | NULL | |
| `source_observed_at` | INTEGER | NULL | world-time freshness |
| `stale_after` | INTEGER | NULL | soft staleness (distinct from hard `expires_at`) |
| `revoked_at` | INTEGER | NULL | §9.8 |
| `revoked_reason` | TEXT | NULL | |
| `superseded_by` | TEXT | NULL | correction lineage |
| `retention_policy` | TEXT | `'durable'` | |
| `index_state` | TEXT | `'indexed'` if embedding else `'none'` | cache invalidation |
| `embedding_model` | TEXT | NULL | space identity |
| `embedding_dim` | INTEGER | NULL | space identity |
| `workspace_id` | TEXT | store's `workspaceId` | cross-workspace fence |

### 9.2 New tables

| Table | Rows bounded by | Purpose |
|---|---|---|
| `context_items` | user actions | knowledge / evidence / artifact / task_context / untrusted / instruction items (everything that is **not** user memory) |
| `context_provenance` | ≤ `PROVENANCE_MAX_PER_ITEM` (32) per item | typed references: url, file, execution, checkpoint, research claim, artifact, business record |
| `context_revocations` | append-only, pruned with items | revocation ledger, survives UI rollback (§19) |
| `context_packages` | TTL-pruned (`CONTEXT_BOUNDS.packageRetentionMs`) | durable package identity/version for checkpoints |
| `context_summaries` | lineage-chained | evidence-preserving summaries |

### 9.3 Indexes

```
idx_ctx_scope        (workspace_id, project_scope, type)
idx_ctx_trust        (workspace_id, trust_status)
idx_ctx_live         (workspace_id, deleted_at, revoked_at)
idx_ctx_prov_item    (item_id)
idx_ctx_pkg_run      (run_id)
idx_ctx_pkg_created  (workspace_id, created_at DESC)
idx_ctx_sum_task     (workspace_id, task_id)
idx_um_consent       (consent_state)
idx_um_workspace     (workspace_id)
```

### 9.4 Honest legacy mapping (no fabrication)

| legacy `source` | `provenance_kind` | `actor_kind` | `trust_status` | `consent_state` |
|---|---|---|---|---|
| `user` | `user_input` | `user` | `approved_memory` | `legacy_unknown` |
| `chat` | `user_input` | `user` | `approved_memory` | `legacy_unknown` |
| `voice` | `user_input` | `user` | `approved_memory` | `legacy_unknown` |
| `research` | `research` | `system` | `generated_synthesis` | `legacy_unknown` |
| `import` | `import` | `system` | `unknown` | `legacy_unknown` |

`trust_status` is derived from an existing, honest field. `consent_state` is **never** upgraded to `approved` — the user must re-affirm. Legacy rows remain **retrievable** (no data loss, §10.4) and are labelled `legacy` in explanations.

---

## 10. File-by-File Change Proposal (Deliverable 10)

| File | Change | Interface impact | Migration | Risk | Rollback |
|---|---|---|---|---|---|
| `src/context/types.ts` | **NEW** taxonomy, metadata, consent, trust, provenance, tiers, bounds | additive | none | none | delete |
| `src/context/policy.ts` | **NEW** deterministic scope/authority gate | additive | none | **security-critical** | `knowledge.enforceScope:false` documented as unsafe |
| `src/context/poison.ts` | **NEW** deterministic anti-poisoning | additive | none | security-critical | n/a |
| `src/context/repository.ts` | **NEW** additive DDL + typed CRUD | additive | idempotent | schema | tables ignored if unused |
| `src/context/provenance.ts` | **NEW** typed reference linking | additive | none | low | n/a |
| `src/context/retrieval.ts` | **NEW** scope-first pipeline | additive | none | medium | legacy path retained |
| `src/context/assembler.ts` | **NEW** tiered package builder | additive | none | medium | compat mode |
| `src/context/injection.ts` | **NEW** safe injection packaging | additive | none | **high value** | compat mode |
| `src/context/compression.ts` | **NEW** evidence-preserving summaries | additive | none | medium | old summarizer kept |
| `src/context/inspection.ts` | **NEW** inspect/correct/revoke/export/delete | additive | none | low | n/a |
| `src/context/service.ts` | **NEW** `ContextService` facade | new token | none | low | not registered ⇒ no-op |
| `src/context/index.ts` | **NEW** barrel | additive | none | none | n/a |
| `src/memory/types.ts` | +context metadata on `MemoryEntry` (optional, additive) | **compatible** | none | low | fields ignored |
| `src/memory/store.ts` | + consent/trust/provenance write & read; `revoke`, `correct`, `markStale`; existing APIs untouched | **compatible** | defaults | medium | adapters |
| `src/memory/embed.ts` | route model choice through Phase 5; keep lexical fallback | signature preserved | none | medium | env override still wins |
| `src/memory/inject.ts` | + `buildContextBlocks()`; `buildMemoryBlock()` unchanged | additive | none | low | compat mode |
| `src/memory/intent.ts` | + revoke / export / correct / inspect intents | additive union members | none | low | n/a |
| `src/memory/summarize.ts` | + lineage + preserved invariants | additive opts | none | medium | old path default-compatible |
| `src/memory/cli.ts` | + consent/trust/provenance columns, `--json` | additive | none | low | n/a |
| `src/state/workspace-store.ts` | additive columns + `contextRepo` wiring | **compatible** | idempotent `ALTER` | schema | columns unused |
| `src/config/config.ts` | v14→v15 `knowledge` block | additive | migration 14 | low | disable flag |
| `src/core/tokens.ts` | `Tokens.Context` | additive | none | none | n/a |
| `src/core/providers.ts` | `ContextServiceProvider` | additive | none | none | remove from `use()` |
| `src/core/agent.ts` | consume context package when provided; legacy path preserved | **compatible** | none | medium | `knowledge.injectionMode:"legacy"` |
| `src/services/agent-service.ts` | build package, pass through | **compatible** | none | medium | same |
| `src/services/multi-agent-service.ts` | enforce declared `MemoryScope` | behaviour tightened | none | medium | same |
| `src/plugins/host.ts` | plugin memory writes → `proposed` + `untrusted_external` | behaviour tightened | none | medium | documented |
| `src/research/engine.ts` (+`report.ts`) | link claims → provenance | additive | none | low | best-effort |
| `src/commands/context.ts` | **NEW** `xr context …` | additive | none | none | unregister |
| `src/cli/catalog.ts`, `src/cli/router.ts` | register command | additive | none | none | n/a |
| `src/daemon/routes/context.routes.ts` | **NEW** read/inspect/revoke routes | additive | none | low | n/a |
| `test/context/*` | **NEW** 9 suites | — | — | — | — |
| `docs/phase6/*` | **NEW** 6 docs | — | — | — | — |

---

## 11. Phase 7+ Issues Explicitly Deferred (Deliverable 11)

| Deferred item | Why it is out of scope | Where it belongs |
|---|---|---|
| Unifying automation + agent workflows | workflow orchestration | Phase 7 |
| Multi-agent planner redesign | agent-team coordination | Phase 7 |
| Mailbox / team messaging | agent-team coordination | Phase 7 |
| Visual workflow editor | UI product surface | Phase 7 |
| New browser / voice / vision capabilities | new modalities | Phase 8 |
| Remote knowledge / control-plane infrastructure | distributed infra | Phase 9+ |
| Enterprise tenancy & knowledge governance | org administration | Phase 10 |
| New business knowledge suite modules | business product | Phase 10 |
| **General knowledge graph** | audit found a **bounded typed-reference model is sufficient** (§7.7 escape hatch not triggered): research already models claims/contradictions; a graph adds complexity without user value | not planned |
| Automatic/silent memory capture | violates consent-first identity | never |
| Model training / self-improvement loop | explicitly forbidden | never |
| LLM-decided authority for untrusted text | deterministic policy only | never |
| RAG chunk freshness via file mtime | *desirable* but touches the indexer's contract; recorded as a **known limitation**, not shipped | Phase 6.x follow-up |
| Cryptographic erasure from embedding vectors | not implementable honestly; we invalidate + delete stored vectors and say so | documented limitation |

---

## 12. Audit Conclusion

XR 4.4's memory subsystem is genuinely strong on **consent flow, TTL, pruning, access tracking, explainability, and hygiene**. Its Phase 6 gaps are precisely the ones the roadmap predicts:

1. no typed taxonomy (everything is "memory" or invisible);
2. provenance is an enum, not a reference;
3. freshness exists only in the research engine;
4. authorization is a widening SQL clause, not a policy gate;
5. injection puts retrieved data in the **instruction channel**;
6. a **second embedding router** bypasses the Phase 5 plane;
7. declared `MemoryScope` is unenforced;
8. compression is lossy with no lineage and no invariants.

All eight are addressable additively. **Proceed to design and implementation.**
