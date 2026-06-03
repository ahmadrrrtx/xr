/**
 * XR — Block 5 tests: daemon security + API (no live socket needed; we call
 * the exposed handler directly).
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/state/db.ts";
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
  expect(html).toContain("Cost Cockpit");
  expect(html).toContain("Security Posture");
  // No external script/style/link tags (sandbox-safe, offline).
  expect(html).not.toMatch(/<script[^>]+src=/i);
  expect(html).not.toMatch(/<link[^>]+href=/i);
});
