# Phase 4 — Chat Screen (plan)

> Agent 5 · Branch: `phase/4-chat` · Builds on Phase 3 (#140, merged).
> Brief: "SCREEN 1: CHAT" (docs/SCREEN-BRIEFS.md) · DESIGN-SYSTEM §2/§5/§7 · THEME-SYSTEM adaptation table.
> NOTE: `previews/01-chat-screen.png` + theme variants don't exist in the workspace (confirmed in Phases 2–3) — docs + uploads are the visual reference.

## Research (Step 2) — 12 lines

1. Shiki dual themes: `codeToHtml(code, {lang, themes:{light,dark}, defaultColor:false})` emits per-token CSS vars (`--shiki-light`/`--shiki-dark`); a short CSS block picks the var per `[data-theme]` — theme switching needs NO re-highlight.
2. Fine-grained shiki bundle: `createHighlighterCore` + `createOnigurumaEngine(() => import('shiki/wasm'))` + explicit lang/theme imports keeps size sane; lazy dynamic import → code-splits, loads on first code block.
3. rusqlite in Tauri v2: `app.path().app_data_dir().join("xr.db")`, `Connection::open` + `pragma_update(None,"journal_mode","WAL")`, `app.manage(Mutex<Connection>)`, commands take `State<'_, Mutex<Connection>>` — the zero-regrets pattern (dev.to guide).
4. `CREATE TABLE IF NOT EXISTS` idempotent schema init on startup — no migration framework needed at this scale.
5. Stick-to-bottom: `scrollHeight - scrollTop - clientHeight < 120` = "near bottom"; during token streaming assign `scrollTop = scrollHeight` INSTANTLY (smooth per token janks); smooth scroll only for discrete new messages.
6. Show a jump-to-latest button when not stuck; resume follow when user returns to bottom; count new messages while detached as a badge.
7. Blinking cursor: CSS `@keyframes` (not Tailwind animate-pulse — known to stall mid-stream on re-renders); 500ms opacity 0.2↔1; `prefers-reduced-motion` → static opacity 1.
8. HTML5 drag-drop: `preventDefault()` on dragover or drop never fires; dragenter/dragleave counter ref fixes the child-element flicker; files only readable from `e.dataTransfer.files` on drop.
9. IME: check `e.nativeEvent.isComposing` (plus keyCode 229 fallback) so Enter confirms CJK candidates instead of sending.
10. react-textarea-autosize: `<TextareaAutosize minRows={1} maxRows={8}>` with rows→px mapping (44px→200px per brief) — tiny, no editor machinery.
11. Pagination: cursor = `(created_at, id)` DESC LIMIT 30+1 → hasMore; prepend older page, preserve scroll offset by anchoring to the previous first message's offsetTop.
12. Normal `flex-col` (NOT column-reverse): pagination + welcome-state + scroll-anchoring are all simpler with normal flow; brief's auto-scroll behavior preserved via the 120px rule.

## Architecture decisions

1. **Storage abstraction** `src/lib/chat-db.ts`: one typed interface (`ChatDb`), two impls — Tauri (invoke `chat_*` Rust commands; rusqlite, WAL, `xr.db` in app_data_dir) and browser (localStorage JSON mirror, same pagination contract). All stores go through it → full flow testable in `bun dev`/Playwright.
2. **Rust** `src-tauri/src/commands/chat.rs`: `chat_db_init` (setup-managed `Mutex<Connection>`), `chat_list_sessions`, `chat_get_session`, `chat_create_session`, `chat_update_session_title`, `chat_archive_session`, `chat_delete_session`, `chat_list_messages` (cursor, limit 30, hasMore), `chat_save_message` (upsert), `chat_delete_message`. Cargo +`rusqlite {bundled}`.
3. **Message shape**: `{id, sessionId, role, content, createdAt, status?, segments?, toolCalls?}` — `segments: [{type:'text',text}|{type:'tool',toolCallIdx}]` in `metadata` JSON lets tool cards interject between text parts; `content` stays the full markdown for copy/search.
4. **Provider interface** `src/lib/mockLLM.ts`: `streamChat({messages, model, signal, onEvent})` with events `token|tool_call|tool_result|done|error` — Phase 14 swaps the impl, nothing else changes. Tokens 30–60ms variable, occasional pauses; canned pools (greeting / code / email tool / research tool / default); 5% error rate in DEV only (test hook to disable).
5. **Auto-scroll** (`useStickToBottom`): 120px threshold, instant scroll on tokens, smooth on send; `ScrollToBottomButton` with "N new" badge; entrance spring 200ms.
6. **Bubbles**: user right `bg-bg-raised` rounded-16 top-right-4 + initial circle; XR left with `<Avatar size="sm" variant="head">` + `bg-bg-ink` rounded-16 top-left-4; max-w 70%; theme adaptation via `useThemeStore` — xr-native: `box-shadow: 0 0 12px -4px var(--accent-glow)`; graphite/midnight: 2px accent left border; paper/arctic: `border-subtle` + light shadow.
7. **Shiki theming**: single pass, `defaultColor:false`, CSS in globals.css maps `.shiki span` → `--shiki-dark` for dark themes, `--shiki-light` under `[data-theme='paper']/[data-theme='arctic']`. Code bg stays token-based (`bg-black/50` dark, `bg-black/5` light) per THEME-SYSTEM inline-code row.
8. **Session panel**: 260px, inside the chat screen (the app sidebar stays); collapsible via `⌘⇧O` + header button; auto-hidden `<960px`. Groups Today/Yesterday/Last 7 days/Older; search appears >5 sessions; hover actions rename/archive/delete; active = `bg-bg-raised` + 3px accent bar.
9. **Routing**: `/chat` (welcome/new), `/chat/:sessionId` loads messages. AppShell main drops `p-6` on chat routes (chat manages its own flush layout).
10. **Shortcuts**: `⌘N` new session (rewire AppShell + cmdk to sessionsStore), `⌘/` focus composer, `⌘⇧O` panel toggle, `Esc` cancel-stream/blur, `↑` (empty composer) prefill last user msg, `Cmd+Shift+C` copy last code block, `⌘F` focus session search (chat-local, stops propagation).
11. **Attachments**: in-memory `FileAttachment[]` (name/size/type/dataURL preview); paperclip → Tauri dialog (browser: hidden file input); paste images; drag-drop overlay on the chat area (counter ref); on send → `[Attached: file]` note in message text + cleared (v1 contract).
12. **Offline**: `navigator.onLine` + online/offline events; sends while offline park as `queued` (dashed bubble + clock), yellow banner, auto-flush on reconnect. Token counter chars/4 vs 128K — visible >75%, amber 90%, red 98%.

## Files

- New: `src/screens/Chat/index.tsx` + `components/{SessionList,SessionItem,MessageList,MessageBubble,CodeBlock,ToolCallCard,Composer,WelcomeState,AttachmentStrip,ModelPicker,StreamingCursor,ScrollToBottomButton}.tsx`
- New: `src/stores/sessionsStore.ts`, `src/stores/chatStore.ts`, `src/lib/chat-db.ts`, `src/lib/mockLLM.ts`, `src/lib/markdown.tsx`, `src/hooks/useStickToBottom.ts`
- Modified: `src/router.tsx` (chat route param already OK), `src/components/layout/AppShell.tsx` (flush main on /chat, ⌘N rewire), `src/components/cmdk/CommandPalette.tsx` (New chat → real session), `src/styles/globals.css` (shiki vars, cursor keyframes, scrollbar), `src-tauri/src/commands/{mod.rs,chat.rs}`, `src-tauri/src/lib.rs` (db init + handler registration), `src-tauri/Cargo.toml` (+rusqlite bundled)
- Deps (justified): `react-markdown`, `remark-gfm`, `shiki` (preferred per brief), `react-textarea-autosize`. NO virtualization (cap 100 sessions + "Show all"), NO dnd libs, NO editors.

## Test checklist (Step 6)

bun install clean · typecheck/lint/build green · cargo check green · Playwright (browser, localStorage DB): welcome state + 4 chips → chip creates session + streams; send/Enter/Shift+Enter/IME flag; stop cancels; scroll-to-bottom button + N-new badge; code block renders highlighted w/ lang label + copy; tool call card expands w/ inputs/outputs + status; attachments add/remove/send-as-note; model picker switches + persists; session groups/search/rename/archive/delete; ⌘N/⌘//⌘⇧O/↑/Esc; token counter thresholds; offline banner + queued flush; ↑-edit last; all 5 themes (bubble/code/input adapt); <960px panel hides; reload → sessions persist. Screenshots 01–10 to `previews/implementation/phase-04/`.

## Out of scope

Real LLM (14) · real file upload to model · voice/theater buttons (toast only, 15/16) · citations panel (18) · approval modal (7 — cards show waiting→auto-continue) · right panel · reactions/threads/branching · resizable divider (v1 fixed 260px).
