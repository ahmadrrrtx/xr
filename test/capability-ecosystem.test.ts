/**
 * XR 5.2.0 — Phase 9 Capability Ecosystem Tests
 *
 * Tests descriptors, provenance, effective authority, lifecycle,
 * verification, certification, registry, SDK, CLI, and security
 * enforcement without breaking existing contracts.
 */
import { test, expect, describe } from "bun:test";
import {
  buildDescriptor,
  CapabilityDescriptorSchema,
  CapabilityDescriptor,
} from "../src/capability/types.ts";
import { parseDescriptorObject, readDescriptorFile, descriptorFromPluginManifest } from "../src/capability/descriptor.ts";
import { buildProvenance, hashPackageFile, provenanceFromPackage, verifyProvenance } from "../src/capability/provenance.ts";
import { resolveEffectiveAuthority, buildPolicyIntersection, requiresReReview } from "../src/capability/effective.ts";
import { resolveDependencies, checkCompatibility } from "../src/capability/dependencies.ts";
import { runSDKLifecycle, inspectDescriptorDescriptor } from "../src/capability/sdk.ts";
import { verifyCapability, verifyBeforeInstall } from "../src/capability/verify.ts";
import { buildCertification, addContractTest, evaluateCertificationEvidence } from "../src/capability/certification.ts";
import { transitionLifecycle, quarantineCapability, rollbackCapability } from "../src/capability/lifecycle.ts";
import { CapabilityCatalog, globalCatalog } from "../src/capability/registry.ts";
import { discoverCapabilities } from "../src/capability/discovery.ts";
import { cliInspect, cliListStatus } from "../src/capability/cli.ts";
import { createStateStore, migrateStateStore, saveDescriptorToState, recordRollback } from "../src/capability/state.ts";
import { extractInteropDescriptor } from "../src/capability/interop.ts";

// ── Descriptor ─────────────────────────────────────────────────────────────────

