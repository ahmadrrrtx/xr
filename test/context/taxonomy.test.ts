/**
 * XR 4.5 — Phase 6 §11.1 unit tests: taxonomy, metadata, consent, trust,
 * provenance, freshness, confidence, bounds.
 *
 * These tests assert the CONTRACT, not the implementation: if any of them
 * fails, the guarantee "memory is context, not authority" has been weakened.
 */
import { describe, test, expect } from "bun:test";
import {
  CONTEXT_BOUNDS,
  CONTEXT_TIERS,
  CONTEXT_TYPES,
  CONSENT_STATES,
  TIER_POLICIES,
  TRUST_STATUSES,
  boundText,
  clampTrustToProvenance,
  computeFreshness,
  consentAllowsRetrieval,
  consentIsTerminal,
  contentHash,
  defaultTierForType,
  deriveTitle,
  emptyUncertainty,
  freshnessBlocksRetrieval,
  isConsentState,
  isContextTier,
  isContextType,
  isTrustStatus,
  itemIsRetrievable,
  mayActAsInstruction,
  maxTrustForProvenance,
  requiresQuarantine,
  requiresRedaction,
  trustRank,
  typeMayCarryAuthority,
  type ContextItem,
  type ContextType,
  type TrustStatus,
} from "../../src/context/types.ts";

function item(over: Partial<ContextItem> = {}): ContextItem {
  const now = Date.now();
  return {
    id: "ctx_test",
    version: 1,
    type: "memory",
    content: "content",
    title: "title",
    scope: { workspaceId: "default", projectScope: "global", userId: "local" },
    trustStatus: "approved_memory",
    consentState: "approved",
    provenanceKind: "user_input",
    actorKind: "user",
    freshness: computeFreshness({ createdAt: now, updatedAt: now }, now),
    uncertainty: emptyUncertainty(),
    sensitivity: "unknown",
    retention: "durable",
    links: {},
    indexState: "none",
    tags: [],
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    ...over,
  };
}

// ── Taxonomy ────────────────────────────────────────────────────────────────

describe("XR 4.5 context taxonomy", () => {
  test("the seven classes are distinct and none is collapsed into 'memory'", () => {
    expect(CONTEXT_TYPES).toEqual([
      "instruction",
      "memory",
      "knowledge",
      "evidence",
      "artifact",
      "task_context",
      "untrusted",
    ]);
    expect(new Set(CONTEXT_TYPES).size).toBe(CONTEXT_TYPES.length);
  });

  test("ONLY 'instruction' may ever carry authority", () => {
    const authority = CONTEXT_TYPES.filter(typeMayCarryAuthority);
    expect(authority).toEqual(["instruction"]);
  });

  test("every type has a default tier and it is a real tier", () => {
    for (const t of CONTEXT_TYPES) {
      const tier = defaultTierForType(t);
      expect(isContextTier(tier)).toBe(true);
      // The default tier must actually accept the type.
      expect(TIER_POLICIES[tier].allowedTypes).toContain(t);
    }
  });

  test("type guards reject unknown values", () => {
    expect(isContextType("memory")).toBe(true);
    expect(isContextType("anything_else")).toBe(false);
    expect(isTrustStatus("approved_memory")).toBe(true);
    expect(isTrustStatus("super_trusted")).toBe(false);
    expect(isConsentState("legacy_unknown")).toBe(true);
    expect(isConsentState("probably_fine")).toBe(false);
  });
});

// ── Authority ───────────────────────────────────────────────────────────────

describe("XR 4.5 authority gate", () => {
  test("mayActAsInstruction requires BOTH instruction type and trusted trust", () => {
    expect(mayActAsInstruction("instruction", "trusted_instruction")).toBe(true);
    // Right type, wrong trust.
    expect(mayActAsInstruction("instruction", "approved_memory")).toBe(false);
    expect(mayActAsInstruction("instruction", "untrusted_external")).toBe(false);
    // Right trust, wrong type — this is the memory-poisoning vector.
    expect(mayActAsInstruction("memory", "trusted_instruction")).toBe(false);
    expect(mayActAsInstruction("knowledge", "trusted_instruction")).toBe(false);
    expect(mayActAsInstruction("evidence", "trusted_instruction")).toBe(false);
    expect(mayActAsInstruction("untrusted", "trusted_instruction")).toBe(false);
  });

  test("NO combination of memory + any trust can instruct", () => {
    for (const trust of TRUST_STATUSES) {
      expect(mayActAsInstruction("memory", trust)).toBe(false);
    }
  });

  test("untrusted and unknown trust always require quarantine", () => {
    expect(requiresQuarantine("untrusted_external")).toBe(true);
    expect(requiresQuarantine("unknown")).toBe(true);
    expect(requiresQuarantine("approved_memory")).toBe(false);
    expect(requiresQuarantine("source_evidence")).toBe(false);
  });

  test("trust ranking is strictly ordered", () => {
    expect(trustRank("trusted_instruction")).toBeGreaterThan(trustRank("approved_memory"));
    expect(trustRank("approved_memory")).toBeGreaterThan(trustRank("source_evidence"));
    expect(trustRank("source_evidence")).toBeGreaterThan(trustRank("generated_synthesis"));
    expect(trustRank("generated_synthesis")).toBeGreaterThan(trustRank("untrusted_external"));
    expect(trustRank("untrusted_external")).toBeGreaterThan(trustRank("unknown"));
  });
});

