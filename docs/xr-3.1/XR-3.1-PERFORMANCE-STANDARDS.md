# XR 3.1A — Performance Standards
> Hard, measurable performance targets for every XR surface.

Performance is not optional. These numbers are **exit criteria**, not stretch goals. If a release does not meet a target, the release does not ship.

Performance is measured on a reference machine:
- **Reference spec:** 2022 MacBook Pro (M1 Pro, 16GB RAM), or equivalent x86 (i7-12700/16GB RAM/SSD).
- **Network:** 100 Mbps broadband, 50ms RTT to provider endpoints.
- **Reference local model:** Ollama qwen2.5:7b on same machine.
- **Reference cloud model:** Claude Sonnet/Opus (or comparable flagship) via stable internet.

All numbers below were picked after studying the shipped products in our competitive set. Cursor, Claude Code, Warp, Lazygit, and Raycast all meet or exceed these bars today.

---

## 1. Startup performance

| Metric | Target | How measured |
|---|---|---|
| CLI `xr --version` to output | **<100 ms** | time to first byte on stdout (no kernel boot) |
| CLI `xr help` to output | **<200 ms** | includes help text rendering |
| `xr serve` to "Listening on" printed | **<500 ms** | Bun HTTP server up, dashboard HTML servable |
| Shell (TUI) cold start to first paint | **<500 ms** | from enter to first visible frame (alternate screen + brand frame) |
| Shell to interactive prompt ready | **<1.5 s** | composer editable, spinner only on provider health check (which can continue in background) |
| Control Center first paint (HTML) | **<300 ms** | from browser navigation to `DOMContentLoaded` (inline HTML, no external deps — already fast; must not regress) |
| Control Center first content (data populated) | **<1 s** | overview cards populated with real data (parallel fetches, skeleton until then) |
| `xr "hello"` one-shot first token | **<1 s local / <2 s cloud** | includes kernel boot + provider health + first streamed token |

### Rules that guarantee these numbers
1. **Lazy kernel boot.** No subsystem (providers, memory, skills, plugins, voice, research, control, business OS, telegram) initializes until a command that actually needs it is invoked. The current `src/index.ts` fast-path is the starting point; every other command path must be audited for eager imports.
2. **Static strings for fast paths.** Version, help, serve banner are pre-rendered or cheaply computed strings.
3. **Brand animation (6 frames × 110ms) is the only allowed startup wait.** Real loading happens behind the animation, not in front of it. If subsystem init finishes before 660ms, we do not add artificial delay; we transition immediately.
4. **First paint shows chrome; data fills in progressively.** The TUI draws sidebar + empty chat + composer in frame 1; workspace list and session list populate as soon as loaded (spinner/skeleton while waiting).
5. **Dashboard HTML is one static string** (as now); adding components must not add external script/asset fetches that block first paint.

---

## 2. Runtime interactivity

| Metric | Target | Notes |
|---|---|---|
| Keypress to screen (TUI) | **<16 ms** (one 60fps frame) | no 100ms ticker-batching; input must render immediately |
| Input latency (Control Center) | **<16 ms** to keypress echo | browser-native, must not regress |
| Command palette open | **<50 ms** | Ctrl+K to palette visible and interactive |
| Command palette search filter | **<16 ms per keystroke** | even with 500 commands indexed |
| View/panel switch (TUI) | **<50 ms** | e.g., Chat → Sessions |
| View/panel switch (CC) | **<100 ms** | DOM render + data |
| Slash menu open in composer | **<30 ms** | `/` typed to menu visible |
| @-mention menu filter | **<16 ms per keystroke** | fuzzy search across files/skills |
| Workspace switch (visual) | **<200 ms** | UI responds instantly; data loads async |
| Model/provider switch | **<100 ms** to status bar update | applies to next send immediately |
| Approval dialog appearance | **<50 ms** | from XR deciding to ask, to dialog interactive |
| Notification toast appearance | **<80 ms** | event to visible toast |
| Esc closes overlay | **<16 ms** | never feels sticky |

