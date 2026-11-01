/**
 * XR-P01 — engine handshake surface: session-gated `/api/v1/meta/version`
 * carries the contract data the desktop negotiates against, while the open
 * health probes stay exactly `{ok, ts}` (P2-21 anti-fingerprinting).
 *
 * Fail-before property: run this file against the pre-P01 tree and ONLY the
 * new-field assertions fail (the namespace imports of the new constants are
 * `undefined` there); the 401/legacy-field/health assertions already pass.
 * No timing assertions: statuses and payload shape only.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as S from "../../src/daemon/server.ts";
import * as C from "../../src/daemon/routes/contract.ts";
import { Store } from "../../src/state/workspace-store.ts";
import { LATEST_SCHEMA_VERSION } from "../../src/state/migrations.ts";

const { makeHandler } = S;
// Against pre-P01 code both are undefined and the field assertions fail
// behaviourally; after P01 they are the single exported authorities.
const { ENGINE_CONTRACT_VERSION, MIN_DESKTOP_VERSION } = C as unknown as {
  ENGINE_CONTRACT_VERSION?: number;
  MIN_DESKTOP_VERSION?: string;
};

const TOKEN = "[SECURITY_DATA]";

let tmp: string;
let store: Store;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-p01-"));
  process.env.XR_HOME = join(tmp, "home");
  store = new Store(join(tmp, "d.db"));
});
afterEach(() => {
  (store as unknown as { close?: () => void }).close?.();
  // origin-host-guard.test.ts documents the Windows SQLite lock release.
  let last: unknown;
  for (let i = 0; i < 30; i++) {
    try { rmSync(tmp, { recursive: true, force: true }); return; }
    catch (e) {
      last = e;
      if ((e as { code?: string }).code !== "EBUSY" && (e as { code?: string }).code !== "ENOTEMPTY") break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  throw last;
});

function req(path: string, auth: "bearer" | "none" = "none"): Request {
  const headers: Record<string, string> = {};
  if (auth === "bearer") headers.authorization = `Bearer ${TOKEN}`;
  return new Request(`http://localhost:3141${path}`, { headers });
}

describe("XR-P01 · GET /api/v1/meta/version (session-gated handshake)", () => {
  test("anonymous → 401 (identity is never served open)", async () => {
    const h = makeHandler(store, TOKEN);
    const res = await h(req("/api/v1/meta/version"));
    expect(res.status).toBe(401);
  });

  test("paired → 200 with legacy fields unchanged AND contract fields added", async () => {
    const h = makeHandler(store, TOKEN);
    const res = await h(req("/api/v1/meta/version", "bearer"));
    expect(res.status).toBe(200);
    const j: Record<string, unknown> = await res.json() as Record<string, unknown>;

    // Legacy fields: same names, same types (mobile companion compat).
    expect(typeof j.version).toBe("string");
    expect(typeof j.host).toBe("string");
    expect(typeof j.lan).toBe("boolean");
    expect(j.deviceName).toBe("XR desktop");

    // XR-P01 additive contract fields, from their single authorities.
    expect(j.contractVersion).toBe(ENGINE_CONTRACT_VERSION);
    expect(typeof j.contractVersion).toBe("number");
    expect(j.minDesktopVersion).toBe(MIN_DESKTOP_VERSION);
    expect(typeof j.minDesktopVersion).toBe("string");
    expect(j.schemaVersion).toBe(LATEST_SCHEMA_VERSION);

    // Capabilities are derived from the served registry, so this very
    // operation (registered by P01) and the health operation must appear.
    expect(Array.isArray(j.capabilities)).toBe(true);
    const caps = j.capabilities as string[];
    expect(caps).toContain("meta.version.get");
    expect(caps).toContain("health.get");
    expect(caps.every((c) => typeof c === "string")).toBe(true);
    // Derived, de-duplicated, deterministic order (sorted).
    expect([...caps].sort()).toEqual(caps);
    expect(new Set(caps).size).toBe(caps.length);
  });

  test("legacy /api mount answers identically (one handler, two mounts)", async () => {
    const h = makeHandler(store, TOKEN);
    const v1: Record<string, unknown> = await (await h(req("/api/v1/meta/version", "bearer"))).json() as Record<string, unknown>;
    const legacy: Record<string, unknown> = await (await h(req("/api/meta/version", "bearer"))).json() as Record<string, unknown>;
    expect(legacy).toEqual(v1);
  });
});

describe("XR-P01 · open health probes are NOT extended (P2-21 guard)", () => {
  test("both health mounts return exactly {ok, ts} — no identity fields", async () => {
    const h = makeHandler(store, TOKEN);
    for (const p of ["/api/health", "/api/v1/health"]) {
      const res = await h(req(p));
      expect(res.status).toBe(200);
      const j: Record<string, unknown> = await res.json() as Record<string, unknown>;
      expect(Object.keys(j).sort()).toEqual(["ok", "ts"]);
      for (const k of ["contractVersion", "minDesktopVersion", "schemaVersion", "capabilities", "version", "deviceName"]) {
        expect(j[k]).toBeUndefined();
      }
    }
  });
});
