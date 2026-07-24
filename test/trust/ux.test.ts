import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import { ServiceRegistry } from "../../src/core/service-registry.ts";
import { Tokens } from "../../src/core/tokens.ts";
import { TrustCommand } from "../../src/commands/trust.ts";
import { makeTrust } from "./_helpers.ts";

const TOKEN = "test-token-trust";
let tmp: string;
let store: Store;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-trust-ux-"));
  process.env.XR_HOME = join(tmp, "home");
  store = new Store(join(tmp, "d.db"));
});

function req(path: string, init?: RequestInit): Request {
  return new Request(`http://127.0.0.1:7842${path}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
    ...init,
  });
}

describe("XR 4.2 daemon trust routes", () => {
  test("GET /api/trust reports backend availability + health (secret-free)", async () => {
    const h = makeHandler(store, TOKEN);
    const res = await h(req("/api/trust"));
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.enabled).toBe(true);
    expect(Array.isArray(j.backends)).toBe(true);
    expect(j.backends.length).toBeGreaterThanOrEqual(1);
    const placements = j.backends.map((b: any) => b.placement);
    expect(placements).toContain("namespace_sandbox");
    expect(typeof j.activeEnvironments).toBe("number");
    expect(typeof j.quarantined).toBe("number");
    // Secret-free: no credential values, no sensitive paths.
    expect(JSON.stringify(j)).not.toContain("XR_CRED_");
  });

  test("GET /api/trust requires auth", async () => {
    const h = makeHandler(store, TOKEN);
    const res = await h(new Request("http://127.0.0.1:7842/api/trust"));
    expect(res.status).toBe(401);
  });

  test("POST /api/trust/classify returns tier + placement for a shell command", async () => {
    const h = makeHandler(store, TOKEN);
    const res = await h(
      req("/api/trust/classify", { method: "POST", body: JSON.stringify({ cmd: "echo hi" }) }),
    );
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.classification.tier).toBe("tier2_isolated");
    expect(j.classification.requiredApprovalLevel).not.toBe("none");
    expect(typeof j.decision.kind).toBe("string");
    expect(typeof j.decision.placement).toBe("string");
  });
});

describe("XR 4.2 `xr trust` CLI command", () => {
  function capture(fn: () => Promise<void>): Promise<string> {
    const chunks: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => chunks.push(a.map(String).join(" "));
    return fn()
      .then(() => chunks.join("\n"))
      .finally(() => {
        console.log = orig;
      });
  }

  async function makeCtx(args: string[]) {
    const registry = new ServiceRegistry();
    const h = makeTrust();
    await h.trust.ensureReady();
    registry.registerValue(Tokens.Trust, h.trust, { kernelScope: "process", owner: "trust" });
    return { registry, args, cwd: tmp };
  }

  test("`xr trust` prints backend availability", async () => {
    const ctx = await makeCtx([]);
    const out = await capture(() => new TrustCommand().execute(ctx as any));
    expect(out).toContain("Trust & Isolation");
    expect(out).toContain("namespace_sandbox");
    expect(out).toContain("Placement backends");
  });

  test("`xr trust classify <cmd>` prints the risk tier + placement", async () => {
    const ctx = await makeCtx(["classify", "echo", "hi"]);
    const out = await capture(() => new TrustCommand().execute(ctx as any));
    expect(out).toContain("Risk tier:   tier2_isolated");
    expect(out).toContain("Placement:");
  });

  test("`xr trust --json` emits stable JSON", async () => {
    const ctx = await makeCtx(["--json"]);
    const out = await capture(() => new TrustCommand().execute(ctx as any));
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed.backends)).toBe(true);
  });
});
