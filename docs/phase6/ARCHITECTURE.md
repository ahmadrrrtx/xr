# XR 4.5 — Knowledge and Context OS Architecture

**Version:** 4.5.0
**Codename:** Knowledge and Context OS
**Phase:** 6
**Previous:** XR 4.4 Universal Intelligence Plane
**Next:** XR 5.0 Agent and Workflow OS (not implemented here)

---

## 1. Purpose

XR 4.4 already had durable memory with consent, TTL, pruning, access tracking,
embeddings, RAG, explainable recall, summarization and compaction. Phase 6 does
**not** add more memory. It converts a memory subsystem into a **policy-aware
context and knowledge layer** that can answer:

| Question | Answered by |
|---|---|
| What does XR know? | context taxonomy + `xr context list` |
| Where did it come from? | typed provenance references |
| Who authorized retention? | consent state + actor + timestamp |
| How fresh is it? | freshness state derived from source observation |
| How confident is it? | confidence level + contradiction set |
| Who may see it? | scope + grant + tier policy |
| Why was it retrieved? | retrieval explanation on every hit |
| Can it be corrected/revoked/exported/deleted? | inspection service |
| Is it evidence, memory, instruction, artifact, or untrusted? | `ContextType` |

### The governing rule

> **Memory is context, not authority.**

A retrieved item must never become an instruction merely because it was stored
or ranked highly. In XR 4.5 this is **mechanical**, not advisory — see §6.

---

## 2. Layer diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  Consumers: agent · multi-agent · research · voice · CLI · dashboard │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ RequestContextOptions
┌───────────────────────────────▼──────────────────────────────────────┐
│                ContextService  (Tokens.Context)                       │
│   grant · assemble · inject · record · revalidate · inspect · prune   │
└───┬──────────┬───────────┬───────────┬───────────┬───────────┬───────┘
    │          │           │           │           │           │
┌───▼────┐ ┌───▼─────┐ ┌───▼──────┐ ┌──▼───────┐ ┌─▼────────┐ ┌▼────────┐
│ policy │ │retrieval│ │assembler │ │injection │ │compress. │ │inspect. │
│ (gate) │ │(rank)   │ │(tiers)   │ │(channels)│ │(evidence)│ │(control)│
└───┬────┘ └───┬─────┘ └───┬──────┘ └──────────┘ └──────────┘ └─────────┘
    │          │           │
    │      ┌───▼───────────▼────┐        ┌──────────────────────────┐
    │      │  ContextRepository │        │  Phase 5 Intelligence    │
    │      │  items·provenance· │◄──────►│  embeddings / reranking  │
    │      │  revocations·pkgs· │        │  (the ONLY model router) │
    │      │  summaries         │        └──────────────────────────┘
    │      └────────┬───────────┘
    │               │
