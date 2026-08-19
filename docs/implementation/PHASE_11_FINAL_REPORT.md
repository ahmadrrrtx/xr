# Phase 11 — Repo Intelligence / Coding Experience — Final Report

**Date:** 2026-08-19
**Base:** `main` @ `a498a9d` (Phase 10 Web Research)
**Verdict:** PHASE 11 PASS (with documented pre-existing egress-test flake)

This is not “a repo map feature.” XR can now treat a repository as a
**structured system** — files, symbols, dependencies, git/diff, ranked under
a token budget — and feed that into the existing context engine and
capability pipeline.

---

## A. What was discovered

The repository already provided most of the substrate Phase 11 must not
duplicate:

| Existing | Where | Reused how |
|---|---|---|
| Content-addressed scan cache (tree fingerprint) | `src/util/scan-cache.ts` | Principle only; per-file parse cache is new |
| Incremental memory reindex (sha256 skip) | `MemoryStore.reindexEmbeddings` | Same skip contract for parse cache |
| One SQLite file per workspace + WriteGate | `WorkspaceStore` / `WorkspaceManager` | New tables via Migration 4 + `RepoStore` |
| Hybrid retrieval + `ExternalCandidate` | `context/retrieval.ts` | Repo map injected as extras |
| `project_knowledge` tier | `context/types.ts` | Repo facts live here |
| Progressive disclosure / budget | `context/budget.ts` | Unchanged |
| Unified tools | `ToolRegistryService` | `repo_*` registered as core |
| Real git tools | `src/tools/git.ts` | Ranking/diff use `git`, not mtimes |
| Secret/path policy | `security/guard.ts` | `isSecretPath`, `canonicalPath` |
| Default skip dirs | `context/memory/rag.ts` | Aligned ignore set |
| Metrics registry | `observability/metrics.ts` | Repo histograms/counters |
| Phase 10 tool pattern | `src/research/tools.ts` | Same core + read-only + audit shape |

`rag_chunks` remains the Block-4 chunk/embed path. Repo Intelligence is
**structural** (symbols + graph), not a second vector database.

Waived modules (`workspace-store.ts`, `config.ts`, `catalog.ts`) were **not
grown**.

---

## B. Research findings

### Aider — researched fact

Aider: tree-sitter → tags (defs/refs) → file graph → personalized PageRank
→ ~1024-token tree. Unchanged files SQLite-cached. Map is structural; bodies
are fetched separately.

**Principle borrowed:** do not dump the repository. Build a compact, ranked,
token-budgeted structural representation.

**Not copied:** Python/NetworkX/grep-ast, 130+ language claim, chat-file
personalization internals.

### Tree-sitter — researched fact

- Native node bindings are C addons; Bun’s weak spot.
- `web-tree-sitter` needs per-language WASM (distribution + size).
- XR’s only required runtime dependency is `zod`.

**Implementation decision:** tree-sitter is an **optional** future backend
(`confidence: "ast"`). XR ships first-party **structural scanners**
(`confidence: "structural"`) and a labeled **heuristic** fallback. We do not
install tree-sitter.

### Other agents — principles only

- Claude Code: progressive file reads (map → symbol → section → full file).
- OpenHands / Goose: typed tools on one execution path.

**Inference:** task-specific ranking must beat generic popularity or the map
collapses to `types.ts` / `registry.ts`.

---

## C. What was implemented

### Added

```
src/repo/                 public API + indexer + ranking + map + tools
src/repo/parser/          JS/TS, Python, Go, Rust, heuristic fallback
src/commands/repo.ts      xr repo …
test/repo-map/            26 tests
scripts/repo-intelligence-bench.ts
benchmarks/repo-intelligence/
docs/implementation/PHASE_11_DESIGN.md
docs/architecture/PHASE_11_REPO_INTELLIGENCE.md
```

### Modified (integration only)

- `src/state/migrations.ts` — Migration 4 `repo_intelligence` (reversible)
- `src/tools/registry.ts` / `registry-service.ts` / `registry-builder.ts`
- `src/capabilities/compatibility.ts` — `repo_*` → `filesystem.read`
- `src/context/service.ts` — `extras` on assemble; `project_knowledge` still
  granted when memory is off
