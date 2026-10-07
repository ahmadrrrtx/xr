# Phase 18 · Research — study notes

Read before writing code (brief rule). What exists, what the brief assumed
that does not exist, and the decisions that follow from the gap.

## 1. What the brief assumed vs. what is in the tree

| Brief premise | Reality (verified at `6d5b943`) | Decision |
| --- | --- | --- |
| A 188-line `screens/Research/index.tsx` stub with `SAMPLE_SOURCES` to extend | `desktop/src/screens/Research/index.tsx` is a 5-line `PlaceholderScreen id="research"` | Build the screen fresh as `screens/Research/{index.tsx, components/*}` (Builder-style). Nothing useful to preserve. |
| `desktop/src/api/client.ts` with research calls | No such file. The desktop talks to the engine through `desktop/src/engine/transport.ts` (`engineFetch`, base already `/api/v1`) + per-surface modules (`engine/builder.ts`, `engine/chat.ts`). The generated `src/clients/daemon-client.generated.ts` is the CLI/SDK client, not the desktop's. | Add `desktop/src/engine/research.ts` following `engine/builder.ts` (fetch-reader SSE via `engine/sse.ts`, because the packaged sidecar needs the bearer header — `EventSource` cannot send it). |
| An end-to-end research run route with SSE events `research_started / source_found / page_scraped / research_completed …` | Those events exist only for the Phase 10 **provider-operation** job layer (`runner.ts` / `jobs.ts` / `research.routes.ts`: search / scrape / map / crawl / extract). The real orchestrator `runResearch()` (`src/research/engine.ts`) is reachable only from `cli.ts` and `src/voice/pipeline.ts`; it reports progress through `deps.say(line)` strings, has no cancel and no token streaming, and persists a `ResearchSession` through `store.saveResearch`. | Add ONE engine route family that runs `runResearch()` exactly the way `cli.ts` builds it (`src/research/run-deps.ts`), a small in-memory run registry with an SSE replay buffer (`src/research/run-registry.ts`), and structured progress events emitted by the engine beside the existing `say()` lines (`deps.onEvent?`). Cancel is a real `AbortSignal` that reaches the model socket (`provider.chat(…, { signal })`) and the fetch tool. |
| Report cites `[1]…[N]` | The synthesizer cites **source ids**: `[s0]`, `[s3][s7]` (`enforceCitations` in `synthesize.ts`). | The desktop maps `[sN]` → citation numbers in order of first appearance and renders `<sup>` links; the "Sources cited" list uses the same numbering. |
| Depth: Quick / Standard / Deep / Academic with minute estimates | `DEPTH_BUDGETS` has two tiers: `quick` (4 queries · 10 sources · 5 read) and `deep` (10 · 28 · 16). There is no ArXiv/journal provider — `ranking.ts` only *scores* academic domains higher. | Add one honest third tier `thorough` (14 queries · 40 sources · 24 read) so the three enabled labels map 1:1 to engine budgets: Quick→`quick`, Standard→`deep` (default), Deep→`thorough`. Hints show the engine budget ("up to N pages read"), never minutes. **Academic is shown disabled** with the reason. |
| Token streaming of the report | `synthesize()` is one structured JSON call — nothing to stream. | The report renders in one go when `run_completed` arrives (fade-in). Live progress is the plan / search / fetch / extract feed, which is what the engine actually emits. |
| ArXiv filter, Connected apps | No provider for either. | Both rendered disabled with a tooltip; Connected apps says "Coming in Phase 22". |

## 2. Engine facts the UI is wired to

- `runResearch(deps, opts)` → `ResearchSession { id r_xxx, topic, mode, depth, status, plan, sources[], notes[], contradictions[], synthesis?, finalReport?, meter, … }`. Status order: `planning → discovering → ranking → fetching → extracting → checking → synthesizing → done | stopped`.
- Sources: `{ id sN, url, domain, title, snippet, type (official|academic|primary|news|docs|community|reference|unknown — Phase 18 adds `local`), trust 0–1, relevance 0–1, freshness { label, … }, fetched, verified, fetchError?, content? }`.
- Contradictions: `{ id, sourceIds[], description, severity }`. Synthesis: `{ shortAnswer, executiveSummary[], report, openQuestions[], overallConfidence }`.
- Search is fail-closed: `WebSearchCapability.available()` needs the SearXNG host in `security.egressAllowlist` (default list includes `searx.be`); fetching *other* hosts needs `config.research.allowPublicWeb` (default **false**) — otherwise every page fetch fails with "blocked by egress allow-list". Private ranges are blocked by the egress proxy unless the exact IP is in `security.allowedHosts`.
- Budget: `GovernedResearchBudget` (cloud; same `CostGovernor` + `BudgetManager` as chat — spend lands in the Budget screen automatically) or `LocalResearchBudget` (ollama; `$0`). `priceFor()` returns FREE for unknown provider/model → the UI shows "cost unknown" rather than `$0.00` in that case (Art. IV.5).
- Persistence: `store.saveResearch / getResearch / latestResearch / listResearch(limit)`; existing routes `GET /api/research` (recent list) and `GET /api/research/{id}` (full session) already serve "Recent research".
- Memory: the CLI's `remember` flow (fact + provenance `generated_synthesis` + evidence item + per-source links) is extracted to `src/research/remember.ts` and shared by the CLI and the new route.

