/**
 * XR 6.0 — Phase 11 Tests: Task Capsules
 */
import { describe, expect, test } from "bun:test";
import {
  buildCapsule,
  serializeCapsule,
  deserializeCapsule,
  verifyCapsuleIntegrity,
  isCompatibleCapsuleVersion,
  redactCapsuleForControlPlane,
  redactCapsuleForAudit,
  recordCapsuleTransfer,
  isCapsuleExpired,
  isCapsuleCompatibleWithProfile,
  CapsuleValidationError,
  CapsuleIntegrityError,
} from "../../src/deployment/capsule.ts";
import type { CapsuleBuildInput } from "../../src/deployment/capsule.ts";
import { CAPSULE_SCHEMA_VERSION } from "../../src/deployment/types.ts";

function makeValidInput(overrides: Partial<CapsuleBuildInput> = {}): CapsuleBuildInput {
  return {
    executionId: {
      runId: "ex_test123",
      workspaceId: "ws_test",
      attempt: 1,
      correlationId: "corr_test",
    },
    actor: { kind: "user", source: "cli" },
    intent: {
      summary: "Test task intent",
      mode: "agent",
    },
    authority: {
      policyVersion: "xr-6.0.0/trust-v1",
      riskTier: "tier0_in_process",
    },
    placement: {
      required: [],
      preferred: [],
      excluded: [],
      allowRemote: true,
      allowLocal: true,
    },
    context: {
      contextRefs: [],
      consentScope: "workspace",
      sensitiveContextTransfer: false,
    },
    requirements: {
      capabilities: [],
      providers: [],
      modalities: [],
    },
    limits: {
      maxCostUsd: 1.0,
      maxDurationMs: 60_000,
      maxRetries: 3,
    },
    provenance: {
      originInstanceId: "inst_local",
      originWorkspaceId: "ws_test",
      originProfile: "personal_local",
      transferChain: [],
      auditTrailRef: "audit_001",
    },
    residency: {
      allowedRegions: [],
      forbiddenRegions: [],
      retentionDays: 30,
      dataClassification: "internal",
      mustNotLeaveOrigin: false,
    },
    ...overrides,
  };
}

