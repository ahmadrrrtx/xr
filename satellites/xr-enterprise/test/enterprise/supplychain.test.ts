/**
 * XR 6.1 — Phase 12 Tests: Capability supply-chain response.
 */
import { describe, expect, test } from "bun:test";
import {
  SupplyChainResponseService,
  parseSemver,
  compareSemver,
  satisfiesRange,
  type CapabilityCatalog,
  type CapabilitySnapshot,
} from "../../src/enterprise/index.ts";

const NOW = 1_800_000_000_000;

describe("Semver helpers", () => {
  test("parses versions with and without a v prefix", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: undefined });
    expect(parseSemver("v2.0.1")!.major).toBe(2);
    expect(parseSemver("1.2.3-beta.1")!.prerelease).toBe("beta.1");
    expect(parseSemver("not-a-version")).toBeUndefined();
  });

  test("compares versions correctly", () => {
    expect(compareSemver(parseSemver("1.0.0")!, parseSemver("2.0.0")!)).toBeLessThan(0);
    expect(compareSemver(parseSemver("1.2.0")!, parseSemver("1.1.9")!)).toBeGreaterThan(0);
    expect(compareSemver(parseSemver("1.0.0")!, parseSemver("1.0.0")!)).toBe(0);
  });

  test("a prerelease sorts before its release", () => {
    expect(compareSemver(parseSemver("1.0.0-beta")!, parseSemver("1.0.0")!)).toBeLessThan(0);
  });

  test("range matching handles compound ranges", () => {
    expect(satisfiesRange("1.3.0", ">=1.2.0 <1.4.1")).toBe(true);
    expect(satisfiesRange("1.1.0", ">=1.2.0 <1.4.1")).toBe(false);
    expect(satisfiesRange("1.4.1", ">=1.2.0 <1.4.1")).toBe(false);
    expect(satisfiesRange("1.4.0", ">=1.2.0 <1.4.1")).toBe(true);
  });

  test("exact and wildcard ranges", () => {
    expect(satisfiesRange("1.0.0", "1.0.0")).toBe(true);
    expect(satisfiesRange("1.0.1", "1.0.0")).toBe(false);
    expect(satisfiesRange("9.9.9", "*")).toBe(true);
  });
});