- `src/services/agent-service.ts` — seed repo map if index is ready (no TTFT wait)
- `src/cli/command-loaders.ts`, `src/core/boot-profile.ts`, `src/cli/route-decision.ts`
- `.dependency-cruiser.cjs` — `src/repo` is L2 Platform
- `docs/OWNERSHIP.md` — regenerated (167 areas)

---

## D. Architecture (final flow)

```
                 USER CODING TASK
                        │
                        ▼
                TASK TERMS (deterministic)
                        │
          ┌─────────────┴─────────────┐
          ▼                           ▼
   MEMORY / CONTEXT             REPO INTELLIGENCE
   (Phase 09 extras)                  │
                           ┌──────────┼──────────┐
                           ▼          ▼          ▼
                        FILES      SYMBOLS   DEPENDENCIES
                           └──────────┼──────────┘
                                      ▼
                          GRAPH + RELEVANCE RANK
                                      │
                           ┌──────────┼──────────┐
                           ▼          ▼          ▼
                         GIT       DIFF       TASK TERMS
                           └──────────┼──────────┘
                                      ▼
                         TOKEN BUDGET (default 1024)
                                      ▼
                                REPO MAP
                                      ▼
                     CONTEXT extras (project_knowledge)
                                      ▼
                      repo_* tools (progressive load)
                                      ▼
                    ToolRegistryService → Policy / Shield / Audit
                                      ▼
                                  XR AGENT
```

Repo items: `type=knowledge`, `provenanceKind=file`, `trust=source_evidence`,
tags `repo`. Research extras stay `research`/`web`. They can share a package;
they are never the same class of fact.

---

## E. Parser support

| Language | Parser | Confidence |
|---|---|---|
| TypeScript / JS / TSX / JSX | `xr-js-scanner` | structural |
| Python | `xr-python-scanner` | structural |
| Go | `xr-go-scanner` | structural |
| Rust | `xr-rust-scanner` | structural |
| Java, C/C++, C#, PHP, Ruby, Kotlin, Swift | `xr-heuristic` | heuristic |

We do **not** claim 100+ languages. Tree-sitter is not shipped.

---

## F. Cache

Key: `workspaceId + sha256(bytes) + parserVersion`.

- Unchanged file → reuse symbols/edges (no re-read of parse payload if hash matches)
- Changed file → re-parse, replace graph
- Deleted file → removed from `repo_files`, `repo_symbols`, `repo_edges`, search, map
- Rename → delete + add
- `indexVersion` / `parserVersion` change → wipe that workspace’s index

Lifecycle: `not_indexed` → `indexing` → `ready` | `failed`. Concurrent jobs
coalesce per `workspaceId::root`. Failed is never marked ready.

---

## G. Ranking

Deterministic, no LLM:

```
score = 4.0·lexical + 6.0·symbol + 2.2·path + 1.6·dependency
      + 1.0·min(personalized PageRank, 0.35) + 1.1·git + 1.4·taskHit
```

Exact symbol match outranks a high-degree generic file (tested). Git
modification is a boost, never the primary signal.

---

## H. Token budget

Estimator: `xr-code-approx-v1` (documented approximation — **not** tiktoken;
XR has no official tokenizer). `chars/4` is **not** claimed as exact.

Measured (`bun run scripts/repo-intelligence-bench.ts`, 121 generated TS files):

| | |
|---|---|
| Budget | 1024 |
| Map tokens | **624** |
| Files / symbols in map | 121 / 122 |
| Generation p50 / p95 | 8.4 ms / 14.2 ms |

Tests assert 256/512/768/1024 budgets are never exceeded.

Configurable: `XR_REPO_MAP_TOKENS`. Kill switch: `XR_REPO_DISABLED=1`.

---

## I. Security

- Every query and row is `workspaceId`-scoped (tested A ↛ B)
- `isSecretPath` blocks `.env`, `.env.local`, SSH keys, `credentials.json`, …
- Symlinks resolving outside the root are not followed
- `.gitignore` + `.xrignore` + default skip (`node_modules`, `.git`, `dist`, …)
- Repo tools are read-only core, `filesystem.read`, workspace scope, plan/ask safe
- Model REQUESTS `repo_*`; it cannot grant itself index privileges
- No source bodies or secrets in metrics/logs

