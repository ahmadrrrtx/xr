import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { makeTrust, makeGrant, type TrustHarness } from "./_helpers.ts";
import { NamespaceSandboxBackend } from "../../src/trust/environment/namespace.ts";
import { RestrictedProcessBackend } from "../../src/trust/environment/restricted-process.ts";
import { sensitiveBlockedPaths } from "../../src/trust/classify.ts";
import type { EnvironmentExecutable, PlacementDecision } from "../../src/trust/types.ts";

// Probe the real backend at module load so we can skip honestly if the host
// cannot provide a namespace sandbox (e.g. no bubblewrap / no user namespaces).
const probe = new NamespaceSandboxBackend();
const NS_AVAILABLE = await probe.detect();

let h: TrustHarness;
let W: string;
let hostSecret: string;
const HOST_SECRET_VALUE = `TOPSECRET_HOST_${randomUUID().replace(/-/g, "")}`;
const WS_SECRET_VALUE = `WS_VISIBLE_${randomUUID().replace(/-/g, "")}`;

function admitted(placement: PlacementDecision["placement"] = "namespace_sandbox"): PlacementDecision {
  return {
    kind: "admitted",
    requestedTier: "tier2_isolated",
    placement,
    reason: "test admission",
    decidedAt: Date.now(),
    policyVersion: "test",
  };
}

function grantFor(cwd: string) {
  return makeGrant({
    tier: "tier2_isolated",
    fs: { writableRoots: [cwd], readOnlyRoots: [], blockedPaths: sensitiveBlockedPaths(), ephemeralScratch: true },
    net: { mode: "none", allowlist: [], blockPrivateNetworks: true, blockOffAllowlistRedirects: true },
  });
}

beforeAll(async () => {
  h = makeTrust([new RestrictedProcessBackend(), new NamespaceSandboxBackend()]);
  await h.manager.init();
  W = mkdtempSync(join(tmpdir(), "xr-trust-ws-"));
  writeFileSync(join(W, "ws_secret.txt"), WS_SECRET_VALUE);
  // Host secret lives OUTSIDE the workspace, under a path the sandbox hides.
  hostSecret = join(tmpdir(), `xr-trust-hostsecret-${randomUUID().slice(0, 8)}.txt`);
  writeFileSync(hostSecret, HOST_SECRET_VALUE);
});

afterAll(() => {
  try { rmSync(W, { recursive: true, force: true }); } catch { /* noop */ }
  try { rmSync(hostSecret, { force: true }); } catch { /* noop */ }
});