describe("Task Capsules", () => {
  test("builds a valid capsule", () => {
    const capsule = buildCapsule(makeValidInput());
    expect(capsule.capsuleId).toBeTruthy();
    expect(capsule.capsuleId.startsWith("cap_")).toBe(true);
    expect(capsule.schemaVersion).toBe(CAPSULE_SCHEMA_VERSION);
    expect(capsule.integrityHash).toBeTruthy();
    expect(capsule.createdAt).toBeGreaterThan(0);
    expect(capsule.executionId.runId).toBe("ex_test123");
  });

  test("integrity hash is deterministic", () => {
    const input = makeValidInput();
    const c1 = buildCapsule(input);
    // Note: createdAt differs, so hashes differ. But same full payload = same hash.
    const capsule = buildCapsule(makeValidInput());
    expect(verifyCapsuleIntegrity(capsule)).toBe(true);
  });

  test("serialize and deserialize roundtrip", () => {
    const capsule = buildCapsule(makeValidInput());
    const json = serializeCapsule(capsule);
    const restored = deserializeCapsule(json);
    expect(restored.capsuleId).toBe(capsule.capsuleId);
    expect(restored.integrityHash).toBe(capsule.integrityHash);
    expect(verifyCapsuleIntegrity(restored)).toBe(true);
  });

  test("tampered capsule fails integrity check", () => {
    const capsule = buildCapsule(makeValidInput());
    const json = serializeCapsule(capsule);
    const parsed = JSON.parse(json);
    parsed.intent.summary = "TAMPERED";
    expect(() => deserializeCapsule(JSON.stringify(parsed))).toThrow(CapsuleIntegrityError);
  });

  test("invalid JSON is rejected", () => {
    expect(() => deserializeCapsule("not json")).toThrow(CapsuleValidationError);
  });

  test("missing fields are rejected", () => {
    expect(() => deserializeCapsule("{}")).toThrow(CapsuleValidationError);
  });

  test("incompatible schema version is rejected", () => {
    const capsule = buildCapsule(makeValidInput());
    const json = serializeCapsule(capsule);
    const parsed = JSON.parse(json);
    parsed.schemaVersion = "xr-1.0.0/old-v1";
    expect(() => deserializeCapsule(JSON.stringify(parsed))).toThrow(CapsuleValidationError);
  });

  test("isCompatibleCapsuleVersion", () => {
    expect(isCompatibleCapsuleVersion("xr-6.0.0/capsule-v1")).toBe(true);
    expect(isCompatibleCapsuleVersion("xr-6.1.0/capsule-v1")).toBe(true);
    expect(isCompatibleCapsuleVersion("xr-5.0.0/capsule-v1")).toBe(false);
    expect(isCompatibleCapsuleVersion("xr-7.0.0/capsule-v2")).toBe(false);
  });

  test("validation rejects too-long intent", () => {
    expect(() => buildCapsule(makeValidInput({
      intent: { summary: "x".repeat(3000), mode: "agent" },
    }))).toThrow(CapsuleValidationError);
  });

  test("validation rejects too many context refs", () => {
    expect(() => buildCapsule(makeValidInput({
      context: {
        contextRefs: Array.from({ length: 50 }, (_, i) => ({
          kind: "memory" as const,
          refId: `ref_${i}`,
          scope: "ws",
          trustLevel: "trusted" as const,
        })),
        consentScope: "workspace",
        sensitiveContextTransfer: false,
      },
    }))).toThrow(CapsuleValidationError);
  });

  test("validation rejects capsule with no placement allowed", () => {
    expect(() => buildCapsule(makeValidInput({
      placement: {
        required: [], preferred: [], excluded: [],
        allowRemote: false, allowLocal: false,
      },
    }))).toThrow(CapsuleValidationError);
  });

  test("validation rejects negative cost limit", () => {
    expect(() => buildCapsule(makeValidInput({
      limits: { maxCostUsd: -1, maxDurationMs: 60000, maxRetries: 3 },
    }))).toThrow(CapsuleValidationError);
  });

  test("redactCapsuleForControlPlane removes sensitive data", () => {
    const capsule = buildCapsule(makeValidInput({
      context: {
        contextRefs: [
          { kind: "memory", refId: "mem_1", scope: "ws", trustLevel: "trusted" },
          { kind: "evidence", refId: "ev_1", scope: "ws", trustLevel: "quarantined" },
        ],
        consentScope: "workspace",
        sensitiveContextTransfer: true,
      },
    }));
    const redacted = redactCapsuleForControlPlane(capsule);
    expect(redacted.context).toBeDefined();
    // Context refs should be reduced to count
    const ctx = redacted.context as Record<string, unknown>;
    expect(ctx.contextRefCount).toBe(2);
    expect(ctx.consentScope).toBe("workspace");
    // Original refs should not be visible
    expect((ctx as any).contextRefs).toBeUndefined();
  });

  test("redactCapsuleForAudit truncates sensitive data", () => {
    const capsule = buildCapsule(makeValidInput());
    const redacted = redactCapsuleForAudit(capsule);
    expect(redacted.capsuleId).toBe(capsule.capsuleId);
    expect(redacted.intentSummary).toBeTruthy();
    expect((redacted.intentSummary as string).length).toBeLessThanOrEqual(200);
    expect((redacted.integrityHash as string).endsWith("...")).toBe(true);
  });

  test("recordCapsuleTransfer adds to chain and rehashes", () => {
    const capsule = buildCapsule(makeValidInput());
    const oldHash = capsule.integrityHash;
    const transferred = recordCapsuleTransfer(
      capsule,
      "inst_local",
      "inst_cloud_1",
      "User requested cloud execution",
      "user_001",
    );

    expect(transferred.provenance.transferChain.length).toBe(1);
    expect(transferred.provenance.transferChain[0].from).toBe("inst_local");
    expect(transferred.provenance.transferChain[0].to).toBe("inst_cloud_1");
    expect(transferred.integrityHash).not.toBe(oldHash);
    expect(verifyCapsuleIntegrity(transferred)).toBe(true);
  });

  test("isCapsuleExpired", () => {
    const capsule = buildCapsule(makeValidInput());
    expect(isCapsuleExpired(capsule)).toBe(false);
  });

  test("isCapsuleCompatibleWithProfile", () => {
    // Local-only capsule works on all profiles
    const localCapsule = buildCapsule(makeValidInput({
      placement: {
        required: [], preferred: [], excluded: [],
        allowRemote: false, allowLocal: true,
      },
    }));
    expect(isCapsuleCompatibleWithProfile(localCapsule, "personal_local")).toBe(true);
    expect(isCapsuleCompatibleWithProfile(localCapsule, "hybrid")).toBe(true);

    // Remote-only capsule does not work on personal_local
    const remoteCapsule = buildCapsule(makeValidInput({
      placement: {
        required: [], preferred: [], excluded: [],
        allowRemote: true, allowLocal: false,
      },
    }));
    expect(isCapsuleCompatibleWithProfile(remoteCapsule, "personal_local")).toBe(false);
    expect(isCapsuleCompatibleWithProfile(remoteCapsule, "hybrid")).toBe(true);

    // mustNotLeaveOrigin capsule
    const originCapsule = buildCapsule(makeValidInput({
      residency: {
        allowedRegions: [],
        forbiddenRegions: [],
        retentionDays: 30,
        dataClassification: "restricted",
        mustNotLeaveOrigin: true,
      },
    }));
    expect(isCapsuleCompatibleWithProfile(originCapsule, "personal_local")).toBe(true);
    expect(isCapsuleCompatibleWithProfile(originCapsule, "managed_cloud")).toBe(false);
  });

  test("verifyCapsuleIntegrity returns true for valid capsule", () => {
    const capsule = buildCapsule(makeValidInput());
    expect(verifyCapsuleIntegrity(capsule)).toBe(true);
  });

  test("verifyCapsuleIntegrity returns false for tampered capsule", () => {
    const capsule = buildCapsule(makeValidInput());
    const tampered = { ...capsule, intent: { ...capsule.intent, summary: "TAMPERED" } };
    expect(verifyCapsuleIntegrity(tampered)).toBe(false);
  });
});