// ── Anti-spoofing ───────────────────────────────────────────────────────────

describe("XR 4.5 provenance trust ceilings (anti-spoofing)", () => {
  test("web/tool/mcp/plugin content can never claim more than untrusted", () => {
    for (const kind of ["web", "search_result", "tool_output", "mcp_output", "plugin_output", "skill_output"] as const) {
      expect(maxTrustForProvenance(kind)).toBe("untrusted_external");
      expect(clampTrustToProvenance("trusted_instruction", kind)).toBe("untrusted_external");
      expect(clampTrustToProvenance("approved_memory", kind)).toBe("untrusted_external");
    }
  });

  test("model synthesis can never become a user fact", () => {
    expect(maxTrustForProvenance("model_synthesis")).toBe("generated_synthesis");
    expect(clampTrustToProvenance("approved_memory", "model_synthesis")).toBe("generated_synthesis");
    expect(clampTrustToProvenance("trusted_instruction", "model_synthesis")).toBe("generated_synthesis");
  });

  test("clamping never RAISES trust", () => {
    for (const kind of ["web", "file", "user_input", "system", "import"] as const) {
      for (const requested of TRUST_STATUSES) {
        const result = clampTrustToProvenance(requested, kind);
        expect(trustRank(result)).toBeLessThanOrEqual(trustRank(requested));
      }
    }
  });

  test("only 'system' provenance reaches trusted_instruction", () => {
    const reaching = (["user_input", "file", "web", "search_result", "tool_output", "mcp_output",
      "plugin_output", "skill_output", "model_synthesis", "research", "business_record",
      "execution_record", "artifact", "import", "system", "unknown"] as const)
      .filter((k) => maxTrustForProvenance(k) === "trusted_instruction");
    expect(reaching).toEqual(["system"]);
  });
});

// ── Consent ─────────────────────────────────────────────────────────────────

describe("XR 4.5 consent states", () => {
  test("only approved / limited / legacy_unknown permit retrieval", () => {
    const retrievable = CONSENT_STATES.filter(consentAllowsRetrieval);
    expect(retrievable.sort()).toEqual(["approved", "legacy_unknown", "limited"]);
  });

  test("proposed content is NOT retrievable — nothing self-approves", () => {
    expect(consentAllowsRetrieval("proposed")).toBe(false);
  });

  test("quarantined content is NOT retrievable", () => {
    expect(consentAllowsRetrieval("quarantined")).toBe(false);
  });

  test("revoked and deleted are terminal", () => {
    expect(consentIsTerminal("revoked")).toBe(true);
    expect(consentIsTerminal("deleted")).toBe(true);
    expect(consentIsTerminal("approved")).toBe(false);
    expect(consentIsTerminal("legacy_unknown")).toBe(false);
  });

  test("legacy_unknown is retrievable but distinct from approved", () => {
    // Migration honesty: legacy data keeps working, but is never relabelled.
    expect(consentAllowsRetrieval("legacy_unknown")).toBe(true);
    expect("legacy_unknown").not.toBe("approved");
  });
});

// ── Freshness ───────────────────────────────────────────────────────────────

describe("XR 4.5 freshness", () => {
  const now = 1_700_000_000_000;
  const day = 86_400_000;

  test("labels degrade deterministically with age", () => {
    expect(computeFreshness({ createdAt: now, updatedAt: now }, now).label).toBe("fresh");
    expect(computeFreshness({ createdAt: now, updatedAt: now - 10 * day }, now).label).toBe("recent");
    expect(computeFreshness({ createdAt: now, updatedAt: now - 60 * day }, now).label).toBe("aging");
    expect(computeFreshness({ createdAt: now, updatedAt: now - 400 * day }, now).label).toBe("stale");
  });

  test("hard expiry wins over everything", () => {
    const f = computeFreshness({ createdAt: now, updatedAt: now, expiresAt: now - 1 }, now);
    expect(f.label).toBe("expired");
    expect(freshnessBlocksRetrieval(f.label)).toBe(true);
  });

  test("supersession marks an item stale even when recently updated", () => {
    const f = computeFreshness({ createdAt: now, updatedAt: now, supersededBy: "ctx_new" }, now);
    expect(f.label).toBe("stale");
    expect(f.reason).toContain("ctx_new");
  });

  test("age is measured from SOURCE observation when known", () => {
    // Row updated now, but the world was sampled a year ago → stale, not fresh.
    const f = computeFreshness(
      { createdAt: now, updatedAt: now, sourceObservedAt: now - 400 * day },
      now,
    );
    expect(f.label).toBe("stale");
    expect(f.reason).toContain("source observed");
  });

  test("only 'expired' blocks retrieval — stale is shown, not hidden", () => {
    expect(freshnessBlocksRetrieval("stale")).toBe(false);
    expect(freshnessBlocksRetrieval("aging")).toBe(false);
    expect(freshnessBlocksRetrieval("unknown")).toBe(false);
    expect(freshnessBlocksRetrieval("expired")).toBe(true);
  });
});

