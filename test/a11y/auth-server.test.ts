/**
 * XR Phase 8 · T3 — server-side accessible-auth contract.
 *
 * Browsers (Accept: text/html) get the accessible sign-in page; every other
 * client keeps the Phase-4 JSON 401. The one-time bootstrap, session cookie,
 * and CSRF guard are untouched (pinned by test/daemon.security tests).
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";

const TOKEN = "auth-contract-token";
function freshHandler() {
  const tmp = mkdtempSync(join(tmpdir(), "xr-auth-"));
  process.env.XR_HOME = join(tmp, "home");
  return makeHandler(new Store(join(tmp, "d.db")), TOKEN);
}
const htmlGet = (path: string) =>
  new Request(`http://127.0.0.1:7842${path}`, { headers: { accept: "text/html,application/xhtml+xml" } });

describe("T3 — accessible auth responses", () => {
  test("browser page navigation without credentials gets the sign-in page (401 + HTML + CSP)", async () => {
    const res = await freshHandler()(htmlGet("/"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain("Sign in to Control Center");
    expect(html).toContain('role="alert"');
    expect(html).toContain('<label for="token">');
    expect(html).not.toContain(TOKEN);
  });

  test("deep links are preserved as the form's return path", async () => {
    const res = await freshHandler()(htmlGet("/dashboard"));
    const html = await res.text();
    expect(html).toContain('action="/dashboard"');
  });

  test("API clients still get the JSON 401 (Phase-4 contract intact)", async () => {
    const res = await freshHandler()(
      new Request("http://127.0.0.1:7842/api/overview", { headers: { accept: "application/json" } }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body: any = await res.json();
    expect(body.error).toContain("unauthorized");
  });

  test("mutating verbs never get the HTML page (no form confusion)", async () => {
    const res = await freshHandler()(
      new Request("http://127.0.0.1:7842/api/overview", { method: "POST", headers: { accept: "text/html" } }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("the sign-in page's behaviour script is the one open asset (static, no data)", async () => {
    const h = freshHandler();
    const res = await h(new Request("http://127.0.0.1:7842/assets/auth.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    const js = await res.text();
    expect(js).not.toContain(TOKEN);
    // …but nothing else escaped the auth boundary:
    const css = await h(new Request("http://127.0.0.1:7842/assets/dashboard.css", { headers: { accept: "*/*" } }));
    expect(css.status).toBe(401);
  });

  test("the form's GET submission drives the one-time bootstrap exactly as before", async () => {
    const res = await freshHandler()(
      new Request(`http://127.0.0.1:7842/?token=${TOKEN}`, { headers: { accept: "text/html" } }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:7842/");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(res.headers.get("set-cookie")).toContain("SameSite=Strict");
  });

  test("a wrong token on the form still lands on the accessible page (affordance loop)", async () => {
    const res = await freshHandler()(
      new Request("http://127.0.0.1:7842/?token=wrong-token", { headers: { accept: "text/html" } }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});
