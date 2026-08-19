# XR Repo Intelligence (Phase 11)

This is the canonical Repository Intelligence design after Phase 11. It
extends the existing scanner, workspace store, context engine, and
ToolRegistryService. It does **not** introduce a second memory system,
vector database, or tool registry.

## Architecture

```
Repository (cwd + workspaceId)
        ↓
Scanner          gitignore + XR defaults + secret paths + no symlink escape
        ↓
Content hash     SHA-256 of file bytes
        ↓
Parse cache      repo_parse_cache (hash + parserVersion)
        ↓
Parser           structural scanners (tree-sitter optional, not shipped)
        ↓
Symbols + deps   repo_symbols / repo_edges
        ↓
Graph ranking    personalized PageRank (capped)
        ↓
Relevance rank   lexical + symbol + path + dependency + git
        ↓
Repo map         token budget (default 1024, xr-code-approx-v1)
        ↓
Context extras   type=knowledge, provenance=file, trust=source_evidence
        ↓
Context engine   existing Phase 09 pipeline
        ↓
repo_* tools     ToolRegistryService → Policy / Shield / Audit
```

## Supported languages

| Language | Confidence | Notes |
|---|---|---|
| TypeScript, JavaScript, TSX, JSX | structural | first-party scanner |
| Python | structural | first-party scanner |
| Go, Rust | structural | first-party scanner |
| Java, C/C++, C#, PHP, Ruby, Kotlin, Swift | heuristic | imports + file module only |

Tree-sitter is an optional future backend (`confidence: ast`). XR does not
ship tree-sitter or language WASM packs.

## Indexing lifecycle

`not_indexed` → `indexing` → `ready`

On failure: `indexing` → `failed` (never marked ready). Retry: `failed` → `indexing`.

Concurrent index jobs for the same workspace coalesce.

Unchanged files (same content hash) are not re-parsed. Deleted files are
removed from files, symbols, edges, search, and the map.

## Ranking

```
score = 4.0·lexical + 6.0·symbol + 2.2·path + 1.6·dependency
      + 1.0·min(graph, 0.35) + 1.1·git + 1.4·task
```

Exact symbol match outranks a generic high-degree file. Git modification is
a boost, never the primary signal. No LLM is involved.

## Token budget

Default `1024` (`XR_REPO_MAP_TOKENS`). Enforced with `countTokens`
(`xr-code-approx-v1`) — a documented approximation, not tiktoken. The map
never exceeds its budget under that estimator.

## Security

- `workspaceId` on every row and query
- `isSecretPath` / `canonicalPath` reused from `src/security/guard.ts`
- Symlinks that resolve outside the root are skipped
- `.gitignore` + default skip dirs (`node_modules`, `.git`, `dist`, …)
- Repo facts are DATA (`project_knowledge`), never instructions
- Research extras keep `provenanceKind: research|web` and are not repo facts

## Progressive loading

1. Repo map (structural)
2. `repo_search` / `repo_symbols`
3. `repo_context` (section, not whole file)
4. `read_file` only if the agent still needs the body

## Kill switch

`XR_REPO_DISABLED=1` disables indexing seed and all repo tools.
