import { CredentialBroker } from "../../src/runtime/trust/credentials.ts";
import { AuthorityRegistry } from "../../src/runtime/trust/authority.ts";
import { EnvironmentManager } from "../../src/runtime/trust/environment/manager.ts";
import { TrustService } from "../../src/runtime/trust/service.ts";
import { InProcessBackend } from "../../src/runtime/trust/environment/in-process.ts";
import { RestrictedProcessBackend } from "../../src/runtime/trust/environment/restricted-process.ts";
import { NamespaceSandboxBackend } from "../../src/runtime/trust/environment/namespace.ts";
import { ContainerBackend } from "../../src/runtime/trust/environment/container.ts";
import type { EnvironmentBackend } from "../../src/runtime/trust/environment/backend.ts";
import type { AuthorityGrant } from "../../src/runtime/trust/types.ts";

export interface TrustHarness {
  trust: TrustService;
  manager: EnvironmentManager;
  broker: CredentialBroker;
  registry: AuthorityRegistry;
}

/** Build a TrustService over a chosen backend set. Call init() before use. */
export function makeTrust(backends?: EnvironmentBackend[]): TrustHarness {
  const broker = new CredentialBroker();
  const registry = new AuthorityRegistry();
  const manager = new EnvironmentManager(
    backends ?? [new InProcessBackend(), new RestrictedProcessBackend(), new NamespaceSandboxBackend(), new ContainerBackend()],
    broker,
  );
  const trust = new TrustService({ manager, registry, broker });
  return { trust, manager, broker, registry };
}

/** Convenience: a trust harness with NO Tier-2 backend (to test fail-closed). */
export function makeTrustNoSandbox(): TrustHarness {
  return makeTrust([new InProcessBackend(), new RestrictedProcessBackend()]);
}

/** Build a fully-populated AuthorityGrant for unit tests. */
export function makeGrant(over: Partial<AuthorityGrant> = {}): AuthorityGrant {
  const now = Date.now();
  return {
    grantId: "grant_test",
    actor: "user:test",
    executionId: "ex_test",
    correlationId: "ex_test",
    workspaceId: "ws",
    capability: "core_tool:shell",
    tier: "tier2_isolated",
    fs: { writableRoots: ["/tmp/ws"], readOnlyRoots: [], blockedPaths: [], ephemeralScratch: true },
    net: { mode: "none", allowlist: [], blockPrivateNetworks: true, blockOffAllowlistRedirects: true },
    proc: { allowedExecutables: [], allowSpawn: true, maxProcesses: 64, stripAmbientEnv: true },
    resources: { wallClockMs: 60000, maxOutputBytes: 100000, cpuSeconds: 60, memoryBytes: 256 * 1024 * 1024 },
    credentials: { mode: "none", refs: [], envNames: [] },
    issuedAt: now,
    expiresAt: now + 60000,
    policyVersion: "test",
    revoked: false,
    ...over,
  };
}