describe("XR 4.2 namespace sandbox (real kernel boundary)", () => {
  test("backend detects and claims an honest kernel boundary", () => {
    if (!NS_AVAILABLE) return;
    expect(h.manager.capabilities().namespaceSandbox).toBe(true);
    const be = h.manager.backendFor("namespace_sandbox");
    expect(be).toBeDefined();
    expect(be!.guarantees.kernelBoundary).toBe(true);
    expect(be!.guarantees.enforcedNetwork).toBe(true);
    expect(be!.guarantees.noAmbientAuthority).toBe(true);
  });

  test("filesystem is confined: workspace is writable, host paths are ABSENT", async () => {
    if (!NS_AVAILABLE) return;
    const exec: EnvironmentExecutable = {
      argv: ["sh", "-c", `echo built > out.txt; cat ${hostSecret} 2>/dev/null || echo NO_HOST_SECRET; cat ${W}/ws_secret.txt 2>/dev/null || echo NO_WS_SECRET`],
      cwd: W,
      env: {},
      timeoutMs: 30000,
      maxOutputBytes: 100000,
    };
    const out = await h.manager.executeInEnvironment({ decision: admitted(), exec, grant: grantFor(W) });
    expect(out.blocked).toBe(false);
    if (out.blocked) return;
    const r = out.output.result;
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("NO_HOST_SECRET");          // host file is absent inside
    expect(r.stdout).not.toContain(HOST_SECRET_VALUE);     // its value never appears
    expect(r.stdout).toContain(WS_SECRET_VALUE);           // workspace file IS visible
    // The write happened inside the bound workspace and persists on the host.
    expect(existsSync(join(W, "out.txt"))).toBe(true);
    expect(out.output.verification.verified).toBe(true);
    expect(out.output.cleanup.state).toBe("succeeded");
  });

  test("network is blocked inside the sandbox (no routes, no DNS)", async () => {
    if (!NS_AVAILABLE) return;
    // Primary proof: an isolated net namespace has NO routing table entries
    // (only the /proc/net/route header). A leaked/host netns would show eth0
    // and a default route. Secondary proof: DNS resolution cannot succeed.
    const exec: EnvironmentExecutable = {
      argv: ["sh", "-c", "test $(wc -l < /proc/net/route) -gt 1 && echo HAS_ROUTE || echo NO_ROUTE; getent hosts example.com >/dev/null 2>&1 && echo DNS_OK || echo DNS_FAIL"],
      cwd: W,
      env: {},
      timeoutMs: 30000,
      maxOutputBytes: 100000,
    };
    const out = await h.manager.executeInEnvironment({ decision: admitted(), exec, grant: grantFor(W) });
    expect(out.blocked).toBe(false);
    if (out.blocked) return;
    expect(out.output.result.stdout).toContain("NO_ROUTE");
    expect(out.output.result.stdout).not.toContain("HAS_ROUTE");
    expect(out.output.result.stdout).toContain("DNS_FAIL");
    expect(out.output.result.stdout).not.toContain("DNS_OK");
  });

  test("ambient host environment is NOT inherited", async () => {
    if (!NS_AVAILABLE) return;
    process.env.XR_HOST_LEAK = "LEAKY_VALUE_123";
    try {
      const exec: EnvironmentExecutable = {
        argv: ["sh", "-c", "printenv XR_HOST_LEAK >/dev/null 2>&1 && echo LEAK_PRESENT || echo NO_LEAK; echo SANDBOX_PATH=$PATH"],
        cwd: W,
        env: {},
        timeoutMs: 30000,
        maxOutputBytes: 100000,
      };
      const out = await h.manager.executeInEnvironment({ decision: admitted(), exec, grant: grantFor(W) });
      expect(out.blocked).toBe(false);
      if (out.blocked) return;
      expect(out.output.result.stdout).toContain("NO_LEAK");
      expect(out.output.result.stdout).not.toContain("LEAK_PRESENT");
      expect(out.output.result.stdout).toContain("SANDBOX_PATH=/usr/bin:/bin");
    } finally {
      delete process.env.XR_HOST_LEAK;
    }
  });

  test("output is bounded (truncation raises a boundary event)", async () => {
    if (!NS_AVAILABLE) return;
    const exec: EnvironmentExecutable = {
      argv: ["sh", "-c", "head -c 300000 /dev/zero | tr '\\0' 'a'"],
      cwd: W,
      env: {},
      timeoutMs: 30000,
      maxOutputBytes: 50000,
    };
    const out = await h.manager.executeInEnvironment({ decision: admitted(), exec, grant: grantFor(W) });
    expect(out.blocked).toBe(false);
    if (out.blocked) return;
    expect(out.output.result.outputTruncated).toBe(true);
    expect(out.output.result.boundaryEvent).toBe(true);
    expect(out.output.result.stdout.length).toBeLessThanOrEqual(50000 + 4096);
  });

  test("task-scoped credentials are injected then revoked on cleanup", async () => {
    if (!NS_AVAILABLE) return;
    const RAW = `RAWSECRET_${randomUUID().replace(/-/g, "")}`;
    const ref = h.broker.register("token", RAW, "core_tool:shell");
    const grant = grantFor(W);
    grant.credentials = h.broker.scopeFor([ref], "task_scoped");
    const exec: EnvironmentExecutable = {
      argv: ["sh", "-c", "echo GOT=${XR_CRED_TOKEN:+yes}"],
      cwd: W,
      env: {},
      timeoutMs: 30000,
      maxOutputBytes: 100000,
    };
    const out = await h.manager.executeInEnvironment({ decision: admitted(), exec, grant });
    expect(out.blocked).toBe(false);
    if (out.blocked) return;
    expect(out.output.result.stdout).toContain("GOT=yes"); // sandbox saw the injected cred
    expect(out.output.result.stdout).not.toContain(RAW);   // command did not print the value
    expect(out.output.cleanup.credentialsRevoked).toBeGreaterThanOrEqual(1);
    expect(h.broker.has(ref.refId)).toBe(false);           // revoked after the run
  });

  test("a Tier-2 network allowlist is refused (not enforceable inside the boundary)", async () => {
    if (!NS_AVAILABLE) return;
    const grant = makeGrant({
      tier: "tier2_isolated",
      fs: { writableRoots: [W], readOnlyRoots: [], blockedPaths: sensitiveBlockedPaths(), ephemeralScratch: true },
      net: { mode: "allowlist", allowlist: ["api.example.com"], blockPrivateNetworks: true, blockOffAllowlistRedirects: true },
    });
    const exec: EnvironmentExecutable = { argv: ["sh", "-c", "true"], cwd: W, env: {}, timeoutMs: 5000, maxOutputBytes: 1000 };
    const out = await h.manager.executeInEnvironment({ decision: admitted(), exec, grant });
    expect(out.blocked).toBe(true);
  });
});
