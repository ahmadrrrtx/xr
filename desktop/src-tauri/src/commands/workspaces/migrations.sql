-- Phase 10 — Workspaces (launch pad). Same idempotent-DDL approach as the
-- Phase 4 chat schema (chat.rs): no migration framework at this scale.
-- Lives in the same xr.db file; rusqlite WAL allows the two connections.

CREATE TABLE IF NOT EXISTS workspaces (
  id               TEXT PRIMARY KEY,              -- uuid
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  path             TEXT NOT NULL,                 -- absolute folder path on disk
  kind             TEXT NOT NULL,                 -- web | python | research | custom | git | scratch
  icon             TEXT,                          -- user-picked emoji (default per kind)
  stack            TEXT NOT NULL DEFAULT '[]',    -- JSON array of strings
  pinned           INTEGER NOT NULL DEFAULT 0,
  last_opened_at   INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  window_pos_x     INTEGER,
  window_pos_y     INTEGER,
  window_w         INTEGER NOT NULL DEFAULT 1280,
  window_h         INTEGER NOT NULL DEFAULT 800
);

CREATE INDEX IF NOT EXISTS idx_workspaces_pinned
  ON workspaces(pinned DESC, last_opened_at DESC);
