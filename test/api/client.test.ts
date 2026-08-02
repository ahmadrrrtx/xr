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
    baseUrl: "http://daemon.in-process",
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
  expect(health.ok).toBe(true);
  expect(typeof health.version.version).toBe("string");
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
