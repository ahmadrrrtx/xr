-- Phase 13 — Budget governor tables (shared xr.db, WAL).
-- Mirrors desktop/src/budget/types.ts (SpendEvent / BudgetSettings).

CREATE TABLE IF NOT EXISTS budget_events (
  id          TEXT PRIMARY KEY,
  ts          INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  agent       TEXT,
  workspace   TEXT,
  session_id  TEXT,
  model       TEXT,
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0,
  cost_usd    REAL NOT NULL DEFAULT 0,
  category    TEXT NOT NULL DEFAULT 'llm',
  detail      TEXT
);

CREATE INDEX IF NOT EXISTS idx_budget_events_ts ON budget_events (ts);
CREATE INDEX IF NOT EXISTS idx_budget_events_kind_ts ON budget_events (kind, ts);

-- Key/value: 'settings' (JSON BudgetSettings), 'seeded' (seed version), 'tz'.
CREATE TABLE IF NOT EXISTS budget_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