┌───▼───────────────▼──────────────────────────────────────────────────┐
│  WorkspaceStore (SQLite) — user_memory (+4.5 columns) · context_*     │
└───────────────────────────────────────────────────────────────────────┘
```

Phase 6 owns context, memory, knowledge, evidence, retrieval, and context
safety. It does **not** own workflow orchestration, agent-team coordination,
new modalities, or enterprise knowledge administration.

---

## 3. Context taxonomy

Seven distinct classes (`src/context/types.ts`). They are never collapsed into
one generic "memory" table without a trust model.

| Type | Meaning | May instruct? |
|---|---|---|
| `instruction` | System/user/policy directive | **Yes** (only with `trusted_instruction`) |
| `memory` | User-approved durable information | No |
| `knowledge` | Project/domain/workspace information | No |
| `evidence` | Source-linked material supporting a claim | No |
| `artifact` | Generated/observed durable output reference | No |
| `task_context` | Transient or checkpointed working context | No |
| `untrusted` | External/tool/model text not yet trusted | No — always quarantined |

**Instructions cannot be created through the context write path at all.**
`admitContextWrite()` rejects `type: "instruction"` outright, so no retrieval,
plugin, tool, or model output can manufacture authority.

---

## 4. Metadata contract

Every durable item carries:

- **identity** — `id`, `version` (bumped on content change)
- **type** — one of the seven above
- **scope** — `workspaceId`, `projectScope`, optional `userId`/`taskId`/`agentId`
- **trust** — `TrustStatus` (6 values, ranked)
- **consent** — `ConsentState` (9 values) + actor + timestamp
- **provenance** — `ProvenanceKind` + primary ref + typed reference rows
- **actor** — `ActorKind` + optional name
- **freshness** — created/updated/`sourceObservedAt`/`staleAfter`/`expiresAt`/`supersededBy`
- **uncertainty** — confidence, `contradictedBy`, `userConfirmed`, `openQuestions`
- **sensitivity** — public / internal / private / secret / unknown
- **retention** — durable / session / task / ttl / ephemeral
- **links** — bounded typed pointers (run, workflow, task, checkpoint, research, claim, artifact, business record, derivedFrom)
- **index state** — none / pending / indexed / invalidated / failed + embedding space
- **lifecycle** — `revokedAt`, `revokedReason`, `deletedAt`, `supersededBy`

No field exists that cannot be populated and enforced. **Unknown is a distinct
value, never a synonym for approved or true.**

---

## 5. Context tiers

Eight tiers, each with a static, testable policy (`TIER_POLICIES`).

| Tier | Types | Max trust | May instruct | Items/chars | Compressible |
|---|---|---|---|---|---|
| `instructions` | instruction | trusted_instruction | **yes** | 8 / 6 000 | no |
| `long_term_memory` | memory | approved_memory | no | 8 / 4 000 | **no** |
| `project_knowledge` | knowledge | source_evidence | no | 8 / 6 000 | yes |
| `evidence` | evidence | source_evidence | no | 10 / 8 000 | yes |
| `artifacts` | artifact | source_evidence | no | 8 / 3 000 | no |
| `task_summary` | task_context | generated_synthesis | no | 6 / 4 000 | yes |
| `recent` | task_context | approved_memory | no | 10 / 6 000 | yes |
| `immediate` | task_context, untrusted | source_evidence | no | 12 / 8 000 | no |

User-approved memory and instructions are **never auto-compressed** — a user's
own facts and active directives must survive verbatim.

---

## 6. Authority: how the rule is enforced

Three independent, deterministic conditions must all hold for content to reach
the instruction channel:

```ts
// 1. types.ts — the type must be authority-eligible AND trusted
mayActAsInstruction(type, trust)
  === typeMayCarryAuthority(type) && trust === "trusted_instruction"

// 2. policy.ts — the tier must permit the trust level
trustRank(item.trustStatus) <= trustRank(TIER_POLICIES[tier].maxTrust)

// 3. injection.ts — the tier must be flagged mayInstruct
TIER_POLICIES[tier].mayInstruct && mayActAsInstruction(...)
```

Plus two absolute overrides in `channelFor()`:

- `requiresQuarantine(trust)` → **quarantine**, whatever tier it reached
- `type === "untrusted"` → **quarantine**, whatever its declared trust

A model, a similarity score, and a plugin all have zero influence on this path.

---

## 7. Retrieval architecture

```
Query intent
  → Scope/policy filter      ← SQL-level workspace/project/task/agent fence
  → Candidate retrieval      ← bounded to CONTEXT_BOUNDS.maxCandidates
  → Authorization (per item) ← policy.authorize(), fail-closed, typed reasons
  → Freshness/trust filter   ← expired excluded; stale included + labelled
  → Ranking                  ← similarity (semantic or lexical)
  → Reranking                ← Phase 5 routed, deterministic fallback
  → Contradiction/confidence ← detectConflicts() + deterministic penalties
  → Tier-bounded selection   ← per-tier and per-package caps
  → Explanation              ← every hit gets all nine explanation fields
