/**
 * XR 6.0 — Phase 11 Tests: Security, Identity, and Backup
 */
import { describe, expect, test } from "bun:test";
import { IdentityService } from "../../src/deployment/identity/service.ts";
import { BackupService } from "../../src/deployment/backup/service.ts";
import { buildCapsule, verifyCapsuleIntegrity, deserializeCapsule, serializeCapsule } from "../../src/deployment/capsule.ts";
import type { CapsuleBuildInput } from "../../src/deployment/capsule.ts";

// ── Identity Service Tests ─────────────────────────────────────────────

describe("Identity Service", () => {
  test("issues and verifies identity", () => {
    const service = new IdentityService();
    const identity = service.issueIdentity({
      kind: "user",
      workspaceIds: ["ws_1"],
      scopes: ["execute", "read"],
    });

    expect(identity.identityId).toBeTruthy();
    expect(identity.revoked).toBe(false);
    expect(identity.expiresAt).toBeGreaterThan(Date.now());

    const result = service.verifyIdentity(identity.identityId);
    expect(result.valid).toBe(true);
    expect(result.identity?.kind).toBe("user");
  });

  test("expired identity fails verification", () => {
    const service = new IdentityService({ defaultTokenTtlMs: -1 });
    const identity = service.issueIdentity({
      kind: "user",
      workspaceIds: ["ws_1"],
      scopes: ["execute"],
    });

    const result = service.verifyIdentity(identity.identityId);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("expired");
  });

  test("revoked identity fails verification", () => {
    const service = new IdentityService();
    const identity = service.issueIdentity({
      kind: "worker",
      workspaceIds: ["ws_1"],
      scopes: ["execute"],
    });

    service.revokeIdentity(identity.identityId, "Security incident");
    const result = service.verifyIdentity(identity.identityId);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("revoked");
  });

  test("scope checking works", () => {
    const service = new IdentityService();
    const identity = service.issueIdentity({
      kind: "user",
      workspaceIds: ["ws_1"],
      scopes: ["execute", "read"],
    });

    expect(service.hasScope(identity.identityId, "execute")).toBe(true);
    expect(service.hasScope(identity.identityId, "admin")).toBe(false);
  });

  test("workspace access checking works", () => {
    const service = new IdentityService();
    const identity = service.issueIdentity({
      kind: "user",
      workspaceIds: ["ws_1", "ws_2"],
      scopes: ["execute"],
    });

    expect(service.hasWorkspaceAccess(identity.identityId, "ws_1")).toBe(true);
    expect(service.hasWorkspaceAccess(identity.identityId, "ws_3")).toBe(false);
  });

  test("revokeAllForWorkspace revokes all identities", () => {
    const service = new IdentityService();
    service.issueIdentity({ kind: "user", workspaceIds: ["ws_1"], scopes: ["execute"] });
    service.issueIdentity({ kind: "worker", workspaceIds: ["ws_1"], scopes: ["execute"] });
    service.issueIdentity({ kind: "user", workspaceIds: ["ws_2"], scopes: ["execute"] });

    const count = service.revokeAllForWorkspace("ws_1", "Workspace cleanup");
    expect(count).toBe(2);
    expect(service.getActiveIdentityCount()).toBe(1);
  });

  test("registers organization", () => {
    const service = new IdentityService();
    const org = service.registerOrganization({
      name: "Test Corp",
      plan: "team",
      maxWorkspaces: 20,
      dataResidencyRegion: "eu-west-1",
    });

    expect(org.organizationId).toBeTruthy();
    expect(org.name).toBe("Test Corp");
    expect(org.plan).toBe("team");
    expect(service.getOrganizationCount()).toBe(1);
  });

  test("tenant boundary defines isolation", () => {
    const service = new IdentityService();
    service.defineTenantBoundary({
      organizationId: "org_1",
      workspaceId: "ws_1",
      isolationLevel: "separate_db",
      dataBoundary: "workspace",
    });

    const boundary = service.getTenantBoundary("org_1", "ws_1");
    expect(boundary).toBeDefined();
    expect(boundary!.isolationLevel).toBe("separate_db");
  });

  test("workspace isolation check", () => {
    const service = new IdentityService();
    service.defineTenantBoundary({
      organizationId: "org_1",
      workspaceId: "ws_1",
      isolationLevel: "shared_db_separate_tables",
      dataBoundary: "workspace",
    });
    service.defineTenantBoundary({
      organizationId: "org_1",
      workspaceId: "ws_2",
      isolationLevel: "shared_db_separate_tables",
      dataBoundary: "workspace",
    });

    // Same org, different workspaces — isolated
    expect(service.areWorkspacesIsolated("org_1", "ws_1", "org_1", "ws_2")).toBe(true);
    // Different orgs — always isolated
    expect(service.areWorkspacesIsolated("org_1", "ws_1", "org_2", "ws_1")).toBe(true);
  });

  test("cleanup removes expired identities", () => {
    const service = new IdentityService({ defaultTokenTtlMs: -1 });
    service.issueIdentity({ kind: "user", workspaceIds: ["ws_1"], scopes: [] });
    service.issueIdentity({ kind: "user", workspaceIds: ["ws_1"], scopes: [] });

    const removed = service.cleanupExpired();
    expect(removed).toBe(2);
  });
});

// ── Backup Service Tests ───────────────────────────────────────────────

