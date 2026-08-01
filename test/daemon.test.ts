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
import { CORE_VERSION } from "../src/core/version.ts";

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
  // Derived from the single source of truth (src/core/version.ts) so a release
  // bump never breaks this test.
  expect(j.version.version).toBe(CORE_VERSION);
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

test("Phase 4 T5 — query token bootstraps a session cookie, then redirects to a token-free URL (one-time bootstrap)", async () => {
  const h = makeHandler(store, TOKEN);
  const res = await h(new Request(`http://127.0.0.1:7842/?token=${TOKEN}`));
  expect(res.status).toBe(302);
  const cookie = res.headers.get("set-cookie") ?? "";
  expect(cookie).toContain("xr_session=");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");
  const location = res.headers.get("location") ?? "";
  expect(location).not.toContain("token="); // token never lingers
  // The cookie now authenticates the dashboard.
  const authed = await h(new Request("http://127.0.0.1:7842/", {
    headers: { cookie: `xr_session=${TOKEN}` },
  }));
  expect(authed.status).toBe(200);
  expect(authed.headers.get("content-type")).toContain("text/html");
  // The query token is DEAD for mutating requests (CSRF guard).
  const mut = await h(new Request(`http://127.0.0.1:7842/api/control/approve?token=${TOKEN}`, {
    method: "POST",
    body: "{}",
  }));
  expect(mut.status).toBe(401);
});

test("Phase 4 T5 — strict CSP: no unsafe-inline, external dashboard assets", async () => {
  const h = makeHandler(store, TOKEN);
  const res = await h(new Request("http://127.0.0.1:7842/", {
    headers: { cookie: `xr_session=${TOKEN}` },
  }));
  const csp = res.headers.get("content-security-policy") ?? "";
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-inline");
  expect(csp).not.toContain("unsafe-eval");
  const html = await res.text();
  expect(html).not.toContain("onclick=");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("style=\"");
  // external assets are served
  const js = await h(new Request("http://127.0.0.1:7842/assets/dashboard.js", {
    headers: { cookie: `xr_session=${TOKEN}` },
  }));
  expect(js.status).toBe(200);
  expect(js.headers.get("content-type")).toContain("javascript");
  const css = await h(new Request("http://127.0.0.1:7842/assets/dashboard.css", {
    headers: { cookie: `xr_session=${TOKEN}` },
  }));
  expect(css.status).toBe(200);
});

test("Phase 4 T5 — cross-origin mutating request is refused (CSRF/Origin guard)", async () => {
  const h = makeHandler(store, TOKEN);
  const res = await h(new Request("http://127.0.0.1:7842/api/control/approve", {
    method: "POST",
    headers: {
      cookie: `xr_session=${TOKEN}`,
      origin: "https://evil.example.com",
      "content-type": "application/json",
    },
    body: "{}",
  }));
  expect(res.status).toBe(403);
  // Same-origin mutating request is allowed.
  const ok = await h(new Request("http://127.0.0.1:7842/api/control/approve", {
    method: "POST",
    headers: {
      cookie: `xr_session=${TOKEN}`,
      origin: "http://127.0.0.1:7842",
      "content-type": "application/json",
    },
    body: "{}",
  }));
  expect(ok.status).not.toBe(403);
});

test("Phase 4 T5 — rate limiting returns 429", async () => {
  const h = makeHandler(store, TOKEN, { rateLimit: 3 });
  for (let i = 0; i < 3; i++) {
    await h(new Request("http://127.0.0.1:7842/api/overview", {
      headers: { authorization: `Bearer ${TOKEN}` },
    }));
  }
  const res = await h(new Request("http://127.0.0.1:7842/api/overview", {
    headers: { authorization: `Bearer ${TOKEN}` },
  }));
  expect(res.status).toBe(429);
  expect(res.headers.get("retry-after")).toBeTruthy();
});

test("Phase 4 T5 — oversized request body is refused (route caps)", async () => {
  const h = makeHandler(store, TOKEN);
  const big = "x".repeat(3 * 1024 * 1024);
  const res = await h(new Request("http://127.0.0.1:7842/api/chat", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ message: big }),
  }));
  expect(res.status).toBe(413);
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

test("dashboard html does NOT embed the token and loads same-origin assets only", () => {
  const html = dashboardHtml(TOKEN);
  // Phase 4 · T5 — the token is NOT embedded in the HTML (one-time bootstrap
  // via the server); embedding would leak it into history/referrers.
  expect(html).not.toContain(TOKEN);
  // Stable dashboard copy (rendered statically, not via JS).
  expect(html).toContain("Control Center");
  expect(html).toContain("Security EDR");
  expect(html).toContain("Audit Log");
  // Phase 4 · T5 — same-origin external assets under strict CSP. NO
  // third-party origins, no inline scripts.
  const srcs = [...html.matchAll(/<script[^>]+src=\"([^\"]+)\"/gi)].map((m) => m[1]);
  const links = [...html.matchAll(/<link[^>]+href=\"([^\"]+)\"/gi)].map((m) => m[1]);
  for (const a of [...srcs, ...links]) {
    expect(a.startsWith("/") || a.startsWith("data:")).toBe(true);
  }
  expect(html).not.toMatch(/<script(?!\s+src)/i);
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

import { MemoryStore } from "../src/context/memory/store.ts";

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

test("dashboard html includes the durable memory viewer (markup; script is external)", () => {
  const html = dashboardHtml(TOKEN);
  // The memory panel shows the durable ledger + search + the viewer.
  expect(html).toContain("Durable Memory");
  expect(html).toContain("Search memory ledger");
  // Phase 4 · T5 — the client application is an external asset under strict
  // CSP; the API wiring lives in /assets/dashboard.js, not inline HTML.
  expect(html).toContain('/assets/dashboard.js');
});