### Rules
1. **Damage-region rendering for TUI.** Do not clear and redraw the entire screen every 100ms. Track which regions changed and only redraw those. At 60fps, outputting 4KB of ANSI per frame is acceptable; outputting 20KB per tick on a 120-col terminal is not.
2. **Render immediately on input**, not on the next ticker. The ticker is only for: (a) spinner advance during busy state, (b) polling for async state changes, (c) periodic time updates.
3. **Debounce filtering** at 16ms (one frame) for search inputs; 50ms max for heavy fuzzy search over large lists.
4. **Never block the main thread** (Bun event loop / browser UI thread) for >50ms with synchronous work. Large JSON loads, fuzzy indexes, and audit-chain verification happen off the main thread (worker thread or async chunks).

---

## 3. Streaming performance

This is the single most important perceived-performance metric.

| Metric | Target | Notes |
|---|---|---|
| Time from Enter to first visible indication ("thinking…") | **<100 ms** | spinner or "connecting…" status appears instantly |
| Time to first token (local model, warm) | **<200 ms** after Enter | Ollama with model loaded in memory |
| Time to first token (local model, cold) | **<2 s** | includes Ollama model load; show loading state with model name |
| Time to first token (cloud, healthy) | **<800 ms** after Enter | network + provider latency |
| Token streaming throughput (visible) | **≥30 tokens/sec** | rendering keeps up with model; never falls behind by >3 tokens |
| Time-to-interrupt (Esc/Ctrl+C to stop) | **<200 ms** | response halts visibly within 200ms of keypress |
| Time from last token to "composer ready" | **<300 ms** | done indicator, cost updated, composer re-enabled |
| Tool-call chip appearance | **<50 ms** from tool decision | chip visible while tool runs; spinner while executing; status update when done |
| Shell-command output streaming | **line-buffered, <50ms latency** | appears same-rate as running the command in a regular terminal |
| Streaming scroll stability | **bottom-anchored** | auto-scroll only when user is at bottom; if user scrolled up, leave them there and show "N new steps" indicator |

### Rules
1. **Every model call streams tokens.** There is no "wait for full answer" path. When a provider's SDK does not support streaming (current `/api/chat` does not stream!), implement SSE chunking at the transport layer or use a streaming-compatible client.
2. **Token rendering uses requestAnimationFrame** (web) / frame-aligned updates (terminal); never re-render the full message list for each token — append to the live message DOM node.
3. **Show incremental tool output**, not just end-of-tool results. For shell commands, stream stdout/stderr as it arrives. For file reads, show progress (lines read). For web fetches, show "fetching <domain>…".
4. **Thinking/extended-reasoning indicators** appear immediately (spinner + label "thinking…") even before first token arrives. Silence >500ms after Enter with no indicator is a bug.
5. **Interrupt is a hard cancel.** When user hits Ctrl+C or Stop: abort the fetch/stream, close the provider connection, show partial response with "(interrupted)" tag, re-enable composer. Never hangs the abort for >200ms.

---

## 4. List and data performance

