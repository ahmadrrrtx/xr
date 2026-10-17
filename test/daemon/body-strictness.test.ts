/**
 * Phase 34 · R2 — write-body strictness (audit P1-6: phantom success).
 *
 * Mount-aware unknown-field policy, pinned against a real daemon on an
 * ephemeral port (harness copied from test/api/contract.test.ts):
 *   · /api/v1/*   → 400 problem+json, errors[] naming each unknown path + accepted set
 *   · /api/*      → 2xx unchanged + `x-xr-ignored-fields` naming them (until 2027-08-01)
 * No timing assertions; statuses, envelope and payload effects only.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod/v4";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";

const TOKEN = "body-strictness-token";

// Lazy import: the walker module does not exist on pre-fix code — against
// `git stash push -- src/` this resolves to a thrown "walker absent" per
// walker test, and the behavioral groups fail on statuses, so the stash run
// is a real fail-before proof instead of a module-resolution error.
let declaredKeys!: (schema: unknown) => string[];
let unknownFieldPaths!: (schema: unknown, raw: unknown) => string[];

let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(async () => {
  const mod = await import("../../src/daemon/routes/body-strictness.ts").catch(() => undefined);
  const absent = (name: string) => (): never => { throw new Error(`walker absent (pre-fix?): ${name}`); };
  declaredKeys = mod?.declaredKeys ?? absent("declaredKeys");
  unknownFieldPaths = mod?.unknownFieldPaths ?? absent("unknownFieldPaths");
  const tmp = mkdtempSync(join(tmpdir(), "xr-body-strictness-"));
  process.env.XR_HOME = join(tmp, "home");
  const store = new Store(join(tmp, "d.db"));
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, srv) => makeHandler(store, TOKEN)(req, srv),
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server?.stop(true));

const post = (path: string, body: unknown, method = "POST") =>
  fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

type Problem = { error: string; status: number; errors?: Array<{ path: string; message: string }> };

/** 1 · The audit's exact case (P1-6) */
describe("budget.set — the phantom success is closed", () => {
  test("v1 rejects the typo'd field with a precise 400", async () => {
    const res = await post("/api/v1/budget/set", { usd: 50 });
    expect(res.status).toBe(400);
    // same problem envelope shape as the pre-existing semantic 400 (RFC 9457
    // style; the repo's problem() serialises application/json + errors[]).
    const p = (await res.json()) as Problem;
    expect((p as { error?: string }).error).toContain("fields the operation does not accept");
    expect(p.errors?.[0]?.path).toBe("usd");
    expect(p.errors?.[0]?.message).toContain("Unknown field");
    expect(p.errors?.[0]?.message).toContain("budget.set accepts");
    expect(p.errors?.[0]?.message).toContain("perTaskUsd");
    // and nothing was written: no random "usd" persisted anywhere
    const after = await (await fetch(`${base}/api/budget`, { headers: { authorization: `Bearer ${TOKEN}` } })).json() as Record<string, unknown>;
    expect(JSON.stringify(after)).not.toContain('"usd"');
  });

  test("legacy keeps 200 and NAMES the ignored field in the header", async () => {
    const res = await post("/api/budget/set", { usd: 50 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true); // legacy semantics unchanged
    expect(res.headers.get("x-xr-ignored-fields")).toBe("usd");
  });
});

/** 2 · No regression on valid input, semantic 400 keeps its own shape */
describe("valid input regression", () => {
  test("a valid body behaves identically on both mounts (200, no header)", async () => {
    for (const mount of ["/api/v1", "/api"]) {
      const res = await post(`${mount}/budget/set`, { perTaskUsd: 5 });
      expect(res.status).toBe(200);
      expect(res.headers.get("x-xr-ignored-fields")).toBeNull();
    }
  });

  test("a semantically bad VALUE stays the pre-existing 400 with its own path — on both mounts", async () => {
    for (const mount of ["/api/v1", "/api"]) {
      const res = await post(`${mount}/budget/set`, { perTaskUsd: -5 });
      expect(res.status).toBe(400);
      const p = (await res.json()) as Problem;
      expect(p.errors?.[0]?.path).toBe("perTaskUsd");
      expect(p.errors?.[0]?.message).not.toContain("Unknown field"); // strictness must not claim it
    }
  });
});

/** 3 · Breadth: ≥8 mutating ops across route families */
describe("breadth sweep", () => {
  const OPS: Array<{ op: string; path: string; valid: Record<string, unknown>; method?: string }> = [
    { op: "budget.set", path: "/budget/set", valid: { perTaskUsd: 5 } },
    { op: "providers.set", path: "/providers/set", valid: { provider: "anthropic" } },
    { op: "workspaces.switch", path: "/workspaces/switch", valid: { id: "breadth-ws" } },
    { op: "workspaces.create", path: "/workspaces/create", valid: { id: "breadth-a", name: "Breadth A" } },
    { op: "triggers.pause", path: "/triggers/pause", valid: { pauseAll: true } },
    { op: "shield.whitelist", path: "/shield/whitelist", valid: { action: "add", type: "domain", value: "probe.example" } },
    { op: "state.ui.patch", path: "/state/ui", valid: { patch: { theme: "dark" } }, method: "PUT" },
    {
      op: "triggers.create", path: "/triggers",
      valid: { kind: "cron", spec: { kind: "cron", expr: "0 9 * * 1" }, taskTemplate: "probe", budget: { maxUsd: 1 }, consentRef: "probe" },
    },
  ];

  for (const { op, path, valid, method } of OPS) {
    test(`${op}: valid body 2xx on v1; junk key → 400 on v1 + named header on legacy`, async () => {
      const ok = await post(`/api/v1${path}`, valid, method);
      expect([200, 201]).toContain(ok.status);
      const junked = await post(`/api/v1${path}`, { ...valid, bogus_field_p46: 1 }, method);
      expect(junked.status).toBe(400);
      const p = (await junked.json()) as Problem;
      expect(p.errors?.[0]?.path).toBe("bogus_field_p46");
      expect(p.errors?.[0]?.message).toContain(`${op} accepts`);
      const legacy = await post(`/api${path}`, { ...valid, bogus_field_p46: 1 }, method);
      expect([200, 201]).toContain(legacy.status);
      expect(legacy.headers.get("x-xr-ignored-fields")).toBe("bogus_field_p46");
    });
  }
});

/** 4 · Nested objects and array elements are located precisely */
describe("nested & array descent", () => {
  test("unknown key inside a nested object → dotted path; known nested field passes", async () => {
    const ok = await post("/api/v1/triggers", {
      kind: "cron", spec: { kind: "cron", expr: "0 9 * * 1" }, taskTemplate: "p", budget: { maxUsd: 1 }, consentRef: "c",
    });
    expect(ok.status).toBe(200);
    const bad = await post("/api/v1/triggers", {
      kind: "cron", spec: { kind: "cron", expr: "0 9 * * 1" }, taskTemplate: "p", budget: { maxUsd: 1, forty: 1 }, consentRef: "c",
    });
    expect(bad.status).toBe(400);
    const p = (await bad.json()) as Problem;
    expect(p.errors?.map((e) => e.path)).toContain("budget.forty");
  });

  test("unknown key inside an array element → [i] path", async () => {
    const bad = await post("/api/v1/chat", {
      message: "hi", history: [{ role: "user", content: "x", junk: 1 }],
    });
    expect(bad.status).toBe(400); // validation precedes provider state — deterministic
    const p = (await bad.json()) as Problem;
    expect(p.errors?.map((e) => e.path)).toContain("history[0].junk");
  });
});

/** 5 · No false positives on shapes the contract declares free-form */
describe("no false positives (record / catch-all / unions)", () => {
  test("record field (state.ui.patch.patch) accepts arbitrary keys — 2xx", async () => {
    const res = await post("/api/v1/state/ui", { patch: { "any.deep.key": { nested: true } } }, "PUT");
    expect(res.status).toBe(200);
  });

  test("empty-shape bag (triggers.create spec) accepts arbitrary content — 2xx", async () => {
    const res = await post("/api/v1/triggers", {
      kind: "cron", spec: { kind: "cron", expr: "0 9 * * 1", anything: { goes: [1, 2] } },
      taskTemplate: "p", budget: { maxUsd: 1 }, consentRef: "c",
    });
    expect(res.status).toBe(200);
  });

  test("union value (telegram-style z.union code) is opaque — no strictness 400", async () => {
    // telegram.pair.confirm needs a live pairing context; the deterministic
    // assertion is that strictness does NOT preempt the semantic response.
    const res = await post("/api/v1/telegram/pair/confirm", { code: 123456 });
    expect(res.status).not.toBe(400);
    if (res.status !== 400) return;
    const p = (await res.json()) as Problem;
    expect(p.errors?.[0]?.message ?? "").not.toContain("Unknown field");
  });
});

/** 6 · Reads untouched */
describe("reads are not gated", () => {
  test("GET with an unknown query param behaves as before (200, no strictness 400)", async () => {
    const res = await fetch(`${base}/api/v1/budget?bogus_param=1`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
  });
});

/** 7 · Walker unit tests: purity, opaqueness and the cap */
describe("walker", () => {
  test("6 constructed schemas", () => {
    const S1 = z.looseObject({ a: z.number() });
    expect(unknownFieldPaths(S1, { a: 1, b: 2 } as object)).toEqual(["b"]);
    const S2 = z.looseObject({ n: z.looseObject({ x: z.string() }) });
    expect(unknownFieldPaths(S2, { n: { x: "ok", y: 1 } } as object)).toEqual(["n.y"]);
    const S3 = z.looseObject({ arr: z.array(z.looseObject({ c: z.string() })) });
    expect(unknownFieldPaths(S3, { arr: [{ c: "ok" }, { c: "ok", d: 1 }] } as object)).toEqual(["arr[1].d"]);
    const S4 = z.looseObject({ u: z.union([z.looseObject({ k: z.number() }), z.string()]) });
    expect(unknownFieldPaths(S4, { u: { k: 1, free: 1 } } as object)).toEqual([]); // union subtree opaque
    const S5 = z.looseObject({ r: z.record(z.string(), z.unknown()) });
    expect(unknownFieldPaths(S5, { r: { deep: { deeper: 1 } } } as object)).toEqual([]); // record opaque
    const S6 = z.looseObject({ o: z.number().optional(), dd: z.number().default(4), nn: z.number().nullable() });
    expect(unknownFieldPaths(S6, { o: 1, dd: 2, nn: 3, extra: 1 } as object)).toEqual(["extra"]); // unwrapping
    expect(declaredKeys(S6)).toEqual(["o", "dd", "nn"]);
  });

  test("30 junk keys → capped at 20 findings", () => {
    const junk = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i.toString().padStart(2, "0")}`, 1]));
    const out = unknownFieldPaths(z.looseObject({ decl: z.number() }), { decl: 1, ...junk } as object);
    expect(out.length).toBe(20);
  });
});
