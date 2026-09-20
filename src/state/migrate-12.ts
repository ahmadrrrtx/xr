/**
 * Schema migration 12 — Phase 2 · G-08 (desktop UI state).
 *
 * The app remembers itself: last area, open tabs, drafts, pane layout — per
 * workspace, as small JSON values the renderer owns and the engine merely
 * keeps. Nothing here carries engine semantics; the engine enforces only the
 * shape and the budget (see src/state/ui-state.ts). Lives outside
 * migrations.ts so the registry stays under the 800-LOC threshold.
 */
import type { Migration } from "./migrations.ts";

export const MIGRATION_12: Migration = {
  version: 12,
  name: "phase2_ui_state",
  up(store) {
    store.exec(`
      CREATE TABLE IF NOT EXISTS ui_state (
        workspace_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, key)
      );
    `);
  },
  down(store) {
    store.exec(`DROP TABLE IF EXISTS ui_state;`);
  },
};
