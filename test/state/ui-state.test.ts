/**
 * Phase 2 · G-08 — the app remembers itself: per-workspace UI state with an
 * honest budget. Repo-level contract + the two routes through the real
 * daemon handler.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, WorkspaceStore } from "../../src/state/workspace-store.ts";
import { UiStateRepo, UI_STATE_MAX_KEYS, UI_STATE_MAX_VALUE_BYTES } from "../../src/state/ui-state.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import { currentSchemaVersion, LATEST_SCHEMA_VERSION } from "../../src/state/migrations.ts";

let dir = "";
let store: WorkspaceStore;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "xr-uistate-"));
  store = new WorkspaceStore("ws-a", join(dir, "xr.db"));
});
afterAll(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("UiStateRepo", () => {
  test("migration 12 is applied on open", () => {
    expect(currentSchemaVersion(store)).toBe(LATEST_SCHEMA_VERSION);
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(12);
  });

  test("patch upserts, null deletes, get filters — with per-key updatedAt", () => {
    const repo = new UiStateRepo(store, "ws-a");
    const r1 = repo.patch({ "nav.lastarea": "workspace", "workspace.tabs": ["a.ts", "b.ts"] }, 1_000);
    expect(r1.written.sort()).toEqual(["nav.lastarea", "workspace.tabs"]);
    expect(repo.get().map((e) => e.key)).toEqual(["nav.lastarea", "workspace.tabs"]);
    const r2 = repo.patch({ "workspace.tabs": ["a.ts"], "chat.draft": { text: "hello", cursor: 5 } }, 2_000);
    expect(r2.written.sort()).toEqual(["chat.draft", "workspace.tabs"]);
    const tabs = repo.get(["workspace.tabs"])[0]!;
    expect(tabs.value).toEqual(["a.ts"]);
    expect(tabs.updatedAt).toBe(2_000);
    expect(repo.get(["nav.lastarea"])[0]!.updatedAt).toBe(1_000); // untouched key keeps its time
    const r3 = repo.patch({ "chat.draft": null }, 3_000);
    expect(r3.deleted).toEqual(["chat.draft"]);
    expect(repo.get(["chat.draft"])).toEqual([]);
  });

  test("workspaces are isolated", () => {
    const a = new UiStateRepo(store, "ws-a");
    const b = new UiStateRepo(store, "ws-b");
    b.patch({ "nav.lastarea": "trust" });
    expect(a.get(["nav.lastarea"])[0]!.value).toBe("workspace");
    expect(b.get(["nav.lastarea"])[0]!.value).toBe("trust");
    expect(b.clear()).toBe(1);
    expect(a.get().length).toBeGreaterThan(0);
  });

  test("the patch is all-or-nothing: one bad key rejects everything", () => {
    const repo = new UiStateRepo(store, "ws-c");
    expect(() => repo.patch({ "good.key": 1, "Bad Key": 2 })).toThrow(/invalid key/);
    expect(repo.get()).toEqual([]);
    expect(() => repo.patch({})).toThrow(/empty/);
    expect(() => repo.patch({ big: "x".repeat(UI_STATE_MAX_VALUE_BYTES + 1) })).toThrow(/exceeds/);
    expect(repo.get()).toEqual([]);
  });

  test("the key budget is enforced on the projected set (deletes free room)", () => {
    const repo = new UiStateRepo(store, "ws-d");
    const full: Record<string, unknown> = {};
    for (let i = 0; i < UI_STATE_MAX_KEYS; i++) full[`k.${i}`] = i;
    repo.patch(full);
    expect(() => repo.patch({ "k.overflow": 1 })).toThrow(/more than/);
    expect(repo.patch({ "k.0": null, "k.overflow": 1 }).written).toEqual(["k.overflow"]);
  });
});

describe("GET/PUT /api/v1/state/ui", () => {
  const TOKEN = "ui-token";
  let h: ReturnType<typeof makeHandler>;
  let hdir = "";
  let hstore: Store;
  beforeAll(() => {
    hdir = mkdtempSync(join(tmpdir(), "xr-uistate-http-"));
    hstore = new Store(join(hdir, "xr.db"));
    h = makeHandler(hstore, TOKEN);
  });
  afterAll(() => {
    hstore.close();
    rmSync(hdir, { recursive: true, force: true });
  });
  const req = (p: string, init?: { method?: string; body?: unknown }) =>
    new Request(`http://127.0.0.1:7842${p}`, {
      method: init?.method ?? "GET",
      headers: { authorization: `Bearer ${TOKEN}`, ...(init?.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

  test("round-trip through the daemon, keyed by the store's workspace", async () => {
    const put = await h(req("/api/v1/state/ui", { method: "PUT", body: { patch: { "workspace.layout": { split: "v", ratio: 0.42 }, "nav.lastarea": "work" } } }));
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as { workspaceId: string; written: string[]; updatedAt: number };
    expect(putBody.written.sort()).toEqual(["nav.lastarea", "workspace.layout"]);
    expect(putBody.workspaceId).toBe(hstore.workspaceId);
    const get = await h(req("/api/v1/state/ui?keys=workspace.layout"));
    const got = (await get.json()) as { entries: Array<{ key: string; value: { ratio: number }; updatedAt: number }> };
    expect(got.entries).toHaveLength(1);
    expect(got.entries[0]!.value.ratio).toBe(0.42);
    expect(got.entries[0]!.updatedAt).toBe(putBody.updatedAt);
    const all = (await (await h(req("/api/v1/state/ui"))).json()) as { entries: unknown[] };
    expect(all.entries).toHaveLength(2);
  });

  test("bad patches are 400/413, never partial", async () => {
    expect((await h(req("/api/v1/state/ui", { method: "PUT", body: { patch: [] } }))).status).toBe(400);
    expect((await h(req("/api/v1/state/ui", { method: "PUT", body: { patch: { "NOPE!": 1 } } }))).status).toBe(400);
    const big = await h(req("/api/v1/state/ui", { method: "PUT", body: { patch: { "ok.key": "x".repeat(UI_STATE_MAX_VALUE_BYTES + 1) } } }));
    expect(big.status).toBe(413);
    const all = (await (await h(req("/api/v1/state/ui"))).json()) as { entries: Array<{ key: string }> };
    expect(all.entries.map((e) => e.key)).not.toContain("ok.key");
  });
});