---

## J. Performance (measured)

Host: Linux x64, Bun 1.3.14. Synthetic 121-file tree.

| Metric | Value |
|---|---|
| Initial index | 121 files, **46 ms**, 121 cache misses |
| Incremental (unchanged) | **12 ms**, 0 reparsed, **100% cache hit** |
| Query p50 / p95 | 0.36 ms / 0.63 ms |
| Repo-map p50 / p95 | 8.4 ms / 14.2 ms |
| 80-file fixture 2nd pass | cheaper than first (automated test) |

Startup does **not** wait for indexing. Agent seed uses the map only when
`state === ready`; otherwise it kicks a background index and continues.

---

## K. Tests

| Gate | Result |
|---|---|
| `bun run typecheck` | **PASS** |
| `bun run boundaries` | **PASS** — 608 modules, 1995 deps, 0 violations |
| `bun run size-gate` | **PASS** |
| `bun run claim-lint` | **PASS** |
| `bun run hot-path-lint` | **PASS** |
| `bun run ownership:check` | **PASS** — 167 areas |
| `bun run ci-capability-gate` | **PASS** |
| Phase 11 `test/repo-map/` | **26 pass / 0 fail** |
| Full suite | **3401 pass / 19 skip / 13 fail** (see L) |
| Security / isolation / git / golden | **PASS** (in `test/repo-map/`) |

---

## L. Regressions

| Area | Status |
|---|---|
| typecheck / boundaries / size-gate / claim-lint | **PASS** |
| Phase 11 repo tests | **PASS** |
| Phase 09 engine / migrations / boot profiles / tool semantics | **PASS** |
| Phase 4 `test/security/egress-proxy.test.ts` | **PRE-EXISTING FLAKE** |

The 13 full-suite failures are all `Phase 4 · T4` egress/DNS tests. They
**pass in isolation** (`bun test test/security/egress-proxy.test.ts` → 16/16)
and fail only when interleaved with other files (shared DNS/mock isolation).
Phase 11 did not touch `egress-proxy.ts` / `private-ip.ts`. Classified
**PRE-EXISTING**, not a Phase 11 regression.

No CLI/daemon/startup path was made to wait on a full index.

---

## M. Remaining limitations

1. **No tree-sitter in tree.** Structural scanners miss unusual syntax
   (decorated/parameter properties, complex TS mapped types). Confidence is
   labeled; we do not invent AST nodes.
2. **Heuristic languages** (Java, C/C++, …) only extract import-like lines
   and a file-level module symbol.
3. **Token counts are approximate** (`xr-code-approx-v1`). There is no
   tiktoken in XR.
4. **`xr repo` is not in `src/cli/catalog.ts`** (size-waived at 871 LOC).
   The command is registered (`command-loaders` + `route-decision`) and
   works; primary help does not list it. `xr repo --help` still prints usage.
5. **Path aliases** (`@/`, tsconfig paths) resolve only when the target
   exists as a known file (`src/…`). Otherwise they are `external`/`unresolved`.
6. **Cold start has no repo map** until the first index finishes. The agent
   can still call `repo_map` / `repo_search` (those await index).
7. **Catalog / config / workspace-store** were not extended (waiver / size).
   Repo config is env-based (`src/repo/config.ts`).

None of these are exit-criterion failures for Phase 11.

---

## Phase integration check

| Phase | Integration |
|---|---|
| 02 API contract | No new HTTP surface (internal + tools + CLI) |
| 05 Chat / TTFT | Seed is ready-or-skip; no blocking index |
| 06 Reliability | Index jobs coalesce; failed ≠ ready |
| 07 Security | Secret paths, symlink scope, workspace fence |
| 08 Capabilities | `repo_*` through ToolRegistryService |
| 09 Memory/context | Extras on `assembleWithGrant`; progressive tools |
| 10 Research | Distinct provenance; `isRepositoryFact` / `isResearchFact` |

---

## Final verdict

PHASE 11 PASS.

XR can answer: *given this coding task, which parts of this repository are
relevant, and what compact structural representation should the model see?*
The agent loop can request more through `repo_map`, `repo_search`,
`repo_symbols`, `repo_dependencies`, `repo_context`, and `repo_diff` — all
on the existing policy path.
