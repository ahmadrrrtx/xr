# Phase 13 — Budget: study notes

## Environment reality (sandbox)

- No `cargo`/rustfmt locally; the Rust governor compiles only in CI
  (`cargo check` / `clippy -D warnings` / `cargo test --lib`, Linux + Windows).
- `previews/14-budget.png` is absent (same as Phase 12's missing preview);
  SCREEN 11 + the Phase 13 brief are the spec. One optional reference mock may
  be generated at `previews/implementation/phase-13/budget-overview.png`.
- The webview is verified in the Vite preview (Playwright); the browser
  backend must therefore mirror the Rust governor exactly (shared vectors).

## What the brief assumed vs. what the repo has

| Brief says                                  | Repo reality                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/AppShell.tsx` add Budget nav           | `lib/nav.ts` already has `budget` (Wallet icon, `/budget`); `Sidebar.tsx` has a static green `BudgetDot`; `WalletWidget.tsx` shows a static "$5.00". Wire them, don't add.                                                                                                     |
| `screens/ModelCenter.tsx` + `/models` route | Neither exists. Model data lives in `screens/Chat/components/ModelPicker.tsx` (`MODELS`: claude-sonnet-4.5, gpt-4o-mini, qwen2.5:3b) and Settings → `ModelsTab.tsx` (providers, keychain, Ollama pull). The Budget Models tab becomes the registry; ModelPicker reads from it. |
| `src/screens/Chat.tsx` streaming            | `lib/mockLLM.ts` `streamChat()` is the single mock provider used by `stores/chatStore.ts` **and** the HUD quick-ask (`components/palette/CommandPalette.tsx`). One hook inside `streamChat` covers both.                                                                       |
| `src/brain/mock.ts` "start" events          | `streamMockRun()` is a 100 ms tick loop with `StreamHooks`; it already parks at an approval gate (`parkedAt`). A budget gate parks the same way.                                                                                                                               |
| `src/styles/tokens.css`                     | Theme tokens live in `styles/themes.css` (`--risk-*`, `--chart-*` per theme).                                                                                                                                                                                                  |
| `settingsStore` default budget              | `settings.defaults.budget` preset (`'5'`…) + `budgetCustom`; GeneralTab says "Enforcement arrives with Phase 13". Onboarding `StepPrefs` writes `xr.budget.default`.                                                                                                           |

## Existing seams to reuse

- Phase 12: `shield/enforce.ts` (init pattern, orb blink, `sendNotification`),
  `useShieldStore.getState().addAuditEntry()` (ruleId/decision), URL tab hook,
  `ShieldCard`, `EnforcementBadge`, alertdialog + ack checkbox.
- Phase 11: `useTween`, hand-rolled SVG charts (`--chart-*` tokens), react-window
  v2 `List` table, `save_runs_export` for CSV, `killedBy` on runs.
- Phase 8: `ProviderConfigModal` (keychain key entry + test connection),
  `ollamaDetect/ollamaPull`, `detectSystem` (RAM for hardware badge).
- Phase 7: `sendNotification` (OS/Sonner policy; `warning` → kind `budget`).
- Rust: `commands/chat.rs` init on shared `xr.db`, `shield/mod.rs` patterns
  (own `Mutex<Connection>`, store plugin, `app.emit`).

## Governor rules (decided)

1. **Order of checks**: paused → per-request cap → remaining (month, day,
   agent cap, workspace cap, all with the finalization reserve held back)
   → spike breaker → allow. Downshifting is tried before any cost denial.
2. **Reserve**: `usable = limit × (1 − reserve)`. Pre-call checks use `usable`;
   calls flagged `finalization` (and the in-flight mid-stream guard) may use
   the full limit. That is the whole point of the reserve: a long answer is
   blocked up front rather than cut off at 90 %.
3. **Hard cap OFF**: cost denials become warnings (events still recorded,
   state becomes `over`), the 95 % threshold breaker is off too (it would
   contradict the switch), the **spike breaker stays on**. The UI says this in
   red next to the switch.
4. **Circuit breaker**: threshold (`pct_used ≥ circuit_breaker_pct`) or spike
   (`spend in last 5 min > circuit_breaker_spend_per_5min`) → `paused` with a
   reason; only the user resumes.
5. **$0 budget** = local-only: cloud calls downshift to local when possible,
   otherwise deny with "Cloud models are off".
6. **Epsilon** 0.0001 USD on every comparison; costs rounded to 6 dp.
7. **Estimates are labelled**: pre-call uses `estimated_cost`; the recorded
   event stores the actual; unknown models use a mid-tier estimate and the UI
   says "estimate" (Art. IV.5).
8. **Period** = from `month_start_day` at local midnight, or from the latest
   `reset` event if later. Local-day math uses a tz offset the webview passes
   (no chrono); pure civil-date functions are mirrored in TS + Rust with
   vectors.
9. Every block / downshift / pause writes a Shield audit row
   (`BUDGET`, `BUDGET-DOWNGRADE`, `BUDGET-PAUSE`).
10. Nothing is billed anywhere; copy says "metered locally".

## Built (what shipped vs. the plan)

- Webview: `src/budget/{types,period,models,core,seed,api,enforce}.ts`, one
  canonical `stores/budgetStore.ts`, `screens/Budget/*` (Overview / Spend
  History / Models / Agents / Workspaces / Settings + dev Playground),
  `components/budget/{BudgetBanners,BudgetNoteCard}.tsx`. The gate runs in
  `lib/mockLLM.ts` (chat / palette / HUD), `brain/mock.ts` (runs; mid-stream
  guard cuts at the hard limit, `killedBy: 'budget'`) — before the first
  token, never after.
- Rust: `src-tauri/src/budget/{mod,governor}.rs` + `migrations.sql` —
  `budget_events` + `budget_settings` on the shared `xr.db` (own WAL
  connection, same pattern as `ShieldDb`), commands
  `budget_init · budget_overview · budget_check · budget_record ·
budget_events · budget_series · budget_breakdown · budget_update_settings ·
budget_set_paused · budget_reset_month · budget_clear · budget_export`,
  events `budget:state-change · budget:spend · budget:settings`.
  `governor.rs` is a line-for-line port of `core.ts` (same check order, EPS
  0.0001, price table, round6, message strings) — the browser fallback and
  the shell return identical verdicts.
- Cross-language vectors pinned in both suites (`NOW = 2026-10-05T09:30Z`,
  `TZ = -300`): period Oct start `1790794800000` / reset `2026-10-31` /
  27 days left; `mulberry32(0x1317b0d6)` → `0.847121331, 0.601883391, …`;
  seed = 246 events, first `sp_seed_0004` @ `1788581594000`
  (`chat-b69c`, sonnet 362/906, $0.014676), month spend `$0.409827`,
  tokens 47 225 / 20 640; fresh defaults → remaining 0.982, hardRemaining 1;
  gpt-5 100k/20k → `gemini-2.5-flash` ($0.08); approach downshift 4.0 →
  haiku, 4.3 → `qwen2.5-coder:3b`; reserve 4.49 denies, finalization allows
  (0.492 left); threshold trips at 4.75 not 4.74; 18 × $0.03 trips the spike
  breaker and clears 6 min later.
- Honest copy: "Enforced" badges only on caps the Rust/TS gate actually
  checks; Pro billing + invoices are "Planned"; unknown models carry the
  "estimate" pill ($5 / $15 per 1M); hard cap OFF shows a red warning and
  the call goes through with an explicit "Hard cap is off" note; every
  downshift says why.

## Verification

- `bunx tsc --noEmit`, eslint on every touched file, `bun test test/desktop/`
  (148 tests, 27 for the governor) green. Rust: `cargo test` (21 tests in
  `budget::`) and `cargo clippy --all-targets -- -D warnings` green on the
  governor + db module via a scratch crate with a tauri shim (full crate
  still compiles only in CI).
- Playwright flows against the Vite preview: $0.01 cap → chat blocked
  pre-call with the inline "Budget limit reached" card + banner + toast +
  `blocked` event; raise → wallet back to "$4.09 left", banners gone; pause
  dialog focuses Cancel and needs the checkbox; paused banner + Resume;
  Playground runaway loop stops after 17 calls ("spike breaker tripped") and
  the paused banner appears; Spend History shows the blocked rows; six tabs
  and five themes. Screenshots: `previews/implementation/phase-13/`.
