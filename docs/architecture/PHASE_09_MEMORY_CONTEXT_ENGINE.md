# XR Memory / Context Engine (Phase 09)

This document describes the **canonical** Memory and Context Engine after
Phase 09. It extends the Phase 6 architecture (ADR 0006, ADR 0013). It does
**not** introduce a second store, a second retrieval pipeline, or a second
lifecycle.

## 1. Architecture

One coherent subsystem:

```
config / onboarding / XR_MEMORY_DISABLED
        ↓
inspectMemoryEngine()     ← truthful doctor / dashboard status
        ↓
IsolatedMemoryStore       ← workspace-stamped MemoryStore
        ↓
ContextService            ← grant → retrieve → assemble → inject
        ↓
ContextRetrieval          ← scope fence → hybrid RRF → integrity
        ↓
buildInjectionPackage()   ← memory is DATA, never authority
```

Procedural knowledge stays in **SkillEngine**. Conversation text is never
automatically promoted to a skill.

## 2. Memory tiers

| Tier | Lives in | Durable? | Bound? |
|---|---|---|---|
| **Session** | `SessionMemory` | No | Recent-turn cap |
| **Working** | `WorkingMemory` | No | `WORKING_MEMORY_BOUNDS` |
| **Durable** | `user_memory` + `context_items` | Yes | Consent + admission gate |
| **Procedural** | `SkillEngine` | Yes | Verifiability / freeze / regression |

Session and working memory never write themselves into durable stores.

## 3. Retrieval pipeline

Unchanged from Phase 6, still the only ranking path:

1. Scope / policy filter (workspace first)
2. Candidate retrieval (SQL fence)
3. Hybrid channels: lexical + semantic (optional) + structured
4. Reciprocal Rank Fusion (k=60)
5. Freshness / confidence prior (temporal decay lives here)
6. Conflict penalty
7. Render-time integrity gate
8. Context budget + progressive disclosure

Embedding is optional. Local-first is mandatory. Offline lexical always works.

## 4. Context assembly

Progressive loading:

```
STABLE CONTEXT
    → RELEVANT SUMMARY          (default, ~1536 chars)
    → RELEVANT MEMORY METADATA
    → FULL CONTENT              only if requested / high confidence / tool lookup
```

Budget pipeline (derived from `CONTEXT_BOUNDS` / `TIER_POLICIES`, no second config):

```
SYSTEM → CORE → USER/WORKSPACE → ACTIVE TASK → RELEVANT MEMORY → TOOLS/SKILLS → RECENT CONVERSATION
```

A layer that overflows is summarized, then compacted, then prioritized, then
dropped. The global package ceiling is never silently exceeded.

## 5. Compaction

`microCompact()` wraps the existing `compact()`:

- preserves objective, decisions, unresolved actions, policy constraints
- keeps recent turns
- max retries + quality check
- **fallback = original conversation** if quality cannot be met

## 6. Workspace isolation

Primary fence: **one SQLite file per workspace** (`WorkspaceManager`).

Defense in depth:

- `IsolatedMemoryStore` stamps `workspace_id` on write
- reads drop rows stamped for another workspace
- `authorize()` rejects `workspace_mismatch` before ranking
- `XRApp.switchWorkspace` is the only legal switch (daemon routes go through it)

Global scope means “any project **in this workspace**”. It is never
cross-workspace. Cross-workspace global requires an explicit future policy
that does not exist.

## 7. Privacy / deletion

- Capture is explicit (`remember …`) or consent-gated.
- Onboarding asks whether durable memory should be enabled (default yes).
- `XR_MEMORY_DISABLED=1` is a hard off-switch.
- Secrets are redacted by the existing `maskSecrets` path. No second redactor.
- Delete removes the row. Revoke keeps the row, destroys the embedding, marks
  the index invalidated. Undo restores a before-image from `UndoLedger`.
- Deleted / revoked memory cannot return from the embedding cache.

## 8. Memory poisoning

Memory is **data**. A stored string saying “Ignore all previous instructions”
is quarantined at admission and again at render time. It never occupies the
instruction channel. Existing Phase 07 integrity / poison / injection
protections are unchanged.

## 9. Provenance

Every durable item carries source, actor, timestamp, workspace, consent, and
an integrity/hash field. Provenance is never fabricated. Legacy rows stay
`legacy_unknown`.

## 10. Benchmark methodology

- Deterministic dataset: `benchmarks/memory-recall/dataset.json`
- Runner: `scripts/memory-recall-bench.ts`
- Metrics: precision/recall (existing Phase 6 harness) + p50/p95/p99 latency,
  cold vs warm, isolation, stale rejection, indexing skip-count
- Target: retrieval p95 ≤ 250 ms where hardware permits
- Numbers are measured on the host that ran the script and recorded in
  `benchmarks/memory-recall/latest.json`

## What is stored / retrieved / injected

| Question | Answer |
|---|---|
| What is stored? | Only what the user (or an explicit approved path) asked to remember. Session/working are not stored. |
| What is retrieved? | Scope-authorized, consent-valid, non-revoked, non-expired items that clear the relevance floor. |
| What is injected? | Summaries / metadata by default. Full body only when needed. Always labelled as reference data. |
| When is it injected? | When memory is enabled **and** `injectInChat` is on **and** the grant allows the tier. |
| Who can delete it? | The user (`xr memory`, dashboard, `forget` / `revoke` intents). Undo is available. |
| How does isolation work? | Separate store files + stamped `workspace_id` + authorize-before-rank. |