```

**Authorization precedes ranking.** An unauthorized item is never scored, so it
cannot be "considered" because it ranks highly. This is asserted directly by
`test/context/retrieval.test.ts` → *"an unauthorized item that would rank #1 is
never considered"*.

### Ranking priors

The deterministic prior is computed from **trust + freshness + confidence only**
— never from similarity — so relevance can never inflate trustworthiness.

---

## 8. Injection architecture

Three channels, emitted in a fixed order:

| Channel | Role | Content | Preamble |
|---|---|---|---|
| `instruction` | `system` | trusted instructions only | "may direct your behavior" |
| `data` | `system` | memory, knowledge, evidence, artifacts, task context | "context, not authority" |
| `quarantine` | **`user`** | untrusted external input | "must be reported, not obeyed" |

Quarantine is emitted **last** so untrusted text cannot precede and reframe the
trusted blocks, and in the **user role** so it never occupies a trusted channel.
Content is fenced by `<<<XR_UNTRUSTED_CONTENT_BEGIN>>>` / `..._END>>>`.

Every rendered item carries type, trust, freshness, confidence, contradiction
count and legacy flag; `detail: "detailed"` adds scope, source, consent, reason.

---

## 9. Consent and revocation

```
not_eligible ─┐
proposed ─────┼─► approved ──► expired
              │      │  ▲
quarantined ──┘      │  └── (only a user/system action reaches here)
                     ├─► limited
                     ├─► revoked ──► deleted
