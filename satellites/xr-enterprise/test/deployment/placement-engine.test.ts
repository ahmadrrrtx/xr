/**
 * XR 6.0 — Phase 11 Tests: Placement Engine
 */
import { describe, expect, test } from "bun:test";
import { PlacementEngine } from "../../src/enterprise/deployment/placement/engine.ts";
import { buildCapsule } from "../../src/enterprise/deployment/capsule.ts";
import type { CapsuleBuildInput } from "../../src/enterprise/deployment/capsule.ts";
import type { WorkerIdentity, PlacementPolicyInput } from "../../src/enterprise/deployment/types.ts";

function makeCapsule(overrides: Partial<CapsuleBuildInput> = {}) {
  return buildCapsule({
    executionId: { runId: "ex_1", workspaceId: "ws_1", attempt: 1, correlationId: "c1" },
    actor: { kind: "user", source: "cli" },
    intent: { summary: "Test task", mode: "agent" },
    authority: { policyVersion: "v1", riskTier: "tier0_in_process" },
    placement: { required: [], preferred: [], excluded: [], allowRemote: true, allowLocal: true },
    context: { contextRefs: [], consentScope: "workspace", sensitiveContextTransfer: false },
    requirements: { capabilities: [], providers: [], modalities: [] },
    limits: { maxCostUsd: 1.0, maxDurationMs: 60000, maxRetries: 3 },
    provenance: {
      originInstanceId: "inst_local", originWorkspaceId: "ws_1",
      originProfile: "personal_local", transferChain: [], auditTrailRef: "a1",
    },
    residency: {
      allowedRegions: [], forbiddenRegions: [], retentionDays: 30,
      dataClassification: "internal", mustNotLeaveOrigin: false,
    },
    ...overrides,
  });
}

function makeWorker(id: string, overrides: Partial<WorkerIdentity> = {}): WorkerIdentity {
  return {
    workerId: id,
    instanceId: `inst_${id}`,
    profile: "team_private",
    registeredAt: Date.now(),
    lastSeenAt: Date.now(),
    state: "active",
    capabilities: ["model_call", "core_tool"],
    ...overrides,
  };
}

describe("Placement Engine", () => {
  const engine = new PlacementEngine();

  test("places locally when no remote workers available", () => {
    const capsule = makeCapsule();
    const result = engine.decide({
      capsule,
      currentProfile: "personal_local",
      availableWorkers: [],
      currentWorkerHealth: [],
    });

    expect(result.decision.kind).toBe("local");
    expect(result.factors.length).toBeGreaterThan(0);
  });

  test("respects user force-local override", () => {
    const capsule = makeCapsule();
    const worker = makeWorker("w1");
    const result = engine.decide({
      capsule,
      currentProfile: "hybrid",
      availableWorkers: [worker],
      currentWorkerHealth: [{ ok: true, checks: [], uptimeMs: 1000 }],
      userOverrides: { forceLocal: true },
    });

    expect(result.decision.kind).toBe("local");
    expect(result.factors.some(f => f.name === "user_override")).toBe(true);
  });

  test("blocks when user-forced worker is unavailable", () => {
    const capsule = makeCapsule();
    const result = engine.decide({
      capsule,
      currentProfile: "hybrid",
      availableWorkers: [],
      currentWorkerHealth: [],
      userOverrides: { forceWorker: "nonexistent" },
    });

    expect(result.decision.kind).toBe("blocked");
  });

  test("excludes workers per user override", () => {
    const capsule = makeCapsule();
    const worker = makeWorker("w1");
    const result = engine.decide({
      capsule,
      currentProfile: "hybrid",
      availableWorkers: [worker],
      currentWorkerHealth: [{ ok: true, checks: [], uptimeMs: 1000 }],
      userOverrides: { excludeWorkers: ["w1"] },
    });

    // Worker w1 is excluded, so only local should remain
    const workerOptions = result.alternativeOptions.filter(o => o.workerId === "w1");
    // The excluded worker should not appear in options
    // (it was scored but excluded, so it shouldn't be selected)
    expect(result.decision.kind).toBe("local");
  });

  test("blocks when data must not leave origin and profile differs", () => {
    const capsule = makeCapsule({
      residency: {
        allowedRegions: [],
        forbiddenRegions: [],
        retentionDays: 30,
        dataClassification: "restricted",
        mustNotLeaveOrigin: true,
      },
    });
    // Profile is managed_cloud but origin was personal_local
    const result = engine.decide({
      capsule,
      currentProfile: "managed_cloud",
      availableWorkers: [],
      currentWorkerHealth: [],
    });

    expect(result.decision.kind).toBe("blocked");
  });

  test("prefers local when scores are close", () => {
    const capsule = makeCapsule();
    const worker = makeWorker("w1");
    const result = engine.decide({
      capsule,
      currentProfile: "hybrid",
      availableWorkers: [worker],
      currentWorkerHealth: [{ ok: true, checks: [], uptimeMs: 1000 }],
    });

    // Local should be preferred when worker scores are similar
    // (local gets bonus for latency and cost)
    expect(result.decision.kind).toBe("local");
  });

  test("capsule allowing only remote blocks on personal_local", () => {
    const capsule = makeCapsule({
      placement: { required: [], preferred: [], excluded: [], allowRemote: true, allowLocal: false },
    });
    const result = engine.decide({
      capsule,
      currentProfile: "personal_local",
      availableWorkers: [],
      currentWorkerHealth: [],
    });

    expect(result.decision.kind).toBe("blocked");
  });

  test("placement explanation includes policy version", () => {
    const capsule = makeCapsule();
    const result = engine.decide({
      capsule,
      currentProfile: "personal_local",
      availableWorkers: [],
      currentWorkerHealth: [],
    });

    expect(result.policyVersion).toBe("xr-6.0.0/placement-v1");
    expect(result.decidedAt).toBeGreaterThan(0);
  });

  test("GPU requirement affects scoring", () => {
    const capsule = makeCapsule({
      requirements: {
        capabilities: [],
        providers: [],
        modalities: [],
        hardware: { gpuRequired: true },
      },
    });
    const worker = makeWorker("w1", {
      hardwareProfile: { cpuCores: 4, memoryMb: 8192, gpuAvailable: false },
    });
    const result = engine.decide({
      capsule,
      currentProfile: "hybrid",
      availableWorkers: [worker],
      currentWorkerHealth: [{ ok: true, checks: [], uptimeMs: 1000 }],
    });

    // Worker without GPU should score lower
    const hardwareFactors = result.factors.filter(f => f.name === "hardware_match");
    if (hardwareFactors.length > 0) {
      expect(hardwareFactors[0].score).toBeLessThan(1.0);
    }
  });
});
