/**
 * XR Phase 06 · Steps 34/35 — recovery.status.get HONESTY contract.
 *
 * The route must expose unresolved work with per-state counts AND truthful
 * RPO/RTO: the checkpoint-per-boundary model, an explicit `zeroDataLoss:
 * false`, and the MEASURED last startup-recovery duration where available.
 * Tested against a REAL daemon on an ephemeral port, auth enforced as shipped.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";

const TOKEN = "phase06-recovery-token";

let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  const tmp = mkdtempSync(join(tmpdir(), "xr-phase06-recovery-"));
  process.env.XR_HOME = join(tmp, "home");
  const store = new Store(join(tmp, "d.db"));
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: makeHandler(store, TOKEN) });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
});

describe("Phase 06 · recovery.status.get (spec steps 34/35)", () => {
  test("returns recovery list + summary + honest rpoRto", async () => {
    const res = await fetch(`${base}/api/recovery`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      recovery: unknown[];
      summary: { pending: number; blocked: number; safeToResume: number; needsApproval: number };
      rpoRto: {
        rpo: { zeroDataLoss: boolean; model: string; worstCaseLoss: string };
        rto: { model: string; budgetMs: number; lastMeasuredMs: number | null };
      };
    };
    expect(Array.isArray(body.recovery)).toBe(true);
    expect(body.summary).toBeDefined();
    expect(typeof body.summary.pending).toBe("number");
    expect(typeof body.summary.blocked).toBe("number");
    expect(typeof body.summary.safeToResume).toBe("number");
    expect(typeof body.summary.needsApproval).toBe("number");

    // RPO/RTO honesty (step 35): model documented, zero-data-loss NEVER claimed.
    expect(body.rpoRto).toBeDefined();
    expect(body.rpoRto.rpo.zeroDataLoss).toBe(false);
    expect(body.rpoRto.rpo.model).toContain("checkpoint");
    expect(body.rpoRto.rpo.worstCaseLoss).toContain("last checkpoint");
    expect(body.rpoRto.rto.model).toContain("startup_recovery");
    expect(typeof body.rpoRto.rto.budgetMs).toBe("number");
    // lastMeasuredMs may be null pre-first-recovery — but the field must exist.
    expect("lastMeasuredMs" in body.rpoRto.rto).toBe(true);
  });

  test("legacy /api/v1 mount resolves identically (Phase 02 invariant preserved)", async () => {
    const a = await fetch(`${base}/api/recovery`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const b = await fetch(`${base}/api/v1/recovery`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const ja = (await a.json()) as { summary: unknown; rpoRto: { rpo: { zeroDataLoss: boolean } } };
    const jb = (await b.json()) as { summary: unknown; rpoRto: { rpo: { zeroDataLoss: boolean } } };
    expect(ja.summary).toEqual(jb.summary);
    expect(ja.rpoRto.rpo.zeroDataLoss).toBe(jb.rpoRto.rpo.zeroDataLoss);
  });

  test("auth enforced: no token → 401", async () => {
    const res = await fetch(`${base}/api/recovery`);
    expect(res.status).toBe(401);
  });
});
