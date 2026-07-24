/**
 * XR 4.2 — Trust & Isolation performance measurement (Stage F artifact).
 *
 * Measures the cost of the trust gate per tier:
 *   - Tier 0: classify + placement decision (the fast-path overhead).
 *   - Tier 1: restricted-process echo (confined child).
 *   - Tier 2: namespace-sandbox echo (full OS sandbox startup + teardown).
 *
 * Run: bun run scripts/measure-trust-perf.ts
 *
 * The low-risk path must remain fast; Tier-2 overhead is the price of an
 * enforceable boundary and is reported honestly, not hidden.
 */
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CredentialBroker } from "../src/trust/credentials.ts";
import { AuthorityRegistry } from "../src/trust/authority.ts";
import { EnvironmentManager } from "../src/trust/environment/manager.ts";
import { TrustService } from "../src/trust/service.ts";
import { InProcessBackend } from "../src/trust/environment/in-process.ts";
import { RestrictedProcessBackend } from "../src/trust/environment/restricted-process.ts";
import { NamespaceSandboxBackend } from "../src/trust/environment/namespace.ts";
import { ContainerBackend } from "../src/trust/environment/container.ts";
import { shellTrustSpec } from "../src/trust/tool-support.ts";
import type { TrustRequest } from "../src/trust/types.ts";

function stats(samples: number[]): { min: number; median: number; p95: number; mean: number } {
  const s = [...samples].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { min: s[0], median: q(0.5), p95: q(0.95), mean: s.reduce((a, b) => a + b, 0) / s.length };
}

async function timeN(fn: () => Promise<unknown>, n: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn();
    out.push(performance.now() - t0);
  }
  return out;
}

async function main(): Promise<void> {
  const broker = new CredentialBroker();
  const registry = new AuthorityRegistry();
  const manager = new EnvironmentManager(
    [new InProcessBackend(), new RestrictedProcessBackend(), new NamespaceSandboxBackend(), new ContainerBackend()],
    broker,
  );
  const trust = new TrustService({ manager, registry, broker });
  await trust.onInit();

  console.log("XR 4.2 — Trust & Isolation performance");
  console.log("backends:", manager.listBackends().map((b) => `${b.placement}=${b.available ? "on" : "off"}`).join("  "));
  const W = mkdtempSync(join(tmpdir(), "xr-perf-"));
  const { request, executable } = shellTrustSpec("echo hi", W);

  // Tier 0: classify + decision only (in-process fast-path overhead).
  const t0req: TrustRequest = { ...request, spawnsProcess: false, runsArbitraryCode: false, fsPaths: [], reversible: true };
  const t0 = await timeN(async () => {
    await trust.evaluate({ request: t0req, runId: `ex_${Math.random()}`, correlationId: "c", workspaceId: "ws", actor: "user:perf", capability: "core_tool:read_file" });
  }, 200);

  // Tier 1: restricted-process echo.
  const t1req: TrustRequest = { ...request, runsArbitraryCode: false };
  const t1 = await timeN(async () => {
    await trust.evaluate({ request: t1req, runId: `ex_${Math.random()}`, correlationId: "c", workspaceId: "ws", actor: "user:perf", capability: "core_tool:shell", executable });
  }, 30);

  // Tier 2: namespace-sandbox echo.
  const t2 = await timeN(async () => {
    await trust.evaluate({ request, runId: `ex_${Math.random()}`, correlationId: "c", workspaceId: "ws", actor: "user:perf", capability: "core_tool:shell", executable });
  }, 30);

  const fmt = (s: ReturnType<typeof stats>) => `min ${s.min.toFixed(2)}ms · median ${s.median.toFixed(2)}ms · p95 ${s.p95.toFixed(2)}ms · mean ${s.mean.toFixed(2)}ms`;
  console.log("");
  console.log(`Tier 0 (classify+decision, fast path) n=${t0.length}: ${fmt(stats(t0))}`);
  console.log(`Tier 1 (restricted_process echo)      n=${t1.length}: ${fmt(stats(t1))}`);
  console.log(`Tier 2 (namespace_sandbox echo)       n=${t2.length}: ${fmt(stats(t2))}`);
  console.log("");
  console.log("Note: Tier-2 latency includes full sandbox startup+teardown per action");
  console.log("(ephemeral, no cross-action reuse). Tier-0 pays no sandbox cost.");
}

await main();
