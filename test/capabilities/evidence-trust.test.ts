/**
 * XR Phase 7 · T3 — Evidence-based marketplace trust tests.
 *
 * Proves popularity NEVER dominates: a high-download but unsigned /
 * low-evidence capability ranks below a low-download signed + tested one,
 * across a 10x → 10⁶x download sweep, with explanations available.
 */
import { expect, test } from "bun:test";
import { EvidenceTrustScorer, POPULARITY_MAX_WEIGHT, popularityFactor } from "../../src/platform/capabilities/trust.ts";
import type { CapabilityDescriptor } from "../../src/platform/capabilities/types.ts";
import { CAPABILITY_DESCRIPTOR_SCHEMA_VERSION } from "../../src/platform/capabilities/types.ts";

function descriptor(overrides: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
  const base: CapabilityDescriptor = {
    schemaVersion: CAPABILITY_DESCRIPTOR_SCHEMA_VERSION,
    id: "skill:test",
    nativeId: "test",
    type: "skill",
    name: "Test Skill",
    version: "1.0.0",
    description: "test",
    publisher: { id: "pub", name: "pub", verified: false, trustLevel: "unknown" },
    provenance: { source: "unknown", observedAt: 1 },
    package: { signatureStatus: "unsigned", verifiedAt: 1 },
    compatibility: {},
    dependencies: [],
    permissions: { declared: [], effective: { declared: [], publisherPolicy: [], packagePolicy: [], workspacePolicy: [], userGrant: [], agentTaskGrant: [], trustPlacementLimit: [], denied: [], effective: [], undetermined: false } },
    dataScopes: [],
    network: { required: false, domains: [], locality: "local" },
    credentials: { required: false, refs: [] },
    providerRequirements: { providerIds: [], modelCapabilities: [] },
    placement: { requested: "in_process", riskTier: "tier0", requiresHostAuthority: false },
    interfaces: [],
    certification: { status: "unknown", tests: [] },
    lifecycle: { state: "discovered", enabled: false, installed: false, rollbackAvailable: false, history: [] },
    trust: { trustLevel: "unknown", verifiedPublisher: false, signedPackage: false, signatureStatus: "unsigned", certificationStatus: "unknown", vulnerabilityStatus: "unknown", maintenanceStatus: "unknown", evidenceScore: 0, evidence: [] },
    support: { maintenance: "unknown" },
    cost: {},
    tags: [],
    keywords: [],
    ...overrides,
  };
  return base;
}

const signedTested = descriptor({
  id: "skill:signed-tested",
  publisher: { id: "verified-pub", name: "Verified Publisher", verified: true, trustLevel: "verified" },
  provenance: { source: "marketplace", sourceUrl: "https://example.com/skill", registry: "xr-marketplace", installedAt: 1, observedAt: 1 },
  package: { signatureStatus: "valid", signatureKeyId: "k1", verifiedAt: 1 },
  certification: { status: "xr-tested", tests: [{ id: "t1", kind: "execution", status: "passed", message: "ok" }], certifiedAt: 1, certifiedBy: "xr-contract" },
  support: { maintenance: "active" },
  trust: { trustLevel: "reviewed", verifiedPublisher: true, signedPackage: true, signatureStatus: "valid", certificationStatus: "xr-tested", vulnerabilityStatus: "none-known", maintenanceStatus: "active", evidenceScore: 0.8, evidence: [] },
});

const unsignedPopular = descriptor({
  id: "skill:unsigned-popular",
  publisher: { id: "random-pub", name: "Random Publisher", verified: false, trustLevel: "unknown" },
  provenance: { source: "unknown", observedAt: 1 },
  package: { signatureStatus: "unsigned" },
  certification: { status: "unknown", tests: [] },
  support: { maintenance: "unknown" },
});

test("popularity factor is log-scaled and bounded", () => {
  expect(popularityFactor(undefined)).toBe(0);
  expect(popularityFactor(0)).toBe(0);
  expect(popularityFactor(10)).toBeGreaterThan(0);
  expect(popularityFactor(1_000_000)).toBeLessThanOrEqual(1);
  expect(popularityFactor(10_000_000)).toBeLessThanOrEqual(1);
  // 1000x more downloads cannot even double the factor.
  expect(popularityFactor(1_000_000)).toBeLessThan(popularityFactor(1_000) * 2);
});