## 3. New engine surface (as built — verified with curl against the dev engine)

All under `/api/v1` (the daemon serves both prefixes); contract in
`contract-research.ts`, schemas in `schemas-research.ts`, parameterised
routes match by `pattern:` regex (prefix matching would shadow them).

| Op | Route | Verified behaviour |
| --- | --- | --- |
| `research.run.start` | `POST /research/run` | body `{ query, depth: quick\|deep\|thorough, mode?, allowPublicWeb?, provider?, model?, documents?: [{ name, text, kind: "pdf"\|"local" }] }` → **202** `{ runId: "rr_…", state, provider, model, searchAvailable, publicWeb, depth, mode, documents }`. 400 on bad input, 429 when more than 2 runs are live. |
| `research.run.get` | `GET /research/run/{runId}` | `{ run: { id, state: queued\|running\|done\|stopped\|cancelled\|error, topic, sessionId, createdAt, updatedAt, result?, error? } }` |
| `research.run.stream` | `GET /research/run/{runId}/stream` | SSE: replay buffer, then live, then `stream_end` and `[DONE]`. 404 for unknown ids. |
| `research.run.cancel` | `POST /research/run/{runId}/cancel` | `{ ok: true, id }`; the `AbortSignal` reaches the provider socket and the fetch tool; the session persists as `stopped` / `stopReason: "cancelled"`. 409 once terminal. |
| `research.upload.pdf` | `POST /research/upload-pdf` | multipart `file` **or** a raw `application/pdf` body with `x-xr-filename` (the desktop uses the raw form because `engineFetch` pins JSON content types). → `{ name, bytes, pages, pagesRead, chars, text, truncated }`; 422 "That file is not a PDF.", 413 above 20 MB. Text is extracted in-process with `unpdf`; nothing is written to disk. |
| `research.settings.get/set` | `GET/PATCH /research/settings` | `{ allowPublicWeb, searchAvailable, searchHost, egressAllowlist, budgets{quick,deep,thorough}, provider, model }`; PATCH persists `config.research.allowPublicWeb`. Shield's "Research web access" row reads/writes this (engine-enforced per fetch). |
| `research.remember` | `POST /research/{sessionId}/remember` | `{ ok, memoryId, duplicate, linkedSources }`; 409 `memory_disabled`; 400 when the session has no report; 404 unknown. |
| (existing) | `GET /research`, `GET /research/{id}` | recent list `{ count, recent[{ id, topic, depth, status, updated_at }], latest }` and the stored `ResearchSession` — "Recent research" and read-only loads. |

Local files: no new engine route. When the "Local files" filter is on, the
desktop lists the active workspace's `.md/.txt` through the Builder project
API (`fetchTree` / `readFile`, same sandbox rule), caps them (12 files / 200 KB)
and sends them as `documents[kind: "local"]`; the engine turns them into
already-fetched `local` sources (`url local://name`, `domain local-file`).

### Real SSE frames (captured from `GET /research/run/:id/stream`; fixtures in `test/desktop/fixtures/research/*.jsonl`)

```
run_started   { sessionId, topic, depth, mode, provider, model, searchAvailable, publicWeb, runId, at }
status        { status: planning|discovering|ranking|fetching|extracting|checking|synthesizing|done|stopped }
log           { line }                                   # the engine's say() lines, verbatim
plan          { objective, questions[], queries[] }
search        { query, phase: start|done, hits?, unavailableReason? }
sources       { sources: LiteSource[] }                  # ranked snapshot (no page content)
fetch         { sourceId, phase: start|ok|fail, chars?, freshness?, error? }
extract       { sourceId, phase, notes? }
contradictions{ count }
budget        { meter, reason? }
run_completed { result: { sessionId, topic, depth, mode, status: done|stopped, stopReason?, report, shortAnswer,
                          executiveSummary[], openQuestions[], overallConfidence, sources: LiteSource[],
                          contradictions[], evidence: { sN: string[≤5] }, usage: { inTokens, outTokens, usd|null, local },
                          provider, model, startedAt, endedAt } }
run_error     { code, message }
stream_end    {}                                        # then "data: [DONE]"
```

