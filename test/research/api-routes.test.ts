/**
 * XR Phase 10 — research API route smoke tests (offline).
 *
 * Boots the REAL daemon on an ephemeral port and proves the research routes
 * are served under /api/v1 with auth, schema validation, and truthful states.
 * Uses a private-IP crawl target so the SSRF guard rejects before any network
 * I/O — fully deterministic, no external dependencies.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";

const TOKEN = "research-route-token";
let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  const tmp = mkdtempSync(join(tmpdir(), "xr-research-api-"));
  const store = new Store(join(tmp, "d.db"));
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: makeHandler(store, TOKEN) });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
});

const auth = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
});

async function waitForJob(id: string, timeoutMs = 3000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${base}/api/v1/research/jobs/${id}`, auth());
    const body: any = await res.json();
    const state = body?.job?.state;
    if (["completed", "partial", "cancelled", "failed", "budget_exhausted"].includes(state)) return body;
    if (Date.now() > deadline) return body;
    await new Promise((r) => setTimeout(r, 25));
  }
}

test("GET /api/v1/research/jobs requires auth and lists jobs", async () => {
  const unauth = await fetch(`${base}/api/v1/research/jobs`);
  expect(unauth.status).toBe(401);

  const res = await fetch(`${base}/api/v1/research/jobs`, auth());
  expect(res.status).toBe(200);
  expect(res.headers.get("x-xr-api-version")).toBe("v1");
  const body: any = await res.json();
  expect(Array.isArray(body.jobs)).toBe(true);
  expect(typeof body.count).toBe("number");
});

test("POST /api/v1/research/crawl on a private target is refused by the SSRF guard (truthful failed)", async () => {
  const res = await fetch(`${base}/api/v1/research/crawl`, auth({ method: "POST", body: JSON.stringify({ url: "http://127.0.0.1/secret" }) }));
  expect(res.status).toBe(200); // truthful state in the envelope, not an HTTP error
  const body: any = await res.json();
  expect(body.job.id).toMatch(/^rj_/);

  const terminal = await waitForJob(body.job.id);
  expect(terminal.job.state).toBe("failed");
  expect(terminal.job.error).toContain("blocked");
});

test("POST /api/v1/research/search with a malformed body is schema-rejected (400)", async () => {
  const res = await fetch(`${base}/api/v1/research/search`, auth({ method: "POST", body: JSON.stringify({ query: 12345 }) }));
  expect(res.status).toBe(400);
  const body: any = await res.json();
  expect(body.error).toBeTruthy();
});

test("GET /api/v1/research/stream/{unknown} → 404", async () => {
  const res = await fetch(`${base}/api/v1/research/stream/nope`, auth());
  expect(res.status).toBe(404);
});

test("cancel of an unknown job is a truthful 409", async () => {
  const res = await fetch(`${base}/api/v1/research/jobs/nope/cancel`, auth({ method: "POST" }));
  expect(res.status).toBe(409);
});
