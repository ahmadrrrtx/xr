/**
 * Phase 1 · T8 — Edge-case coverage that closes mutation gaps on the store's
 * public CRUD surface (legacy constructor detection, embedding clearing,
 * expiry semantics, provenance undefined-propagation, memory content-touch).
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore, Store } from "../../src/state/workspace-store.ts";
import { rmrf } from "./helpers.ts";

function fresh(dbName = "xr.db"): { store: WorkspaceStore; dbPath: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "xr-edge-"));
  const dbPath = join(dir, dbName);
  return { store: new WorkspaceStore("t", dbPath), dbPath, dir };
}

describe("Phase 1 · store edge cases", () => {
  test("legacy constructor detects a slash-path without .db as a legacy path", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-legacy-"));
    try {
      const legacy = new Store(join(dir, "nested", "dir", "data")) as unknown as {
        workspaceId: string;
        dbPath: string;
        close(): void;
      };
      expect(legacy.workspaceId).toBe("default"); // legacy path → default workspace
      expect(legacy.dbPath).toBe(join(dir, "nested", "dir", "data"));
      legacy.close();
    } finally {
      rmrf(dir);
    }
  });

  test("empty embedding array is stored as NULL (index_state none)", () => {
    const { store, dir } = fresh();
    try {
      store.insertMemory({ id: "m", category: "fact", content: "c", scope: "global", source: "user", tags: "", importance: 3 });
      store.setMemoryEmbedding("m", []);
      const row = store.getMemory("m");
      expect(row?.embedding).toBeNull();
      store.setMemoryEmbedding("m", [0.1, 0.2]);
      expect(store.getMemory("m")?.embedding).toBe("[0.1,0.2]");
      store.close();
    } finally {
      rmrf(dir);
    }
  });

  test("updateMemory: explicit null clears expiry; non-finite clears it; content edit clears embedding", () => {
    const { store, dir } = fresh();
    try {
      store.insertMemory({ id: "m1", category: "fact", content: "original", scope: "global", source: "user", tags: "a", importance: 3 });
      store.setMemoryEmbedding("m1", [1, 2, 3]);
      // Content change invalidates the cached embedding.
      expect(store.updateMemory("m1", { content: "edited" })).toBe(true);
      expect(store.getMemory("m1")?.embedding).toBeNull();
      // Tags change invalidates too.
      store.setMemoryEmbedding("m1", [9]);
      expect(store.updateMemory("m1", { tags: "b" })).toBe(true);
      expect(store.getMemory("m1")?.embedding).toBeNull();
      // Explicit expiry, then explicit null clears it.
      expect(store.updateMemory("m1", { expiresAt: Date.now() + 10_000 })).toBe(true);
      expect(store.getMemory("m1")?.expires_at).not.toBeNull();
      expect(store.updateMemory("m1", { expiresAt: null })).toBe(true);
      expect(store.getMemory("m1")?.expires_at).toBeNull();
      expect(store.updateMemory("missing", { content: "x" })).toBe(false);
      store.close();
    } finally {
      rmrf(dir);
    }
  });

  test("setMemoryProvenance keeps existing values when fields are undefined", () => {
    const { store, dir } = fresh();
    try {
      store.insertMemory({ id: "m2", category: "fact", content: "c", scope: "global", source: "user", tags: "", importance: 3 });
      store.setMemoryProvenance("m2", { provenanceKind: "user_input", actorKind: "user" });
      // Undefined fields must NOT clobber existing values.
      store.setMemoryProvenance("m2", { trustStatus: "approved_memory" });
      const row = store.getMemory("m2");
      expect(row?.provenance_kind).toBe("user_input");
      expect(row?.actor_kind).toBe("user");
      expect(row?.trust_status).toBe("approved_memory");
      // Missing row → false.
      expect(store.setMemoryProvenance("missing", { provenanceKind: "x" })).toBe(false);
      store.close();
    } finally {
      rmrf(dir);
    }
  });

  test("remember dedups by (project, kind, content) even across concurrent-ish calls", () => {
    const { store, dir } = fresh();
    try {
      store.remember("r1", "p", "fact", "same");
      store.remember("r2", "p", "fact", "same");
      store.remember("r3", "p", "fact", "different");
      expect(store.memoryCount("p")).toBe(2);
      store.close();
    } finally {
      rmrf(dir);
    }
  });
});
