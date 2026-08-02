/**
 * XR Phase 8 · T4 — undo as a first-class user-control surface.
 *
 * The daemon exposes the Phase-6 UndoLedger at POST /api/v1/context/undo;
 * dashboard mutations (approve/revoke) record before-images so every one of
 * them is exactly undoable. UNDO RESTORES DATA, NEVER AUTHORITY — the
 * before-image is precisely what comes back.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import { MemoryStore } from "../../src/context/memory/store.ts";

const TOKEN = "undo-token";

function fresh() {
  const tmp = mkdtempSync(join(tmpdir(), "xr-undo-"));
  process.env.XR_HOME = join(tmp, "home");
  const store = new Store(join(tmp, "d.db"));
  return { store, h: makeHandler(store, TOKEN) };
}
const post = (path: string, body?: unknown) =>
  new Request(`http://127.0.0.1:7842${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("T4 — /api/v1/context/undo", () => {
  test("undo with an empty ledger is an honest 404, not a silent no-op success", async () => {
    const { h } = fresh();
    const res = await h(post("/api/v1/context/undo"));
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toContain("nothing to undo");
  });

  test("undoing an unknown id is also 404 (fail-closed, named reason)", async () => {
    const { h } = fresh();
    const res = await h(post("/api/context/undo", { id: "op_does-not-exist" }));
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toContain("not found");
  });

  test("approve → undo restores the exact prior consent state (dashboard mutation is undoable)", async () => {
    const { store, h } = fresh();
    // Seed a memory entry with a pending/non-approved consent state.
    const mem = new MemoryStore(store);
    const add = mem.add({ content: "the user prefers ritual tea over coffee", source: "user" });
    expect(add.ok).toBe(true);
    const id = (add as any).entry.id as string;
    const beforeRevoke = await h(post(`/api/context/revoke/${id}`));
    expect(beforeRevoke.status).toBe(200);

    // Revoke happened for real:
    expect((store as any).db.query("SELECT consent_state FROM user_memory WHERE id=?").get(id) as any)
      .toMatchObject({ consent_state: expect.stringMatching(/revoke|denied/) });

    // Now undo the revoke — default target is the latest dashboard mutation.
    const undo = await h(post("/api/v1/context/undo"));
    expect(undo.status).toBe(200);
    const outcome: any = await undo.json();
    expect(outcome.ok).toBe(true);
    expect(outcome.restoredTarget).toEqual({ table: "user_memory", id });

    // The before-image is EXACTLY what came back (data restored, never authority invented):
    const after: any = (store as any).db.query("SELECT consent_state FROM user_memory WHERE id=?").get(id);
    const pristine: any = (store as any).db.query("SELECT before_json FROM context_ops WHERE target_id=? ORDER BY rowid ASC LIMIT 1").get(id);
    expect(pristine).toBeTruthy(); // evidence: begin-op recorded the before-image
    expect(after.consent_state).toBe(JSON.parse(pristine.before_json).consent_state);
  });

  test("undo is itself recorded as an append-only ledger op (evidence discipline)", async () => {
    const { store, h } = fresh();
    const mem = new MemoryStore(store);
    const add = mem.add({ content: "audit-me entry", source: "user" });
    const id = (add as any).entry.id as string;
    await h(post(`/api/context/revoke/${id}`));
    const res = await h(post("/api/context/undo"));
    expect(res.status).toBe(200);
    const row: any = (store as any).db
      .query("SELECT op, reason FROM context_ops WHERE op LIKE 'undo %' ORDER BY rowid DESC LIMIT 1")
      .get();
    expect(row.op).toBe("undo memory_revoke");
    expect(row.reason).toContain("undo of");
  });

  test("a double undo refuses cleanly (each op undoes once)", async () => {
    const { store, h } = fresh();
    const mem = new MemoryStore(store);
    const add = mem.add({ content: "double-undo guard", source: "user" });
    const id = (add as any).entry.id as string;
    await h(post(`/api/context/revoke/${id}`));
    const first = await h(post("/api/context/undo"));
    expect(first.status).toBe(200);
    const opId = ((await first.json()) as any).undoneOpId;
    const again = await h(post("/api/context/undo", { id: opId }));
    expect(again.status).toBe(404);
    expect(((await again.json()) as any).reason).toContain("already undone");
  });

  test("the undo request is schema-validated (problem+json 400)", async () => {
    const { h } = fresh();
    const res = await h(post("/api/v1/context/undo", { id: 42 }));
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.status).toBe(400);
    expect(body.title).toBe("Bad Request");
    expect(body.errors?.length).toBeGreaterThan(0);
  });

  test("the undo op is in the published contract (OpenAPI + typed client stay generated)", async () => {
    const openapi = JSON.parse(
      await (await fresh().h(new Request("http://127.0.0.1:7842/api/v1/openapi.json", {
        headers: { authorization: `Bearer ${TOKEN}` },
      }))).text(),
    );
    expect(openapi.paths["/api/v1/context/undo"]).toBeTruthy();
    expect(openapi.paths["/api/v1/context/undo"].post.summary).toContain("Undo");
  });
});
