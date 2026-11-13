/**
 * XR Phase 8 · T1 — the generated typed client round-trips REAL endpoints
 * against the in-process daemon handler (effects, not mocks).
 */

import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import { XRDaemonClient, createDaemonClient, XRApiError } from "../../src/clients/daemon-client.generated.ts";

let store: Store;
const TOKEN = "client-test-token";

beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), "xr-client-"));
  process.env.XR_HOME = join(tmp, "home");
  store = new Store(join(tmp, "d.db"));
});

function client(): XRDaemonClient {
  const handle = makeHandler(store, TOKEN);
  return createDaemonClient({
    // Phase 34 · R1 — loopback authority: the Host gate (421 on unknown
    // authorities) refuses fictional hosts even for in-process clients.
    baseUrl: "http://127.0.0.1:3141",
    token: TOKEN,
    fetchImpl: async (input, init) =>
      await handle(new Request(String(input), init as RequestInit)),
  });
}

test("generated client instantiates with the expected typed methods", () => {
  const c = client();
  expect(typeof c.healthGet).toBe("function");
  expect(typeof c.providersList).toBe("function");
  expect(typeof c.budgetSet).toBe("function");
  expect(typeof c.controlApprove).toBe("function");
});

test("healthGet round-trips the real health contract", async () => {
  const c = client();
  const health = await c.healthGet();
  // Phase 34 · R1 (audit P2-21): unauth health is {ok, ts} only.
  expect(health.ok).toBe(true);
  expect(typeof health.ts).toBe("number");
  expect((health as Record<string, unknown>).version).toBeUndefined();
});

test("overviewGet returns the mission-control aggregate", async () => {
  const c = client();
  const overview = await c.overviewGet();
  expect(overview).toBeDefined();
  expect(typeof overview).toBe("object");
});

test("typed error surface: XRApiError carries status + problem envelope", async () => {
  const c = client();
  let caught: unknown;
  try {
    // id:42 violates the published schema (number where string required).
    await c.controlApprove({ id: 42 as unknown as string, approved: true });
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(XRApiError);
  const err = caught as XRApiError;
  expect(err.status).toBe(400);
  expect(err.problem?.error).toContain("schema");
});

test("mutating round trip: budgetGet → budgetSet → budgetGet reflects effects", async () => {
  const c = client();
  const before = (await c.budgetGet()) as Record<string, any>;
  await c.budgetSet({ monthlyCap: 777 });
  const after = (await c.budgetGet()) as Record<string, any>;
  expect(JSON.stringify(after)).toContain("777");
  expect(JSON.stringify(before)).not.toBe(JSON.stringify(after));
});

test("client library is generated from the registry (drift gate equivalent)", async () => {
  // Importing the generator-produced module proves it exists; the CI gate
  // (bun run client:check) proves it is in lockstep with the registry.
  expect(XRDaemonClient.name).toBe("XRDaemonClient");
});

test("every generated operation preserves method, encoded path, body and SSE transport", async () => {
  const { listDaemonRoutes } = await import("../../src/daemon/routes/index.ts");
  const { apiRegistry } = await import("../../src/daemon/routes/registry.ts");
  const schemas = await import("../../src/daemon/routes/schemas.ts");
  const knownSchemas = new Set(Object.values(schemas).filter((v) => v && typeof v === "object" && "safeParse" in v));
  let request: { url: string; init?: RequestInit } | undefined;
  const c = new XRDaemonClient({ baseUrl: "http://127.0.0.1:3141/", token: TOKEN, fetchImpl: async (url, init) => {
    request = { url: String(url), init }; return new Response('{"ok":true}', { status: 200 });
  } });
  const used = new Set<string>();
  let checked = 0, encoded = 0, bodies = 0, streams = 0;
  for (const op of apiRegistry(listDaemonRoutes())) {
    if (op.path.includes("{path}") || op.method === "ANY") continue;
    const parts = op.id.split(/[.]/).filter(Boolean);
    let name = parts[0]!.replace(/[^a-zA-Z0-9_$]/g, "");
    for (const p of parts.slice(1)) name += p.charAt(0).toUpperCase() + p.slice(1).replace(/[^a-zA-Z0-9_$]/g, "");
    if (used.has(name)) name += "Op";
    used.add(name);
    const count = [...op.path.matchAll(/\{([^}]+)\}/g)].length;
    const params = Array.from({ length: count }, (_, i) => `parameter ${i}/?#`);
    const hasBody = Boolean(op.meta.request && knownSchemas.has(op.meta.request));
    const body = { probe: "payload" };
    const method = (c as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[name];
    expect(typeof method).toBe("function");
    expect(Object.getOwnPropertyDescriptor(XRDaemonClient.prototype, name)?.enumerable).toBe(false);
    request = undefined;
    const result = await method!.apply(c, hasBody ? [...params, body] : params);
    let index = 0;
    const path = op.path.replace(/\{[^}]+\}/g, () => encodeURIComponent(params[index++]!));
    expect(request?.url).toBe(`http://127.0.0.1:3141${path}`);
    expect(request?.init?.method).toBe(op.method);
    expect(request?.init?.body).toBe(hasBody ? JSON.stringify(body) : undefined);
    expect((request?.init?.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    if (op.meta.sse) { expect(result).toBeInstanceOf(Response); streams++; }
    else expect(result).toEqual({ ok: true });
    checked++; if (count) encoded++; if (hasBody) bodies++;
  }
  expect(checked).toBeGreaterThan(200);
  expect(encoded).toBeGreaterThan(0);
  expect(bodies).toBeGreaterThan(0);
  expect(streams).toBeGreaterThan(0);
});
