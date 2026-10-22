/**
 * XR-LAUNCH-018 / 027 (minimal) / 034 — `xr serve` browser sign-in.
 *
 *   · unauthenticated `/` → the HTML sign-in page, even for `curl /`;
 *   · the form POSTs the token in the body → session cookie → dashboard;
 *   · constant-time token comparison everywhere authorizeRequest looks;
 *   · `<XR home>/daemon/token` is 0600, holds the current token, and goes away on stop.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { authorizeRequest, makeHandler, serve } from "../../src/daemon/server.ts";
import {
  cookieHasToken,
  LOGIN_PATH,
  safeReturnPath,
  tokenEquals,
  wantsSignInPage,
} from "../../src/daemon/session-auth.ts";
import { daemonTokenPath, readDaemonTokenFile, writeDaemonTokenFile } from "../../src/daemon/token-file.ts";

const TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718";
const BASE = "http://127.0.0.1:7842";
const savedHome = process.env.XR_HOME;
afterAll(() => {
  if (savedHome === undefined) delete process.env.XR_HOME;
  else process.env.XR_HOME = savedHome;
});

function freshHandler() {
  const tmp = mkdtempSync(join(tmpdir(), "xr-signin-"));
  process.env.XR_HOME = join(tmp, "home");
  return makeHandler(new Store(join(tmp, "d.db")), TOKEN);
}

function loginRequest(body: string, headers: Record<string, string> = {}) {
  return new Request(`${BASE}${LOGIN_PATH}`, {
    method: "POST",
    headers: { origin: BASE, "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
  });
}
const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();

describe("XR-LAUNCH-018 · unauthenticated page GETs get the sign-in page", () => {
  test("`curl /` (Accept: */*) gets the HTML sign-in page, not the JSON 401", async () => {
    const res = await freshHandler()(new Request(`${BASE}/`, { headers: { accept: "*/*" } }));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("Sign in to Control Center");
    expect(html).toContain('method="post" action="/auth/login"');
    expect(html).toContain("daemon/token");
    expect(html).not.toContain(TOKEN);
  });

  test("no Accept header at all also gets the page; /chat keeps its deep link", async () => {
    const res = await freshHandler()(new Request(`${BASE}/chat`));
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain('name="next" value="/chat"');
  });

  test("API paths and assets keep the JSON 401 contract under */*", async () => {
    const h = freshHandler();
    for (const path of ["/api/overview", "/api/v1/overview", "/assets/dashboard.css"]) {
      const res = await h(new Request(`${BASE}${path}`, { headers: { accept: "*/*" } }));
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toContain("application/json");
    }
  });

  test("a wrong ?token= is never reflected into the page", async () => {
    const res = await freshHandler()(new Request(`${BASE}/dashboard?token=WRONGVALUE&tab=x`, { headers: { accept: "text/html" } }));
    const html = await res.text();
    expect(html).not.toContain("WRONGVALUE");
    expect(html).toContain('name="next" value="/dashboard?tab=x"');
  });

  test("wantsSignInPage decision table", () => {
    expect(wantsSignInPage("GET", "/", "*/*")).toBe(true);
    expect(wantsSignInPage("GET", "/", null)).toBe(true);
    expect(wantsSignInPage("GET", "/x", "text/html,application/xhtml+xml;q=0.9")).toBe(true);
    expect(wantsSignInPage("GET", "/x", "application/json")).toBe(false);
    expect(wantsSignInPage("POST", "/", "text/html")).toBe(false);
    expect(wantsSignInPage("GET", "/api/overview", "text/html")).toBe(false);
    expect(wantsSignInPage("GET", "/assets/dashboard.js", "*/*")).toBe(false);
  });
});

