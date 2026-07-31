/**
 * XR 6.0 — Phase 11 Tests: Sync Engine, Offline Service, Residency Policy
 */
import { describe, expect, test } from "bun:test";
import { SyncEngine, SyncError } from "../../src/enterprise/deployment/sync/engine.ts";
import type { SyncVersionedEntity } from "../../src/enterprise/deployment/sync/engine.ts";
import { OfflineService } from "../../src/enterprise/deployment/offline/service.ts";
import { buildCapsule } from "../../src/enterprise/deployment/capsule.ts";
import type { CapsuleBuildInput } from "../../src/enterprise/deployment/capsule.ts";
import { ResidencyPolicyEngine, defaultResidencyPolicy } from "../../src/enterprise/deployment/residency/policy.ts";
import type { TaskCapsule } from "../../src/enterprise/deployment/types.ts";

// ── Sync Engine Tests ──────────────────────────────────────────────────

describe("Sync Engine", () => {
  test("starts and stops cleanly", () => {
    const engine = new SyncEngine({
      config: {
        direction: "bidirectional",
        intervalMs: 60000,
        conflictResolution: "local_wins",
        maxBatchSize: 10,
        retryPolicy: { maxRetries: 3, backoffBaseMs: 1000, backoffMaxMs: 10000, jitterFactor: 0.1 },
      },
    });

    engine.start();
    expect(engine.getStatus().state).toBe("syncing");
    engine.stop();
    expect(engine.getStatus().state).toBe("idle");
  });

  test("queues local changes", () => {
    const engine = new SyncEngine({
      config: {
        direction: "local_to_remote",
        intervalMs: 60000,
        conflictResolution: "local_wins",
        maxBatchSize: 10,
        retryPolicy: { maxRetries: 3, backoffBaseMs: 1000, backoffMaxMs: 10000, jitterFactor: 0.1 },
      },
    });

    const entity: SyncVersionedEntity = {
      entityType: "task_capsule",
      entityId: "cap_001",
      version: 1,
      payload: {},
      modifiedAt: Date.now(),
      modifiedBy: "local",
    };

    const op = engine.queueLocalChange(entity);
    expect(op.operationId).toBeTruthy();
    expect(op.direction).toBe("local_to_remote");
    expect(op.entityType).toBe("task_capsule");
    expect(engine.getStatus().pendingOps).toBe(1);
  });

  test("goes offline and online", () => {
    const engine = new SyncEngine({
      config: {
        direction: "bidirectional",
        intervalMs: 60000,
        conflictResolution: "local_wins",
        maxBatchSize: 10,
        retryPolicy: { maxRetries: 3, backoffBaseMs: 1000, backoffMaxMs: 10000, jitterFactor: 0.1 },
      },
    });

    engine.goOffline();
    expect(engine.isOffline()).toBe(true);
    expect(engine.getStatus().state).toBe("offline");

    engine.goOnline();
    expect(engine.isOffline()).toBe(false);
  });

  test("detects conflicts for non-audit entities", () => {
    const engine = new SyncEngine({
      config: {
        direction: "bidirectional",
        intervalMs: 60000,
        conflictResolution: "local_wins",
        maxBatchSize: 10,
        retryPolicy: { maxRetries: 3, backoffBaseMs: 1000, backoffMaxMs: 10000, jitterFactor: 0.1 },
      },
    });

    const conflict = engine.detectConflict(
      "task_capsule", "cap_001", 2, 3, Date.now() - 1000, Date.now()
    );
    expect(conflict).not.toBeNull();
    expect(conflict!.entityType).toBe("task_capsule");
    expect(conflict!.localVersion).toBe(2);
    expect(conflict!.remoteVersion).toBe(3);
  });

  test("no conflict for audit records", () => {
    const engine = new SyncEngine({
      config: {
        direction: "bidirectional",
        intervalMs: 60000,
        conflictResolution: "local_wins",
        maxBatchSize: 10,
        retryPolicy: { maxRetries: 3, backoffBaseMs: 1000, backoffMaxMs: 10000, jitterFactor: 0.1 },
      },
    });

    const conflict = engine.detectConflict(
      "audit_record", "audit_001", 1, 2, Date.now() - 1000, Date.now()
    );
    expect(conflict).toBeNull(); // Audit records are append-only
  });

  test("no conflict when versions match", () => {
    const engine = new SyncEngine({
      config: {
        direction: "bidirectional",
        intervalMs: 60000,
        conflictResolution: "local_wins",
        maxBatchSize: 10,
        retryPolicy: { maxRetries: 3, backoffBaseMs: 1000, backoffMaxMs: 10000, jitterFactor: 0.1 },
      },
    });

    const conflict = engine.detectConflict(
      "task_capsule", "cap_001", 2, 2, Date.now(), Date.now()
    );
    expect(conflict).toBeNull();
  });
});

