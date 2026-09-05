/**
 * XR 6.1 — Phase 12 Tests: Security and adversarial.
 *
 * Roadmap §9 adversarial list:
 *   privilege escalation, tenant leakage, hidden policy override, audit
 *   tampering, redaction bypass, compromised capability, compromised worker,
 *   restore poisoning, revoked identity use.
 *
 * Each attack below must FAIL against XR.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  DelegationRegistry,
  PolicyBundleStore,
  AuditExportService,
  RecoveryOperations,
  SupplyChainResponseService,
  IncidentService,
  resolvePolicy,
  evaluatePolicy,
  policyRule,
  rootAuthority,
  redactRecords,
  proveRedactionFaithful,
  detectRedactionBypass,
  verifyExportedChain,
  validateRollback,
  NON_OVERRIDABLE_VISIBILITY_KEYS,
  POLICY_LAYERS,
  type AuditRecord,
  type AuthoritySubject,
  type RedactionRule,
} from "../../src/enterprise/index.ts";
import type { BackupManifest } from "../../src/enterprise/deployment/backup/service.ts";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const attacker: AuthoritySubject = { kind: "user", subjectId: "u_attacker", organizationId: "org1" };
const victimWorker: AuthoritySubject = { kind: "ai_worker", subjectId: "w_victim", organizationId: "org1" };
const otherOrgWorker: AuthoritySubject = { kind: "ai_worker", subjectId: "w_other", organizationId: "org2" };

function chain(count: number, over: Partial<AuditRecord>[] = []): AuditRecord[] {
  const out: AuditRecord[] = [];
  let prev = "0".repeat(64);
  for (let i = 0; i < count; i++) {
    const o = over[i] ?? {};
    const at = o.at ?? NOW - (count - i) * 1000;
    const event = o.event ?? `e${i}`;
    const detail = o.detail ?? { i };
    const hash = createHash("sha256").update(`${prev}${event}${JSON.stringify(detail)}${at}`).digest("hex");
    out.push({
      recordId: `r${i}`,
      sequence: i + 1,
      eventClass: o.eventClass ?? "system",
      event,
      at,
      sensitivity: o.sensitivity ?? "internal",
      organizationId: o.organizationId,
      workspaceId: o.workspaceId,
      detail,
      prevHash: prev,
      hash,
    });
    prev = hash;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════

describe("ATTACK: privilege escalation via delegation", () => {
  test("cannot delegate a scope the delegator does not hold", () => {
    const r = new DelegationRegistry({ now: () => NOW });
    const res = r.delegate({
      delegator: attacker,
      delegate: victimWorker,
      requestedScopes: ["admin:root", "fs:read"],
      requestedMaxRiskTier: "tier2_isolated",
      delegatorAuthority: rootAuthority({ subject: attacker, scopes: ["fs:read"], maxRiskTier: "tier1_restricted" }),
      expiresAt: NOW + DAY,
      reason: "escalate",
    });
    expect(res.delegation!.scopes).not.toContain("admin:root");
    expect(res.validation.deniedScopes).toContain("admin:root");
  });

  test("cannot raise the risk ceiling mid-chain", () => {
    const r = new DelegationRegistry({ now: () => NOW });
    const parent = r.delegate({
      delegator: attacker,
      delegate: victimWorker,
      requestedScopes: ["proc:spawn"],
      requestedMaxRiskTier: "tier0_in_process",
      delegatorAuthority: rootAuthority({ subject: attacker, scopes: ["proc:spawn"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "p",
      canSubDelegate: true,
    }).delegation!;

    const child = r.delegate({
      delegator: victimWorker,
      delegate: otherOrgWorker,
      requestedScopes: ["proc:spawn"],
      requestedMaxRiskTier: "tier2_isolated",
      delegatorAuthority: { scopes: parent.scopes, maxRiskTier: parent.maxRiskTier, canSubDelegate: true, depth: parent.depth },
      expiresAt: NOW + DAY,
      reason: "escalate",
      parentDelegationId: parent.delegationId,
    });

    // Cross-org is refused outright; even if it were allowed, the ceiling holds.
    expect(child.ok).toBe(false);
    expect(child.validation.effectiveMaxRiskTier).toBe("tier0_in_process");
  });

  test("unbounded chaining is refused", () => {
    const r = new DelegationRegistry({ now: () => NOW });
    const res = r.delegate({
      delegator: attacker,
      delegate: victimWorker,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: { scopes: ["fs:read"], maxRiskTier: "tier1_restricted", canSubDelegate: true, depth: 99 },
      expiresAt: NOW + DAY,
      reason: "deep",
    });
    expect(res.ok).toBe(false);
  });

  test("a review cannot be used to grant new scopes", () => {
    const r = new DelegationRegistry({ now: () => NOW });
    const d = r.delegate({
      delegator: attacker,
      delegate: victimWorker,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: attacker, scopes: ["fs:read"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "t",
    }).delegation!;

    r.review({
      delegationId: d.delegationId,
      reviewedBy: "u_attacker",
      outcome: "affirmed",
      notes: "grant more",
      scopesAfter: ["fs:read", "fs:write", "admin:all"],
    });
    expect(r.get(d.delegationId)!.scopes).toEqual(["fs:read"]);
  });
});

describe("ATTACK: revoked identity reuse", () => {
  test("a revoked delegation grants nothing, immediately", () => {
    const r = new DelegationRegistry({ now: () => NOW });
    const d = r.delegate({
      delegator: attacker,
      delegate: victimWorker,
      requestedScopes: ["fs:read", "net:egress"],
      requestedMaxRiskTier: "tier2_isolated",
      delegatorAuthority: rootAuthority({ subject: attacker, scopes: ["fs:read", "net:egress"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "t",
    }).delegation!;

    r.revoke(d.delegationId, "security", "Compromised.");
    expect(r.authorize(victimWorker, "fs:read", "tier0_in_process").allowed).toBe(false);
    expect(r.effectiveAuthority(victimWorker).scopes.length).toBe(0);
    expect(r.isUsable(d.delegationId)).toBe(false);
  });

  test("revoking a parent kills every descendant", () => {
    const r = new DelegationRegistry({ now: () => NOW });
    const w2: AuthoritySubject = { kind: "ai_worker", subjectId: "w2", organizationId: "org1" };
    const w3: AuthoritySubject = { kind: "ai_worker", subjectId: "w3", organizationId: "org1" };

    const p = r.delegate({
      delegator: attacker,
      delegate: victimWorker,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier2_isolated",
      delegatorAuthority: rootAuthority({ subject: attacker, scopes: ["fs:read"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "p",
      canSubDelegate: true,
    }).delegation!;

    const c1 = r.delegate({
      delegator: victimWorker,
      delegate: w2,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: { scopes: p.scopes, maxRiskTier: p.maxRiskTier, canSubDelegate: true, depth: p.depth },
      expiresAt: NOW + DAY,
      reason: "c1",
      parentDelegationId: p.delegationId,
      canSubDelegate: true,
    }).delegation!;

    const c2 = r.delegate({
      delegator: w2,
      delegate: w3,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: { scopes: c1.scopes, maxRiskTier: c1.maxRiskTier, canSubDelegate: true, depth: c1.depth },
      expiresAt: NOW + DAY,
      reason: "c2",
      parentDelegationId: c1.delegationId,
    }).delegation!;

    r.revoke(p.delegationId, "security", "Root compromise.");
    expect(r.isUsable(c1.delegationId)).toBe(false);
    expect(r.isUsable(c2.delegationId)).toBe(false);
    expect(r.effectiveAuthority(w3).scopes.length).toBe(0);
  });
});

describe("ATTACK: hidden policy override", () => {
  test("an admin cannot silently disable ANY user-visibility invariant", () => {
    for (const key of NON_OVERRIDABLE_VISIBILITY_KEYS) {
      const res = resolvePolicy(
        [policyRule({ key, value: false, layer: "organization", reason: "streamline UX", authoredBy: "bad-admin", authoredAt: NOW })],
        { now: NOW },
      );
      const entry = res.entries.find((e) => e.key === key)!;
      expect(entry.effectiveValue).toBe(true);
      const rejection = res.rejectedOverrides.find((o) => o.key === key);
      expect(rejection).toBeDefined();
      expect(rejection!.severity).toBe("critical");
    }
  });

  test("a suppression bundle cannot even be created", () => {
    const store = new PolicyBundleStore({ now: () => NOW });
    const r = store.create({
      name: "Quiet mode",
      rules: [policyRule({ key: "showApprovalRequests", value: false, layer: "organization", reason: "quiet", authoredBy: "bad-admin", authoredAt: NOW })],
      createdBy: "bad-admin",
      organizationId: "org1",
    });
    expect(r.ok).toBe(false);
    expect(store.active("org1")).toBeUndefined();
  });

  test("a privileged layer cannot loosen a stricter lower layer", () => {
    const res = resolvePolicy(
      [
        policyRule({ key: "allowNetworkEgress", value: false, layer: "user_task", reason: "user says no", authoredBy: "user", authoredAt: NOW }),
        policyRule({ key: "allowNetworkEgress", value: true, layer: "platform_default", reason: "platform says yes", authoredBy: "sys", authoredAt: NOW }),
        policyRule({ key: "allowNetworkEgress", value: true, layer: "organization", reason: "org says yes", authoredBy: "admin", authoredAt: NOW }),
      ],
      { now: NOW },
    );
    expect(res.entries.find((e) => e.key === "allowNetworkEgress")!.effectiveValue).toBe(false);
    expect(res.rejectedOverrides.filter((o) => o.key === "allowNetworkEgress").length).toBe(2);
  });

  test("policy restrictions on authority are always explained, never silent", () => {
    const r = new DelegationRegistry({ now: () => NOW });
    r.delegate({
      delegator: attacker,
      delegate: victimWorker,
      requestedScopes: ["net:egress"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: attacker, scopes: ["net:egress"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "t",
    });
    const policy = evaluatePolicy(
      [policyRule({ key: "allowNetworkEgress", value: false, layer: "organization", reason: "Compliance.", authoredBy: "admin", authoredAt: NOW })],
      { now: NOW },
    );
    const eff = r.effectiveAuthority(victimWorker, policy);
    expect(eff.restrictedByPolicy.length).toBeGreaterThan(0);
    expect(eff.restrictedByPolicy[0]!.reason.length).toBeGreaterThan(0);
  });

  test("every layer is subject to the invariant, including the most privileged", () => {
    for (const layer of POLICY_LAYERS) {
      const res = resolvePolicy(
        [policyRule({ key: "showIncidentImpact", value: false, layer, reason: "x", authoredBy: "a", authoredAt: NOW })],
        { now: NOW },
      );
      expect(res.entries.find((e) => e.key === "showIncidentImpact")!.effectiveValue).toBe(true);
    }
  });
});

describe("ATTACK: tenant leakage", () => {
  test("audit export cannot cross organization boundaries", () => {
    const records = [
      ...chain(3).map((r) => ({ ...r, organizationId: "org1" })),
      ...chain(3).map((r, i) => ({ ...r, organizationId: "org2", recordId: `x${i}` })),
    ];
    const svc = new AuditExportService({ source: () => records, now: () => NOW });
    const result = svc.export({
      requestedBy: "admin_org1",
      organizationId: "org1",
      format: "json",
      redactionRules: [],
      reason: "audit",
    });
    expect(result.records.every((r) => r.organizationId === "org1")).toBe(true);
    expect(result.records.length).toBe(3);
  });

  test("workspace-scoped policy does not leak to sibling workspaces", () => {
    const rules = [
      policyRule({
        key: "secretSetting",
        value: "org1-ws1-only",
        layer: "workspace",
        reason: "scoped",
        authoredBy: "a",
        authoredAt: NOW,
        organizationId: "org1",
        workspaceId: "ws1",
      }),
    ];
    expect(evaluatePolicy(rules, { now: NOW, organizationId: "org1", workspaceId: "ws2" }).get("secretSetting")).toBeUndefined();
  });

  test("cross-organization delegation is refused", () => {
    const r = new DelegationRegistry({ now: () => NOW });
    const res = r.delegate({
      delegator: attacker,
      delegate: otherOrgWorker,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: attacker, scopes: ["fs:read"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "cross-tenant",
    });
    expect(res.ok).toBe(false);
  });

  test("an unauthorized export is denied and logged", () => {
    const svc = new AuditExportService({
      source: () => chain(5),
      now: () => NOW,
      authorizer: {
        canExport: ({ organizationId }) =>
          organizationId === "org1" ? { granted: true } : { granted: false, reason: "Wrong tenant." },
      },
    });
    const denied = svc.export({ requestedBy: "attacker", organizationId: "org2", format: "json", redactionRules: [], reason: "r" });
    expect(denied.manifest.status).toBe("denied");
    expect(denied.records.length).toBe(0);
    expect(svc.accessEntries({ granted: false }).length).toBe(1);
  });
});

describe("ATTACK: audit tampering", () => {
  test("a modified record breaks chain verification", () => {
    const records = chain(5);
    const { records: redacted } = redactRecords(records, { rules: [] });
    expect(verifyExportedChain(redacted, { contiguous: true }).intact).toBe(true);

    const tampered = [...redacted];
    tampered[2] = { ...tampered[2]!, hash: "f".repeat(64) };
    expect(verifyExportedChain(tampered, { contiguous: true }).intact).toBe(false);
  });

  test("a deleted middle record breaks the chain", () => {
    const records = chain(5);
    const { records: redacted } = redactRecords(records, { rules: [] });
    const withHole = [redacted[0]!, redacted[1]!, redacted[3]!, redacted[4]!];
    expect(verifyExportedChain(withHole, { contiguous: true }).intact).toBe(false);
  });

  test("a tampered export payload fails content verification", () => {
    const svc = new AuditExportService({ source: () => chain(4), now: () => NOW });
    const result = svc.export({ requestedBy: "a", format: "jsonl", redactionRules: [], reason: "r" });
    const forged = { ...result, serialized: result.serialized.replace(/"e0"/, '"MODIFIED"') };
    expect(svc.verify(forged).ok).toBe(false);
  });
});

describe("ATTACK: redaction bypass", () => {
  test("credential fields cannot survive a default export", () => {
    const records = chain(3, [
      { detail: { token: "sk-live-SECRET-0001" } },
      { detail: { password: "hunter2", apiKey: "AKIAIOSFODNN7EXAMPLE" } },
      { detail: { note: "clean" } },
    ]);
    const svc = new AuditExportService({ source: () => records, now: () => NOW });
    const result = svc.export({ requestedBy: "a", format: "jsonl", redactionRules: [], reason: "r" });

    expect(result.serialized).not.toContain("sk-live-SECRET-0001");
    expect(result.serialized).not.toContain("hunter2");
    expect(result.serialized).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  test("a record claiming redaction while keeping the value is caught", () => {
    const records = chain(1, [{ detail: { token: "sk-abcdefghij1234567890" } }]);
    const { records: honest } = redactRecords(records, { rules: [] });

    // Forge: keep the redactedFields claim, but restore the original payload.
    const forged = honest.map((r) => ({
      ...r,
      detail: { token: "sk-abcdefghij1234567890" },
    }));

    // The faithfulness proof detects that the claimed redaction was not applied.
    const proof = proveRedactionFaithful(records, forged);
    expect(proof.ok).toBe(false);
    expect(
      proof.mismatches.some((m) => m.detail.includes("still present") || m.detail.includes("original value")),
    ).toBe(true);

    // And the pattern scanner independently flags the leaked secret.
    expect(detectRedactionBypass(forged).length).toBeGreaterThan(0);
  });

  test("a masked field that secretly retains its value is caught", () => {
    const records = chain(1, [{ detail: { ssn: "123-45-6789" } }]);
    const rules: RedactionRule[] = [{ ruleId: "r", path: "ssn", mode: "mask", reason: "PII" }];
    const { records: honest } = redactRecords(records, { rules });
    expect(proveRedactionFaithful(records, honest).ok).toBe(true);

    const forged = honest.map((r) => ({ ...r, detail: { ssn: "123-45-6789" } }));
    const proof = proveRedactionFaithful(records, forged);
    expect(proof.ok).toBe(false);
    expect(proof.mismatches.some((m) => m.detail.includes("original value"))).toBe(true);
  });

  test("a redaction that lies about the original value is caught", () => {
    const originals = chain(1, [{ detail: { ssn: "123-45-6789" } }]);
    const rules: RedactionRule[] = [{ ruleId: "r", path: "ssn", mode: "remove", reason: "PII" }];
    const { records } = redactRecords(originals, { rules });
    const lying = [{ ...records[0]!, redactedFields: records[0]!.redactedFields.map((f) => ({ ...f, originalDigest: "0".repeat(64) })) }];
    expect(proveRedactionFaithful(originals, lying).ok).toBe(false);
  });

  test("restricted records are not exportable without explicit authorization", () => {
    const records = chain(2, [{ sensitivity: "restricted", detail: { secretData: "classified" } }, {}]);
    const svc = new AuditExportService({ source: () => records, now: () => NOW });
    const result = svc.export({ requestedBy: "a", format: "json", redactionRules: [], reason: "r" });
    expect(result.serialized).not.toContain("classified");
    expect(result.manifest.withheldCount).toBe(1);
  });
});

describe("ATTACK: compromised capability", () => {
  test("a revoked capability cannot be reinstalled", () => {
    const s = new SupplyChainResponseService({ now: () => NOW });
    s.revoke({ scope: "capability", targetId: "skill:evil", reason: "malicious", detail: "backdoor", issuedBy: "sec" });
    expect(s.checkInstall("skill:evil", "1.0.0").allowed).toBe(false);
    expect(s.checkInstall("skill:evil", "2.0.0").allowed).toBe(false);
  });

  test("a capability cannot erase its trail by being quarantined first", () => {
    const order: string[] = [];
    const s = new SupplyChainResponseService({
      now: () => NOW,
      snapshot: (id) => {
        order.push("snapshot");
        return { capabilityId: id, installedInWorkspaces: [], capturedAt: NOW, lifecycleState: "enabled" };
      },
      quarantineCapability: () => {
        order.push("quarantine");
        return { ok: true };
      },
    });
    s.revoke({ scope: "capability", targetId: "skill:evil", reason: "malicious", detail: "d", issuedBy: "sec" });
    expect(order[0]).toBe("snapshot");
  });

  test("a compromised publisher's new uploads are blocked", () => {
    const s = new SupplyChainResponseService({ now: () => NOW, capabilitiesOfPublisher: () => ["skill:a"] });
    s.revokePublisher("pub_evil", "compromised_publisher", "Key stolen.", "sec");
    expect(s.checkInstall("skill:brand_new", "1.0.0", "pub_evil").allowed).toBe(false);
  });

  test("a permissive org catalog cannot resurrect a revoked capability", () => {
    const s = new SupplyChainResponseService({ now: () => NOW });
    s.setCatalog({
      catalogId: "c1",
      organizationId: "org1",
      name: "All",
      mode: "open",
      entries: [],
      requireSigned: false,
      requireCertified: false,
      version: 1,
      updatedBy: "admin",
      updatedAt: NOW,
    });
    s.revoke({ scope: "capability", targetId: "skill:evil", reason: "malicious", detail: "d", issuedBy: "sec" });
    expect(s.checkCatalog({ organizationId: "org1", capabilityId: "skill:evil" }).allowed).toBe(false);
  });

  test("rollback to a revoked version is refused", () => {
    const s = new SupplyChainResponseService({
      now: () => NOW,
      rollbackCapability: () => ({ ok: true }),
    });
    s.revokeVersionRange("skill:x", ">=1.0.0 <2.0.0", "malicious", "backdoor", "sec");
    expect(s.restoreSafeVersion({ capabilityId: "skill:x", version: "1.5.0", actorId: "a", reason: "r" }).ok).toBe(false);
  });
});

describe("ATTACK: restore poisoning", () => {
  function ops(hash: string, scan: readonly string[] = []) {
    const m: BackupManifest = {
      backupId: "bk_evil",
      createdAt: NOW,
      profile: "personal_local",
      version: "6.1.0",
      components: [{ kind: "audit_records", recordCount: 1, sizeBytes: 1, earliestRecord: NOW, latestRecord: NOW }],
      totalSizeBytes: 1,
      integrityHash: "a".repeat(64),
      encrypted: true,
      metadata: {},
    };
    let applied = 0;
    const o = new RecoveryOperations({
      now: () => NOW,
      currentVersion: "6.1.0",
      currentProfile: "personal_local",
      getManifest: () => m,
      recomputeIntegrityHash: () => hash,
      scanForCredentials: () => scan,
      applyComponent: () => {
        applied++;
        return { ok: true, records: 1 };
      },
    });
    return { o, applied: () => applied };
  }

  test("a tampered backup is refused and nothing is applied", () => {
    const { o, applied } = ops("f".repeat(64));
    const plan = o.createPlan({ backupId: "bk_evil", mode: "full", requestedBy: "attacker" });
    const { outcome } = o.restore(plan);
    expect(outcome.ok).toBe(false);
    expect(applied()).toBe(0);
  });

  test("a backup carrying credentials is refused", () => {
    const { o, applied } = ops("a".repeat(64), ["config.apiKey"]);
    const plan = o.createPlan({ backupId: "bk_evil", mode: "full", requestedBy: "attacker" });
    const { outcome, preflight } = o.restore(plan);
    expect(preflight.ok).toBe(false);
    expect(outcome.ok).toBe(false);
    expect(applied()).toBe(0);
  });

  test("a clean backup still restores normally", () => {
    const { o, applied } = ops("a".repeat(64));
    const plan = o.createPlan({ backupId: "bk_evil", mode: "full", requestedBy: "admin" });
    const { outcome } = o.restore(plan);
    expect(outcome.ok).toBe(true);
    expect(applied()).toBe(1);
  });
});

describe("ATTACK: compromised worker", () => {
  test("incident containment disables the worker and preserves evidence", () => {
    const disabled: string[] = [];
    const svc = new IncidentService({
      now: () => NOW,
      handlers: {
        disable_worker: (id) => {
          disabled.push(id);
          return { ok: true, detail: "disabled" };
        },
      },
    });

    const i = svc.declare({
      kind: "worker_compromise",
      severity: "critical",
      title: "Worker key leaked",
      summary: "Worker credentials found in a public repo.",
      detectedBy: "scanner",
      affected: ["worker_1"],
    });

    svc.captureEvidence({
      incidentId: i.incidentId,
      kind: "worker_state",
      description: "Worker state at detection",
      capturedBy: "responder",
      payload: { workerId: "worker_1", tasks: 3 },
    });

    const r = svc.contain({
      incidentId: i.incidentId,
      actorId: "responder",
      reason: "Key leaked.",
      actions: [{ kind: "disable_worker", targetId: "worker_1" }],
    });

    expect(r.ok).toBe(true);
    expect(disabled).toContain("worker_1");
    expect(svc.verifyEvidence(i.incidentId).ok).toBe(true);
    expect(svc.get(i.incidentId)!.evidence.length).toBe(1);
  });

  test("worker compromise at critical severity is always user-visible", () => {
    const svc = new IncidentService({ now: () => NOW });
    const i = svc.declare({
      kind: "worker_compromise",
      severity: "critical",
      title: "t",
      summary: "s",
      detectedBy: "m",
    });
    expect(i.userVisibleImpact).toBe(true);
  });
});

describe("ATTACK: rollback used to bypass safety", () => {
  test("a rollback that would disable revocation enforcement is blocked", () => {
    const v = validateRollback({
      fromVersion: "6.1.0",
      toVersion: "6.0.0",
      compatibility: {
        ok: true,
        fromVersion: "6.1.0",
        toVersion: "6.0.0",
        direction: "downgrade",
        breaking: [],
        warnings: [],
        rollbackSupported: true,
        migrationRequired: false,
      },
      probe: {
        localOperationAvailable: true,
        policySafetyIntact: true,
        auditChainVerifies: true,
        backupsReadable: true,
        incidentEvidenceIntact: true,
        revocationsEnforced: false,
      },
    });
    expect(v.ok).toBe(false);
    expect(v.blockers.some((b) => b.includes("capability_revocation"))).toBe(true);
  });

  test("a rollback that would erase incident evidence is blocked", () => {
    const v = validateRollback({
      fromVersion: "6.1.0",
      toVersion: "6.0.0",
      compatibility: {
        ok: true,
        fromVersion: "6.1.0",
        toVersion: "6.0.0",
        direction: "downgrade",
        breaking: [],
        warnings: [],
        rollbackSupported: true,
        migrationRequired: false,
      },
      probe: {
        localOperationAvailable: true,
        policySafetyIntact: true,
        auditChainVerifies: true,
        backupsReadable: true,
        incidentEvidenceIntact: false,
        revocationsEnforced: true,
      },
    });
    expect(v.ok).toBe(false);
  });
});
