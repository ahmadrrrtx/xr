# Phase 18 · Research — build plan

Branch `phase/18-research` from `main@6d5b943`. One feature commit, PR vs
`main`, no self-merge.

## A. Engine (`src/research`, `src/daemon/routes`)

1. `types.ts` — `ResearchDepth` gains `thorough` (+ `DEPTH_BUDGETS.thorough`), `SourceType` gains `local`, `ResearchSession.stopReason?`.
2. `run-events.ts` — the structured event union + a `liteSource()` projection (no page content on the wire).
3. `engine.ts` — `deps.onEvent?`, `deps.signal?`; emit at every stage already marked by a `say()`; cancellation checks before each await; abort error → `stopped/cancelled`; `opts.documents` (PDF / local text) become fetched `local` sources ahead of ranking so extraction and synthesis cite them.
4. `llm.ts` — `StructuredCallDeps.signal` forwarded to `provider.chat(…, { signal })`.
5. `run-deps.ts` — `buildRunDeps(store, config, { allowPublicWeb, signal, say, onEvent })` = the `cli.ts` recipe (governor fallback, egress-gated search with `allowedHosts`, governed/local budget) + a usage tracker for truthful stats.
6. `run-registry.ts` — `ResearchRunRegistry`: start / events / cancel / terminal; bounded ring buffer; one run per id; registry on `DaemonState`.
7. `remember.ts` — `rememberResearch(store, session)` extracted from `cli.ts` (CLI calls it).
8. `pdf-text.ts` — `extractPdfText(bytes)` via `unpdf`, size + page caps, never touches disk.
9. `research-run.routes.ts` — the routes in the notes table; `contract-research.ts` + schemas; `contract.ts` spreads it; regenerate client + OpenAPI; waiver line count; `TREE_CEILING`.
10. Tests (`test/research/run-events.test.ts`, `test/research/run-registry.test.ts`): event emission with a fake provider/search, cancel → `stopped`, documents become `local` sources, `[sN]` → citation mapping (pure helper shared with the desktop via `test/desktop`).

## B. Desktop (as built)

1. `research/api.ts` — `startRun`, `streamRun(runId, onEvent, signal)`, `cancelRun`, `getRun`, `listSessions`, `getSession`, `uploadPdf(file)` (raw body + `x-xr-filename`), `getSettings/setAllowPublicWeb`, `rememberSession`.
2. `research/core.ts` — pure helpers (`[sN]` → numbered citations, phase mapping, engine-budget hints, formatting, slug/date path, follow-ups, export markdown, stored-session projection); `research/reduce.ts` — the frame reducer. Both unit-tested from root `bun test` (`test/desktop/research-{core,reduce}.test.ts`, relative imports, real captured frames as fixtures).
3. `stores/researchStore.ts` — the brief's state + actions; store-owned stream; Brain/Runs recorder via `beginEngineRun`; budget gate + measured spend; local files through the Builder project API; save-to-workspace through Builder `writeFile` (Shield approval); export via Tauri dialog or browser download; `rememberRun`; voice follow.
4. `screens/Research/` — `index.tsx` (lazy route wrapper, Builder-style) → `ResearchScreen.tsx` (3 columns, hotkeys, URL intents, aria-live) + `components/{QueryPanel, MainColumn (hero · live feed · skeleton · error card), ReportView, SourcesPanel, SourceCard}.tsx`.
5. `styles/research.css` — tokens only; glow scoped to XR Native / Midnight; reduced-motion block; Paper/Arctic tints.
6. Cross-surface: palette `?` prefix → `/research?q=…&start=1` + "Research…" command; Shield → engine-backed "Research web access" row (`Enforced`, deep link `/shield?tab=security&section=network`); voice final transcript "research …" → `/research?q=…&via=voice`; Budget gate/record; Runs/Brain rows with measured tokens; Builder write for save.

## C. Verification

- `bun run typecheck`, targeted `bun test test/research test/desktop`, desktop `tsc --noEmit`, `bun run lint`, `vite build`; root gates: `size-gate`, `claim-lint`, `hot-path-lint`, `desktop:sink-lint`, `api:schema:check`, `client:check`, `api:compat`, `boundaries`, `ownership:check`, `supply:check`.
- Smoke: engine on 3141 with a local OpenAI-compatible stand-in model and a local SearXNG/page stand-in (sandbox has no Ollama and searx.be is behind a browser check) → curl the SSE, then Playwright through `vite preview` on 4173: idle, running, done (report + sources + contradictions), error (egress blocked), 5 themes, reduced motion. Screenshots → `/home/user/previews/implementation/phase-18/` and `previews/implementation/phase-18/`.
