/**
 * UX Phase B · B-1 — onboarding routes.
 *
 * The GUI first-run flow is a thin orchestrator over real engines:
 *   · status   → provider keys + local runtime health (same probes the CLI
 *                onboarding and the Providers/Models panels use);
 *   · provider → key stored via the secrets vault (OS keychain or sealed
 *                file), defaults written via saveConfig(), advisory health;
 *   · complete → append-only audit record.
 *
 * No new capability is invented and no key is ever returned. The save
 * succeeds even when the live probe cannot run (F-1 parity with the CLI).
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import { loadConfig } from "../../src/config/config.ts";
import { getSecretAsync } from "../../src/security/secrets.ts";

const TOKEN = "onb-token";

function fresh() {
  const tmp = mkdtempSync(join(tmpdir(), "xr-onb-"));
  process.env.XR_HOME = join(tmp, "home");
  const store = new Store(join(tmp, "d.db"));
  return { store, h: makeHandler(store, TOKEN) };
}
const get = (path: string) =>
  new Request(`http://127.0.0.1:7842${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
const post = (path: string, body?: unknown) =>
  new Request(`http://127.0.0.1:7842${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("B-1 — onboarding status", () => {
  test("a fresh install reports needsSetup with honest reasons", async () => {
    const { h } = fresh();
    const res = await h(get("/api/v1/onboarding/status"));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.needsSetup).toBe(true);
    expect(Array.isArray(body.reasons)).toBe(true);
    expect(body.reasons.length).toBeGreaterThan(0);
    expect(body.cloud).toMatchObject({ configured: 0, count: expect.any(Number) });
    expect(body.local).toMatchObject({ runtime: expect.any(String) });
    expect(typeof body.local.healthy).toBe("boolean");
    expect(typeof body.internet).toBe("boolean");
    expect(body.config).toMatchObject({ provider: expect.any(String), model: expect.any(String) });
  });

  test("after a key is stored the install no longer needs setup (configured route exists)", async () => {
    const { h } = fresh();
    const save = await h(post("/api/v1/onboarding/provider", { providerId: "openai", apiKey: "sk-test-123", probe: false }));
    expect(save.status).toBe(200);
    const statusRes = await h(get("/api/v1/onboarding/status"));
    const body: any = await statusRes.json();
    expect(body.cloud.configured).toBeGreaterThanOrEqual(1);
    expect(body.needsSetup).toBe(false);
  });
});

describe("B-1 — onboarding provider (key save, fail-closed)", () => {
  test("an unknown provider is rejected with 400", async () => {
    const { h } = fresh();
    const res = await h(post("/api/v1/onboarding/provider", { providerId: "definitely-not-a-provider", apiKey: "x" }));
    expect(res.status).toBe(400);
  });

  test("a local provider preset (no key slot) is rejected with 400", async () => {
    const { h } = fresh();
    const res = await h(post("/api/v1/onboarding/provider", { providerId: "ollama", apiKey: "x" }));
    expect(res.status).toBe(400);
  });

  test("a valid key is stored in the vault, set as default, and never returned", async () => {
    const { h } = fresh();
    const res = await h(post("/api/v1/onboarding/provider", { providerId: "openai", apiKey: "sk-super-secret", model: "gpt-4o-mini", probe: false }));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("openai");
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.secretBackend).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain("sk-super-secret");

    const config = loadConfig().config;
    expect(config.defaults.provider).toBe("openai");
    expect(config.defaults.model).toBe("gpt-4o-mini");
    // the key round-trips from the secrets vault (not the response)
    expect(await getSecretAsync("OPENAI_API_KEY")).toBe("sk-super-secret");
  });

  test("the save is recorded in the audit log", async () => {
    const { store, h } = fresh();
    await h(post("/api/v1/onboarding/provider", { providerId: "openai", apiKey: "sk-audited", probe: false }));
    const events = store.recentAudit(10).map((e) => e.event);
    expect(events).toContain("onboarding.provider");
  });
});

describe("B-1 — onboarding completion is an audit record", () => {
  test("POST complete audits and returns ok", async () => {
    const { store, h } = fresh();
    const res = await h(post("/api/v1/onboarding/complete"));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.ok).toBe(true);
    const events = store.recentAudit(10).map((e) => e.event);
    expect(events).toContain("onboarding.complete");
  });

  test("completion is audited even with an empty body", async () => {
    const { store, h } = fresh();
    await h(post("/api/v1/onboarding/complete", {}));
    const events = store.recentAudit(10).map((e) => e.event);
    expect(events).toContain("onboarding.complete");
  });
});
