# Phase 13 — Budget: build plan

## Files

```
desktop/src/budget/
  types.ts        BudgetSettings · BudgetOverview · BudgetState · SpendEvent · PreCallRequest/Check · SeriesBucket · filters · tabs
  models.ts       model registry (id, provider, family, in/out $ per 1M, context, latency, quality, strengths, local) + ModelPicker bridge
  period.ts       civil-date helpers (days_from_civil / civil_from_days), period start/end, local-day keys (mirrored in Rust)
  core.ts         pure governor: checkPreCall · applySpend · deriveState · spike window · downshift pick · aggregations · csv · fmt
  seed.ts         deterministic 30-day history (mulberry32) — same tables as Rust
  api.ts          BudgetBackend: Browser (localStorage + core) · Tauri (invoke + events)
  enforce.ts      initBudget(): subscriptions → banners/notifications/orb/audit; guard helpers for mockLLM + brain
desktop/src/stores/budgetStore.ts
desktop/src/screens/Budget/{index.tsx,useBudgetTab.ts,components/{shared,charts,OverviewTab,HistoryTab,ModelsTab,AgentsTab,WorkspacesTab,SettingsTab,PauseDialog,Playground}.tsx}
desktop/src/components/budget/BudgetBanners.tsx      (AppShell, under the Shield banner)
desktop/src-tauri/src/budget/{mod.rs,governor.rs,migrations.sql}
test/desktop/budget-core.test.ts
```

## Rust commands (Tauri) ↔ TS backend

| command                                    | args                            | returns                                                                           |
| ------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------- |
| `get_budget_overview`                      | `tzOffsetMin`                   | `BudgetOverview`                                                                  |
| `budget_check_pre_call`                    | `request: PreCallRequest`       | `PreCallCheck` (writes `blocked`/`downshifted` events + emits)                    |
| `budget_record_spend`                      | `input: SpendInput`             | `SpendEvent` (emits `budget:spend`, state transitions emit `budget:state-change`) |
| `get_spend_events`                         | `filter, cursor, limit`         | `{ events, nextCursor, total, totalCost }`                                        |
| `get_spend_series`                         | `range`                         | `SeriesBucket[]`                                                                  |
| `get_spend_breakdown`                      | `range, by: model               | agent                                                                             | workspace | category` | `BreakdownRow[]` |
| `update_budget_settings`                   | `patch`                         | `BudgetSettings`                                                                  |
| `pause_spending` / `resume_spending`       | `reason`                        | `BudgetOverview`                                                                  |
| `test_charge`                              | `amount, model?, finalization?` | `PreCallCheck` (dry run, no events)                                               |
| `reset_budget_month` / `reset_budget_data` | —                               | `BudgetOverview`                                                                  |
| `export_spend_csv`                         | `range`                         | `String` (saved with `save_runs_export`)                                          |

Events: `budget:spend { event, overview }`, `budget:state-change { prev, next, reason, overview }`.

## Enforcement hooks

- `lib/mockLLM.ts`: `const gate = await budgetGate.preCall({ model, estimatedTokensIn, estimatedTokensOut, surface })` →
  `denied` → `onEvent({ type: 'budget_blocked', reason, repair })` + `done`;
  `downgraded` → `onEvent({ type: 'model_switched', from, to, reason })` and the script streams with the cheaper model;
  per token: `charge += outPrice`; when `charge > gate.hardRemaining` → `onEvent({ type: 'budget_cutoff' })`, stop;
  finally `budgetGate.record({ ...actual })`.
- `stores/chatStore.ts`: new events → `metadata.budget = { blocked | cutoff | downshift }` on the assistant message; `components/chat` renders the inline notices; composer shows "Budget limit reached — …" hint while capped.
- HUD quick-ask: same events → inline text.
- `brain/mock.ts`: `hooks.onLlmGate(span)` → Promise; the loop parks (`gatingAt`) until it resolves; denied → span `failed` (`BudgetLimitReached`) + run `failed`; downgraded → span model/cost rewritten + log line; `brainStore.onSpanEnd` records spend per LLM span (agent/workspace/run id).
- `runsStore`: `killedBy: 'budget'` → RunsTable `CircleDollarSign` icon + "Budget capped".
- Shield audit: `BUDGET` (blocked), `BUDGET-DOWNGRADE` (auto-approved w/ detail), `BUDGET-PAUSE` (blocked).
- Notifications: 80 % warn (throttled once per threshold per local day), cap hit, pause, spike — bell + Sonner + OS (policy kind `budget`), orb amber/red single blink.
- Sidebar dot / Topbar wallet chip ("$X.XX left") / palette.
- Onboarding finish + Settings General preset → `updateSettings({ monthlyLimit })`.

## Screen

Header "Budget" · subtitle · Pause/Resume ghost · Export dropdown · 6 tabs (URL `?tab=`).
Overview: hero progress (reserve hatch, cap tick), 4 stat tiles, stacked area (30 d, 4 categories), by-model bars, quick settings (preset slider, 4 toggles/sliders), emergency card.
History: filter bar + react-window table + running-total footer + row detail. Models: cloud/local card grids, Add model (ProviderConfigModal), Test model, Set default. Agents / Workspaces: SVG bars + table with cap sliders. Settings: grouped sections + Playground (dev) + test charge dialog.

## Verification

Bun tests (governor math vectors, period math, downshift, spike, csv, seed determinism) → Rust tests with the same vectors → Playwright flows: $0.01 cap blocks chat pre-call (no tokens), raise → streams; Brain demo run cost ticks; playground loop → spike pause → resume; test-charge per-request / reserve cases; 80 % warn banner; $0 local-only; keyboard; 5 themes; reduced motion.
