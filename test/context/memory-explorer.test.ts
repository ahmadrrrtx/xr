/**
 * Phase 21 — Memory Explorer engine behaviour: sensitivity scan, heuristic
 * entity graph, and the write routes (create/edit/export/import/graph).
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import { MemoryStore } from "../../src/context/memory/store.ts";
import { scanSensitive, passesLuhn } from "../../src/context/memory/sensitivity.ts";
import { buildMemoryGraph, extractEntities, type GraphInputEntry } from "../../src/context/memory/graph.ts";

const TOKEN = "test-token-memory-explorer";
let store: Store;

beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), "xr-memx-"));
  store = new Store(join(tmp, "m.db"));
});

// Close the SQLite handle after each test: an open handle makes temp-dir
// cleanup fail with EBUSY on Windows (see phase19-canvas.test.ts).
afterEach(() => {
  try {
    store.close();
  } catch {
    /* already closed */
  }
});

function call(method: string, path: string, body?: unknown): Promise<Response> {
  const h = makeHandler(store, TOKEN);
  return h(
    new Request(`http://127.0.0.1:7842${path}`, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

// ── sensitivity ─────────────────────────────────────────────────────────────

test("sensitivity: Luhn-valid card numbers are flagged, random digit runs are not", () => {
  expect(passesLuhn("4111111111111111")).toBe(true);
  expect(passesLuhn("4111111111111112")).toBe(false);
  expect(scanSensitive("my card is 4111 1111 1111 1111").map((m) => m.kind)).toContain("credit-card");
  expect(scanSensitive("order number 1234 5678 9012 3456")).toEqual([]);
});

test("sensitivity: SSN, API keys and private key blocks are flagged; plain text is not", () => {
  expect(scanSensitive("SSN 123-45-6789").map((m) => m.kind)).toEqual(["ssn"]);
  expect(scanSensitive("use key sk-abcdefghijklmnopqrstuvwx").map((m) => m.kind)).toEqual(["api-key"]);
  expect(scanSensitive("-----BEGIN RSA PRIVATE KEY-----").map((m) => m.kind)).toEqual(["private-key"]);
  expect(scanSensitive("I prefer Vim bindings when editing")).toEqual([]);
});

test("sensitivity: match results never echo the matched value", () => {
  const out = scanSensitive("card 4111111111111111");
  expect(JSON.stringify(out)).not.toContain("4111");
});

// ── graph ───────────────────────────────────────────────────────────────────

function entry(over: Partial<GraphInputEntry> & { id: string; content: string }): GraphInputEntry {
  return { category: "fact", scope: "global", tags: [], importance: 3, ...over };
}

test("graph: always has a centred 'You' node, even with no memories", () => {
  const g = buildMemoryGraph([]);
  expect(g.method).toBe("heuristic");
  expect(g.nodes.map((n) => n.id)).toEqual(["me"]);
  expect(g.edges).toEqual([]);
  expect(g.truncated).toBe(false);
});

test("graph: extracts tagged entities, file paths, people and known tools", () => {
  const e = entry({
    id: "m1",
    content: "My colleague named Sara Khan reviews src/context/memory/store.ts with Vim",
    tags: ["project:xr", "tool:Vim"],
  });
  const kinds = extractEntities(e).map((x) => `${x.kind}:${x.label}`);
  expect(kinds).toContain("project:xr");
  expect(kinds).toContain("tool:Vim");
  expect(kinds).toContain("person:Sara Khan");
  expect(kinds.some((k) => k.startsWith("file:src/context/memory/store.ts"))).toBe(true);
});

test("graph: links fact → entity and You → entity, and omits exclusion rules", () => {
  const g = buildMemoryGraph([
    entry({ id: "m1", content: "I prefer Vim", tags: [] }),
    entry({ id: "x1", category: "exclusion", content: "never store my password" }),
  ]);
  expect(g.nodes.some((n) => n.kind === "tool" && n.label === "Vim")).toBe(true);
  expect(g.nodes.some((n) => n.id === "fact:x1")).toBe(false);
  const tool = g.nodes.find((n) => n.kind === "tool")!;
  expect(g.edges.some((e) => e.source === "me" && e.target === tool.id && e.relation === "uses")).toBe(true);
  expect(g.edges.some((e) => e.source === "fact:m1" && e.target === tool.id)).toBe(true);
});

test("graph: sensitive entries are drawn without their content", () => {
  const g = buildMemoryGraph([entry({ id: "s1", content: "my card 4111111111111111" })]);
  const fact = g.nodes.find((n) => n.id === "fact:s1")!;
  expect(fact.label).toBe("Sensitive entry");
  expect(JSON.stringify(g)).not.toContain("4111111111111111");
});

test("graph: the generic workspace scope is not mistaken for a project", () => {
  const g = buildMemoryGraph([entry({ id: "p1", category: "project", scope: "workspace", content: "Ship the release on Friday" })]);
  expect(g.nodes.some((n) => n.kind === "project")).toBe(false);
  const named = buildMemoryGraph([entry({ id: "p2", category: "project", scope: "xr", content: "Ship the release on Friday" })]);
  expect(named.nodes.some((n) => n.kind === "project" && n.label === "xr")).toBe(true);
});

test("graph: caps node count and reports truncation", () => {
  const many = Array.from({ length: 40 }, (_, i) => entry({ id: `m${i}`, content: `fact number ${i}` }));
  const g = buildMemoryGraph(many, { maxNodes: 10 });
  expect(g.nodes.length).toBeLessThanOrEqual(10);
  expect(g.truncated).toBe(true);
  expect(g.nodes.some((n) => n.id === "me")).toBe(true);
});

// ── routes ──────────────────────────────────────────────────────────────────

test("create: requires content and refuses sensitive content until acknowledged", async () => {
  expect((await call("POST", "/api/memory", {})).status).toBe(400);

  const blocked = await call("POST", "/api/memory", { content: "card 4111 1111 1111 1111" });
  expect(blocked.status).toBe(409);
  expect(((await blocked.json()) as { reason: string }).reason).toBe("sensitive");
  expect(new MemoryStore(store).count()).toBe(0);

  const ok = await call("POST", "/api/memory", { content: "card 4111 1111 1111 1111", acknowledgeSensitive: true, scope: "global" });
  expect(ok.status).toBe(201);
  const body = (await ok.json()) as { ok: boolean; entry: { source: string; category: string; scope: string } };
  expect(body.ok).toBe(true);
  expect(body.entry.source).toBe("user");
  expect(body.entry.scope).toBe("global");
});

test("create: do-not-remember rules block the write with a 422", async () => {
  new MemoryStore(store).add({ content: "home address", category: "exclusion" });
  const res = await call("POST", "/api/memory", { content: "my home address is on 5th street" });
  expect(res.status).toBe(422);
  expect(((await res.json()) as { excluded: boolean }).excluded).toBe(true);
  expect(new MemoryStore(store).list({ includeExclusions: true }).filter((e) => e.category !== "exclusion").length).toBe(0);
});

test("create: expiry in days becomes an absolute expiresAt", async () => {
  const before = Date.now();
  const res = await call("POST", "/api/memory", { content: "trip to Lahore next week", expiresInDays: 30 });
  expect(res.status).toBe(201);
  const entry = ((await res.json()) as { entry: { expiresAt: number } }).entry;
  expect(entry.expiresAt).toBeGreaterThanOrEqual(before + 30 * 24 * 3600 * 1000 - 1000);
});

test("update: edits content and importance, refuses excluded and sensitive content, 404s unknown ids", async () => {
  const mem = new MemoryStore(store);
  mem.add({ content: "I prefer dark themes", category: "preference" });
  mem.add({ content: "banned phrase zebra", category: "exclusion" });
  const id = mem.list()[0]!.id;

  const ok = await call("PATCH", `/api/memory/${id}`, { content: "I prefer dark themes when coding", importance: 5 });
  expect(ok.status).toBe(200);
  expect(mem.get(id)!.content).toBe("I prefer dark themes when coding");
  expect(mem.get(id)!.importance).toBe(5);

  const excluded = await call("PATCH", `/api/memory/${id}`, { content: "contains banned phrase zebra" });
  expect(excluded.status).toBe(422);

  const sensitive = await call("PATCH", `/api/memory/${id}`, { content: "key sk-abcdefghijklmnopqrstuvwx" });
  expect(sensitive.status).toBe(409);

  expect((await call("PATCH", "/api/memory/mem_missing", { importance: 2 })).status).toBe(404);
});

test("list: exclusions are hidden by default and shown only when asked", async () => {
  const mem = new MemoryStore(store);
  mem.add({ content: "I like tea", category: "preference" });
  mem.add({ content: "home address rule", category: "exclusion" });
  const plain = (await (await call("GET", "/api/memory")).json()) as { entries: unknown[] };
  expect(plain.entries.length).toBe(1);
  const explicit = (await (await call("GET", "/api/memory?exclusions=1")).json()) as { entries: Array<{ category: string; sensitive: string[] }> };
  expect(explicit.entries.map((e) => e.category).sort()).toEqual(["exclusion", "preference"]);
});

test("export → import: round-trips entries, skips sensitive ones, replace needs acknowledgement", async () => {
  const mem = new MemoryStore(store);
  mem.add({ content: "I prefer Vim bindings", category: "preference" });
  mem.add({ content: "project is XR", category: "project", scope: "xr" });
  const exported = (await (await call("GET", "/api/memory/export")).json()) as { format: string; entries: unknown[] };
  expect(exported.format).toBe("xr-memory");
  expect(exported.entries.length).toBe(2);

  // Simulate a file that also carries a card number.
  const bundle = { ...exported, entries: [...exported.entries, { content: "card 4111111111111111", category: "fact" }] };
  const merged = await call("POST", "/api/memory/import", { bundle, mode: "merge" });
  const mergedBody = (await merged.json()) as { added: number; skippedSensitive: number };
  expect(mergedBody.skippedSensitive).toBe(1);
  expect(mergedBody.added).toBe(0); // both already present → deduped, not doubled
  expect(mem.count()).toBe(2);

  expect((await call("POST", "/api/memory/import", { bundle, mode: "replace" })).status).toBe(400);
  expect((await call("POST", "/api/memory/import", { bundle: { format: "other", entries: [] } })).status).toBe(400);
});

test("graph route: returns the heuristic graph for stored memories", async () => {
  new MemoryStore(store).add({ content: "I use Ollama locally", category: "fact" });
  const res = await call("GET", "/api/memory/graph");
  expect(res.status).toBe(200);
  const g = (await res.json()) as { method: string; nodes: Array<{ kind: string }> };
  expect(g.method).toBe("heuristic");
  expect(g.nodes.some((n) => n.kind === "model")).toBe(true);
});

test("settings: auto-memory is off by default and cannot be turned on; showExpired persists", async () => {
  const before = await call("GET", "/api/v1/memory/settings");
  expect(before.status).toBe(200);
  const b = (await before.json()) as { autoMemory: string; autoMemoryAvailable: boolean; showExpired: boolean };
  expect(b.autoMemory).toBe("off");
  expect(b.autoMemoryAvailable).toBe(false);
  expect(b.showExpired).toBe(false);

  const refused = await call("PUT", "/api/v1/memory/settings", { autoMemory: true });
  expect(refused.status).toBe(409);

  const put = await call("PUT", "/api/v1/memory/settings", { showExpired: true });
  expect(put.status).toBe(200);
  const after = (await (await call("GET", "/api/v1/memory/settings")).json()) as { showExpired: boolean; autoMemory: string };
  expect(after.showExpired).toBe(true);
  expect(after.autoMemory).toBe("off");
});

test("scan-sensitive: reports matches and stores nothing", async () => {
  const res = await call("POST", "/api/v1/memory/scan-sensitive", { content: "card 4111 1111 1111 1111" });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { matches: Array<{ kind: string }> };
  expect(body.matches.some((m) => m.kind === "credit-card")).toBe(true);
  const list = (await (await call("GET", "/api/v1/memory")).json()) as { count: number };
  expect(list.count).toBe(0);
});

test("consolidate route: plan by default writes nothing; apply: true runs the engine path", async () => {
  const mem = new MemoryStore(store);
  mem.add({ content: "Fresh note about the release train", category: "workflow", importance: 1, actor: "user" });
  const before = mem.count();
  const plan = (await (await call("POST", "/api/v1/memory/consolidate", {})).json()) as { applied: boolean };
  expect(plan.applied).toBe(false);
  expect(mem.count()).toBe(before);
  const applied = (await (await call("POST", "/api/v1/memory/consolidate", { apply: true })).json()) as { applied: boolean };
  expect(applied.applied).toBe(true);
});

test("consolidate engine: old low-importance notes are superseded by a summary, never deleted", async () => {
  const { planConsolidation, applyConsolidation } = await import("../../src/context/memory/consolidate.ts");
  const mem = new MemoryStore(store);
  for (let i = 0; i < 4; i++) {
    mem.add({ content: `Release train note number ${i} about weekly cadence`, category: "workflow", importance: 1, actor: "user" });
  }
  const future = Date.now() + 120 * 24 * 60 * 60 * 1000; // makes the rows older than the 30-day cutoff
  const plan = planConsolidation(mem, { now: future });
  expect(plan.groups.length).toBeGreaterThan(0);
  const res = await applyConsolidation(store, mem, plan, { now: future });
  expect(res.superseded).toBeGreaterThan(0);
  // Originals still exist (superseded, not destroyed).
  expect(mem.superseded().length).toBeGreaterThan(0);
  // Re-running is idempotent: nothing new to fold.
  const again = planConsolidation(mem, { now: future + 1 });
  expect(again.groups.length).toBe(0);
});
