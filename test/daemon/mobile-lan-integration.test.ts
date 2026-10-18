/**
 * Phase 2.4 · P1-1 — mobile LAN control path against the REAL shipping serve().
 *
 * Boots `serve({ lan })` with a genuine self-signed TLS listener on an
 * ephemeral port (isolated HOME/XR_HOME so the cert + device registry land in
 * tmp) and pins the slice end-to-end:
 *   1. the public cert-fingerprint operation answers WITHOUT a session (TOFU
 *      trust root) and matches the served certificate's shape;
 *   2. a valid pairing code issues an HttpOnly+Secure+SameSite=Strict device
 *      cookie, and the 6-digit code is single-use;
 *   3. the paired-device cookie reads a truthful companion API (models);
 *   4. the SAME cookie hits the 403 wall on files (canonical mount rule —
 *      /api/v1/files ≡ /api/files), before any handler effect;
 *   5. revoke from the desktop kills the mobile session (next request → 401).
 *   6. §15#10 cookie matrix: the bootstrap session cookie carries `Secure`
 *      on the LAN-TLS listener and omits it on the loopback listener.
 *
 * Note on imports: lan-tls.ts / mobile-devices.ts resolve cert/registry paths
 * from $HOME at MODULE LOAD, so HOME + XR_HOME are pinned before ANY dynamic
 * import of daemon modules (static imports here are bun:test/node only).
 * NODE_TLS_REJECT_UNAUTHORIZED=0 is scoped to this test process only: the
 * self-signed LAN certificate is the artifact under test (the fingerprint
 * assertion is the trust check, not TLS CA validation).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HOME = mkdtempSync(join(tmpdir(), "xr-mobile-lan-it-"));
process.env.XR_HOME = join(process.env.HOME, "xr-home");
process.env.XR_AUDIT_LOG_DIR = join(process.env.HOME, "audit");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // test-process only — self-signed cert under test

const TOKEN = "mobile-lan-it-token";
process.env.XR_DAEMON_TOKEN = TOKEN;

let base!: string;
let loopBase!: string;
let stop!: () => void;
let stopLoop!: () => void;
let createPairingCode!: () => { code: string };

const jar = (setCookie: string | null): string => setCookie?.split(";")[0] ?? "";

beforeAll(async () => {
  const { prepareLan } = await import("../../src/cli/serve-lan.ts");
  const { serve } = await import("../../src/daemon/server.ts");
  ({ createPairingCode } = await import("../../src/daemon/mobile-pairing.ts"));
  const lan = await prepareLan(0);
  const handle = await serve({ port: 0, token: TOKEN, lan: { cert: lan.cert } });
  base = handle.lanUrl!.replace(/https:\/\/[\d.]+/, "https://127.0.0.1");
  stop = handle.stop;
  if (process.env.XR_IT_NO_LOOP !== "1") {
    const loop = await serve({ port: 0, token: TOKEN });
    loopBase = `http://127.0.0.1:${loop.port}`;
    stopLoop = loop.stop;
  }
});

afterAll(() => {
  stop?.();
  stopLoop?.();
  rmSync(process.env.HOME!, { recursive: true, force: true });
});

describe("Phase 2.4 · P1-1 — mobile LAN control path (real TLS serve())", () => {
  test("public cert-fingerprint answers without a session (TOFU root)", async () => {
    const res = await fetch(`${base}/api/mobile/cert-fingerprint`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fingerprint?: string };
    expect(body.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test("pair issues HttpOnly+Secure+Strict device cookie; code is single-use", async () => {
    const { code } = createPairingCode();
    const res = await fetch(`${base}/api/mobile/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, deviceName: "IT Phone" }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const replay = await fetch(`${base}/api/mobile/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, deviceName: "Replay" }),
    });
    expect(replay.status).toBe(401);
    (globalThis as Record<string, unknown>).__itCookie = jar(cookie);
  });

  test("paired cookie reads a truthful companion API (models), and ONLY that class", async () => {
    const cookie = (globalThis as Record<string, unknown>).__itCookie as string;
    const models = await fetch(`${base}/api/v1/models`, { headers: { cookie } });
    expect(models.status).toBe(200);
    const body = (await models.json()) as { selected?: { model?: string } };
    expect(typeof body.selected?.model).toBe("string");
  });

  test("403 wall: paired cookie on /api/v1/files is refused pre-effect (canonical gate)", async () => {
    const cookie = (globalThis as Record<string, unknown>).__itCookie as string;
    const v1 = await fetch(`${base}/api/v1/files/package.json`, { headers: { cookie } });
    expect(v1.status).toBe(403);
    const legacy = await fetch(`${base}/api/files/package.json`, { headers: { cookie } });
    expect(legacy.status).toBe(403);
  });

  test("revoke from desktop kills the mobile session", async () => {
    const cookie = (globalThis as Record<string, unknown>).__itCookie as string;
    const bearer = { authorization: `Bearer ${TOKEN}` };
    const list = await fetch(`${base}/api/mobile/devices`, { headers: bearer });
    const listBody = (await list.json()) as { devices: { id: string; name: string }[] };
    if (process.env.XR_IT_DEBUG) console.log("IT list:", list.status, JSON.stringify(listBody));
    const mine = listBody.devices.find((d) => d.name === "IT Phone");
    expect(mine).toBeTruthy();
    const revoke = await fetch(`${base}/api/mobile/devices/${mine!.id}/revoke`, { method: "POST", headers: bearer });
    if (process.env.XR_IT_DEBUG) console.log("IT revoke:", revoke.status, await revoke.clone().text().catch(() => ""));
    expect(revoke.status).toBe(200);
    const after = await fetch(`${base}/api/v1/models`, { headers: { cookie } });
    if (process.env.XR_IT_DEBUG) console.log("IT after:", after.status, (await after.clone().text().catch(() => "")).slice(0, 90));
    expect(after.status).toBe(401);
  });

  test("§15#10: bootstrap cookie is Secure iff the listener is LAN TLS", async () => {
    const lan = await fetch(`${base}/?token=${TOKEN}`, { redirect: "manual" });
    expect(lan.status).toBe(302);
    expect(lan.headers.get("set-cookie") ?? "").toMatch(/Secure/);
    if (process.env.XR_IT_NO_LOOP !== "1") {
      const loop = await fetch(`${loopBase}/?token=${TOKEN}`, { redirect: "manual" });
      expect(loop.status).toBe(302);
      expect(loop.headers.get("set-cookie") ?? "").not.toMatch(/Secure/);
    }
  });
});