test("a signed + tested low-download capability outranks an unsigned high-download one", () => {
  const scorer = new EvidenceTrustScorer();
  for (const downloads of [1_000, 100_000, 10_000_000]) {
    const signed = scorer.score(signedTested, { downloads: 10 });
    const popular = scorer.score(unsignedPopular, { downloads });
    expect(signed.score).toBeGreaterThan(popular.score);
    // And with NO popularity data at all, evidence alone still decides.
    expect(signed.evidenceScore).toBeGreaterThan(popular.evidenceScore);
  }
});

test("popularity contributes at most 5% — it can only nudge, never decide", () => {
  const scorer = new EvidenceTrustScorer();
  const zeroPop = scorer.score(signedTested, { downloads: 0 });
  const maxPop = scorer.score(signedTested, { downloads: 10_000_000 });
  const delta = maxPop.score - zeroPop.score;
  expect(delta).toBeLessThanOrEqual(POPULARITY_MAX_WEIGHT + 1e-9);
  expect(maxPop.popularityFactor).toBeLessThanOrEqual(1);
});

test("evidence components are explainable (why this ranks)", () => {
  const scorer = new EvidenceTrustScorer();
  const res = scorer.score(signedTested, { downloads: 5 });
  expect(res.reasons.some((r) => r.includes("signature valid"))).toBe(true);
  expect(res.reasons.some((r) => r.includes("verified"))).toBe(true);
  expect(res.reasons.some((r) => r.includes("xr-tested"))).toBe(true);
  expect(res.reasons.some((r) => r.includes("popularity"))).toBe(true);

  const unsigned = scorer.score(unsignedPopular);
  expect(unsigned.reasons.some((r) => r.includes("unsigned"))).toBe(true);
  expect(unsigned.reasons.some((r) => r.includes("NOT verified"))).toBe(true);
  expect(unsigned.reasons.some((r) => r.includes("unknown"))).toBe(true);
});

test("rank orders by evidence with stable output", () => {
  const scorer = new EvidenceTrustScorer();
  const ranked = scorer.rank(
    [
      unsignedPopular,
      signedTested,
      descriptor({ id: "skill:mid", package: { signatureStatus: "unverified" }, certification: { status: "self-tested", tests: [] } }),
    ],
    { downloadsOf: (d) => (d.id === "skill:unsigned-popular" ? 5_000_000 : d.id === "skill:signed-tested" ? 3 : 500) },
  );
  expect(ranked[0].descriptor.id).toBe("skill:signed-tested");
  expect(ranked[ranked.length - 1].descriptor.id).toBe("skill:unsigned-popular");
});

test("outcomes affect the score but absence is not penalized to zero", () => {
  const scorer = new EvidenceTrustScorer();
  const noOutcomes = scorer.score(signedTested, { outcomes: undefined });
  const goodOutcomes = scorer.score(signedTested, { outcomes: { uses: 50, successes: 49, failures: 1 } });
  const badOutcomes = scorer.score(signedTested, { outcomes: { uses: 50, successes: 5, failures: 45 } });
  expect(goodOutcomes.score).toBeGreaterThan(noOutcomes.score);
  expect(goodOutcomes.score).toBeGreaterThan(badOutcomes.score);
  expect(noOutcomes.score).toBeGreaterThan(0);
});

test("quarantined/flagged capabilities score near zero regardless of downloads", () => {
  const scorer = new EvidenceTrustScorer();
  const quarantined = descriptor({
    id: "skill:bad",
    lifecycle: { state: "quarantined", enabled: false, installed: true, quarantineReason: "malware", rollbackAvailable: true, history: [] },
    trust: { trustLevel: "unknown", verifiedPublisher: false, signedPackage: true, signatureStatus: "valid", certificationStatus: "quarantined", vulnerabilityStatus: "quarantined", maintenanceStatus: "unknown", evidenceScore: 0, evidence: [] },
    certification: { status: "quarantined", tests: [], reason: "malware" },
  });
  const res = scorer.score(quarantined, { downloads: 10_000_000 });
  expect(res.score).toBeLessThan(0.2);
});