// ── Tier policy ─────────────────────────────────────────────────────────────

describe("XR 4.5 tier policies", () => {
  test("exactly one tier may instruct", () => {
    const instructing = CONTEXT_TIERS.filter((t) => TIER_POLICIES[t].mayInstruct);
    expect(instructing).toEqual(["instructions"]);
  });

  test("only the instructions tier permits trusted_instruction trust", () => {
    for (const tier of CONTEXT_TIERS) {
      const p = TIER_POLICIES[tier];
      if (tier === "instructions") expect(p.maxTrust).toBe("trusted_instruction");
      else expect(trustRank(p.maxTrust)).toBeLessThan(trustRank("trusted_instruction"));
    }
  });

  test("no non-instruction tier accepts the instruction type", () => {
    for (const tier of CONTEXT_TIERS) {
      if (tier === "instructions") continue;
      expect(TIER_POLICIES[tier].allowedTypes).not.toContain("instruction" as ContextType);
    }
  });

  test("user-approved memory and instructions are never auto-compressed", () => {
    expect(TIER_POLICIES.long_term_memory.compressible).toBe(false);
    expect(TIER_POLICIES.instructions.compressible).toBe(false);
  });

  test("every tier is bounded in items and characters", () => {
    for (const tier of CONTEXT_TIERS) {
      const p = TIER_POLICIES[tier];
      expect(p.maxItems).toBeGreaterThan(0);
      expect(p.maxChars).toBeGreaterThan(0);
      expect(p.maxChars).toBeLessThanOrEqual(CONTEXT_BOUNDS.maxPackageChars);
    }
  });

  test("every tier excludes expired content", () => {
    for (const tier of CONTEXT_TIERS) {
      expect(TIER_POLICIES[tier].excludeFreshness).toContain("expired");
    }
  });
});

// ── Item retrievability ─────────────────────────────────────────────────────

describe("XR 4.5 itemIsRetrievable", () => {
  test("an approved, fresh, un-revoked item is retrievable", () => {
    expect(itemIsRetrievable(item())).toBe(true);
  });

  test("deletion, revocation, and expiry each block retrieval independently", () => {
    expect(itemIsRetrievable(item({ deletedAt: Date.now() }))).toBe(false);
    expect(itemIsRetrievable(item({ revokedAt: Date.now() }))).toBe(false);
    expect(itemIsRetrievable(item({ consentState: "revoked" }))).toBe(false);
    expect(itemIsRetrievable(item({ consentState: "proposed" }))).toBe(false);
    expect(itemIsRetrievable(item({ consentState: "quarantined" }))).toBe(false);

    const now = Date.now();
    const expired = item({
      freshness: computeFreshness({ createdAt: now, updatedAt: now, expiresAt: now - 1 }, now),
    });
    expect(itemIsRetrievable(expired, now)).toBe(false);
  });
});

// ── Bounds and helpers ──────────────────────────────────────────────────────

describe("XR 4.5 bounds and helpers", () => {
  test("boundText truncates and marks truncation", () => {
    expect(boundText("hello", 10)).toBe("hello");
    const t = boundText("x".repeat(100), 10);
    expect(t.length).toBe(10);
    expect(t.endsWith("…")).toBe(true);
  });

  test("deriveTitle collapses whitespace and bounds length", () => {
    expect(deriveTitle("  a   b \n c ")).toBe("a b c");
    expect(deriveTitle("x".repeat(200)).length).toBeLessThanOrEqual(72);
  });

  test("contentHash is deterministic and order-sensitive", () => {
    expect(contentHash(["a", "b"])).toBe(contentHash(["a", "b"]));
    expect(contentHash(["a", "b"])).not.toBe(contentHash(["b", "a"]));
    // Not confusable by concatenation (separator is included).
    expect(contentHash(["ab", "c"])).not.toBe(contentHash(["a", "bc"]));
  });

  test("all bounds are positive and finite", () => {
    for (const [k, v] of Object.entries(CONTEXT_BOUNDS)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v as number).toBeGreaterThan(0);
      expect(k.length).toBeGreaterThan(0);
    }
  });

  test("private and secret sensitivity require redaction", () => {
    expect(requiresRedaction("secret")).toBe(true);
    expect(requiresRedaction("private")).toBe(true);
    expect(requiresRedaction("public")).toBe(false);
    expect(requiresRedaction("internal")).toBe(false);
  });
});