// ── Offline Service Tests ──────────────────────────────────────────────

function makeCapsuleForOffline(overrides: Partial<CapsuleBuildInput> = {}): TaskCapsule {
  return buildCapsule({
    executionId: { runId: "ex_1", workspaceId: "ws_1", attempt: 1, correlationId: "c1" },
    actor: { kind: "user", source: "cli" },
    intent: { summary: "Test", mode: "agent" },
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

describe("Offline Service", () => {
  test("starts online", () => {
    const service = new OfflineService({
      isConnected: () => true,
    });
    expect(service.isOffline()).toBe(false);
    expect(service.getStatus().isOffline).toBe(false);
  });

  test("goes offline and online", () => {
    const events: string[] = [];
    const service = new OfflineService({
      isConnected: () => false,
      onDisconnect: () => events.push("disconnect"),
      onReconnect: () => events.push("reconnect"),
    });

    service.goOffline();
    expect(service.isOffline()).toBe(true);
    expect(events).toContain("disconnect");

    service.goOnline();
    expect(service.isOffline()).toBe(false);
    expect(events).toContain("reconnect");
  });

  test("queues tasks and categorizes them", () => {
    const service = new OfflineService({ isConnected: () => true });

    const localCapsule = makeCapsuleForOffline({
      placement: { required: [], preferred: [], excluded: [], allowRemote: false, allowLocal: true },
    });
    const remoteCapsule = makeCapsuleForOffline({
      placement: { required: [], preferred: [], excluded: [], allowRemote: true, allowLocal: false },
    });

    service.queueTask(localCapsule, "Test local");
    service.queueTask(remoteCapsule, "Test remote");

    expect(service.getStatus().queuedTasks).toBe(2);
    expect(service.getLocallyEligibleTasks().length).toBe(1);
    expect(service.getRemoteOnlyTasks().length).toBe(1);
  });

  test("dequeues tasks", () => {
    const service = new OfflineService({ isConnected: () => true });
    const capsule = makeCapsuleForOffline();
    service.queueTask(capsule, "Test");

    expect(service.getStatus().queuedTasks).toBe(1);
    const removed = service.dequeueTask(capsule.executionId.runId);
    expect(removed).toBe(true);
    expect(service.getStatus().queuedTasks).toBe(0);
  });

  test("clears queue", () => {
    const service = new OfflineService({ isConnected: () => true });
    service.queueTask(makeCapsuleForOffline(), "Test 1");
    service.queueTask(makeCapsuleForOffline(), "Test 2");

    const cleared = service.clearQueue();
    expect(cleared).toBe(2);
    expect(service.getStatus().queuedTasks).toBe(0);
  });

  test("priority ordering is correct", () => {
    const service = new OfflineService({ isConnected: () => true });

    const normal = makeCapsuleForOffline({ intent: { summary: "Normal", mode: "agent" } });
    const high = makeCapsuleForOffline({ intent: { summary: "High", mode: "business" } });
    const low = makeCapsuleForOffline({ intent: { summary: "Low", mode: "research" } });

    service.queueTask(normal, "Normal");
    service.queueTask(high, "High");
    service.queueTask(low, "Low");

    const sorted = service.getQueuedTasksSorted();
    expect(sorted[0].priority).toBe("high");
    expect(sorted[sorted.length - 1].priority).toBe("low");
  });

  test("preserves checkpoints and audit in offline status", () => {
    const service = new OfflineService({ isConnected: () => true });
    service.goOffline();
    const status = service.getStatus();
    expect(status.checkpointPreserved).toBe(true);
    expect(status.auditPreserved).toBe(true);
  });
});

// ── Residency Policy Tests ─────────────────────────────────────────────

describe("Residency Policy Engine", () => {
  test("default policy allows all regions", () => {
    const engine = new ResidencyPolicyEngine();
    const decision = engine.checkRegionAllowed("eu-west-1", "internal");
    expect(decision.allowed).toBe(true);
  });

  test("forbidden regions are blocked", () => {
    const policy = { ...defaultResidencyPolicy(), forbiddenRegions: ["restricted-zone"] };
    const engine = new ResidencyPolicyEngine(policy);

    const decision = engine.checkRegionAllowed("restricted-zone", "internal");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("forbidden");
  });

  test("restricted data requires explicit allowed regions", () => {
    const engine = new ResidencyPolicyEngine();
    const decision = engine.checkRegionAllowed("any-region", "restricted");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("explicit");
  });

  test("restricted data allowed when in explicit list", () => {
    const policy = { ...defaultResidencyPolicy(), allowedRegions: ["eu-west-1"] };
    const engine = new ResidencyPolicyEngine(policy);

    const decision = engine.checkRegionAllowed("eu-west-1", "restricted");
    expect(decision.allowed).toBe(true);
  });

  test("checkTransferAllowed for credentials", () => {
    const engine = new ResidencyPolicyEngine();
    const result = engine.checkTransferAllowed("credential");
    expect(result.allowed).toBe(false);
  });

  test("checkTransferAllowed for execution records", () => {
    const engine = new ResidencyPolicyEngine();
    const result = engine.checkTransferAllowed("execution_record");
    expect(result.allowed).toBe(true);
  });

  test("classification for unknown entity defaults to public", () => {
    const engine = new ResidencyPolicyEngine();
    expect(engine.getClassificationForEntityType("unknown_type")).toBe("public");
  });

  test("retention rules are correct", () => {
    const engine = new ResidencyPolicyEngine();
    const auditRule = engine.getRetentionRule("audit_record");
    expect(auditRule.retentionDays).toBe(365);
    expect(auditRule.deleteOnExpiry).toBe(false); // Audit never auto-deleted

    const checkpointRule = engine.getRetentionRule("checkpoint");
    expect(checkpointRule.retentionDays).toBe(7);
  });

  test("isRetentionExpired works", () => {
    const engine = new ResidencyPolicyEngine();
    // Checkpoint from 10 days ago should be expired (7 day retention)
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
    expect(engine.isRetentionExpired("checkpoint", tenDaysAgo)).toBe(true);

    // Checkpoint from 1 day ago should not be expired
    const oneDayAgo = Date.now() - 1 * 24 * 60 * 60 * 1000;
    expect(engine.isRetentionExpired("checkpoint", oneDayAgo)).toBe(false);
  });

  test("policy update cannot weaken classification", () => {
    const engine = new ResidencyPolicyEngine();
    // Try to weaken credential from restricted to public
    engine.updatePolicy({
      classificationRules: [{
        entityType: "credential",
        classification: "public",
        residencyRequirement: "any_allowed",
        transferAllowed: true,
      }],
    });
    // Should still be restricted (weakening blocked)
    expect(engine.getClassificationForEntityType("credential")).toBe("restricted");
  });

  test("policy update can add forbidden regions", () => {
    const engine = new ResidencyPolicyEngine();
    engine.updatePolicy({ forbiddenRegions: ["blocked-zone"] });
    const policy = engine.getPolicy();
    expect(policy.forbiddenRegions).toContain("blocked-zone");
  });
});
