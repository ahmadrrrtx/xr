# Phase 11 — Repo Intelligence / Coding Experience — Design Note

**Date:** 2026-08-19
**Base:** `main` @ `a498a9d` (Phase 10 Web Research)
**Status:** Design against the *current* repository. The repo is the source of truth.

This note is written **before** implementation. It records what already exists,
what is missing, the research that informed the design, and the integration
strategy. It does not invent a second memory, retrieval, tool, or database system.

---

## 1. Current XR architecture (inspected)

### File indexing / scan cache

- `src/util/scan-cache.ts` (Phase 3 · T4) — Merkle-style directory fingerprint
  (path + size + mtime), JSON(+gzip) payload at `$XR_HOME/cache/scans/<id>.json`.
  Used for *skill/registry-style* warm scans. **Not** a per-file AST/symbol cache.
- `src/context/memory/rag.ts` — Block-4 project RAG: walk + chunk (1200 chars)
  + optional embeddings into `rag_chunks`. Complementary, not a repo map.
  Skip-dirs already include `node_modules`, `.git`, `dist`, `build`, `.next`,
  `coverage`, `__pycache__`, `.venv`, `target`, `.cache`, `.xr`.
- Memory reindex (`MemoryStore.reindexEmbeddings`) is content-addressed
  (sha256 of content+tags). Unchanged rows skip. Proven by
  `test/perf/incremental-index.test.ts`.

### Workspace store

- One SQLite file per workspace (`WorkspaceManager`). Single writer (`WriteGate`).
- Baseline tables in `WorkspaceStore.migrate()`; numbered reversible migrations
  in `src/state/migrations.ts` (currently 1–3). Latest = 3.
- `workspaceId` is stamped on the store. Isolation is file-per-workspace + stamp.
- `WorkspaceStore` is size-waived (1693 lines). **Do not grow it.** New tables
  go through Migration 4 + a dedicated `src/repo/store.ts` using `prepare`/`exec`
  (same pattern as `ContextRepository`).

### Context / retrieval engine (Phase 09)

- One pipeline: grant → SQL scope fence → hybrid RRF → integrity → budget.
- Tiers already include `project_knowledge` (`type: knowledge`,
  `maxTrust: source_evidence`, 8 items / 6_000 chars).
- Assembler accepts `ExternalCandidate[]`. Memory rows are adapted into extras.
  Research extras are not yet wired the same way.
- Progressive disclosure: metadata → summary (~1536) → full.
- Memory is DATA, never authority. Repo facts must follow the same rule.

### Git / filesystem

- `src/tools/git.ts` — real `git status --porcelain`, `git diff`, etc.
- `src/tools/files.ts` / `system.ts` — `safePath` / `safe()` refuse `..` escape.
- `src/security/guard.ts` — `isSecretPath`, `canonicalPath` (realpath + lexical
  fallback), secret patterns for `.env`, SSH keys, credentials, cloud configs.

### Capability system (Phase 08)

- `ToolRegistryService` is the only registration/discovery authority.
- Core tools declared in `src/tools/registry.ts` via `coreToolContributions()`.
- Phase 10 research tools (`research_*`) are the template: core, read-only,
  `filesystem`/`network` permissions, plan/ask allow-list in `READ_ONLY_CORE`.
- Model REQUESTS; it cannot grant itself repository permissions.

### Execution / agent

- `AgentService.execute` is the sole entry. Builds one registry, assembles one
  context package, runs the envelope.
- Context assembly is best-effort and must not delay TTFT (Phase 05).
- Startup must not wait for a full repo index (Phase 3 boot profiles).

### Tokenizer

- There is **no** tiktoken / real BPE in XR.
- `src/providers/stream-metrics.ts` uses `chars/4` as a fallback estimate and
  documents it as such.
- Repo map will use a **documented code-aware approximation** (not chars/4
  claimed as exact) and measure it. The budget is enforced against that
  estimator; reports will say "approximate tokens".

### What XR already has (do not rebuild)

| Capability | Where |
|---|---|
| Incremental content-addressed skip | memory reindex, scan-cache |
| Workspace isolation | WorkspaceManager + IsolatedMemoryStore |
| Hybrid retrieval / RRF | `context/retrieval.ts` |
| Progressive context | `context/budget.ts`, injection |
| Unified tools | `ToolRegistryService` |
| Git status/diff tools | `tools/git.ts` |
| Secret/path policy | `security/guard.ts` |
| Ignore-ish skip dirs | `memory/rag.ts` |
| SQLite + reversible migrations | `state/migrations.ts` |
| Metrics registry | `observability/metrics.ts` |

---

## 2. Gaps (what Phase 11 must add)

| Gap | Why it matters |
|---|---|
| Repo map | Agent sees a dump of files or nothing structural |
| Symbol extraction | No function/class/export awareness |
| Dependency graph | Cannot expand "files that import X" |
| Deterministic ranking | No task-scoped file ranking without an LLM |
| Token-budgeted structural context | Context package has char budgets, not a 1024-token repo map |
| Incremental *parse* cache | Scan-cache is tree-level, not per-file AST/symbol |
| Diff as a ranking signal | Git tools exist; ranking does not use them |
| Repo capabilities | Model cannot request `repo_map` / `repo_search` / … |
| Combine repo + research | Phase 10 sources can be confused with repo facts |