`LiteSource = { id, url, domain, title, snippet, type, trust, relevance, freshness, fetched, verified, fetchError?, contentChars, foundVia }`.
An egress refusal is a `fetch{phase:"fail"}` whose `error` reads
"blocked by egress allow-list (rerun with --allow-public-web to fetch public web pages)".
`status: done` alone never settles the UI — `run_completed` (which carries the
result) does; a cancelled run arrives as `status: stopped` + `run_completed{ status: "stopped", stopReason: "cancelled" }`.

### Desktop model (`desktop/src/research/{core,reduce,api}.ts`, `stores/researchStore.ts`)

- `applyRunEvent(slice, frame)` is a pure reducer over exactly those frames; `finalizeResult` settles stats from `result.usage` (cost `null` → "unknown", `local` → gray "local" pill — nothing is invented). Both are unit-tested by replaying the captured streams.
- Phases: `planning` ← planning; `searching` ← discovering/ranking; `reading` ← fetching/extracting; `synthesizing` ← checking/synthesizing; `done`/`partial`/`cancelled`/`error` from `run_completed`/`run_error`. A finished run in which **nothing was read** becomes the error card (the engine's snippet-only fallback is not presented as a report), with the Shield path when the failures were egress refusals or search itself was unavailable.
- Citations: `[sN]` → numbers in first-appearance order; the article rewrites them to `[n](#cite-sN)` links which render as `<sup>` buttons; the "Sources cited" list and the cards share the numbering.
- The run is **store-owned**: the SSE stream is closed on run end, cancel, reset and `pagehide`, not on screen unmount, so navigating to Runs/Shield mid-run does not kill the run (deliberate deviation from the brief's "closed on unmount"; `leaveScreen()` only stops the voice-follow poller).
- Budget: `budgetGate` before the start (surface `research`, agent `researcher`; a governor downshift is shown in the running panel) and `recordSpend` after with the engine's measured usage (skipped for local models). Runs/Brain get a recorder run (`Research: <topic>`, agent Researcher, mode `research/<depth>`) whose synthesis span carries the measured tokens (`brainStore.onSpanEnd` now credits late `tokensIn`).

## 4. Desktop reuse points

- `engine/transport.ts` (`engineFetch/engineJson`), `engine/sse.ts` (`readSse`), `components/Resizer.tsx` (persisted widths), `screens/Chat/components/CodeBlock` (Shiki), `react-markdown + remark-gfm` (own component set for the article), `sonner` toasts, `@tauri-apps/plugin-dialog` + `plugin-fs` (export), `plugin-shell` (open in browser), `react-window` (sources > 100), `hooks/useHotkeys` (screen-local chords), `stores/brainStore.beginEngineRun` (Runs/Brain row with real tokens), `stores/builderStore`/`engine/builder.ts` `writeFile/createFile` (Shield-gated save to workspace), `lib/paletteCommands` + `PaletteResults` `?` prefix (HUD "research …").
- Theme tokens: `--accent`, `--warning`, `--danger`, `--success`, `--bg-raised`, `--border-subtle`, `--text-secondary`; glow only under `[data-theme='xr-native'|'midnight']`; reduced motion via `[data-motion='reduced']` + `prefers-reduced-motion`.

## 5. Size / gates

- `contract.ts` is exactly 800 lines (threshold `> 800` fails): the research contract lives in `contract-research.ts`; one blank line in `contract.ts` gives way to the import.
- `TREE_CEILING` raised 148,000 → 149,000 with a dated reason (new engine files ≈ 900 lines).
- New runtime dependency: `unpdf@1.8.1` (MIT, zero transitive deps, works under Bun — verified with a generated PDF). SBOM/license gate covers it.

## 6. Follow-ups (not in this PR)

- Voice "research {topic}" runs engine-side (`src/voice/pipeline.ts`) and answers by voice; the desktop now opens `/research?q=…&via=voice` and follows the stored session when it lands (polls `GET /research`), but it cannot show that run's live feed — that needs the engine→desktop run handoff noted in Phase 17.
- Chat's `[n]` citation chip (`lib/markdown.tsx`) explains that chat citations are not linked to sources and points at Research.
- Past-report refresh (`refreshResearch`) is reachable from the CLI only.
- Stored sessions keep only the engine's human meter string, so re-opened sessions show "usage was not recorded" instead of numbers; persisting `usage` on the session is an engine follow-up.
- Academic depth / ArXiv lane and Connected apps stay disabled with their reasons; hover citation popovers, PDF inline viewer, share links, citation graph, PDF/DOCX export are out of scope per the brief.
