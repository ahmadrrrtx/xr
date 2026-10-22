/**
 * XR-LAUNCH-018 / 027 / 034 — `xr serve` browser sign-in.
 *
 *   · unauthenticated `/` → the HTML sign-in page, even for `curl /`;
 *   · the form POSTs the token in the body → session cookie → dashboard;
 *   · constant-time token comparison everywhere authorizeRequest looks;
 *   · 027: the cookie is a random session id (never the token); bootstrap
 *     links are single-use and expire; logout revokes; `?token=` is retired;
 *   · `<XR home>/daemon/token` is 0600, holds the current token, and goes away on stop.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { authorizeRequest, makeHandler, serve } from "../../src/daemon/server.ts";
import {
  BOOTSTRAP_PATH,
  BOOTSTRAP_TTL_MS,
  BrowserSessions,
  cookieValues,
  LOGIN_PATH,
  LOGOUT_PATH,
  SESSION_MAX_AGE_S,
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

function freshHandler(browser?: BrowserSessions) {
  const tmp = mkdtempSync(join(tmpdir(), "xr-signin-"));
  process.env.XR_HOME = join(tmp, "home");
  return makeHandler(new Store(join(tmp, "d.db")), TOKEN, browser ? { browser } : {});
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
    expect(cookie).toContain(`Max-Age=${SESSION_MAX_AGE_S}`);
    const session = cookie.split(";")[0];
    expect(session).not.toContain(TOKEN); // XR-LAUNCH-027: a session id, never the API token
    const api = await h(new Request(`${BASE}/api/overview`, { headers: { cookie: session } }));
    expect(api.status).toBe(200);
  });

  test("the sign-in page is `Referrer-Policy: same-origin` so a real browser's form POST carries its Origin", async () => {
    // Under the global `no-referrer` a browser serializes the form POST's Origin
    // as "null", which loginOriginOk (rightly) refuses — no one could sign in.
    const h = freshHandler();
    const page = await h(new Request(`${BASE}/`, { headers: { accept: "text/html" } }));
    expect(page.status).toBe(401);
    expect(page.headers.get("referrer-policy")).toBe("same-origin");
    const api = await h(new Request(`${BASE}/api/overview`, { headers: { accept: "application/json" } }));
    expect(api.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await h(loginRequest(form({ token: TOKEN, next: "/" }), { origin: "null" }))).status).toBe(403);
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

describe("XR-LAUNCH-027 · constant-time comparison", () => {
  test("tokenEquals: equal, unequal, different length, empty/absent", () => {
    expect(tokenEquals(TOKEN, TOKEN)).toBe(true);
    expect(tokenEquals(TOKEN.slice(0, -1) + "0", TOKEN)).toBe(false);
    expect(tokenEquals(TOKEN.slice(0, 10), TOKEN)).toBe(false);
    expect(tokenEquals(`${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokenEquals(null, TOKEN)).toBe(false);
    expect(tokenEquals("", "")).toBe(false); // an empty expected token never authorizes
  });

  test("cookieValues finds every pair of that exact name", () => {
    expect(cookieValues("a=1; xr_session=s1; b=2; xr_session=s2", "xr_session")).toEqual(["s1", "s2"]);
    expect(cookieValues("other_xr_session=x", "xr_session")).toEqual([]);
  });

  test("authorizeRequest: bearer, a live session id, a single-use GET bootstrap code — nothing else", () => {
    const sessions = new BrowserSessions();
    const sid = sessions.create();
    const code = sessions.mintBootstrap();
    const r = (init: RequestInit & { url?: string }) => new Request(init.url ?? `${BASE}/`, init);
    expect(authorizeRequest(r({ headers: { authorization: `Bearer ${TOKEN}` } }), TOKEN, sessions).kind).toBe("bearer");
    expect(authorizeRequest(r({ headers: { authorization: `Bearer ${TOKEN}0` } }), TOKEN, sessions).kind).toBe("denied");
    expect(authorizeRequest(r({ headers: { authorization: TOKEN } }), TOKEN, sessions).kind).toBe("denied");
    expect(authorizeRequest(r({ headers: { cookie: `xr_session=${sid}` } }), TOKEN, sessions).kind).toBe("session");
    // The API token is no longer a cookie value, and ?token= is retired.
    expect(authorizeRequest(r({ headers: { cookie: `xr_session=${TOKEN}` } }), TOKEN, sessions).kind).toBe("denied");
    expect(authorizeRequest(r({ url: `${BASE}/?token=${TOKEN}` }), TOKEN, sessions).kind).toBe("denied");
    // A POST never consumes the code; the GET then works exactly once.
    expect(authorizeRequest(r({ url: `${BASE}/?bootstrap=${code}`, method: "POST" }), TOKEN, sessions).kind).toBe("denied");
    const first = authorizeRequest(r({ url: `${BASE}/chat?bootstrap=${code}&x=1` }), TOKEN, sessions);
    expect(first).toEqual({ kind: "bootstrap", url: `${BASE}/chat?x=1` });
    expect(authorizeRequest(r({ url: `${BASE}/chat?bootstrap=${code}` }), TOKEN, sessions).kind).toBe("denied");
  });

  test("safeReturnPath keeps same-origin paths and strips token and bootstrap parameters", () => {
    expect(safeReturnPath("/chat?x=1&token=abc")).toBe("/chat?x=1");
    expect(safeReturnPath("/chat?bootstrap=abc&x=1")).toBe("/chat?x=1");
    expect(safeReturnPath("/a b")).toBe("/a%20b");
    expect(safeReturnPath(null)).toBe("/");
    expect(safeReturnPath("javascript:alert(1)")).toBe("/");
  });
});

describe("XR-LAUNCH-027 · session ids and single-use bootstrap", () => {
  test("session ids are random, never the token, and expire after 7 days", () => {
    let now = 1_000_000;
    const s = new BrowserSessions(() => now);
    const a = s.create();
    const b = s.create();
    expect(a).not.toBe(b);
    expect(a).not.toContain(TOKEN);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.isValid(a)).toBe(true);
    expect(s.isValid(`${a}x`)).toBe(false);
    expect(s.isValid("")).toBe(false);
    now += SESSION_MAX_AGE_S * 1000 - 1;
    expect(s.isValid(a)).toBe(true);
    now += 1;
    expect(s.isValid(a)).toBe(false);
  });

  test("bootstrap codes are single-use and expire after 60 s", () => {
    let now = 5_000;
    const s = new BrowserSessions(() => now);
    const code = s.mintBootstrap();
    expect(s.consumeBootstrap(code)).toBe(true);
    expect(s.consumeBootstrap(code)).toBe(false);
    const late = s.mintBootstrap();
    now += BOOTSTRAP_TTL_MS;
    expect(s.consumeBootstrap(late)).toBe(false);
    expect(s.consumeBootstrap(late)).toBe(false);
    expect(s.consumeBootstrap(TOKEN)).toBe(false);
  });

  test("stores are bounded: the oldest session is evicted first", () => {
    const s = new BrowserSessions();
    const first = s.create();
    for (let i = 0; i < 256; i++) s.create();
    expect(s.size.sessions).toBe(256);
    expect(s.isValid(first)).toBe(false);
  });

  test("a bootstrap link signs in once: 302 to the clean URL with a session cookie; a replay gets the sign-in page", async () => {
    const browser = new BrowserSessions();
    const h = freshHandler(browser);
    const code = browser.mintBootstrap();
    const res = await h(new Request(`${BASE}/chat?bootstrap=${code}`, { headers: { accept: "text/html" } }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${BASE}/chat`);
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect(cookie.startsWith("xr_session=")).toBe(true);
    expect(cookie).not.toContain(TOKEN);
    expect(cookie).not.toContain(code);
    expect((await h(new Request(`${BASE}/api/overview`, { headers: { cookie } }))).status).toBe(200);
    const replay = await h(new Request(`${BASE}/chat?bootstrap=${code}`, { headers: { accept: "text/html" } }));
    expect(replay.status).toBe(401);
    expect(replay.headers.get("content-type")).toContain("text/html");
    expect(replay.headers.get("set-cookie")).toBeNull();
  });

  test("the retired ?token= link lands on the sign-in page and sets no cookie", async () => {
    const res = await freshHandler()(new Request(`${BASE}/?token=${TOKEN}`, { headers: { accept: "text/html" } }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
    const html = await res.text();
    expect(html).toContain("Sign in to Control Center");
    expect(html).not.toContain(TOKEN);
  });

  test("a leaked session cookie is not a bearer token", async () => {
    const browser = new BrowserSessions();
    const h = freshHandler(browser);
    const sid = browser.create();
    expect((await h(new Request(`${BASE}/api/overview`, { headers: { authorization: `Bearer ${sid}` } }))).status).toBe(401);
  });

  test("POST /auth/bootstrap mints a single-use link for bearer clients; anonymous callers get 401", async () => {
    const browser = new BrowserSessions();
    const h = freshHandler(browser);
    const anon = await h(new Request(`${BASE}${BOOTSTRAP_PATH}`, { method: "POST", headers: { accept: "application/json" } }));
    expect(anon.status).toBe(401);
    const res = await h(new Request(`${BASE}${BOOTSTRAP_PATH}?next=%2Fchat`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { url: string; expiresInSeconds: number };
    expect(body.expiresInSeconds).toBe(60);
    const link = new URL(body.url);
    expect(link.origin).toBe(BASE);
    expect(link.pathname).toBe("/chat");
    expect(body.url).not.toContain(TOKEN);
    const code = link.searchParams.get("bootstrap")!;
    expect(browser.consumeBootstrap(code)).toBe(true);
    // next= is a return path, never an open redirect
    const evil = await h(new Request(`${BASE}${BOOTSTRAP_PATH}?next=${encodeURIComponent("//evil.example/x")}`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(new URL(((await evil.json()) as { url: string }).url).pathname).toBe("/");
  });

  test("POST /auth/logout revokes the session and clears the cookie; a cross-origin logout is refused", async () => {
    const browser = new BrowserSessions();
    const h = freshHandler(browser);
    const sid = browser.create();
    const cookie = `xr_session=${sid}`;
    const evil = await h(new Request(`${BASE}${LOGOUT_PATH}`, { method: "POST", headers: { cookie, origin: "http://evil.example" } }));
    expect(evil.status).toBe(403);
    expect(browser.isValid(sid)).toBe(true);
    const res = await h(new Request(`${BASE}${LOGOUT_PATH}`, { method: "POST", headers: { cookie, origin: BASE } }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(browser.isValid(sid)).toBe(false);
    expect((await h(new Request(`${BASE}/api/overview`, { headers: { cookie } }))).status).toBe(401);
  });

  test("a real serve(): the private banner prints single-use links (never ?token=), and each works once", async () => {
    const home = join(mkdtempSync(join(tmpdir(), "xr-serve-027-")), "home");
    process.env.XR_HOME = home;
    const lines: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => lines.push(a.map(String).join(" "));
    let handle: Awaited<ReturnType<typeof serve>> | undefined;
    try {
      handle = await serve({ port: 0, token: TOKEN, revealToken: true });
      const text = lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
      expect(text).not.toContain("?token=");
      expect(text).toContain(`Token: ${TOKEN}`); // the desktop sidecar still reads this line
      const m = text.match(/Dashboard\s+(http:\/\/\S+\?bootstrap=\S+)/);
      expect(m).not.toBeNull();
      const link = m![1]!;
      const first = await fetch(link, { redirect: "manual", headers: { accept: "text/html" } });
      expect(first.status).toBe(302);
      expect(first.headers.get("set-cookie")).toContain("xr_session=");
      const again = await fetch(link, { redirect: "manual", headers: { accept: "text/html" } });
      expect(again.status).toBe(401);
    } finally {
      console.log = log;
      handle?.stop();
    }
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