---

## 3. Research findings

### Aider (researched fact)

Aider builds a **repo map**: tree-sitter parse → tags (definitions + references)
→ file graph (edges = symbol references) → **personalized PageRank** biased
toward chat/task files → pack definitions into a **~1024 token** tree.
Unchanged files are SQLite-cached. The map is structural; file bodies are
fetched separately.

**Principle borrowed:** do not dump the repository. Build a compact, ranked,
token-budgeted structural representation.

**Not copied:** Aider's Python/NetworkX/grep-ast stack, 130+ language claim,
or chat-file personalization internals.

### Tree-sitter (researched fact)

- Native `node-tree-sitter` is a C addon. Bun's native-addon compatibility is
  the documented weak spot. XR's only required runtime dependency is `zod`.
- `web-tree-sitter` is WASM: portable, but each grammar is a large `.wasm`
  payload and a distribution/versioning problem.
- Dozens of `tree-sitter-<lang>` packages would violate XR's minimal-deps
  constitution and binary-size gates.

**Implementation decision:** tree-sitter is an **optional** parser backend.
If `web-tree-sitter` (or `tree-sitter`) can be loaded at runtime it is used
and labeled `confidence: "ast"`. Otherwise XR uses first-party **structural
scanners** (not regex pretending to be AST) labeled `confidence: "structural"`,
and a clearly weaker `confidence: "heuristic"` fallback for other languages.

### Other coding agents (principles only)

- **Claude Code:** agentic grep/glob + progressive file reads. Borrow:
  progressive loading (map → symbol → section → full file).
- **OpenHands / Goose:** typed tools through one execution path. Borrow:
  repo capabilities go through ToolRegistryService + policy.
- **None** of them dump the whole repo into the prompt as the default.

---

## 4. Integration strategy

```
Workspace (cwd + workspaceId)
   ↓
Repository Scanner          (gitignore + XR defaults + secret paths + no symlink escape)
   ↓
Content hash (sha256)       (reuse crypto; same idea as memory T9)
   ↓
Parse cache                 (SQLite repo_parse_cache, keyed by hash+parserVersion)
   ↓
Symbol / dependency index   (repo_files / repo_symbols / repo_edges)
   ↓
Ranking engine              (deterministic: lexical + symbol + graph + git)
   ↓
Repo map                    (token budget, default 1024)
   ↓
Context extras              (type=knowledge, provenance=file, trust=source_evidence)
   ↓
ContextRetrieval / Assembler (existing Phase 09 pipeline)
   ↓
Agent                       (seed map if ready; tools for progressive load)
```

**Hard rules**

- `workspaceId` is part of every query and every row.
- Repo items are **repository facts** (`provenanceKind: "file"`). Research
  items stay `provenanceKind: "research"` / `web`. They may share a package;
  they are never the same class of evidence.
- No second vector database. Ranking is lexical + graph, not embeddings.
- No second tool registry. Tools are core contributions.
- No growth of waived modules (`workspace-store.ts`, `config.ts`, `catalog.ts`).
- Config lives in `src/repo/config.ts` + env (`XR_REPO_DISABLED`,
  `XR_REPO_MAP_TOKENS`). Additive, kill-switchable.
- Indexing is lazy / coalesced / non-blocking. Startup does not wait.

---

## 5. Target flow (coding task)

```
USER CODING TASK
        │
        ▼
TASK TERMS / SYMBOLS          (deterministic tokenizer, no LLM)
        │
        ▼
REPO INDEX (workspace-scoped)
        │
        ├─ candidate files (path / name / symbol hit)
        ├─ symbol relevance (exact name wins)
        ├─ dependency expansion (1 hop, internal only)
        ├─ graph rank (personalized PageRank, capped)
        ├─ git / diff signal (boost, never dominate)
        ├─ security / scope filter
        └─ token budget
        ▼
RANKED REPO MAP  +  repo_* tools
        │
        ▼
CONTEXT ENGINE (project_knowledge extras)
        │
        ▼
UNIFIED CAPABILITY → POLICY / SHIELD / AUDIT → XR AGENT
```

---

## 6. Language support (honest)

| Language | Parser | Confidence |
|---|---|---|
| TypeScript / JavaScript / TSX / JSX | first-party scanner; tree-sitter if present | structural / ast |
| Python | first-party scanner; tree-sitter if present | structural / ast |
| Go | first-party scanner | structural |
| Rust | first-party scanner | structural |
| Other text sources | import/export heuristics + file module | heuristic |

We will **not** claim 100+ languages.

---

## 7. Risks

1. Parser false positives on unusual syntax — mitigated by confidence labels
   and tests on realistic XR-shaped fixtures.
2. Popular files (registry, types) dominating rank — mitigated by capping
   graph score and requiring task match to stay on top.
3. TTFT regression if we index synchronously — mitigated by ready-or-skip
   seed + background coalesce.
4. Size-gate on waived files — do not touch them.
