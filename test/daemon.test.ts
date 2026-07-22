/**
 * XR — Block 5 tests: daemon security + API (no live socket needed; we call
 * the exposed handler directly).
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/state/workspace-store.ts";
import { makeHandler } from "../src/daemon/server.ts";
import { dashboardHtml } from "../src/daemon/dashboard.ts";

let tmp: string;
let store: Store;
const TOKEN = "test-token-123";
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-daemon-"));
  process.env.XR_HOME = join(tmp, "home");
  store = new Store(join(tmp, "d.db"));
});

function req(path: string, withAuth = true): Request {
  return new Request(`http://127.0.0.1:7842${path}`, {
    headers: withAuth ? { authorization: `Bearer ${TOKEN}` } : {},
  });
}

test("health endpoint is open (no auth) and reports localhost", async () => {
  const h = makeHandler(store, TOKEN);
  const res = await h(req("/api/health", false));
  expect(res.status).toBe(200);
  const j: any = await res.json();
  expect(j.ok).toBe(true);
  expect(j.host).toBe("127.0.0.1");
  expect(j.version.version).toBe("3.1.6");
  expect(j.binding).toBe("localhost-only");
  expect(j.auth).toBe("required-except-health");
});

test("API requires the local token (401 without it)", async () => {
  const h = makeHandler(store, TOKEN);
  const res = await h(req("/api/overview", false));
  expect(res.status).toBe(401);
});

test("API works with the token", async () => {
  const h = makeHandler(store, TOKEN);
  const res = await h(req("/api/overview", true));
  expect(res.status).toBe(200);
  const j: any = await res.json();
  expect(j).toHaveProperty("project");
  expect(j).toHaveProperty("audit");
  expect(j).toHaveProperty("skills");
});

test("wrong token is rejected", async () => {
  const h = makeHandler(store, TOKEN);
  const bad = new Request("http://127.0.0.1:7842/api/overview", {
    headers: { authorization: "Bearer WRONG" },
  });
  expect((await h(bad)).status).toBe(401);
});

test("token via query string works for the dashboard page", async () => {
  const h = makeHandler(store, TOKEN);
  const res = await h(new Request(`http://127.0.0.1:7842/?token=${TOKEN}`));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
});

test("security endpoint returns a block-rate report", async () => {
  const h = makeHandler(store, TOKEN);
  const res = await h(req("/api/security"));
  const j: any = await res.json();
  expect(j).toHaveProperty("rate");
  expect(j.total).toBeGreaterThan(0);
});

test("cost endpoint aggregates recorded events", async () => {
  store.recordCost("s1", "groq", "Groq", 1000, 500, 0.001);
  store.recordCost("s1", "groq", "Groq", 2000, 800, 0.002);
  const h = makeHandler(store, TOKEN);
  const j: any = await (await h(req("/api/cost"))).json();
  expect(j.totalTokens).toBe(4300);
  expect(j.totalUsd).toBeCloseTo(0.003, 5);
  expect(j.byModel.length).toBe(1);
});

test("unknown route 404s (authed)", async () => {
  const h = makeHandler(store, TOKEN);
  expect((await h(req("/api/nope"))).status).toBe(404);
});

test("dashboard html embeds the token and has no external assets", () => {
  const html = dashboardHtml(TOKEN);
  expect(html).toContain(TOKEN);
  // Stable dashboard copy (rendered statically, not via JS).
  expect(html).toContain("Control Center");
  expect(html).toContain("Security EDR");
  expect(html).toContain("Audit Log");
  // No external script/style/link tags (sandbox-safe, offline).
  expect(html).not.toMatch(/<script[^>]+src=/i);
  expect(html).not.toMatch(/<link[^>]+href=/i);
});

test("agents endpoint returns the built-in workforce and workflow counters", async () => {
  const h = makeHandler(store, TOKEN);
  const j: any = await (await h(req("/api/agents"))).json();
  expect(Array.isArray(j.agents)).toBe(true);
  expect(j.agents.some((a: any) => a.id === "supervisor")).toBe(true);
  expect(j).toHaveProperty("workflows");
});

test("agents workflow detail endpoint returns a persisted workflow", async () => {
  const { compileWorkflowPlan } = await import("../src/agents/planner.ts");
  const { WorkflowRepo } = await import("../src/state/repos/workflow-repo.ts");
  // 0.2 Storage Unification: persist into the SAME unified store the handler serves.
  const wf = new WorkflowRepo(store);
  const plan = compileWorkflowPlan({ goal: "Implement a safe feature", cwd: process.cwd() });
  wf.saveWorkflow(plan);

  const h = makeHandler(store, TOKEN);
  const res = await h(req(`/api/agents/workflows/${plan.workflowId}`));
  expect(res.status).toBe(200);
  const j: any = await res.json();
  expect(j.workflowId).toBe(plan.workflowId);
  expect(Array.isArray(j.tasks)).toBe(true);
  expect(j.tasks.length).toBeGreaterThan(0);
});

// ── v0.9: durable memory endpoints ──────────────────────────────────────────

import { MemoryStore } from "../src/memory/store.ts";

test("memory endpoint requires the token (401 without it)", async () => {
  const h = makeHandler(store, TOKEN);
  expect((await h(req("/api/memory", false))).status).toBe(401);
});

test("memory endpoint lists entries but hides exclusions", async () => {
  const mem = new MemoryStore(store);
  mem.add({ content: "I prefer TypeScript and Bun", category: "preference" });
  mem.add({ content: "project is XR", category: "project", scope: "xr" });
  mem.add({ content: "my home address", category: "exclusion" });

  const h = makeHandler(store, TOKEN);
  const j: any = await (await h(req("/api/memory"))).json();
  expect(j.enabled).toBe(true);
  expect(j.count).toBe(3); // total stored (incl. exclusion)
  // but the entries array NEVER includes exclusions:
  expect(j.entries.length).toBe(2);
  expect(j.entries.every((e: any) => e.category !== "exclusion")).toBe(true);
  expect(j.entries[0]).toHaveProperty("content");
  expect(j.entries[0]).toHaveProperty("importance");
});

test("memory DELETE removes a single entry", async () => {
  const mem = new MemoryStore(store);
  const a = mem.add({ content: "delete me", category: "fact" });
  const h = makeHandler(store, TOKEN);
  const res = await h(
    new Request(`http://127.0.0.1:7842/api/memory/${a.entry!.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
  );
  expect(res.status).toBe(200);
  expect(((await res.json()) as any).ok).toBe(true);
  expect(mem.count()).toBe(0);
});

test("memory DELETE all clears everything", async () => {
  const mem = new MemoryStore(store);
  mem.add({ content: "a", category: "fact" });
  mem.add({ content: "b", category: "preference" });
  const h = makeHandler(store, TOKEN);
  const res = await h(
    new Request("http://127.0.0.1:7842/api/memory/all", {
      method: "DELETE",
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
  );
  const j: any = await res.json();
  expect(j.ok).toBe(true);
  expect(j.removed).toBe(2);
  expect(mem.count()).toBe(0);
});

test("memory DELETE of a missing id 404s", async () => {
  const h = makeHandler(store, TOKEN);
  const res = await h(
    new Request("http://127.0.0.1:7842/api/memory/nope_missing", {
      method: "DELETE",
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
  );
  expect(res.status).toBe(404);
});

test("dashboard html includes the durable memory viewer", () => {
  const html = dashboardHtml(TOKEN);
  // The memory panel shows the durable ledger + search + the viewer.
  expect(html).toContain("Durable Memory");
  expect(html).toContain("Search memory ledger");
  expect(html).toContain("/api/memory");
});