describe("Revocation", () => {
  function svc(overrides: Partial<ConstructorParameters<typeof SupplyChainResponseService>[0]> = {}) {
    return new SupplyChainResponseService({ now: () => NOW, ...overrides });
  }

  test("revoking a capability blocks its install", () => {
    const s = svc();
    const r = s.revoke({
      scope: "capability",
      targetId: "skill:evil",
      reason: "malicious",
      detail: "Exfiltrates credentials.",
      issuedBy: "security",
    });
    expect(r.ok).toBe(true);
    expect(s.checkInstall("skill:evil").allowed).toBe(false);
    expect(s.checkInstall("skill:good").allowed).toBe(true);
  });

  test("EVIDENCE IS PRESERVED BEFORE QUARANTINE", () => {
    const order: string[] = [];
    const snap: CapabilitySnapshot = {
      capabilityId: "skill:evil",
      version: "1.2.3",
      publisherId: "pub1",
      lifecycleState: "enabled",
      installedInWorkspaces: ["ws1"],
      capturedAt: NOW,
    };
    const s = svc({
      snapshot: (id) => {
        order.push(`snapshot:${id}`);
        return snap;
      },
      quarantineCapability: (id) => {
        order.push(`quarantine:${id}`);
        return { ok: true };
      },
    });

    const r = s.revoke({
      scope: "capability",
      targetId: "skill:evil",
      reason: "malicious",
      detail: "bad",
      issuedBy: "security",
    });

    // The snapshot must come first, so a capability cannot erase its own trail.
    expect(order).toEqual(["snapshot:skill:evil", "quarantine:skill:evil"]);
    expect(r.evidenceId).toBeDefined();
    expect(s.snapshot(r.evidenceId!)!.lifecycleState).toBe("enabled");
  });

  test("version-range revocation blocks only the affected range", () => {
    const s = svc();
    s.revokeVersionRange("skill:x", ">=1.2.0 <1.4.1", "vulnerable", "CVE-2026-1", "security");

    expect(s.checkInstall("skill:x", "1.3.0").allowed).toBe(false);
    expect(s.checkInstall("skill:x", "1.1.0").allowed).toBe(true);
    expect(s.checkInstall("skill:x", "1.4.1").allowed).toBe(true);
    expect(s.checkInstall("skill:x", "2.0.0").allowed).toBe(true);
  });

  test("version-range revocation with no version specified is blocked", () => {
    const s = svc();
    s.revokeVersionRange("skill:x", ">=1.0.0", "vulnerable", "d", "security");
    const d = s.checkInstall("skill:x");
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("no version was specified");
  });

  test("publisher revocation covers all of their capabilities", () => {
    const quarantined: string[] = [];
    const s = svc({
      capabilitiesOfPublisher: (id) => (id === "pub1" ? ["skill:a", "skill:b", "plugin:c"] : []),
      quarantineCapability: (id) => {
        quarantined.push(id);
        return { ok: true };
      },
    });

    const r = s.revokePublisher("pub1", "compromised_publisher", "Signing key stolen.", "security");
    expect(r.ok).toBe(true);
    expect(quarantined).toEqual(["skill:a", "skill:b", "plugin:c"]);
    expect(s.checkInstall("skill:new", "1.0.0", "pub1").allowed).toBe(false);
    expect(s.checkInstall("skill:new", "1.0.0", "pub2").allowed).toBe(true);
  });

  test("version_range requires a range", () => {
    const s = svc();
    const r = s.revoke({
      scope: "capability_version",
      targetId: "skill:x",
      reason: "vulnerable",
      detail: "d",
      issuedBy: "s",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("versionRange is required");
  });

  test("notices are created for affected workspaces", () => {
    const s = svc({
      affectedWorkspaces: () => ["ws1", "ws2"],
    });
    const r = s.revoke({
      scope: "capability",
      targetId: "skill:evil",
      reason: "malicious",
      detail: "bad",
      issuedBy: "security",
    });
    expect(r.notices.length).toBe(1);
    expect(r.notices[0]!.workspaceIds).toEqual(["ws1", "ws2"]);
    expect(r.notices[0]!.severity).toBe("critical");
    expect(r.notices[0]!.recommendedAction).toContain("rotate");
  });

  test("notices can be acknowledged", () => {
    const s = svc({ affectedWorkspaces: () => ["ws1"] });
    const r = s.revoke({ scope: "capability", targetId: "skill:e", reason: "malicious", detail: "d", issuedBy: "s" });
    expect(s.pendingNotices().length).toBe(1);
    expect(s.acknowledgeNotice(r.notices[0]!.noticeId, "admin").ok).toBe(true);
    expect(s.pendingNotices().length).toBe(0);
  });

  test("a malicious revocation declares an incident", () => {
    let declared = false;
    const s = svc({
      declareIncident: () => {
        declared = true;
        return "inc_1";
      },
    });
    const r = s.revoke({ scope: "capability", targetId: "skill:e", reason: "malicious", detail: "d", issuedBy: "s" });
    expect(declared).toBe(true);
    expect(r.incidentId).toBe("inc_1");
  });

  test("an abandoned capability does not raise an incident", () => {
    let declared = false;
    const s = svc({
      declareIncident: () => {
        declared = true;
        return "inc_1";
      },
    });
    s.revoke({ scope: "capability", targetId: "skill:old", reason: "abandoned", detail: "d", issuedBy: "s" });
    expect(declared).toBe(false);
  });

  test("lifting a revocation restores installability", () => {
    const s = svc();
    const r = s.revoke({ scope: "capability", targetId: "skill:x", reason: "vulnerable", detail: "d", issuedBy: "s" });
    expect(s.checkInstall("skill:x").allowed).toBe(false);
    expect(s.lift(r.entry!.entryId, "admin", "False positive.").ok).toBe(true);
    expect(s.checkInstall("skill:x").allowed).toBe(true);
  });

  test("an expired revocation stops blocking", () => {
    const s = new SupplyChainResponseService({ now: () => NOW });
    s.revoke({
      scope: "capability",
      targetId: "skill:x",
      reason: "vulnerable",
      detail: "d",
      issuedBy: "s",
      expiresAt: NOW - 1,
    });
    expect(s.checkInstall("skill:x").allowed).toBe(true);
  });

  test("blockInstall=false records the revocation without blocking", () => {
    const s = svc();
    s.revoke({
      scope: "capability",
      targetId: "skill:x",
      reason: "abandoned",
      detail: "Unmaintained.",
      issuedBy: "s",
      blockInstall: false,
    });
    expect(s.checkInstall("skill:x").allowed).toBe(true);
    expect(s.activeRevocations().length).toBe(1);
  });

  test("activeRevocations excludes lifted entries", () => {
    const s = svc();
    const r = s.revoke({ scope: "capability", targetId: "a", reason: "vulnerable", detail: "d", issuedBy: "s" });
    s.revoke({ scope: "capability", targetId: "b", reason: "vulnerable", detail: "d", issuedBy: "s" });
    s.lift(r.entry!.entryId, "admin", "fixed");
    expect(s.activeRevocations().length).toBe(1);
    expect(s.allRevocations().length).toBe(2);
  });
});

describe("Safe version restore", () => {
  test("restoring a safe version succeeds", () => {
    let restored = "";
    const s = new SupplyChainResponseService({
      now: () => NOW,
      rollbackCapability: (id, v) => {
        restored = `${id}@${v}`;
        return { ok: true, detail: "rolled back" };
      },
    });
    s.revokeVersionRange("skill:x", ">=1.2.0 <1.4.1", "vulnerable", "CVE", "security");
    const r = s.restoreSafeVersion({ capabilityId: "skill:x", version: "1.1.0", actorId: "admin", reason: "revert" });
    expect(r.ok).toBe(true);
    expect(restored).toBe("skill:x@1.1.0");
  });

  test("RESTORING A REVOKED VERSION IS BLOCKED", () => {
    let called = false;
    const s = new SupplyChainResponseService({
      now: () => NOW,
      rollbackCapability: () => {
        called = true;
        return { ok: true };
      },
    });
    s.revokeVersionRange("skill:x", ">=1.2.0 <1.4.1", "malicious", "backdoor", "security");
    const r = s.restoreSafeVersion({ capabilityId: "skill:x", version: "1.3.0", actorId: "admin", reason: "oops" });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("Restore blocked");
    expect(called).toBe(false);
  });
});

describe("Organization capability catalogs", () => {
  function catalog(mode: CapabilityCatalog["mode"], entries: CapabilityCatalog["entries"], extra: Partial<CapabilityCatalog> = {}): CapabilityCatalog {
    return {
      catalogId: "cat1",
      organizationId: "org1",
      name: "Approved",
      mode,
      entries,
      requireSigned: false,
      requireCertified: false,
      version: 1,
      updatedBy: "admin",
      updatedAt: NOW,
      ...extra,
    };
  }

  test("allowlist permits only listed capabilities", () => {
    const s = new SupplyChainResponseService({ now: () => NOW });
    s.setCatalog(catalog("allowlist", [{ capabilityId: "skill:approved" }]));

    expect(s.checkCatalog({ organizationId: "org1", capabilityId: "skill:approved" }).allowed).toBe(true);
    expect(s.checkCatalog({ organizationId: "org1", capabilityId: "skill:other" }).allowed).toBe(false);
  });

  test("denylist blocks only listed capabilities", () => {
    const s = new SupplyChainResponseService({ now: () => NOW });
    s.setCatalog(catalog("denylist", [{ capabilityId: "skill:banned", note: "Data risk" }]));

    expect(s.checkCatalog({ organizationId: "org1", capabilityId: "skill:banned" }).allowed).toBe(false);
    expect(s.checkCatalog({ organizationId: "org1", capabilityId: "skill:banned" }).reason).toContain("Data risk");
    expect(s.checkCatalog({ organizationId: "org1", capabilityId: "skill:fine" }).allowed).toBe(true);
  });

  test("allowlist enforces min and max versions", () => {
    const s = new SupplyChainResponseService({ now: () => NOW });
    s.setCatalog(catalog("allowlist", [{ capabilityId: "skill:x", minVersion: "2.0.0", maxVersion: "3.0.0" }]));

    expect(s.checkCatalog({ organizationId: "org1", capabilityId: "skill:x", version: "2.5.0" }).allowed).toBe(true);
    expect(s.checkCatalog({ organizationId: "org1", capabilityId: "skill:x", version: "1.0.0" }).allowed).toBe(false);
    expect(s.checkCatalog({ organizationId: "org1", capabilityId: "skill:x", version: "4.0.0" }).allowed).toBe(false);
  });

  test("requireSigned rejects unsigned packages", () => {
    const s = new SupplyChainResponseService({ now: () => NOW });
    s.setCatalog(catalog("open", [], { requireSigned: true }));
    expect(s.checkCatalog({ organizationId: "org1", capabilityId: "skill:x", signed: false }).allowed).toBe(false);
    expect(s.checkCatalog({ organizationId: "org1", capabilityId: "skill:x", signed: true }).allowed).toBe(true);
  });

  test("requireCertified rejects uncertified capabilities", () => {
    const s = new SupplyChainResponseService({ now: () => NOW });
    s.setCatalog(catalog("open", [], { requireCertified: true }));
    expect(s.checkCatalog({ organizationId: "org1", capabilityId: "skill:x", certified: false }).allowed).toBe(false);
  });

  test("REVOCATION OVERRIDES A PERMISSIVE CATALOG", () => {
    const s = new SupplyChainResponseService({ now: () => NOW });
    s.setCatalog(catalog("allowlist", [{ capabilityId: "skill:x" }]));
    s.revoke({ scope: "capability", targetId: "skill:x", reason: "malicious", detail: "backdoor", issuedBy: "security" });

    const d = s.checkCatalog({ organizationId: "org1", capabilityId: "skill:x" });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("revoked");
  });

  test("no catalog means open by default", () => {
    const s = new SupplyChainResponseService({ now: () => NOW });
    const d = s.checkCatalog({ organizationId: "orgNone", capabilityId: "skill:x" });
    expect(d.allowed).toBe(true);
    expect(d.reason).toContain("default open");
  });

  test("catalogs are per-organization", () => {
    const s = new SupplyChainResponseService({ now: () => NOW });
    s.setCatalog(catalog("allowlist", [{ capabilityId: "skill:a" }]));
    expect(s.checkCatalog({ organizationId: "org1", capabilityId: "skill:b" }).allowed).toBe(false);
    expect(s.checkCatalog({ organizationId: "org2", capabilityId: "skill:b" }).allowed).toBe(true);
  });

  test("updating a catalog bumps its version", () => {
    const s = new SupplyChainResponseService({ now: () => NOW });
    const c1 = s.setCatalog(catalog("allowlist", []));
    expect(c1.version).toBe(1);
    const c2 = s.setCatalog(catalog("allowlist", [{ capabilityId: "skill:a" }]));
    expect(c2.version).toBe(2);
  });
});