describe("XR-LAUNCH-018 · POST /auth/login", () => {
  test("the right token → 303 to the deep link with the HttpOnly SameSite=Strict session cookie, which then authorizes", async () => {
    const h = freshHandler();
    const res = await h(loginRequest(form({ token: TOKEN, next: "/dashboard" })));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/dashboard");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("xr_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain("Secure"); // loopback HTTP: Secure only on LAN TLS
    const session = cookie.split(";")[0];
    const api = await h(new Request(`${BASE}/api/overview`, { headers: { cookie: session } }));
    expect(api.status).toBe(200);
  });

  test("a wrong token → the sign-in page again (401) with an announced mismatch, token not echoed", async () => {
    const res = await freshHandler()(loginRequest(form({ token: "not-the-token", next: "/" })));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("set-cookie")).toBeNull();
    const html = await res.text();
    expect(html).toContain("did not match");
    expect(html).not.toContain("not-the-token");
  });

  test("cross-origin or Origin-less posts are refused (403) and set no cookie", async () => {
    const h = freshHandler();
    const evil = await h(loginRequest(form({ token: TOKEN }), { origin: "http://evil.example" }));
    expect(evil.status).toBe(403);
    expect(evil.headers.get("set-cookie")).toBeNull();
    const otherPort = await h(loginRequest(form({ token: TOKEN }), { origin: "http://127.0.0.1:9999" }));
    expect(otherPort.status).toBe(403);
    const noOrigin = await h(
      new Request(`${BASE}${LOGIN_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form({ token: TOKEN }),
      }),
    );
    expect(noOrigin.status).toBe(403);
  });

  test("loopback spellings are the daemon's own origin (same set as the Host gate)", async () => {
    const res = await freshHandler()(loginRequest(form({ token: TOKEN }), { origin: "http://localhost:7842" }));
    expect(res.status).toBe(303);
  });

  test("non-form bodies are refused (415); open redirects collapse to /", async () => {
    const h = freshHandler();
    const json = await h(loginRequest(JSON.stringify({ token: TOKEN }), { "content-type": "application/json" }));
    expect(json.status).toBe(415);
    for (const next of ["//evil.example/x", "https://evil.example", "/\\evil.example", "/auth/login"]) {
      const res = await h(loginRequest(form({ token: TOKEN, next })));
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/");
    }
  });

  test("GET /auth/login is not a credential path (still unauthenticated)", async () => {
    const res = await freshHandler()(new Request(`${BASE}${LOGIN_PATH}`, { headers: { accept: "application/json" } }));
    expect(res.status).not.toBe(303);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("XR-LAUNCH-027 (minimal) · constant-time comparison", () => {
  test("tokenEquals: equal, unequal, different length, empty/absent", () => {
    expect(tokenEquals(TOKEN, TOKEN)).toBe(true);
    expect(tokenEquals(TOKEN.slice(0, -1) + "0", TOKEN)).toBe(false);
    expect(tokenEquals(TOKEN.slice(0, 10), TOKEN)).toBe(false);
    expect(tokenEquals(`${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokenEquals(null, TOKEN)).toBe(false);
    expect(tokenEquals("", "")).toBe(false); // an empty expected token never authorizes
  });

  test("cookieHasToken finds the session pair among others and rejects near-misses", () => {
    expect(cookieHasToken(`a=1; xr_session=${TOKEN}; b=2`, "xr_session", TOKEN)).toBe(true);
    expect(cookieHasToken(`xr_session=${TOKEN}x`, "xr_session", TOKEN)).toBe(false);
    expect(cookieHasToken(`other_xr_session=${TOKEN}`, "xr_session", TOKEN)).toBe(false);
  });

  test("authorizeRequest semantics unchanged: bearer, cookie, GET bootstrap, nothing else", () => {
    const r = (init: RequestInit & { url?: string }) => new Request(init.url ?? `${BASE}/`, init);
    expect(authorizeRequest(r({ headers: { authorization: `Bearer ${TOKEN}` } }), TOKEN).kind).toBe("bearer");
    expect(authorizeRequest(r({ headers: { authorization: `Bearer ${TOKEN}0` } }), TOKEN).kind).toBe("denied");
    expect(authorizeRequest(r({ headers: { authorization: TOKEN } }), TOKEN).kind).toBe("denied");
    expect(authorizeRequest(r({ headers: { cookie: `xr_session=${TOKEN}` } }), TOKEN).kind).toBe("session");
    expect(authorizeRequest(r({ url: `${BASE}/?token=${TOKEN}` }), TOKEN).kind).toBe("bootstrap");
    expect(authorizeRequest(r({ url: `${BASE}/?token=${TOKEN}`, method: "POST" }), TOKEN).kind).toBe("denied");
  });

  test("safeReturnPath keeps same-origin paths and strips token parameters", () => {
    expect(safeReturnPath("/chat?x=1&token=abc")).toBe("/chat?x=1");
    expect(safeReturnPath("/a b")).toBe("/a%20b");
    expect(safeReturnPath(null)).toBe("/");
    expect(safeReturnPath("javascript:alert(1)")).toBe("/");
  });
});

describe("XR-LAUNCH-018/034 · <XR home>/daemon/token", () => {
  const posix = process.platform !== "win32";

  test("written owner-only with the current token; release removes it", () => {
    const env = { XR_HOME: join(mkdtempSync(join(tmpdir(), "xr-tokfile-")), "home") };
    const f = writeDaemonTokenFile(TOKEN, env);
    expect(f.path).toBe(daemonTokenPath(env));
    expect(readFileSync(f.path!, "utf8")).toBe(`${TOKEN}\n`);
    expect(readDaemonTokenFile(env)).toBe(TOKEN);
    if (posix) {
      expect(statSync(f.path!).mode & 0o777).toBe(0o600);
      expect(statSync(join(f.path!, "..")).mode & 0o777).toBe(0o700);
    }
    f.release();
    expect(existsSync(f.path!)).toBe(false);
    expect(readDaemonTokenFile(env)).toBeNull();
    f.release(); // idempotent
  });

  test("a newer daemon's token is never deleted by an older daemon's release", () => {
    const env = { XR_HOME: join(mkdtempSync(join(tmpdir(), "xr-tokfile-")), "home") };
    const older = writeDaemonTokenFile(TOKEN, env);
    const newer = writeDaemonTokenFile("f".repeat(48), env);
    older.release();
    expect(readDaemonTokenFile(env)).toBe("f".repeat(48));
    newer.release();
    expect(readDaemonTokenFile(env)).toBeNull();
  });

  test("an unwritable home is best-effort (path null, no throw)", () => {
    const parent = mkdtempSync(join(tmpdir(), "xr-tokfile-"));
    writeFileSync(join(parent, "home"), "a file, not a directory");
    const f = writeDaemonTokenFile(TOKEN, { XR_HOME: join(parent, "home") });
    expect(f.path).toBeNull();
    expect(() => f.release()).not.toThrow();
  });

  test("a real `serve()` writes the token file on start and removes it on stop", async () => {
    const home = join(mkdtempSync(join(tmpdir(), "xr-serve-tok-")), "home");
    process.env.XR_HOME = home;
    const log = console.log;
    console.log = () => {};
    let handle: Awaited<ReturnType<typeof serve>> | undefined;
    try {
      handle = await serve({ port: 0, token: TOKEN });
      expect(readDaemonTokenFile({ XR_HOME: home })).toBe(TOKEN);
      if (posix) expect(statSync(daemonTokenPath({ XR_HOME: home })).mode & 0o777).toBe(0o600);
      const res = await fetch(`http://127.0.0.1:${handle.port}/`, { headers: { accept: "*/*" } });
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toContain("text/html");
    } finally {
      console.log = log;
      handle?.stop();
    }
    expect(readDaemonTokenFile({ XR_HOME: home })).toBeNull();
  });
});