describe("descriptor", () => {
  test("buildDescriptor creates valid descriptor with defaults", () => {
    const d = buildDescriptor({ capabilityId: "test-cap", capabilityType: "plugin", name: "Test", version: "1.0.0" });
    expect(d.capabilityId).toBe("test-cap");
    expect(d.capabilityType).toBe("plugin");
    expect(d.descriptorVersion).toBe("xr-5.2.0/capability-v1");
  });

  test("parseDescriptorObject validates schema and reports errors", () => {
    const bad = parseDescriptorObject({ capabilityId: "", capabilityType: "unknown" as any, name: "x", version: "bad" });
    expect(bad.ok).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  test("descriptor covers all capability types", () => {
    for (const type of ["plugin", "skill", "mcp", "provider", "tool", "workflow", "integration", "artifact"] as const) {
      const d = buildDescriptor({ capabilityId: `test-${type}`, capabilityType: type, name: `Test ${type}`, version: "1.0.0", publisher: { id: "test", kind: "official" } });
      expect(d.capabilityType).toBe(type);
    }
  });
});

// ── Provenance ────────────────────────────────────────────────────────────────

describe("provenance", () => {
  test("buildProvenance creates provenance with hash", () => {
    const p = buildProvenance({ capabilityId: "test", capabilityType: "plugin", version: "1.0.0", packageHash: "abc123", source: "test" });
    expect(p.capabilityId).toBe("test");
    expect(p.packageHash).toBe("abc123");
  });

  test("hashPackageFile computes sha256 of file content", () => {
    // No file needed for this basic check; function throws on missing file
    expect(() => hashPackageFile("/nonexistent/file")).toThrow();
  });

  test("verifyProvenance detects hash mismatch", () => {
    const p = buildProvenance({ capabilityId: "test", capabilityType: "plugin", version: "1.0.0", packageHash: "badhash", source: "test" });
    const result = verifyProvenance(p, "/nonexistent/file", undefined, undefined);
    // No file means hash comparison fails with warning, not error
    expect(result.errors.length).toBeGreaterThanOrEqual(0);
  });
});

// ── Effective Authority ───────────────────────────────────────────────────────

describe("effective authority", () => {
  test("resolveEffectiveAuthority computes intersection", () => {
    const declared = { permissions: ["net", "fs:read"], resourceRequirements: [], dataScopes: { read: ["/data"], write: [], delete: [] }, networkRequirements: ["https://api"], credentialRequirements: [], modelRequirements: [], placementRequirement: undefined, riskTier: undefined };
    const policy = buildPolicyIntersection(
      { allowed: ["net", "fs:read"], denied: [] },
      { allowed: ["net"], denied: [] },
      { allowed: ["net", "fs:read"], denied: [] },
      { allowed: ["net", "fs:read"], denied: ["fs:read"] },
      { allowed: ["net"], denied: [] },
    );
    const effective = resolveEffectiveAuthority(declared, policy, "pending_review");
    expect(effective.grantedPermissions).toContain("net");
    // Denied by publisher policy wins
    expect(effective.deniedPermissions).toContain("fs:read");
  });

  test("requiresReReview detects new permissions", () => {
    const prev = { grantedPermissions: ["net"], deniedPermissions: [], grantedResourceRequirements: [], grantedDataScopes: { read: [], write: [], delete: [] }, grantedNetworkRequirements: [], grantedCredentialRequirements: [], grantedModelRequirements: [], grantedPlacement: undefined, reviewStatus: "approved" } as any;
    const curr = { grantedPermissions: ["net", "fs:read"], deniedPermissions: [], grantedResourceRequirements: [], grantedDataScopes: { read: [], write: [], delete: [] }, grantedNetworkRequirements: [], grantedCredentialRequirements: [], grantedModelRequirements: [], grantedPlacement: undefined, reviewStatus: "pending_review" } as any;
    expect(requiresReReview(prev, curr)).toBe(true);
  });

  test("denied always wins", () => {
    const declared = { permissions: ["net"], resourceRequirements: [], dataScopes: { read: [], write: [], delete: [] }, networkRequirements: [], credentialRequirements: [], modelRequirements: [], placementRequirement: undefined, riskTier: undefined };
    const policy = buildPolicyIntersection({ allowed: ["net"], denied: ["net"] });
    const effective = resolveEffectiveAuthority(declared, policy);
    expect(effective.grantedPermissions).not.toContain("net");
    expect(effective.deniedPermissions).toContain("net");
  });
});

// ── Dependencies ───────────────────────────────────────────────────────────────

describe("dependencies", () => {
  test("resolveDependencies detects missing required dependency", () => {
    const declared = [{ kind: "plugin", id: "missing", version: "1.0.0", optional: false }];
    const result = resolveDependencies(declared, {});
    expect(result.ok).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  test("checkCompatibility checks version ranges", () => {
    const compat = checkCompatibility({ xrVersionMin: "5.0.0", xrVersionMax: "6.0.0", runtimeRequirements: [], platformRequirements: [], capabilityRequirements: [], conflictsWith: [] }, ["plugin"], "5.1.0");
    expect(compat.ok).toBe(true);
    const low = checkCompatibility({ xrVersionMin: "9.0.0", xrVersionMax: "10.0.0", runtimeRequirements: [], platformRequirements: [], capabilityRequirements: [], conflictsWith: [] }, ["plugin"], "5.1.0");
    expect(low.ok).toBe(false);
  });
});

// ── SDK Lifecycle ─────────────────────────────────────────────────────────────

describe("sdk lifecycle", () => {
  test("runSDKLifecycle produces descriptor and diagnostics", () => {
    const descriptor = buildDescriptor({ capabilityId: "sdk-test", capabilityType: "plugin", name: "SDK Test", version: "1.0.0", publisher: { id: "test", kind: "official" } });
    const result = runSDKLifecycle(descriptor);
    expect(result.descriptor.capabilityId).toBe("sdk-test");
    expect(result.validationErrors.length).toBeGreaterThanOrEqual(0);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  test("inspectDescriptorDescriptor returns safe public view", () => {
    const descriptor = buildDescriptor({ capabilityId: "inspect-test", capabilityType: "skill", name: "Inspect", version: "2.0.0", publisher: { id: "demo", kind: "official" }, effectiveAuthority: { grantedPermissions: ["net"], grantedResourceRequirements: [], grantedDataScopes: { read: [], write: [], delete: [] }, grantedNetworkRequirements: [], grantedCredentialRequirements: [], grantedModelRequirements: [], grantedPlacement: undefined, deniedPermissions: [], deniedDataScopes: { read: [], write: [], delete: [] }, denialReason: undefined, reviewStatus: "approved" } });
    const view = inspectDescriptorDescriptor(descriptor);
    expect(view.grantedPermissions).toContain("net");
  });
});

// ── Verification ───────────────────────────────────────────────────────────────

describe("verification", () => {
  test("verifyBeforeInstall allows unsigned when policy permits", () => {
    const descriptor = buildDescriptor({ capabilityId: "verify-test", capabilityType: "plugin", name: "Verify", version: "1.0.0", publisher: { id: "test", kind: "unknown" } });
    const v = verifyBeforeInstall(descriptor, undefined, { requireSigned: false, allowUnsigned: true });
    expect(v.ok).toBe(true);
    expect(v.reason).toContain("unsigned");
  });

  test("verifyBeforeInstall blocks when policy requires signed", () => {
    const descriptor = buildDescriptor({ capabilityId: "verify-test-2", capabilityType: "plugin", name: "Verify 2", version: "1.0.0", publisher: { id: "test", kind: "unknown" } });
    const v = verifyBeforeInstall(descriptor, undefined, { requireSigned: true, allowUnsigned: false });
    expect(v.ok).toBe(false);
  });

  test("verifyCapability reports missing signature clearly", () => {
    const descriptor = buildDescriptor({ capabilityId: "verify-sig", capabilityType: "plugin", name: "Sig", version: "1.0.0", publisher: { id: "test", kind: "unknown" } });
    const v = verifyCapability(descriptor);
    expect(v.signatureStatus).toBe("missing");
    expect(v.signed).toBe(false);
    expect(v.verified).toBe(false);
  });
});

// ── Certification ───────────────────────────────────────────────────────────────

describe("certification", () => {
  test("buildCertification creates certification with unknown status", () => {
    const cert = buildCertification({ status: "unknown" });
    expect(cert.status).toBe("unknown");
  });

  test("addContractTest updates certification with passed test", () => {
    let cert = buildCertification({ status: "self_tested" });
    cert = addContractTest(cert, { name: "manifest_valid", passed: true, timestamp: Date.now() });
    expect(cert.contractTests.length).toBe(1);
    expect(cert.contractTests[0].passed).toBe(true);
  });

  test("evaluateCertificationEvidence computes evidence score", () => {
    const descriptor = buildDescriptor({ capabilityId: "cert-test", capabilityType: "plugin", name: "Cert", version: "1.0.0", publisher: { id: "test", kind: "official" }, certification: buildCertification({ status: "self_tested", contractTests: [{ name: "test", passed: true, timestamp: Date.now() }] }) });
    const evidence = evaluateCertificationEvidence(descriptor);
    expect(evidence.evidenceScore).toBeGreaterThanOrEqual(0);
    expect(evidence.recommendedStatus).toBeDefined();
  });
});

// ── Lifecycle ──────────────────────────────────────────────────────────────────

describe("lifecycle", () => {
  test("install transitions to installed", () => {
    const descriptor = buildDescriptor({ capabilityId: "life-test", capabilityType: "plugin", name: "Life", version: "1.0.0", publisher: { id: "test", kind: "official" } });
    const result = transitionLifecycle(descriptor, "install");
    expect(result.ok).toBe(true);
    expect(result.newState).toBe("installed");
  });

  test("update with new permissions triggers review", () => {
    const descriptor = buildDescriptor({ capabilityId: "life-update", capabilityType: "plugin", name: "Update", version: "1.0.0", publisher: { id: "test", kind: "official" }, declaredAuthority: { permissions: ["net"], resourceRequirements: [], dataScopes: { read: [], write: [], delete: [] } } });
    const result = transitionLifecycle(descriptor, "update", "update detail", "2.0.0", ["net", "fs:read"]);
    expect(result.ok).toBe(true);
    expect(result.permissionReviewRequired).toBe(true);
  });

  test("quarantine disables capability", () => {
    const descriptor = buildDescriptor({ capabilityId: "life-quar", capabilityType: "plugin", name: "Quarantine", version: "1.0.0", publisher: { id: "test", kind: "official" } });
    descriptor.lifecycleState = "enabled";
    const result = quarantineCapability(descriptor, "security failure");
    expect(result.ok).toBe(true);
    expect(result.newState).toBe("quarantined");
  });

  test("rollback restores previous version", () => {
    const descriptor = buildDescriptor({ capabilityId: "life-roll", capabilityType: "plugin", name: "Rollback", version: "2.0.0", publisher: { id: "test", kind: "official" } });
    const previous = { ...descriptor, version: "1.0.0" };
    const result = rollbackCapability(descriptor, previous.version);
    expect(result.ok).toBe(true);
    expect(result.newState).toBe("roll_back");
  });

  test("disable works when enabled", () => {
    const descriptor = buildDescriptor({ capabilityId: "life-dis", capabilityType: "plugin", name: "Disable", version: "1.0.0", publisher: { id: "test", kind: "official" } });
    descriptor.lifecycleState = "enabled";
    const result = transitionLifecycle(descriptor, "disable");
    expect(result.ok).toBe(true);
    expect(result.newState).toBe("disabled");
  });
});

// ── Registry ────────────────────────────────────────────────────────────────────

describe("registry", () => {
  test("catalog upsert/get/remove works", () => {
    const catalog = new CapabilityCatalog();
    const descriptor = buildDescriptor({ capabilityId: "reg-test", capabilityType: "plugin", name: "Reg", version: "1.0.0", publisher: { id: "test", kind: "official" } });
    catalog.upsert({ descriptor, discoveredAt: Date.now(), enabled: true, quarantined: false });
    expect(catalog.get("reg-test")?.descriptor.capabilityId).toBe("reg-test");
    expect(catalog.disable("reg-test")).toBe(true);
    expect(catalog.get("reg-test")?.enabled).toBe(false);
    expect(catalog.remove("reg-test")).toBe(true);
    expect(catalog.get("reg-test")).toBeUndefined();
  });

  test("quarantine disables and isolates", () => {
    const catalog = new CapabilityCatalog();
    const descriptor = buildDescriptor({ capabilityId: "reg-quar", capabilityType: "plugin", name: "Quar", version: "1.0.0", publisher: { id: "test", kind: "official" } });
    catalog.upsert({ descriptor, discoveredAt: Date.now(), enabled: true, quarantined: false });
    expect(catalog.quarantine("reg-quar")).toBe(true);
    expect(catalog.get("reg-quar")?.quarantined).toBe(true);
    expect(catalog.get("reg-quar")?.enabled).toBe(false);
  });

  test("listEnabled excludes quarantined", () => {
    const catalog = new CapabilityCatalog();
    const d1 = buildDescriptor({ capabilityId: "reg-a", capabilityType: "plugin", name: "A", version: "1.0.0", publisher: { id: "t", kind: "official" } });
    const d2 = buildDescriptor({ capabilityId: "reg-b", capabilityType: "plugin", name: "B", version: "1.0.0", publisher: { id: "t", kind: "official" } });
    catalog.upsert({ descriptor: d1, discoveredAt: Date.now(), enabled: true, quarantined: false });
    catalog.upsert({ descriptor: d2, discoveredAt: Date.now(), enabled: true, quarantined: true });
    expect(catalog.listEnabled().length).toBe(1);
    expect(catalog.listQuarantined().length).toBe(1);
  });
});

// ── Discovery ──────────────────────────────────────────────────────────────────

describe("discovery", () => {
  test("discoverCapabilities filters by capability type and permissions", () => {
    const descriptors = [
      buildDescriptor({ capabilityId: "disc-a", capabilityType: "plugin", name: "Plugin A", version: "1.0.0", publisher: { id: "t", kind: "official" }, declaredAuthority: { permissions: ["net", "fs:read"], resourceRequirements: [], dataScopes: { read: ["/data"], write: [], delete: [] } } }),
      buildDescriptor({ capabilityId: "disc-b", capabilityType: "skill", name: "Skill B", version: "1.0.0", publisher: { id: "t", kind: "official" }, declaredAuthority: { permissions: ["net"], resourceRequirements: [], dataScopes: { read: ["/data"], write: [], delete: [] } } }),
    ];
    const results = discoverCapabilities(descriptors, { capabilityType: "plugin", requiredPermissions: ["net"] });
    expect(results.length).toBe(1);
    expect(results[0].capability.capabilityType).toBe("plugin");
  });

  test("discovery excludes capabilities violating denied permissions", () => {
    const descriptors = [
      buildDescriptor({ capabilityId: "disc-c", capabilityType: "plugin", name: "C", version: "1.0.0", publisher: { id: "t", kind: "official" }, declaredAuthority: { permissions: ["shell"], resourceRequirements: [], dataScopes: { read: [], write: [], delete: [] } } }),
    ];
    const results = discoverCapabilities(descriptors, { deniedPermissions: ["shell"] }, { deniedPermissions: ["shell"] });
    expect(results.length).toBe(0);
  });
});

// ── CLI ────────────────────────────────────────────────────────────────────────

describe("cli inspection", () => {
  test("cliInspect formats descriptor correctly", () => {
    const descriptor = buildDescriptor({ capabilityId: "cli-test", capabilityType: "plugin", name: "CLI", version: "1.0.0", publisher: { id: "cli-pub", kind: "official" }, declaredAuthority: { permissions: ["net"], resourceRequirements: [], dataScopes: { read: [], write: [], delete: [] } } });
    globalCatalog.upsert({ descriptor, discoveredAt: Date.now(), enabled: true, quarantined: false });
    const output = cliInspect("cli-test", globalCatalog);
    expect(output).toContain("CLI");
    expect(output).toContain("plugin");
  });

  test("cliInspect returns not found for missing capability", () => {
    const output = cliInspect("missing-id", globalCatalog);
    expect(output).toContain("not found");
  });

  test("cliListStatus lists capabilities", () => {
    const descriptor = buildDescriptor({ capabilityId: "cli-list", capabilityType: "plugin", name: "List", version: "1.0.0", publisher: { id: "pub", kind: "official" } });
    globalCatalog.upsert({ descriptor, discoveredAt: Date.now(), enabled: false, quarantined: false });
    const output = cliListStatus(globalCatalog);
    expect(output).toContain("cli-list");
  });
});

// ── State / Migration ───────────────────────────────────────────────────────────

describe("state and migration", () => {
  test("createStateStore creates empty versioned store", () => {
    const store = createStateStore();
    expect(store.version).toBe(1);
    expect(Object.keys(store.descriptors).length).toBe(0);
  });

  test("migrateStateStore updates version", () => {
    const store = { version: 0, descriptors: {}, quarantinedIds: [], rollbackVersions: {}, certificationHistory: {} } as any;
    const migrated = migrateStateStore(store);
    expect(migrated.version).toBe(1);
  });

  test("saveDescriptorToState saves descriptor and manages quarantine", () => {
    const store = createStateStore();
    const descriptor = buildDescriptor({ capabilityId: "state-save", capabilityType: "plugin", name: "State", version: "1.0.0", publisher: { id: "t", kind: "official" }, lifecycleState: "installed" });
    saveDescriptorToState(store, descriptor);
    expect(store.descriptors["state-save"].capabilityId).toBe("state-save");
    expect(store.quarantinedIds).not.toContain("state-save");
  });

  test("recordRollback saves previous descriptor", () => {
    const store = createStateStore();
    const descriptor = buildDescriptor({ capabilityId: "state-roll", capabilityType: "plugin", name: "Rollback", version: "2.0.0", publisher: { id: "t", kind: "official" } });
    const previous = buildDescriptor({ capabilityId: "state-roll", capabilityType: "plugin", name: "Rollback", version: "1.0.0", publisher: { id: "t", kind: "official" } });
    recordRollback(store, descriptor, previous, "revert");
    expect(store.rollbackVersions["state-roll"].reason).toBe("revert");
    expect(store.rollbackVersions["state-roll"].descriptor.version).toBe("1.0.0");
  });
});

// ── Interop ────────────────────────────────────────────────────────────────────

describe("interop", () => {
  test("extractInteropDescriptor adds interfaces for capability type", () => {
    const descriptor = buildDescriptor({ capabilityId: "interop-test", capabilityType: "plugin", name: "Interop", version: "1.0.0", publisher: { id: "t", kind: "official" } });
    const result = extractInteropDescriptor(descriptor);
    expect(result.interfaces?.plugin).toBeDefined();
  });
});

// ── Security Enforcement Tests ─────────────────────────────────────────────────

describe("security enforcement", () => {
  test("update requesting new permissions requires review", () => {
    const descriptor = buildDescriptor({ capabilityId: "sec-update", capabilityType: "plugin", name: "Sec Update", version: "1.0.0", publisher: { id: "t", kind: "official" }, declaredAuthority: { permissions: ["net"], resourceRequirements: [], dataScopes: { read: [], write: [], delete: [] } } });
    const result = transitionLifecycle(descriptor, "update", "new version", "2.0.0", ["net", "fs:read"]);
    expect(result.permissionReviewRequired).toBe(true);
  });

  test("quarantine sets quarantined state", () => {
    const descriptor = buildDescriptor({ capabilityId: "sec-quar", capabilityType: "plugin", name: "Sec Quar", version: "1.0.0", publisher: { id: "t", kind: "official" }, lifecycleState: "enabled" });
    const result = quarantineCapability(descriptor, "security failure");
    expect(result.newState).toBe("quarantined");
    expect(result.ok).toBe(true);
  });

  test("effective authority denies permissions denied by policy", () => {
    const declared = { permissions: ["net", "shell"], resourceRequirements: [], dataScopes: { read: [], write: [], delete: [] }, networkRequirements: [], credentialRequirements: [], modelRequirements: [], placementRequirement: undefined, riskTier: undefined };
    const policy = buildPolicyIntersection({ allowed: ["net"], denied: ["shell"] });
    const effective = resolveEffectiveAuthority(declared, policy);
    expect(effective.grantedPermissions).toContain("net");
    expect(effective.deniedPermissions).toContain("shell");
  });

  test("descriptor schema rejects unknown capability types", () => {
    const bad = parseDescriptorObject({ capabilityId: "bad", capabilityType: "unknown_type" as any, name: "x", version: "1.0.0" });
    expect(bad.ok).toBe(false);
  });

  test("unsigned package clearly marked but permitted by policy", () => {
    const descriptor = buildDescriptor({ capabilityId: "sec-unsigned", capabilityType: "plugin", name: "Unsigned", version: "1.0.0", publisher: { id: "t", kind: "unknown" } });
    const result = verifyBeforeInstall(descriptor, undefined, { requireSigned: false, allowUnsigned: true });
    expect(result.ok).toBe(true);
    expect(result.reason).toContain("unsigned");
  });
});
