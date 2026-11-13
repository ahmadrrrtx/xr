import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { request } from "node:https";

const home = mkdtempSync(join(tmpdir(), "xr-desktop-mobile-it-"));
const desktopHome = join(home, "desktop");
const dist = join(home, "dist");
const certDir = join(desktopHome, "mobile-tls");
const keys = ["HOME", "XR_HOME", "XR_SECRET_NAMESPACE", "XR_AUDIT_LOG_DIR", "XR_DESKTOP_WEBVIEW_ORIGIN", "XR_MOBILE_DIST", "XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER"] as const;
let saved: Partial<Record<(typeof keys)[number], string | undefined>> = {};
const token = "desktop-mobile-integration-token";
let base: string, stop: () => void, currentPairingCode: () => unknown;
const run = (...args: string[]) => execFileSync("openssl", args, { cwd: home, stdio: "ignore" });
const local = (path: string, init: RequestInit = {}) => fetch(base + path, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } });
const phone = (url: string, opts: { method?: string; body?: string; cookie?: string; authorization?: string; ca?: string } = {}) => new Promise<{ status: number; body: string; cookie: string }>((resolve, reject) => {
  const req = request(url, { method: opts.method ?? "GET", ca: opts.ca ?? readFileSync(join(home, "ca.crt")), rejectUnauthorized: true,
    headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.authorization ? { authorization: opts.authorization } : {}), ...(opts.body ? { "content-type": "application/json" } : {}) } }, (res) => {
    let body = ""; res.on("data", (b) => { body += b; }); res.on("end", () => resolve({ status: res.statusCode ?? 0, body, cookie: res.headers["set-cookie"]?.[0] ?? "" }));
  });
  req.on("error", reject); req.end(opts.body);
});

beforeAll(async () => {
  saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, { HOME: home, XR_HOME: desktopHome, XR_SECRET_NAMESPACE: "desktop", XR_AUDIT_LOG_DIR: join(home, "audit"), XR_DESKTOP_WEBVIEW_ORIGIN: "tauri://localhost", XR_MOBILE_DIST: dist });
  delete process.env.XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER;
  mkdirSync(certDir, { recursive: true }); mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>mobile</title>");
  run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=XR test CA", "-keyout", "ca.key", "-out", "ca.crt");
  run("req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=127.0.0.1", "-keyout", "desktop/mobile-tls/key.pem", "-out", "leaf.csr");
  writeFileSync(join(home, "ext.cnf"), "subjectAltName=IP:127.0.0.1,DNS:phone.xr.test\nextendedKeyUsage=serverAuth\n");
  run("x509", "-req", "-in", "leaf.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-days", "1", "-extfile", "ext.cnf", "-out", "desktop/mobile-tls/cert.pem");
  const { ensureVapidKeys } = await import("../../src/daemon/web-push.ts");
  process.env.XR_SECRET_NAMESPACE = "cli";
  const cliKey = (await ensureVapidKeys()).publicKey;
  process.env.XR_SECRET_NAMESPACE = "desktop";
  const desktopKey = (await ensureVapidKeys()).publicKey;
  if (cliKey === desktopKey || !existsSync(join(desktopHome, "vapid.json"))) throw new Error("mobile VAPID caches must be profile-isolated");
  const { serve } = await import("../../src/daemon/server.ts");
  ({ currentPairingCode } = await import("../../src/daemon/mobile-pairing.ts"));
  const h = await serve({ port: 0, token });
  base = `http://127.0.0.1:${h.port}`; stop = h.stop;
}, 30_000);
afterAll(() => {
  stop?.(); rmSync(home, { recursive: true, force: true });
  for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
});