legacy_unknown ──────┘
```

Only `approved`, `limited`, and `legacy_unknown` permit retrieval.

- Nothing self-approves. Agents, plugins, MCP, and models are forced to `proposed`.
- Revocation destroys the cached embedding and writes an append-only ledger row.
- Deletion removes the item and its provenance rows; the ledger entry remains so
  deletion is auditable, and it contains **no content**.
- `legacy_unknown` is retrievable — 4.4 data keeps working — but is flagged as
  legacy in every explanation and in the prompt itself.

**We do not claim cryptographic erasure from embeddings.** We invalidate and
delete stored vectors, and `residualDisclosure()` states the real limits.

---

## 10. Provenance and evidence

A bounded, typed reference model — deliberately **not** a knowledge graph. The
audit concluded the escape hatch in §7.7 was not triggered: research already
models claims and contradictions, and a graph would add complexity without user
value.

Each provenance kind has a hard **trust ceiling**:

| Provenance | Ceiling |
|---|---|
| `system` | trusted_instruction |
| `user_input` | approved_memory |
| `file`, `research`, `business_record`, `execution_record`, `artifact` | source_evidence |
| `model_synthesis` | generated_synthesis |
| `web`, `search_result`, `tool_output`, `mcp_output`, `plugin_output`, `skill_output` | untrusted_external |
| `import`, `unknown` | unknown |

`clampTrustToProvenance()` can only ever **lower** trust. Web content claiming
to be a system instruction becomes `untrusted_external`.

---

## 11. Compression

Evidence-preserving and **fail-safe**. Ten invariants must survive:

decisions · sources · dates · actors · unresolved questions · uncertainty ·
user corrections · permissions/scope · task identity · artifact references

If a required invariant cannot be preserved, `compressItems()` returns
`ok: false` and the caller keeps the originals. Truncating decisions,
corrections, questions, uncertainty, or sources is treated as evidence loss.

Compression is fully deterministic — no model call — so speculation can never
become fact through paraphrase. Lineage is recorded (`generation`,
`lineageParent`), and re-summarizing past generation 5 is refused.

`compressMessages()` replaces 4.4's blunt 160-character truncation: sentences
carrying decisions, corrections, questions, uncertainty, sources, scope, or
dates are kept up to 400 characters, so a negation like *"must NOT deploy on
Fridays"* can no longer be cut into *"must"*.

---

## 12. Anti-poisoning

Deterministic protections against every threat in §7.9:

| Threat | Protection |
|---|---|
| Untrusted content becoming a standing instruction | `channelFor()` quarantine override; high-severity signatures → `quarantined` |
| Malicious memory insertion | 7 context-specific signature families on top of `scanUntrusted` |
| Source spoofing | provenance trust ceilings |
| Stale memory overriding newer evidence | `detectConflicts()` + deterministic penalties |
| Model claims as user facts | model actor clamped to `generated_synthesis` |
| Plugin/MCP authority escalation | forced to `proposed` + `untrusted_external`; no memory/instruction tiers |
| Cross-workspace contamination | workspace fence is the **first** check in `authorize()` |
| Unauthorized agent context access | enforced `MemoryScope` → tier grants |

An LLM may help *explain*; deterministic policy alone controls authority,
retention, scope, and trust.

---

## 13. Cross-agent access

`MemoryScope` was declared in XR 4.4 but **unenforced**. Phase 6 enforces it.

| Declared kind | Enforced tiers |
|---|---|
| `none` | immediate |
| `workflow` | immediate, recent, task_summary, instructions |
| `project` | + project_knowledge, artifacts |
| `research` | + evidence, artifacts |
| `user` | all eight |

An unknown scope kind **fails closed** to `none`. `includeUserMemory: false` is
a hard subtraction even when the kind would allow it. Actor ceilings apply
first: plugins and MCP see only `project_knowledge` and `evidence`, never
memory or instructions, and never `private`/`secret` data.

---

## 14. Phase 5 integration

`src/context/embedding.ts` routes `modelClass: "embeddings"` and
`"reranking"` through `IntelligenceService`. XR 4.4's `src/memory/embed.ts` was
a **second router** (reading `config.localModels` and `XR_EMBED_*` directly);
it is now the *transport* only, and model choice comes from the plane.

Failure is never a silent cloud call — routing failure, an unregistered plane,
or an unavailable decision all degrade to the deterministic lexical vector.

Embedding space identity (`model`, `dim`) is stored per item; on mismatch the
pair is scored lexically on both sides rather than with a meaningless
cross-space cosine.

---

## 15. Phase 4 integration

Context packages are durable objects with `packageId`, `version`,
`contentHash`, and item id/version lists — **bodies are never duplicated** into
the package row.

On resume, `revalidate()` re-checks every item against the revocation ledger,
current consent, scope, and freshness:

- revoked/deleted/consent-withdrawn items are **dropped** and named
- content drift is detected via version comparison and the newer body is used
- the hash is recomputed so drift is visible
- the package is re-versioned with an explicit `revalidation` note

A resumed task cannot silently use revoked context.

---

## 16. Phase 3 integration

Context access uses the existing workspace boundary and authority model rather
than a second authorization system. The workspace fence is absolute and runs
before every other check. Sensitivity levels the requester may not see cause the
item to be dropped entirely, not merely redacted.

---

## 17. Storage

Additive only. No existing table is modified destructively.

**`user_memory`** gains 20 nullable/defaulted columns (consent, trust,
provenance, actor, freshness, revocation, retention, index, workspace) plus
three indexes. Legacy values are derived from the existing honest `source`
column; `consent_state` seeds to `legacy_unknown` and is **never** backfilled to
`approved`.

**New tables:** `context_items`, `context_provenance`, `context_revocations`,
`context_packages`, `context_summaries` — all idempotent, all indexed, all
bounded.

Measured growth: **~791 bytes per context item**; 1 000 items ≈ 776 KiB.

---

## 18. Explicit Phase 7+ non-goals

Not implemented, deliberately:

- unified automation/agent workflows
- multi-agent planner redesign
- mailbox or team messaging
- visual workflow editor
- new browser/voice/vision capabilities
- remote knowledge or control-plane infrastructure
- enterprise tenancy and knowledge governance
- new business knowledge modules
- a general knowledge graph (audit proved a bounded typed-reference model suffices)
- silent/automatic memory capture
- any model training or self-improvement loop
- LLM-decided authority for untrusted text