| Metric | Target | Notes |
|---|---|---|
| Render 100-item list (sessions/skills) | **<50 ms** | virtualize if >200 items |
| Render 1,000-item audit log | **<100 ms initial, virtualized** | lazy-render out-of-view rows |
| Fuzzy filter 500 items | **<16 ms per keystroke** | after first 500ms idle, indexes are warmed |
| Fuzzy filter 5,000 items (sessions, memory, audit) | **<50 ms per keystroke** | use a fast fuzzy library (or client-side index) |
| Dashboard overview API response | **<100 ms server time** | cached stats, no heavy recompute per request |
| Provider health checks (parallel) | **<5 s total** with per-provider timeout (2s); UI shows per-provider state as they arrive (don't wait for all) |
| Memory search (semantic) | **<300 ms** p95 | local embedding lookup |
| Marketplace skill list (1,000 skills) | **<200 ms** to first render, results fill in |
| Audit chain verification (10k entries) | **<2 s** with progress bar | compute off main thread |
| Export audit report (10k entries to Markdown) | **<3 s** | streamed to file, not held in memory |

### Rules
1. **Virtualize all lists >200 rows** in the Control Center (using a simple virtual-scroll library or IntersectionObserver).
2. **Index fuzzy-searchable lists on first load** (or debounce build until 200ms after data arrives).
3. **Parallelize independent fetches** (the dashboard already does Promise.allSettled — keep this; add timeouts per endpoint so one slow endpoint never blocks the rest).
4. **Paginate API endpoints** with a default limit (50 for audit, 20 for sessions, 100 for skills). Provide `?limit=&offset=` params.
5. **Etags / Last-Modified** on list endpoints; Control Center sends If-None-Match and skips re-rendering on 304.
6. **Real-time sync via SSE** for `/api/events` instead of 30-second polling. Polling remains as a fallback (every 30s when window is focused, 2min when blurred; pause entirely after 5min in background).

---

## 5. Network behavior

| Metric | Target | Notes |
|---|---|---|
| Dashboard initial payload (HTML) | **<50 KB gzipped** | inline HTML/CSS/JS; no external fonts/CDNs |
| API JSON responses gzipped | enforced via Bun middleware | all `/api/*` responses use compression when >1KB |
| Chat SSE events per second | ≤60 frames (one per token batch) | never floods the client |
| Provider health timeouts | **2s per provider** when checking in parallel |
| Automatic retries | up to 2 for idempotent fetches, exponential backoff with jitter | never retries non-idempotent actions (sends, approvals) |
| Offline behavior | Control Center shows "disconnected" banner; TUI status dot goes red; queued actions resume on reconnect; composer remains usable for drafting |

---

## 6. Memory & resource use

| Metric | Target | Notes |
|---|---|---|
| TUI idle RSS | **<80 MB** | Bun + loaded modules |
| TUI active (chat + streaming) | **<150 MB** | typical session |
| `xr serve` daemon idle RSS | **<120 MB** | HTTP server + state stores |
| Control Center browser tab (idle) | **<100 MB** | chromium measure |
| Chat history retention in memory | last N messages per session per pane (N = 200 visible); older messages are loaded on scroll-up (infinite scroll) | avoids memory bloat in long sessions |
| Audit entries kept in memory | rolling window of 500 in UI; full log on disk; load on demand |
| Max log file size (audit) | rotate at 10MB per workspace; keep 10 rotated files | prevents unbounded growth |

---

## 7. Perceived performance principles

Numbers alone aren't enough. These principles are how the numbers feel fast.

1. **Optimistic UI.** When the user takes an action (switch model, send message, approve tool, toggle setting), UI updates immediately. Reconcile with server truth in the background. If server rejects, roll back with a toast explaining why.
2. **Skeletons before spinners.** After 150ms of waiting for data, show skeleton shapes that mirror the content layout, not spinning wheels. Spinners are for *actions in progress*; skeletons are for *content loading*.
3. **Progressive disclosure of loading.** Startup animation → chrome → recent sessions → async data (providers, memory, skill registry). User can interact with chrome even before all data loads.
4. **Predictive prefetch.** When user hovers over a session in the list for >150ms, start fetching its messages in the background. When user opens palette and starts typing a skill name, prefetch skill detail.
5. **Never block composer.** Composer accepts input even while XR is responding (queued sends). Composer accepts input even during approvals (input buffered, sent when approved). Composer accepts input even during workspace switch (routes to new workspace).
6. **Background what you can.** Long tasks (research, security scans, model downloads, multi-step agent tasks) run in background agents; user gets a notification on completion and can switch away.
7. **Cache aggressively.** Provider health is cached for 30s; model list cached for the session; workspace lists cached until invalidated; skills cached until sync is run. Cache status is shown (small "cached" label); user can force refresh with a button.
8. **No jank.** Smooth 60fps scrolling, no layout thrashing (avoid forced synchronous layouts in dashboard JS), no long tasks on main thread (>50ms without yielding).
9. **Save instantly.** Settings changes, palette actions, and workspace switches save on change (no "Save" button except in rare destructive/complex forms).
10. **Show progress, not spinners, for long operations.** Downloads, chain verification, and research runs show real progress bars with percentage/step indicators, never infinite spinners for >3 seconds.

---

## 8. Performance budget for release

Before any release (including 3.1A), a performance checklist must pass on reference hardware:

- [ ] `xr --version` returns in <100ms (5-run median)
- [ ] TUI first paint in <500ms (high-speed camera / trace measure)
- [ ] Composer is interactive <1.5s after `xr` launch
- [ ] Local model first token <200ms warm (qwen2.5:7b or equivalent)
- [ ] Cloud first token <800ms to a healthy provider
- [ ] Tokens render at ≥30/sec visibly (no chunked dumps)
- [ ] Ctrl+C interrupts within 200ms
- [ ] Ctrl+K opens palette within 50ms
- [ ] Switching workspace shows visual change in <200ms
- [ ] Dashboard overview loads with all cards populated in <1s
- [ ] Dashboard JS has no long task >100ms in Chrome Performance trace
- [ ] Audit log 1,000 entries scrolls at 60fps (virtualized)
- [ ] Memory of daemon <150MB RSS after 1 hour of use
- [ ] No full-screen re-renders in TUI at >10Hz when idle (verified via frame log)
- [ ] Streaming SSE Chat endpoint works end-to-end (current `/api/chat` is non-streaming — this is a P0 fix)

---

## 9. Performance anti-patterns (forbidden)

1. **Synchronous file/network calls on the render path.** All I/O is async or cached.
2. **N+1 API calls from the dashboard.** Single composite endpoints (e.g., `/api/overview`) return what the overview screen needs. Do not make the client compose from 7 endpoints (even in parallel — fixed endpoints are faster and more cacheable).
3. **Full-screen ANSI repaints on every tick.** (Current TUI does this — must be replaced with damage tracking.)
4. **setInterval polling at <1s** for anything that isn't a streaming response.
5. **Blocking UI with synchronous crypto / hashing on large datasets.** Audit-chain verification, embedding search, and report generation run on worker threads / async chunks.
6. **Holding entire chat history for all sessions in memory.** Load on demand; keep only the active session in full.
7. **Re-rendering the entire message list on each token.** Append-only updates to the streaming node.
8. **Loading fonts/externals at runtime that block first paint.** Dashboard is offline-safe, inline-everything; this must not regress.
9. **Artificial delays.** Never `setTimeout(1000)` to "let the user see the spinner." Work completes as fast as possible; animations are tied to work completion, not arbitrary durations.
10. **Over-animation.** No transition >200ms in product UI; no hover effects that cause layout/paint thrashing.

---

## 10. Benchmarking and tooling

Implementation agents must add:

1. **`xr doctor --perf`** — runs built-in microbenchmarks for the reference targets and reports pass/fail.
2. **Trace logging** — TUI can write a frame-timing log to `/tmp/xr-perf.log` when `XR_PERF=1` is set, recording: frame number, time since last frame, regions redrawn, bytes written to stdout.
3. **Dashboard Performance marks** — `performance.mark` for key events (first paint, first data, first token, ready); accessible via DevTools.
4. **CI performance gate** — a headless benchmark that checks `xr --version` and `xr help` timings; regressions >20% fail the build.
5. **Network waterfall check** for dashboard: ensure no more than 1 initial request + 7 parallel API calls + 1 SSE stream for chat.