test("desktop-only start requires a bearer; wrong host is refused before opening LAN", async () => {
  expect((await fetch(`${base}/api/v1/mobile/desktop/status`)).status).toBe(401);
  const cors = await fetch(`${base}/api/v1/mobile/desktop/start`, { method: "OPTIONS", headers: { origin: "tauri://localhost", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } });
  expect(cors.status).toBe(204);
  expect(cors.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
  const bad = await local("/api/v1/mobile/desktop/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ host: "evil.example" }) });
  expect(bad.status).toBe(400);
  const stopped = await (await local("/api/v1/mobile/desktop/status")).json() as { enabled: boolean };
  expect(stopped.enabled).toBe(false);
  const stray = await local("/api/v1/mobile/desktop/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ host: "127.0.0.1", unexpected: true }) });
  expect(stray.status).toBe(400);
});
test("trusted TLS phone pairs, remote admin/bearer denied, stop closes listener and clears code", async () => {
  const started = await local("/api/v1/mobile/desktop/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ host: "127.0.0.1" }) });
  expect(started.status).toBe(200);
  const status = await started.json() as { enabled: boolean; url: string };
  expect(status.enabled).toBe(true);
  expect((await local("/api/v1/mobile/desktop/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ host: "127.0.0.1" }) })).status).toBe(400);
  expect((await phone(`${status.url}/mobile/`)).status).toBe(200);
  await expect(phone(`${status.url}/mobile/`, { ca: "" })).rejects.toThrow();
  expect((await phone(`${status.url}/api/mobile/desktop/status`)).status).toBe(404);
  expect((await phone(`${status.url}/api/mobile/models`, { authorization: `Bearer ${token}` })).status).toBe(404);
  expect((await phone(`${status.url}/api/files`)).status).toBe(404);
  const pair = await local("/api/v1/mobile/pair-qr", { method: "POST" });
  expect(pair.status).toBe(200);
  const pairData = await pair.json() as { code: string };
  const response = await phone(`${status.url}/api/mobile/pair`, { method: "POST", body: JSON.stringify({ code: pairData.code, deviceName: "test phone" }) });
  expect(response.status).toBe(200);
  expect(existsSync(join(desktopHome, "devices.json"))).toBe(true);
  expect(existsSync(join(desktopHome, "vapid.json"))).toBe(true);
  expect(existsSync(join(home, ".xr", "devices.json"))).toBe(false);
  expect(response.cookie).toContain("HttpOnly"); expect(response.cookie).toContain("Secure");
  const cookie = response.cookie.split(";")[0]!;
  expect((await phone(`${status.url}/api/mobile/models`, { cookie })).status).toBe(200);
  expect((await phone(`${status.url}/api/files`, { cookie })).status).toBe(404);
  expect((await phone(`${status.url}/api/mobile/pair`, { method: "POST", body: JSON.stringify({ code: pairData.code }) })).status).toBe(401);
  const devices = await (await local("/api/v1/mobile/devices")).json() as { devices: { id: string; name: string }[] };
  const device = devices.devices.find((d) => d.name === "test phone");
  expect(device).toBeDefined();
  expect((await local(`/api/v1/mobile/devices/${device!.id}/revoke`, { method: "POST" })).status).toBe(200);
  expect((await phone(`${status.url}/api/mobile/models`, { cookie })).status).toBe(401);
  expect((await local("/api/v1/mobile/pair-qr", { method: "POST" })).status).toBe(200);
  expect(currentPairingCode()).not.toBeNull();
  expect((await local("/api/v1/mobile/desktop/stop", { method: "POST" })).status).toBe(200);
  expect(currentPairingCode()).toBeNull();
  await expect(phone(`${status.url}/mobile/`)).rejects.toThrow();
}, 30_000);

test("a CA-validated DNS identity works when the phone resolves it to the desktop", async () => {
  const start = await local("/api/v1/mobile/desktop/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ host: "phone.xr.test" }) });
  expect(start.status).toBe(200);
  const { url } = await start.json() as { url: string };
  const u = new URL(url);
  const response = await new Promise<number>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: Number(u.port), path: "/mobile/", servername: u.hostname,
      ca: readFileSync(join(home, "ca.crt")), rejectUnauthorized: true, headers: { host: u.host } }, (res) => {
        res.resume(); res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject); req.end();
  });
  expect(response).toBe(200);
  expect((await local("/api/v1/mobile/desktop/stop", { method: "POST" })).status).toBe(200);
});
