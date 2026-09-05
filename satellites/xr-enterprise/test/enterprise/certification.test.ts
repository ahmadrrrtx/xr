/**
 * XR 6.1 — Phase 12 Tests: Certification evidence and anti-compliance-theater.
 *
 * The most important assertion in this file: XR must NEVER claim an external
 * certification it has not obtained.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildEvidencePack,
  assertNoFalseCertificationClaim,
  renderEvidenceSummary,
  PHASE12_CONTROLS,
  PHASE12_THREAT_MODEL,
  EVIDENCE_DISCLAIMER,
} from "../../src/enterprise/index.ts";

const NOW = 1_800_000_000_000;
const ROOT = join(import.meta.dir, "..", "..");

describe("Control catalog", () => {
  test("controls have unique ids", () => {
    const ids = PHASE12_CONTROLS.map((c) => c.controlId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every control declares an assurance kind and status", () => {
    for (const c of PHASE12_CONTROLS) {
      expect(["technical", "operational", "external_required"]).toContain(c.assurance);
      expect(["implemented", "partial", "not_implemented", "not_applicable"]).toContain(c.status);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  test("every implemented technical control names a source file and a test", () => {
    for (const c of PHASE12_CONTROLS) {
      if (c.status === "implemented" && c.assurance === "technical") {
        expect(c.implementedIn.length).toBeGreaterThan(0);
        expect(c.testedBy.length).toBeGreaterThan(0);
      }
    }
  });

  test("EVERY REFERENCED SOURCE FILE ACTUALLY EXISTS", () => {
    const missing: string[] = [];
    for (const c of PHASE12_CONTROLS) {
      for (const f of c.implementedIn) {
        if (!existsSync(join(ROOT, f))) missing.push(`${c.controlId} → ${f}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("EVERY REFERENCED TEST FILE ACTUALLY EXISTS", () => {
    const missing: string[] = [];
    for (const c of PHASE12_CONTROLS) {
      for (const f of c.testedBy) {
        if (!existsSync(join(ROOT, f))) missing.push(`${c.controlId} → ${f}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("external-required controls are NOT marked implemented", () => {
    for (const c of PHASE12_CONTROLS) {
      if (c.assurance === "external_required") {
        expect(c.status).not.toBe("implemented");
      }
    }
  });

  test("external-required controls state plainly that they were not performed", () => {
    for (const c of PHASE12_CONTROLS) {
      if (c.assurance === "external_required") {
        const text = c.limitations.join(" ").toUpperCase();
        expect(text).toMatch(/NOT (PERFORMED|OBTAINED)/);
      }
    }
  });

  test("SOC 2 and penetration testing are explicitly not implemented", () => {
    const soc2 = PHASE12_CONTROLS.find((c) => c.controlId === "EX-02")!;
    const pentest = PHASE12_CONTROLS.find((c) => c.controlId === "EX-03")!;
    expect(soc2.status).toBe("not_implemented");
    expect(pentest.status).toBe("not_implemented");
  });

  test("partial controls explain what is missing", () => {
    for (const c of PHASE12_CONTROLS) {
      if (c.status === "partial") expect(c.limitations.length).toBeGreaterThan(0);
    }
  });

  test("the catalog covers every Phase 12 domain", () => {
    const prefixes = new Set(PHASE12_CONTROLS.map((c) => c.controlId.split("-")[0]));
    for (const p of ["AC", "AU", "OP", "IR", "SC", "DR", "RM", "TN", "EX"]) {
      expect(prefixes.has(p)).toBe(true);
    }
  });
});

describe("Threat model", () => {
  test("threats have unique ids and mitigations", () => {
    const ids = PHASE12_THREAT_MODEL.map((t) => t.threatId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of PHASE12_THREAT_MODEL) {
      expect(t.mitigations.length).toBeGreaterThan(0);
      expect(["low", "medium", "high"]).toContain(t.residualRisk);
    }
  });

  test("the admin-hides-safety threat is modeled", () => {
    const t = PHASE12_THREAT_MODEL.find((x) => x.threatId === "T-01")!;
    expect(t.title.toLowerCase()).toContain("administrator");
    expect(t.residualRisk).toBe("low");
  });

  test("compliance theater is itself modeled as a threat", () => {
    const t = PHASE12_THREAT_MODEL.find((x) => x.title.toLowerCase().includes("compliance theater"));
    expect(t).toBeDefined();
  });

  test("local-autonomy coercion is modeled as a threat", () => {
    const t = PHASE12_THREAT_MODEL.find((x) => x.threatId === "T-08")!;
    expect(t.mitigations.some((m) => m.includes("TN-02"))).toBe(true);
  });
});

describe("Evidence pack", () => {
  test("a default pack is NOT externally certified", () => {
    const pack = buildEvidencePack({ xrVersion: "6.1.0", profile: "team_private", now: NOW });
    expect(pack.externallyCertified).toBe(false);
    expect(pack.externalCertifications.length).toBe(0);
  });

  test("the disclaimer is present and substantial", () => {
    const pack = buildEvidencePack({ xrVersion: "6.1.0", profile: "team_private", now: NOW });
    expect(pack.disclaimer).toBe(EVIDENCE_DISCLAIMER);
    expect(pack.disclaimer.length).toBeGreaterThan(200);
    expect(pack.disclaimer).toContain("NOT a certification");
  });

  test("the disclaimer names the standards XR does not claim", () => {
    for (const s of ["SOC 2", "ISO 27001", "HIPAA"]) {
      expect(EVIDENCE_DISCLAIMER).toContain(s);
    }
  });

  test("the summary counts match the catalog", () => {
    const pack = buildEvidencePack({ xrVersion: "6.1.0", profile: "team_private", now: NOW });
    expect(pack.summary.total).toBe(PHASE12_CONTROLS.length);
    expect(pack.summary.implemented + pack.summary.partial + pack.summary.notImplemented).toBeLessThanOrEqual(pack.summary.total);
    expect(pack.summary.technical + pack.summary.operational + pack.summary.externalRequired).toBe(pack.summary.total);
  });

  test("not-implemented controls appear in skippedControls", () => {
    const pack = buildEvidencePack({ xrVersion: "6.1.0", profile: "team_private", now: NOW });
    expect(pack.skippedControls.length).toBeGreaterThan(0);
    expect(pack.skippedControls.some((s) => s.startsWith("EX-"))).toBe(true);
  });

  test("medium and high residual risks surface as unresolved", () => {
    const pack = buildEvidencePack({ xrVersion: "6.1.0", profile: "team_private", now: NOW });
    expect(pack.unresolvedRisks.length).toBeGreaterThan(0);
  });

  test("the content hash is stable and content-sensitive", () => {
    const a = buildEvidencePack({ xrVersion: "6.1.0", profile: "team_private", now: NOW });
    const b = buildEvidencePack({ xrVersion: "6.1.0", profile: "team_private", now: NOW });
    expect(a.contentHash).toBe(b.contentHash);
    const c = buildEvidencePack({
      xrVersion: "6.1.0",
      profile: "team_private",
      now: NOW,
      externalCertifications: ["SOC 2 Type II by Example CPA, 2026-06-01"],
    });
    expect(c.contentHash).not.toBe(a.contentHash);
  });

  test("supplying a real attestation is the ONLY way to set externallyCertified", () => {
    const pack = buildEvidencePack({
      xrVersion: "6.1.0",
      profile: "managed_cloud",
      now: NOW,
      externalCertifications: ["SOC 2 Type II — Example CPA LLP — report 2026-06-01"],
    });
    expect(pack.externallyCertified).toBe(true);
    expect(pack.externalCertifications.length).toBe(1);
  });
});

describe("ANTI-COMPLIANCE-THEATER GUARD", () => {
  test("the shipped default pack passes the guard with zero violations", () => {
    const pack = buildEvidencePack({ xrVersion: "6.1.0", profile: "team_private", now: NOW });
    expect(assertNoFalseCertificationClaim(pack)).toEqual([]);
  });

  test("the guard passes for every deployment profile", () => {
    for (const profile of ["personal_local", "private_local_server", "team_private", "managed_cloud", "hybrid"] as const) {
      const pack = buildEvidencePack({ xrVersion: "6.1.0", profile, now: NOW });
      expect(assertNoFalseCertificationClaim(pack)).toEqual([]);
    }
  });

  test("claiming certification with no attestation is caught", () => {
    const pack = {
      ...buildEvidencePack({ xrVersion: "6.1.0", profile: "team_private", now: NOW }),
      externallyCertified: true,
      externalCertifications: [] as string[],
    };
    const v = assertNoFalseCertificationClaim(pack);
    expect(v.length).toBeGreaterThan(0);
    expect(v.some((x) => x.includes("no attestations"))).toBe(true);
  });

  test("marking an external-required control as implemented is caught", () => {
    const pack = buildEvidencePack({
      xrVersion: "6.1.0",
      profile: "team_private",
      now: NOW,
      controls: [
        {
          controlId: "EX-99",
          title: "Self-declared SOC 2",
          description: "d",
          assurance: "external_required",
          status: "implemented",
          implementedIn: ["src/enterprise/index.ts"],
          testedBy: ["test/enterprise/certification.test.ts"],
          limitations: [],
        },
      ],
    });
    const v = assertNoFalseCertificationClaim(pack);
    expect(v.some((x) => x.includes("requires external assurance"))).toBe(true);
  });

  test("a technical control with no test evidence is caught", () => {
    const pack = buildEvidencePack({
      xrVersion: "6.1.0",
      profile: "team_private",
      now: NOW,
      controls: [
        {
          controlId: "AC-99",
          title: "Unproven control",
          description: "d",
          assurance: "technical",
          status: "implemented",
          implementedIn: ["src/enterprise/index.ts"],
          testedBy: [],
          limitations: [],
        },
      ],
    });
    expect(assertNoFalseCertificationClaim(pack).some((x) => x.includes("no test evidence"))).toBe(true);
  });

  test("a control with no source reference is caught", () => {
    const pack = buildEvidencePack({
      xrVersion: "6.1.0",
      profile: "team_private",
      now: NOW,
      controls: [
        {
          controlId: "AC-98",
          title: "Phantom control",
          description: "d",
          assurance: "operational",
          status: "implemented",
          implementedIn: [],
          testedBy: [],
          limitations: [],
        },
      ],
    });
    expect(assertNoFalseCertificationClaim(pack).some((x) => x.includes("no source reference"))).toBe(true);
  });

  test("an inadequate disclaimer is caught", () => {
    const pack = { ...buildEvidencePack({ xrVersion: "6.1.0", profile: "team_private", now: NOW }), disclaimer: "trust us" };
    expect(assertNoFalseCertificationClaim(pack).some((x) => x.includes("disclaimer"))).toBe(true);
  });

  test("an unqualified certification claim in the pack text is caught", () => {
    const pack = {
      ...buildEvidencePack({ xrVersion: "6.1.0", profile: "team_private", now: NOW }),
      controls: [
        {
          controlId: "X-1",
          title: "Marketing",
          description: "XR is SOC 2 certified.",
          assurance: "operational" as const,
          status: "implemented" as const,
          implementedIn: ["src/enterprise/index.ts"],
          testedBy: ["test/enterprise/certification.test.ts"],
          limitations: [],
        },
      ],
    };
    expect(assertNoFalseCertificationClaim(pack).some((x) => x.includes("unqualified"))).toBe(true);
  });
});

describe("Evidence rendering", () => {
  test("the summary renders key facts", () => {
    const pack = buildEvidencePack({ xrVersion: "6.1.0", profile: "team_private", now: NOW });
    const text = renderEvidenceSummary(pack);
    expect(text).toContain("6.1.0");
    expect(text).toContain("team_private");
    expect(text).toContain("Externally certified: NO");
    expect(text).toContain(EVIDENCE_DISCLAIMER);
  });

  test("the rendered summary lists skipped controls", () => {
    const pack = buildEvidencePack({ xrVersion: "6.1.0", profile: "team_private", now: NOW });
    expect(renderEvidenceSummary(pack)).toContain("Skipped/not implemented");
  });
});

describe("Repository-level honesty checks", () => {
  test("no Phase 12 doc claims an unobtained certification", () => {
    const docs = ["docs/enterprise-readiness/CERTIFICATION_EVIDENCE.md", "docs/enterprise-readiness/ENTERPRISE_TRUST_ARCHITECTURE.md"];
    const forbidden = /\b(we are|xr is)\s+(soc\s*2|iso\s*27001|hipaa|pci[- ]dss|fedramp)\s+(certified|compliant)\b/i;
    for (const d of docs) {
      const p = join(ROOT, d);
      if (!existsSync(p)) continue;
      expect(forbidden.test(readFileSync(p, "utf8"))).toBe(false);
    }
  });
});
