/**
 * Phase 34 · R1 — request-trust boundary (audit P1-3 / P1-5 / P2-21 / §15#27).
 *
 * Pins the single allowed-host set shared by the Host gate (421) and the
 * CSRF/Origin gate (403), the minimal unauth health payload, and the
 * XR_TRUST_PROXY=1 gating of x-forwarded-for as a rate-limit key.
 * No timing assertions: statuses and payload shape only.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Namespace import: against pre-R1 code the new predicates are simply absent
// (undefined), so `git stash push -- src/` turns this file into a behavioral
// fail-before proof (handler tests fail on statuses, predicate tests on the
// missing exports) instead of a single module-resolution error.
import * as S from "../../src/daemon/server.ts";
import { Store } from "../../src/state/workspace-store.ts";

const { allowedDaemonHosts, clientIpFor, hostAllowed, makeHandler, RateLimiter } = S;

const TOKEN = "origin-host-guard-token";
const GOOD = ["localhost", "127.0.0.1", "[::1]"] as const;
const EVIL = ["evil.example", "localhost.evil.example", "127.0.0.1.evil.example"] as const;

let tmp: string;
let store: Store;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-ohg-"));
  process.env.XR_HOME = join(tmp, "home");
  store = new Store(join(tmp, "d.db"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function req(
  host: string,
  path: string,
  init: { method?: string; auth?: "bearer" | "session" | "none"; cookies?: string; origin?: string; headers?: Record<string, string> } = {},
): Request {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.auth === "bearer") headers.authorization = `Bearer ${TOKEN}`;
  if (init.auth === "session") headers.cookie = init.cookies ?? `xr_session=${TOKEN}`;
  if (init.origin) headers.origin = init.origin;
  const r = new Request(`http://${host}:3141${path}`, { method: init.method ?? "GET", headers });
  return r;
}

describe("allowed-host set (single source)", () => {
  test("contains loopback spellings plus the resolved bind host", () => {
    const set = allowedDaemonHosts({} as NodeJS.ProcessEnv);
    for (const h of ["127.0.0.1", "localhost", "::1", "[::1]"]) expect(set).toContain(h);
  });

  test("hostAllowed strips ports and matches exactly (no suffix match)", () => {
    for (const h of GOOD) {
      expect(hostAllowed(`${h}:3141`, {} as NodeJS.ProcessEnv)).toBe(true);
      expect(hostAllowed(h, {} as NodeJS.ProcessEnv)).toBe(true);
    }
    for (const e of EVIL) {
      expect(hostAllowed(`${e}:3141`, {} as NodeJS.ProcessEnv)).toBe(false);
    }
    expect(hostAllowed(null)).toBe(false); // missing Host fails closed
    expect(hostAllowed("")).toBe(false);
    expect(hostAllowed("::1", {} as NodeJS.ProcessEnv)).toBe(true); // bare IPv6, no port
  });
});

describe("Host gate (421 before auth and open paths)", () => {
  const METHODS: ReadonlyArray<{ name: string; method: string; auth: "bearer" | "session"; path: string; cookies?: string; origin?: string }> = [
    { name: "bearer GET", method: "GET", auth: "bearer", path: "/api/budget" },
    { name: "bearer POST", method: "POST", auth: "bearer", path: "/api/budget" },
    {
      name: "session POST", method: "POST", auth: "session", path: "/api/budget", cookies: `xr_session=${TOKEN}`,
      origin: "http://127.0.0.1:3141",
    },
  ];

  for (const m of METHODS) {
    test(`${m.name}: good Host passes the gate, evil Host → 421 (token must not override)`, async () => {
      const h = makeHandler(store, TOKEN);
      const good = await h(req("127.0.0.1", m.path, { method: m.method, auth: m.auth, cookies: m.cookies, origin: m.origin }));
      expect([200, 400, 403, 404, 405]).toContain(good.status); // gate passed; route/CSRF decides
      expect(good.status).not.toBe(421);
      for (const e of EVIL) {
        const res = await h(req(e, m.path, { method: m.method, auth: m.auth, cookies: m.cookies, origin: m.origin }));
        expect(res.status).toBe(421);
      }
    });
  }

  test("open paths still work with a good Host; wrong Host on an open path is refused", async () => {
    const h = makeHandler(store, TOKEN);
    expect((await h(req("localhost", "/api/health", { auth: "none" }))).status).toBe(200);
    expect((await h(req("localhost", "/api/v1/health", { auth: "none" }))).status).toBe(200);
    expect((await h(req("localhost", "/assets/auth.js", { auth: "none" }))).status).toBe(200);
    // Signature-authenticated webhooks: reachable (route-level auth response, not 421).
    for (const p of ["/api/telegram/webhook", "/api/discord/webhook"]) {
      const res = await h(req("localhost", p, { method: "POST", auth: "none", headers: { "content-type": "application/json" } }));
      expect([400, 401, 403]).toContain(res.status);
      expect(res.status).not.toBe(421);
    }
    // Wrong Host on an open path: the gate runs first even when no token is needed.
    expect((await h(req("evil.example", "/api/health", { auth: "none" }))).status).toBe(421);
    expect((await h(req("evil.example", "/assets/auth.js", { auth: "none" }))).status).toBe(421);
  });
});

describe("Origin gate (session-authenticated mutating requests)", () => {
  const POST = "/api/budget/set";
  const JSON_HEADERS = { "content-type": "application/json" } as const;
  const EMPTY = "{}" as const;

  test("session POST: same-origin on any loopback spelling → 200; evil/missing Origin → 403", async () => {
    const h = makeHandler(store, TOKEN);
    const put = async (origin: string | undefined) =>
      h(new Request(`http://127.0.0.1:3141${POST}`, {
        method: "POST",
        headers: { cookie: `xr_session=${TOKEN}`, ...JSON_HEADERS, ...(origin ? { origin } : {}) },
        body: EMPTY,
      }));

    const on127 = await put("http://127.0.0.1:3141");
    expect(on127.status).toBe(200);
    const onLocal = await put("http://localhost:3141"); // Phase 34 · R1 fix: localhost ≡ 127.0.0.1
    expect(onLocal.status).toBe(200);
    const onV6 = await put("http://[::1]:3141");
    expect(onV6.status).toBe(200);

    expect((await put("http://evil.example:3141")).status).toBe(403);
    expect((await put(undefined)).status).toBe(403); // missing Origin fails closed
  });

  test("session GET is Origin-exempt; bearer is Origin-exempt for all verbs (2xx regardless)", async () => {
    const h = makeHandler(store, TOKEN);
    const getRes = await h(req("127.0.0.1", "/api/budget", { auth: "session", origin: "http://evil.example:3141" }));
    expect(getRes.status).toBe(200);
    for (const o of ["http://127.0.0.1:3141", "http://localhost:3141", "http://evil.example:3141", undefined]) {
      const res = await h(new Request("http://127.0.0.1:3141/api/budget/set", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, ...JSON_HEADERS, ...(o ? { origin: o } : {}) },
        body: EMPTY,
      }));
      expect(res.status).toBe(200);
    }
  });
});

describe("health payload (P2-21)", () => {
  test("unauth health returns {ok, ts} only — no name/version/host/binding/configCache", async () => {
    const h = makeHandler(store, TOKEN);
    for (const p of ["/api/health", "/api/v1/health"]) {
      const res = await h(req("localhost", p, { auth: "none" }));
      expect(res.status).toBe(200);
      const j: Record<string, unknown> = await res.json() as Record<string, unknown>;
      expect(j.ok).toBe(true);
      expect(typeof j.ts).toBe("number");
      expect(Object.keys(j).sort()).toEqual(["ok", "ts"]);
      for (const k of ["name", "version", "host", "binding", "auth", "configCache"]) expect(j[k]).toBeUndefined();
    }
  });
});

describe("rate-limit client key (§15#27)", () => {
  const xffReq = (xff: string) =>
    new Request("http://127.0.0.1:3141/api/budget", { headers: { "x-forwarded-for": xff } });

  test("default (no XR_TRUST_PROXY): socket peer wins, xff ignored", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(clientIpFor(xffReq("1.2.3.4"), { address: "127.0.0.1" }, env)).toBe("127.0.0.1");
    expect(clientIpFor(xffReq("1.2.3.4, 5.6.7.8"), null, env)).toBe("local");
  });

  test("XR_TRUST_PROXY=1: first xff hop keys the bucket", () => {
    const env = { XR_TRUST_PROXY: "1" } as NodeJS.ProcessEnv;
    expect(clientIpFor(xffReq("1.2.3.4, 5.6.7.8"), { address: "127.0.0.1" }, env)).toBe("1.2.3.4");
    expect(clientIpFor(new Request("http://127.0.0.1:3141/api/budget"), { address: "127.0.0.1" }, env)).toBe("local");
  });

  test("bucket behaviour differs by mode: same peer cannot evade by forging xff", () => {
    const limiter = new RateLimiter(1, 60_000);
    const envOff = {} as NodeJS.ProcessEnv;
    // trust off → both requests share the peer bucket (spoofed xff is irrelevant).
    const k1 = `${clientIpFor(xffReq("9.9.9.9"), { address: "127.0.0.1" }, envOff)}:/api/budget`;
    const k2 = `${clientIpFor(xffReq("8.8.8.8"), { address: "127.0.0.1" }, envOff)}:/api/budget`;
    expect(k1).toBe(k2);
    expect(limiter.allow(k1)).toBe(true);
    expect(limiter.allow(k2)).toBe(false); // same bucket → second is rejected

    const trustOn = new RateLimiter(2, 60_000);
    const envOn = { XR_TRUST_PROXY: "1" } as NodeJS.ProcessEnv;
    const k3 = `${clientIpFor(xffReq("9.9.9.9"), { address: "127.0.0.1" }, envOn)}:/api/budget`;
    const k4 = `${clientIpFor(xffReq("8.8.8.8"), { address: "127.0.0.1" }, envOn)}:/api/budget`;
    expect(k3).not.toBe(k4); // proxy mode → per-forwarded-IP buckets
    expect(trustOn.allow(k3)).toBe(true);
    expect(trustOn.allow(k4)).toBe(true);
  });
});
