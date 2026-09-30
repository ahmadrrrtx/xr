# Phase 4 — Chat Screen (implementation report)

> Agent 5 · branch pending approval → `phase/4-chat` · builds on Phase 3 (#140, merged).
> Plan: `docs/phases/04-chat.plan.md`

## Gates — all green

| Gate | Result |
| --- | --- |
| `tsc --noEmit` | ✅ clean |
| `eslint .` | ✅ clean (0 problems) |
| `bun run build` | ✅ built |
| `cargo check` (src-tauri) | ✅ finished dev profile |
| Playwright e2e (browser dev, localStorage DB + mock LLM) | ✅ **41/41** (`previews/implementation/phase-04/results.txt`) |
| Screenshots | ✅ 10 required (+ multiline, 5 single-theme shots, contact sheet) |

## What shipped

- **Sessions panel** (260px): New Chat primary, search (>5 sessions, client-side filter), date groups Today/Yesterday/Last 7 days/Older, 44px rows with timestamp + model dot, active = `bg-bg-raised` + 3px accent bar, hover rename (inline, Enter/Escape)/archive/delete, archived link (toast v1), collapsible via `⌘⇧O` + header toggle, auto-hidden <960px, "Show all" cap at 100.
- **Welcome state**: 80px Avatar, "Hey {name}. What are we building today?", 4 suggestion chips that create a session and send.
- **Message list**: normal flex-col + stick-to-bottom hook (120px threshold, instant scroll during tokens, smooth on send, "N new" badge, jump button with spring entrance), older-message pagination (cursor, 30/page, scroll-anchored prepends), aria-live mirror, skeleton loader for older pages.
- **Bubbles**: user right (`bg-bg-raised`, 16px radius, 4px top-right, initial circle); XR left (28px head Avatar, `bg-bg-ink`, 4px top-left) with per-theme treatment (xr-native glow / graphite+midnight accent border / paper+arctic subtle border + shadow); hover copy/edit (user) and copy/regenerate (XR); errored bubbles get a danger left border + retry; queued (offline) bubbles dashed + clock.
- **Markdown**: react-markdown + remark-gfm (tables, task lists, strikethrough), headings/quotes/lists/tables per DESIGN-SYSTEM, citations as cyan superscripts (toast until Phase 18), inline code token-safe (`bg-black/40` → `bg-black/5` on light themes via CSS).
- **Code blocks**: shiki (fine-grained bundle, JS regex engine — no wasm) lazy singleton, **one highlight pass with dual palettes as CSS vars** (`github-dark`/`github-light`, `defaultColor:false`) — theme switch is pure CSS; header with language label + hover copy; max-height 480px; graceful plain `<pre>` fallback.
- **Tool call cards**: collapsed 48px row (Lucide icon per tool, summary, status ✓/✗/spinner/⏸, chevron), expand shows pretty input/output, category-colored left border; "waiting approval" toast (real modal = Phase 7); cards interject between text segments via `metadata.segments`.
- **Composer**: react-textarea-autosize (44→200px), Enter send / Shift+Enter newline / **IME-safe** (isComposing + 229), paste-images, drag-drop overlay (counter ref), paperclip → Tauri dialog (browser: file input), mic + voice-theater toasts, send⇄stop while streaming (stop cancels + keeps partial), model chip popover (3 models, session + default persisted), token counter (chars/4 vs 128K, visible >75%, amber 90%, red 98%), `↑` prefills last user message, autofocus.
- **Offline**: `navigator.onLine` + event listeners, yellow banner, queued messages park and **auto-flush on reconnect**.
- **Persistence**: `chat.rs` — rusqlite, WAL, `xr.db` in app data dir, idempotent schema, 10 commands (sessions CRUD + cursor-paginated messages + upsert/delete); browser mirror with identical contract for dev/e2e. Model choice persists per session + default (`xr.model.default`).
- **Shortcuts**: `⌘N` (new session — rewired AppShell + cmdk), `⌘/` (composer), `⌘⇧O` (panel), `Esc` (cancel stream), `↑` (edit last), `⌘⇧C` (copy last code block), `⌘F` (session search).
- **A11y**: skip-to-conversation link, aria-labels on all icon buttons, `role="code"`/`role="region"` labels, live region, reduced-motion (caret static, springs → fades).

## Notable decisions / fixes during QA

- **Removed `tauri-plugin-sql`** (unused Phase-0 scaffold wiring — no frontend import, no capability): its sqlx → `libsqlite3-sys 0.28` cannot coexist with rusqlite's `0.35` (Cargo `links="sqlite3"` conflict). Phase 4's brief mandates the `chat.rs` command path; one SQLite stack, WAL, no duplicate linking.
- **Mock fences**: prose tokens don't end in newline — fences now guarded with blank lines (a glued ` ```ts ` doesn't open a fence and the closing fence swallowed the following prose).
- **Zustand selector loop**: `s.messages[id] ?? []` returned a fresh array per snapshot → `useSyncExternalStore` infinite loop on empty sessions → stable `NO_MESSAGES` constant.
- **Offline flush duplicate**: `retryMessage` re-committed queued messages and `commit` appended → upsert by id (caught by React's duplicate-key warning in the e2e run).
- **Error-rate determinism**: mock's 5% dev failure now overridable via `localStorage.xr.mock.errorRate` (init-script timing made the runtime hook flaky).
- Shiki's template-literal dynamic imports can't be resolved by Vite — static per-language import map.

## Out of scope (as briefed)

Real LLM (14) · real file upload (text note only) · voice/theater (toasts, 15/16) · citations panel (18) · approval modal (7) · right panel · reactions/threads · resizable divider.

## Next

Ahmad approves → branch `phase/4-chat`, push, open PR, stop (no merge, no Phase 5).
