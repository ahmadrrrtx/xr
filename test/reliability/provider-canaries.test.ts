/**
 * XR R-6 (register #11) — provider canary machinery pins.
 *
 * The canary script (scripts/provider-canaries.ts) must be as honest as the
 * rest of the launch corpus:
 *   · unconfigured providers are SKIP, never a fake pass and never a failure;
 *   · a key-present provider that fails its live probe FAILS the run (exit 1)
 *     — auth errors are never downgraded;
 *   · `XR_CANARY_BASEURL_<ID>` lets CI probe a staging/local endpoint
 *     (and is what these tests use to stay hermetic: every network call
 *     below lands on a stub bound to an ephemeral localhost port).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canaryOne, main } from "../../scripts/provider-canaries.ts";

let stub: Server;
let baseUrl: string;
let tmp: string;

function startStub(behavior: (url: string) => { status: number; body: string }): Promise<void> {
  return new Promise((resolve) => {
    stub = createServer((req, res) => {
      let chunk = "";
      req.on("data", (c) => (chunk += c));
      req.on("end", () => {
        const r = behavior(req.url ?? "/");
        res.writeHead(r.status, { "content-type": "application/json" });
        res.end(r.body);
      });
    });
    stub.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}/v1`;
      resolve();
    });
  });
}

const saved: Record<string, string | undefined> = {};
function setEnv(k: string, v: string | undefined): void {
  if (!(k in saved)) saved[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-canary-"));
});

afterEach(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete saved[k];
  }
  if (stub) {
    const s = stub;
    stub = undefined as unknown as Server;
    await new Promise((r) => s.close(() => r(undefined)));
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe("provider canaries (R-6)", () => {
  test("unconfigured providers are honest SKIPs (never fake pass, never fatal)", async () => {
    setEnv("GROQ_API_KEY", undefined);
    setEnv("ANTHROPIC_API_KEY", undefined);
    setEnv("XR_CANARY_BASEURL_OLLAMA", undefined);

    const hosted = await canaryOne("groq", { timeoutMs: 5000, env: {} });
    expect(hosted.status).toBe("skip");
    expect(hosted.skipReason).toContain("GROQ_API_KEY");

    const local = await canaryOne("ollama", { timeoutMs: 5000, env: {} });
    expect(local.status).toBe("skip");
    expect(local.skipReason).toContain("XR_CANARY_BASEURL_OLLAMA");

    const aws = await canaryOne("bedrock", { timeoutMs: 5000, env: {} });
    expect(aws.status).toBe("skip");
    expect(aws.skipReason).toContain("aws");
  });

  test("key-present provider whose endpoint answers health is a PASS (override seam, hermetic stub)", async () => {
    await startStub((url) =>
      url === "/v1/models"
        ? { status: 200, body: JSON.stringify({ object: "list", data: [{ id: "stub-model" }] }) }
        : { status: 404, body: "{}" },
    );
    setEnv("GROQ_API_KEY", "sk-stub");
    setEnv("XR_CANARY_BASEURL_GROQ", baseUrl);

    const row = await canaryOne("groq", { timeoutMs: 5000 });
    expect(row.status).toBe("pass");
    expect(row.keyPresent).toBe(true);
    expect(row.baseUrl).toBe(baseUrl);
    expect(typeof row.latencyMs).toBe("number");
    expect(row.detail).toContain("models endpoint OK");
  });

  test("key-present provider with an AUTH failure is a FAIL and main() exits 1", async () => {
    // Both health probes (GET /models, POST /chat/completions) rejected.
    await startStub(() => ({ status: 401, body: JSON.stringify({ error: { message: "invalid key" } }) }));
    setEnv("GROQ_API_KEY", "sk-bad");
    setEnv("XR_CANARY_BASEURL_GROQ", baseUrl);

    const row = await canaryOne("groq", { timeoutMs: 5000 });
    expect(row.status).toBe("fail");
    expect(row.detail).toContain("401");

    const code = await main(["--only", "groq", "--json", join(tmp, "report.json")]);
    expect(code).toBe(1);
    const report = JSON.parse(readFileSync(join(tmp, "report.json"), "utf8"));
    expect(report.fail).toBe(1);
    expect(report.results[0].id).toBe("groq");
  });

  test("a sweep of only skips fails closed (exit 2) unless XR_CANARY_ALLOW_EMPTY=1", async () => {
    setEnv("ANTHROPIC_API_KEY", undefined);
    setEnv("XR_CANARY_ALLOW_EMPTY", undefined);
    const code = await main(["--only", "anthropic"]);
    expect(code).toBe(2);

    setEnv("XR_CANARY_ALLOW_EMPTY", "1");
    const skipped = await main(["--only", "anthropic"]);
    expect(skipped).toBe(0);
  });

  test("unknown preset id is a fail row, never a crash", async () => {
    const row = await canaryOne("definitely-not-a-provider", { timeoutMs: 1000 });
    expect(row.status).toBe("fail");
    expect(row.detail).toContain("unknown provider preset");
  });
});
