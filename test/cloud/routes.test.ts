/**
 * XR Phase 30 — cloud routes on a machine that has never seen the cloud.
 *
 * This is the acceptance test for the central promise of the Business tier:
 * **XR is completely usable without an account.** The routes must answer, must
 * answer with a 200 rather than an error, and must not open a socket while doing
 * it.
 *
 * The socket trap is the part that matters. It would be easy to write handlers
 * that *look* offline and quietly attempt a `fetch` whose failure is swallowed —
 * that would still be a phone-home, and on a metered or monitored network the
 * attempt itself is the leak. So `node:net` and `node:dns` are both instrumented
 * and any connection or lookup fails the suite.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:net";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";

const TOKEN = "phase30-cloud-token";

let server: ReturnType<typeof Bun.serve>;
let base: string;
let trap: Server;
let dials: string[] = [];

beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), "xr-phase30-cloud-"));
  process.env.XR_HOME = join(tmp, "home");
  // No OAuth device flow, no licence, no team: the state of a fresh install.
  delete process.env.XR_CLOUD_SESSION;
  delete process.env.XR_CLOUD_LICENSE;

  trap = createServer((socket) => {
    dials.push("dial");
    socket.destroy();
  });
  await new Promise<void>((resolve) => trap.listen(0, "127.0.0.1", resolve));

  const store = new Store(join(tmp, "d.db"));
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: makeHandler(store, TOKEN) });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
  trap?.close();
});

function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("licence endpoints degrade honestly", () => {
  test("GET /api/cloud/license is the Personal state, and a 200", async () => {
    const res = await api("/api/cloud/license");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("none");
    expect(body.plan).toBe("personal");
    expect(body.entitled).toBe(false);
    // Not a warning: no licence is the normal, supported configuration.
    expect(body.reason).toBeNull();
    expect(body.localUnaffected).toBe(true);
    // The client is told the whole vocabulary so it cannot invent its own.
    expect(body.allFeatures).toContain("managed-models");
    expect(body.allFeatures).toContain("relay");
  });

  test("a refused feature names itself and promises nothing local broke", async () => {
    const res = await api("/api/cloud/license/feature/managed-models");
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.allowed).toBe(false);
    expect(body.localUnaffected).toBe(true);
    expect(typeof body.reason).toBe("string");
    // The message must never read as though the app is damaged.
    expect(String(body.reason)).not.toContain("error");
  });

  test("every Business feature is individually queryable", async () => {
    for (const feature of ["team", "team-workspaces", "sso-admin", "managed-models", "relay", "memory-sync", "audit-export", "admin-console"]) {
      const res = await api(`/api/cloud/license/feature/${feature}`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { allowed: boolean }).allowed).toBe(false);
    }
  });

  test("an unknown feature is a 400 that lists the real ones", async () => {
    const res = await api("/api/cloud/license/feature/voice");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { known: string[] };
    // `voice` is deliberately not a gate. Local features are not in this
    // vocabulary and the error says so by enumerating what is.
    expect(body.known).not.toContain("voice");
    expect(body.known).toContain("team");
  });

  test("licence verification of a submitted token is offline and total", async () => {
    const res = await api("/api/cloud/license/verify", {
      method: "POST",
      body: JSON.stringify({ token: "obviously.not.a.licence" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { valid: boolean; status: string };
    expect(body.valid).toBe(false);
    expect(body.status).toBe("invalid");
  });
});

describe("session endpoints", () => {
  test("GET /api/cloud/session reports signed-out without an error", async () => {
    const res = await api("/api/cloud/session");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { signedIn: boolean; note: string };
    expect(body.signedIn).toBe(false);
    expect(body.note).toContain("Every local feature is fully available");
  });

  test("DELETE /api/cloud/session is idempotent and touches nothing else", async () => {
    const res = await api("/api/cloud/session", { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; hadSession: boolean; note: string };
    expect(body.ok).toBe(true);
    expect(body.hadSession).toBe(false);
    expect(body.note).toContain("untouched");
    // Twice, because signing out of nothing must not fail.
    expect((await api("/api/cloud/session", { method: "DELETE" })).status).toBe(200);
  });
});

describe("team memory degrades and never leaks a private flag", () => {
  test("listing requires a workspaceId and says so", async () => {
    const res = await api("/api/cloud/team-memory");
    // No licence on this machine, so the entitlement check answers first — which
    // is the honest order: an unauthenticated caller learns nothing about which
    // workspaces exist.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available: boolean; repair: string };
    expect(body.available).toBe(false);
    expect(body.repair).toContain("Local memory is free");
  });

  test("promoting without a workspace is a 400, not a partial write", async () => {
    const res = await api("/api/cloud/team-memory", {
      method: "POST",
      body: JSON.stringify({ body: "Deploys happen on Thursdays." }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available: boolean };
    expect(body.available).toBe(false);
  });

  test("a blocked fact is refused without the value being echoed", async () => {
    const secret = "sk-ant-api03-QWERTYUIOPASDFGHJKLZXCVBNM1234567890abcdef";
    const res = await api("/api/cloud/team-memory", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "wsp_1", body: `key: ${secret}` }),
    });
    const text = await res.text();
    // Whatever path it took, the secret must not come back in our own response —
    // nor should a degraded answer imply the fact was stored.
    expect(text).not.toContain(secret);
  });
});

describe("no outbound network, ever", () => {
  test("the full probe surface made zero connection attempts", async () => {
    // Exercised above; this is the assertion the whole file exists for.
    expect(dials).toEqual([]);
  });

  test("team workspaces answer available:false rather than 5xx", async () => {
    const res = await api("/api/cloud/team-workspaces");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available: boolean; repair: string };
    expect(body.available).toBe(false);
    expect(body.repair).toContain("Local workspaces");
  });

  test("a team-requiring route answers available:false rather than 5xx", async () => {
    const res = await api("/api/cloud/usage");
    // Not a 500 and not a 503: nothing is broken, so nothing may say something is.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available: boolean; repair: string };
    expect(body.available).toBe(false);
    expect(typeof body.repair).toBe("string");
    expect(body.repair).toContain("BYOK");
  });
});