describe("Backup Service", () => {
  test("creates a backup", async () => {
    const service = new BackupService({
      backupRoot: "/tmp/xr-backup",
      profile: "personal_local",
    });

    const result = await service.createBackup({ label: "test-backup" });
    expect(result.ok).toBe(true);
    expect(result.backupId).toBeTruthy();
    expect(result.manifest).toBeDefined();
    expect(result.manifest!.profile).toBe("personal_local");
  });

  test("lists backups", async () => {
    const service = new BackupService({
      backupRoot: "/tmp/xr-backup",
      profile: "personal_local",
    });

    await service.createBackup({ label: "b1" });
    await service.createBackup({ label: "b2" });

    const backups = service.listBackups();
    expect(backups.length).toBe(2);
  });

  test("deletes a backup", async () => {
    const service = new BackupService({
      backupRoot: "/tmp/xr-backup",
      profile: "personal_local",
    });

    const result = await service.createBackup({ label: "to-delete" });
    expect(service.deleteBackup(result.backupId!)).toBe(true);
    expect(service.listBackups().length).toBe(0);
  });

  test("restores from backup with pre-restore safety", async () => {
    const service = new BackupService({
      backupRoot: "/tmp/xr-backup",
      profile: "personal_local",
    });

    const backup = await service.createBackup({ label: "to-restore" });
    const result = await service.restore(backup.backupId!);
    expect(result.ok).toBe(true);
    // Pre-restore backup should have been created
    expect(service.listBackups().length).toBe(2);
  });

  test("restore fails for unknown backup", async () => {
    const service = new BackupService({
      backupRoot: "/tmp/xr-backup",
      profile: "personal_local",
    });

    const result = await service.restore("unknown_backup_id");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  test("cleanup retains specified number", async () => {
    const service = new BackupService({
      backupRoot: "/tmp/xr-backup",
      profile: "personal_local",
    });

    await service.createBackup({ label: "b1" });
    await service.createBackup({ label: "b2" });
    await service.createBackup({ label: "b3" });
    await service.createBackup({ label: "b4" });

    const removed = service.cleanupOldBackups(2);
    expect(removed).toBe(2);
    expect(service.listBackups().length).toBe(2);
  });
});

// ── Security Integration Tests ─────────────────────────────────────────

describe("Security: Capsule Tampering Prevention", () => {
  function makeValidInput(): CapsuleBuildInput {
    return {
      executionId: { runId: "ex_1", workspaceId: "ws_1", attempt: 1, correlationId: "c1" },
      actor: { kind: "user", source: "cli" },
      intent: { summary: "Secure task", mode: "agent" },
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
    };
  }

  test("capsule integrity prevents tampering with intent", () => {
    const capsule = buildCapsule(makeValidInput());
    const tampered = { ...capsule, intent: { ...capsule.intent, summary: "HACKED" } };
    expect(verifyCapsuleIntegrity(tampered)).toBe(false);
  });

  test("capsule integrity prevents tampering with authority", () => {
    const capsule = buildCapsule(makeValidInput());
    const tampered = { ...capsule, authority: { ...capsule.authority, riskTier: "tier2_isolated" as const } };
    // Tampering with any field changes hash
    expect(verifyCapsuleIntegrity(tampered as any)).toBe(false);
  });

  test("capsule integrity prevents tampering with residency", () => {
    const capsule = buildCapsule(makeValidInput());
    const tampered = {
      ...capsule,
      residency: { ...capsule.residency, dataClassification: "public" as const },
    };
    expect(verifyCapsuleIntegrity(tampered)).toBe(false);
  });

  test("capsule integrity prevents tampering with actor identity", () => {
    const capsule = buildCapsule(makeValidInput());
    const tampered = {
      ...capsule,
      actor: { kind: "system" as const, component: "evil" },
    };
    expect(verifyCapsuleIntegrity(tampered as any)).toBe(false);
  });

  test("deserialize rejects tampered capsules", () => {
    const capsule = buildCapsule(makeValidInput());
    const json = serializeCapsule(capsule);
    const parsed = JSON.parse(json);
    parsed.residency.dataClassification = "public";
    expect(() => deserializeCapsule(JSON.stringify(parsed))).toThrow();
  });

  test("capsule does not contain raw secrets", () => {
    const capsule = buildCapsule(makeValidInput());
    const json = serializeCapsule(capsule);
    // Should not contain any secret-like patterns
    expect(json).not.toContain("password");
    expect(json).not.toContain("secret_key");
    expect(json).not.toContain("api_key");
    expect(json).not.toContain("token_value");
  });

  test("control plane redaction hides context details", () => {
    const { redactCapsuleForControlPlane } = require("../../src/deployment/capsule.ts");
    const capsule = buildCapsule({
      ...makeValidInput(),
      context: {
        contextRefs: [
          { kind: "memory", refId: "secret_memory", scope: "private", trustLevel: "trusted" },
        ],
        consentScope: "workspace",
        sensitiveContextTransfer: true,
      },
    });
    const redacted = redactCapsuleForControlPlane(capsule);
    const ctx = redacted.context as Record<string, unknown>;
    // Should not contain the actual ref IDs
    expect(JSON.stringify(ctx)).not.toContain("secret_memory");
    // Should contain count instead
    expect(ctx.contextRefCount).toBe(1);
  });
});
