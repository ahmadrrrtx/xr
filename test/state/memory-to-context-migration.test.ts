/**
 * XR Phase 2 · T5 — REVERSIBLE-MIGRATION ROUND-TRIP for memory → context.
 *
 * Exit Gate item 5 requires `memory/` to be retired "after lossless migration",
 * and Art. XXIII requires every migration to be reversible. This suite proves
 * both against a real SQLite store — no mocks:
 *
 *   · up()   projects every legacy row into the canonical context store
 *   · nothing in `user_memory` is mutated or deleted (losslessness)
 *   · down() removes exactly what up() created and nothing else
 *   · a full up→down→up round-trip is stable
 *   · consent is never fabricated (Art. IV.5 / Inviolable P5)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import {
  LATEST_SCHEMA_VERSION,
  currentSchemaVersion,
  runMigrationsDown,
  runMigrationsUp,
} from "../../src/state/migrations.ts";

let dir = "";
let store: WorkspaceStore;

/** Seed legacy rows covering every source, category and edge case. */
function seedLegacy(s: WorkspaceStore): void {
  const rows: Array<[string, string, string, string, string, string, number, number | null]> = [
    ["m1", "fact", "The build uses bun", "global", "user", "build,tooling", 5, null],
    ["m2", "preference", "Prefer concise answers", "global", "chat", "", 4, null],
    ["m3", "project", "API base is /v2", "proj:demo", "voice", "api", 3, null],
    ["m4", "workflow", "Deploy on Fridays", "proj:demo", "research", "ops", 2, null],
    ["m5", "exclusion", "Never mention my salary", "global", "user", "privacy", 5, null],
    ["m6", "fact", "Imported note", "global", "import", "", 1, Date.now() + 86_400_000],
    // A row whose content should be classified sensitive.
    ["m7", "fact", "My api_key is stored in the vault", "global", "user", "", 3, null],
  ];
  s.write(() => {
    const stmt = s.prepare(
      `INSERT INTO user_memory
         (id, category, content, scope, source, tags, importance, created_at, updated_at,
          last_accessed_at, access_count, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    for (const [id, category, content, scope, source, tags, importance, expires] of rows) {
      stmt.run(id, category, content, scope, source, tags, importance, now, now, null, 0, expires);
    }
  });
}

function legacySnapshot(s: WorkspaceStore): unknown[] {
  return s.prepare(`SELECT * FROM user_memory ORDER BY id`).all();
}

function contextRows(s: WorkspaceStore): Array<Record<string, unknown>> {
  return s
    .prepare(`SELECT * FROM context_items ORDER BY id`)
    .all() as Array<Record<string, unknown>>;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xr-mig-"));
  store = new WorkspaceStore("default", join(dir, "xr.db"));
});

afterEach(() => {
  try { store.close(); } catch { /* already closed */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("T5 — migration 2 is registered and applied", () => {
  test("LATEST_SCHEMA_VERSION includes the memory→context migration", () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
  });

  test("a fresh store is migrated to the latest version on open", () => {
    expect(currentSchemaVersion(store)).toBe(LATEST_SCHEMA_VERSION);
  });
});

describe("T5 — up(): lossless projection into the canonical context store", () => {
  test("every legacy row becomes a context item", () => {
    // Re-run from a downgraded state so the seed is definitely projected.
    runMigrationsDown(store, 1);
    seedLegacy(store);
    runMigrationsUp(store);

    const legacy = store.prepare(`SELECT id FROM user_memory ORDER BY id`).all() as Array<{ id: string }>;
    const ctx = contextRows(store);
    expect(legacy.length).toBe(7);
    for (const row of legacy) {
      expect(ctx.some((c) => c.id === row.id)).toBe(true);
    }
  });

  test("LOSSLESS: user_memory is not mutated or deleted by the migration", () => {
    runMigrationsDown(store, 1);
    seedLegacy(store);
    const before = legacySnapshot(store) as Array<Record<string, unknown>>;

    // Migration 2 itself: byte-identical (the projection reads, never writes, user_memory).
    runMigrationsUp(store, 2);
    expect(legacySnapshot(store)).toEqual(before);

    // The rest of the chain is ADDITIVE only. Phase 7 (migration 9) appends
    // policy columns and backfills them (kind, agent_visibility) — every column
    // that existed before must still hold exactly the value it held.
    runMigrationsUp(store);
    const after = legacySnapshot(store) as Array<Record<string, unknown>>;
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      for (const key of Object.keys(before[i]!)) expect(after[i]![key], `${before[i]!.id}.${key}`).toEqual(before[i]![key]);
    }
  });

  test("content is carried across verbatim", () => {
    runMigrationsDown(store, 1);
    seedLegacy(store);
    runMigrationsUp(store);

    const item = contextRows(store).find((c) => c.id === "m1")!;
    expect(item.content).toBe("The build uses bun");
    expect(item.project_scope).toBe("global");
    expect(item.access_count).toBe(0);
  });

  test("HONESTY: consent is legacy_unknown for every projected row — never approved", () => {
    runMigrationsDown(store, 1);
    seedLegacy(store);
    runMigrationsUp(store);

    const projected = contextRows(store).filter((c) =>
      String(c.tags).includes("legacy:user_memory"),
    );
    expect(projected.length).toBe(7);
    for (const item of projected) {
      expect(item.consent_state).toBe("legacy_unknown");
      expect(item.consent_state).not.toBe("approved");
    }
  });

  test("an `exclusion` becomes a trusted instruction, not a memory", () => {
    runMigrationsDown(store, 1);
    seedLegacy(store);
    runMigrationsUp(store);

    const item = contextRows(store).find((c) => c.id === "m5")!;
    expect(item.type).toBe("instruction");
    expect(item.trust_status).toBe("trusted_instruction");
  });

  test("source maps honestly onto trust and provenance", () => {
    runMigrationsDown(store, 1);
    seedLegacy(store);
    runMigrationsUp(store);
    const byId = new Map(contextRows(store).map((c) => [c.id, c]));

    expect(byId.get("m1")!.trust_status).toBe("approved_memory"); // user
    expect(byId.get("m1")!.provenance_kind).toBe("user_input");
    expect(byId.get("m4")!.trust_status).toBe("generated_synthesis"); // research
    expect(byId.get("m4")!.actor_kind).toBe("system");
    expect(byId.get("m6")!.trust_status).toBe("unknown"); // import
  });

  test("sensitivity is inferred conservatively", () => {
    runMigrationsDown(store, 1);
    seedLegacy(store);
    runMigrationsUp(store);
    const byId = new Map(contextRows(store).map((c) => [c.id, c]));

    expect(byId.get("m7")!.sensitivity).toBe("secret"); // mentions api_key
    // Nothing is ever optimistically labelled "public".
    expect(byId.get("m1")!.sensitivity).toBe("unknown");
  });

  test("an expiring row keeps its expiry and becomes ttl-retained", () => {
    runMigrationsDown(store, 1);
    seedLegacy(store);
    runMigrationsUp(store);

    const item = contextRows(store).find((c) => c.id === "m6")!;
    expect(item.retention).toBe("ttl");
    expect(item.expires_at).toBeGreaterThan(Date.now());
  });

  test("re-running up() is idempotent (no duplicate projections)", () => {
    runMigrationsDown(store, 1);
    seedLegacy(store);
    runMigrationsUp(store);
    const first = contextRows(store).length;

    runMigrationsDown(store, 1);
    runMigrationsUp(store);
    expect(contextRows(store).length).toBe(first);
  });
});

describe("T5 — down(): exact reversal", () => {
  test("down() removes the projected rows", () => {
    runMigrationsDown(store, 1);
    seedLegacy(store);
    runMigrationsUp(store);
    expect(contextRows(store).length).toBeGreaterThan(0);

    runMigrationsDown(store, 1);
    const remaining = contextRows(store).filter((c) =>
      String(c.tags).includes("legacy:user_memory"),
    );
    expect(remaining).toEqual([]);
  });

  test("down() does NOT touch natively-authored context items", () => {
    runMigrationsDown(store, 1);
    seedLegacy(store);
    runMigrationsUp(store);

    // A row authored by the context layer itself — no legacy marker.
    store.write(() => {
      store
        .prepare(
          `INSERT INTO context_items
             (id, version, type, title, content, workspace_id, project_scope,
              consent_state, tags, created_at, updated_at)
           VALUES ('native1', 1, 'knowledge', 't', 'native content', ?, 'global',
                   'approved', 'native', ?, ?)`,
        )
        .run(store.workspaceId, Date.now(), Date.now());
    });

    runMigrationsDown(store, 1);

    const survivors = contextRows(store);
    expect(survivors.some((c) => c.id === "native1")).toBe(true);
    expect(survivors.every((c) => !String(c.tags).includes("legacy:user_memory"))).toBe(true);
  });

  test("down() leaves user_memory byte-identical — the user keeps their data", () => {
    runMigrationsDown(store, 1);
    seedLegacy(store);
    const before = legacySnapshot(store);

    runMigrationsUp(store);
    runMigrationsDown(store, 1);

    expect(legacySnapshot(store)).toEqual(before);
    expect(currentSchemaVersion(store)).toBe(1);
  });
});

describe("T5 — ROUND TRIP: up → down → up is stable", () => {
  test("the projection is identical after a full round trip", () => {
    runMigrationsDown(store, 1);
    seedLegacy(store);

    runMigrationsUp(store);
    const first = contextRows(store);

    runMigrationsDown(store, 1);
    runMigrationsUp(store);
    const second = contextRows(store);

    expect(second).toEqual(first);
    expect(currentSchemaVersion(store)).toBe(LATEST_SCHEMA_VERSION);
  });

  test("a downgraded database is still readable by the legacy memory engine", async () => {
    // Art. XXIII: "a downgraded database is readable by code that does not know
    // the migration". Prove it by reading through the real memory store.
    runMigrationsDown(store, 1);
    seedLegacy(store);
    runMigrationsUp(store);
    runMigrationsDown(store, 1);

    const { MemoryStore } = await import("../../src/context/memory/store.ts");
    const engine = new MemoryStore(store);
    const all = engine.list({ scope: "global" });
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((m) => m.content === "The build uses bun")).toBe(true);
  });
});

describe("T5 — the migration never blocks startup", () => {
  test("up() is a no-op when the context tables are absent", () => {
    // A store opened without the context layer must still migrate cleanly.
    runMigrationsDown(store, 1);
    store.write(() => {
      store.exec(`DROP TABLE IF EXISTS context_items;`);
    });
    expect(() => runMigrationsUp(store)).not.toThrow();
    expect(currentSchemaVersion(store)).toBe(LATEST_SCHEMA_VERSION);
  });
});
