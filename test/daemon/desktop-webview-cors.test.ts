import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { BrowserSessions } from "../../src/daemon/session-auth.ts";
import { applySecurityHeaders } from "../../src/daemon/security-headers.ts";
import { makeHandler } from "../../src/daemon/server.ts";

const tmp = mkdtempSync(join(tmpdir(), "xr-webview-cors-"));
const store = new Store(join(tmp, "data.db"));
const token = "fixture-desktop-bearer";
const origin = "tauri://localhost";
const handler = makeHandler(store, token, { desktopWebviewOrigin: origin });
const plain = makeHandler(store, token);
afterAll(() => { store.close(); rmSync(tmp, { recursive: true, force: true }); });
const call = (method: string, path: string, headers: Record<string, string> = {}, h = handler) =>
  h(new Request(`http://127.0.0.1:34567${path}`, { method, headers }));
const preflight = (o = origin, method = "GET", headers = "authorization") => ({
  origin: o, "access-control-request-method": method, "access-control-request-headers": headers,
});

describe("packaged desktop webview connection", () => {
  test("exact opt-in origin can preflight and read authenticated API, never anonymous", async () => {
    const p = await call("OPTIONS", "/api/v1/meta/version", preflight());
    expect(p.status).toBe(204);
    expect(p.headers.get("access-control-allow-origin")).toBe(origin);
    expect(p.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
    const anonymous = await call("GET", "/api/v1/meta/version", { origin });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("access-control-allow-origin")).toBe(origin);
    const wrong = await call("GET", "/api/v1/meta/version", { origin, authorization: "Bearer invalid" });
    expect(wrong.status).toBe(401);
    const valid = await call("GET", "/api/v1/meta/version", { origin, authorization: `Bearer ${token}` });
    expect(valid.status).toBe(200);
    expect(valid.headers.get("access-control-allow-origin")).toBe(origin);
    expect(valid.headers.get("access-control-allow-credentials")).toBeNull();
  });
  test("bearer POST works from the webview but cookie CSRF rules remain enforced", async () => {
    const p = await call("OPTIONS", "/api/v1/budget/set", preflight(origin, "POST", "authorization, content-type"));
    expect(p.status).toBe(204);
    const make = (authorization?: string) => handler(new Request("http://127.0.0.1:34567/api/v1/budget/set", {
      method: "POST", headers: { origin, "content-type": "application/json", ...(authorization ? {authorization} : {}) },
      body: JSON.stringify({ perTaskUsd: -1 }),
    }));
    expect((await make()).status).toBe(401);
    const valid = await make(`Bearer ${token}`);
    expect(valid.status).toBe(400); // reached validation, did not mutate config
    expect(valid.headers.get("access-control-allow-origin")).toBe(origin);
    const sessions = new BrowserSessions();
    const cookie = sessions.create();
    const cookieHandler = makeHandler(store, token, { desktopWebviewOrigin: origin, browser: sessions });
    const csrf = await cookieHandler(new Request("http://127.0.0.1:34567/api/v1/budget/set", {
      method: "POST", headers: { origin, cookie: `xr_session=${cookie}`, "content-type": "application/json" }, body: "{}",
    }));
    expect(csrf.status).toBe(403);
  });
  test("streaming replies retain CORS without buffering the stream", async () => {
    const req = new Request("http://127.0.0.1:34567/api/v1/events", { headers: { origin } });
    const response = applySecurityHeaders(new Response("data: hello\n\n", { headers: { "content-type": "text/event-stream" } }), req, origin);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(await response.text()).toBe("data: hello\n\n");
  });
  test("Windows origin is opt-in and LAN disables the exception", async () => {
    const windows = makeHandler(store, token, { desktopWebviewOrigin: "http://tauri.localhost" });
    expect((await call("OPTIONS", "/api/v1/meta/version", preflight("http://tauri.localhost"), windows)).status).toBe(204);
    const lan = makeHandler(store, token, { desktopWebviewOrigin: origin, lan: { cert: { key: "", cert: "", fingerprint: "", fingerprintPretty: "", sans: [], notAfter: 0 } } });
    expect((await call("OPTIONS", "/api/v1/meta/version", preflight(), lan)).headers.get("access-control-allow-origin")).toBeNull();
  });
  test("ordinary daemon, foreign/opaque origins, unsafe headers and invalid hosts are not granted", async () => {
    const ordinary = await call("OPTIONS", "/api/v1/meta/version", preflight(), plain);
    expect(ordinary.headers.get("access-control-allow-origin")).toBeNull();
    for (const o of ["null", "https://evil.example", "tauri://localhost.evil", "http://tauri.localhost"]) {
      const r = await call("OPTIONS", "/api/v1/meta/version", preflight(o));
      expect(r.headers.get("access-control-allow-origin")).toBeNull();
    }
    const unsafe = await call("OPTIONS", "/api/v1/meta/version", preflight(origin, "GET", "authorization, x-evil"));
    expect(unsafe.status).not.toBe(204);
    expect(unsafe.headers.get("access-control-allow-origin")).toBeNull();
    const badHost = await call("OPTIONS", "/api/v1/meta/version", { ...preflight(), host: "evil.example" });
    expect(badHost.status).toBe(421);
    expect(badHost.headers.get("access-control-allow-origin")).toBeNull();
    const wrongMethod = await call("OPTIONS", "/api/v1/meta/version", preflight(origin, "TRACE"));
    expect(wrongMethod.status).not.toBe(204);
    expect(wrongMethod.headers.get("access-control-allow-origin")).toBeNull();
    const outsideApi = await call("OPTIONS", "/login", preflight());
    expect(outsideApi.status).not.toBe(204);
  });
});
