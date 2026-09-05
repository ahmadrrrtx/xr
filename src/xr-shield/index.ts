/**
 * XR Shield — the enforcement boundary.
 *
 * ── What this directory is (F-07 · ADR-0027) ────────────────────────────────
 *
 * Until Phase 5, "XR Shield" was the name of a host scanner
 * (`src/security/shield.ts`, now `src/hygiene/scanner.ts`) that sits on no
 * execution path and enforces nothing, while the machinery that actually
 * decides whether an agent action runs had no name at all. Two audits
 * independently flagged the same thing: the protective-sounding name was
 * attached to the wrong component, so a reader could not find the boundary by
 * looking for it.
 *
 * Phase 5 gives the boundary its name. XR Shield is the ensemble that every
 * agent action passes through:
 *
 *   1. POLICY      `capabilities/policy.ts`  — the single deterministic choke
 *                  point in the agent loop. Model proposes, runtime decides.
 *   2. GUARD       `security/guard.ts`       — action inspection: untrusted-text
 *                  scanning, path canonicalization, secret-path and host checks.
 *   3. TRUST       `runtime/trust/*`         — risk classification and the
 *                  escalate-only placement lattice (where an action may run).
 *   4. CONSENT     `control/approval-store.ts` — durable human approval for
 *                  actions the policy will not decide alone. TTL default-deny,
 *                  survives restarts, answerable cross-process.
 *   5. EGRESS      `security/egress-proxy.ts`— network destination control.
 *   6. INTEGRITY   `security/exec-integrity.ts`, `security/tool-output.ts`,
 *                  `security/secret-broker.ts` — what may execute, how tool
 *                  output is framed before it re-enters the prompt, and how
 *                  credentials are brokered rather than handed over.
 *   7. EVIDENCE    `security/audit-signer.ts`, `security/audit-verify.ts` —
 *                  the hash-chained, Ed25519-signed audit trail that makes the
 *                  above auditable after the fact.
 *
 * ── What this directory is NOT ──────────────────────────────────────────────
 *
 * It is NOT a new enforcement layer, and it does not wrap, intercept or
 * re-implement any of the modules above. Phase 5 is subtraction and renaming;
 * adding a real indirection layer here would have been new enforcement code
 * shipped under a documentation change, which is precisely the kind of
 * unreviewed security surface this phase exists to reduce.
 *
 * It is a FACADE: re-exports plus one descriptive interface. The modules keep
 * their paths (renaming 549 modules to chase a label would be churn with no
 * safety benefit), and this directory makes the name findable in code, gives
 * docs and ADRs one import path to point at, and gives the P10 pentest a
 * single enumerable surface to scope against.
 *
 * Import the concrete module when you are calling into it on a hot path.
 * Import this facade when you want the boundary as a whole — describing it,
 * testing that its parts exist, or auditing its shape.
 */

// ── 1. POLICY — the deterministic choke point ────────────────────────────────
export { evaluatePolicy, type PolicyContext as CapabilityPolicyContext } from "../capabilities/policy.ts";

// ── 2. GUARD — action inspection ─────────────────────────────────────────────
export {
  checkAction,
  scanUntrusted,
  scanMcpToolDescription,
  canonicalPath,
  isSecretPath,
  normalizeHost,
  fullyDecode,
  type ActionCheck,
  type PolicyDecision,
  type ScanResult,
  type McpDescriptionScan,
  type PolicyContext as GuardPolicyContext,
} from "../security/guard.ts";

// ── 3. TRUST — risk tiers and the placement lattice ──────────────────────────
export {
  classifyRisk,
  sensitiveBlockedPaths,
  decidePlacement,
  minPlacementForTier,
  TrustService,
  type PlacementCapabilities,
  type PlacementPolicyConfig,
  type TrustEvaluation,
  type TrustOutcome,
} from "../runtime/trust/index.ts";

// ── 4. CONSENT — durable human approval ──────────────────────────────────────
//
// The durable store, NOT the legacy `control/approvals.ts` queue facade. A
// first draft of this file re-exported the legacy queue and was caught by
// test/phase2/architecture-boundaries.test.ts, which allows exactly two
// importers of it (control/service.ts binds it; control.routes.ts serves the
// legacy dashboard). Re-exporting it here would have handed every future caller
// a supported-looking path around the store seam Phase 2 built — through the
// module named "the security boundary", which is the worst possible place to
// open a bypass.
export {
  getApprovalStore,
  makeApprover,
  ApprovalStore,
  DEFAULT_APPROVAL_TTL_MS,
  type ApprovalDecisionValue,
  type ApprovalHandle,
  type ApprovalIdentity,
  type ApprovalOutcome,
  type ApprovalRecord,
  type ApprovalRequestInput,
  type ApproverSurfaceOptions,
} from "../control/approval-store.ts";

// ── 5. EGRESS — network destination control ──────────────────────────────────
export { checkEgressTarget, guardedFetch } from "../security/egress-proxy.ts";

// ── 6. INTEGRITY — execution, tool output, secrets ───────────────────────────
export {
  resolveShellCommandIdentity,
  loadExecAllowlist,
  defaultExecAllowlistPath,
} from "../security/exec-integrity.ts";
export { frameToolOutput, type FramedToolOutput } from "../security/tool-output.ts";
export { secretBroker, secretBrokerSync } from "../security/secret-broker.ts";

// ── 7. EVIDENCE — signed, verifiable audit ───────────────────────────────────
export {
  signCheckpoint,
  checkpointMessage,
  generateAuditIdentity,
  publicKeyFingerprint,
  AUDIT_SIGNING_KEY_NAME,
} from "../security/audit-signer.ts";
export { verifySignedChain, verifyAnchorRecords } from "../security/audit-verify.ts";

/**
 * The seven components of the boundary, as data.
 *
 * This exists so the boundary can be *enumerated* rather than described in
 * prose that drifts: the README table, ADR-0027, and
 * `test/architecture/xr-shield-facade.test.ts` all read this array, so a
 * component cannot be silently added, dropped, or moved without the docs and
 * the test disagreeing with the code.
 */
export interface ShieldComponent {
  /** Stable id used by docs tables and tests. */
  readonly id:
    | "policy"
    | "guard"
    | "trust"
    | "consent"
    | "egress"
    | "integrity"
    | "evidence";
  /** Human-readable name as it appears in the README table. */
  readonly name: string;
  /** Repo-relative module paths that implement this component. */
  readonly modules: readonly string[];
  /** The question this component answers about an action. */
  readonly question: string;
  /** Whether this component can, by itself, stop an action from running. */
  readonly blocking: boolean;
}

export const XR_SHIELD_COMPONENTS: readonly ShieldComponent[] = [
  {
    id: "policy",
    name: "Capability policy",
    modules: ["src/capabilities/policy.ts"],
    question: "Is this capability permitted for this workspace and mode?",
    blocking: true,
  },
  {
    id: "guard",
    name: "Action guard",
    modules: ["src/security/guard.ts"],
    question: "Is the action itself dangerous once fully decoded and canonicalized?",
    blocking: true,
  },
  {
    id: "trust",
    name: "Trust lattice + placement",
    modules: [
      "src/runtime/trust/classify.ts",
      "src/runtime/trust/policy.ts",
      "src/runtime/trust/service.ts",
    ],
    question: "What risk tier is this, and where is it allowed to run?",
    blocking: true,
  },
  {
    id: "consent",
    name: "Consent / approvals",
    modules: ["src/control/approval-store.ts"],
    question: "Has a human approved this action?",
    blocking: true,
  },
  {
    id: "egress",
    name: "Network egress control",
    modules: ["src/security/egress-proxy.ts", "src/security/private-ip.ts"],
    question: "Is this network destination allowed?",
    blocking: true,
  },
  {
    id: "integrity",
    name: "Execution + output integrity",
    modules: [
      "src/security/exec-integrity.ts",
      "src/security/tool-output.ts",
      "src/security/secret-broker.ts",
    ],
    question:
      "Is this binary allowlisted, is tool output framed before re-entering the prompt, and are secrets brokered rather than exposed?",
    blocking: true,
  },
  {
    id: "evidence",
    name: "Signed audit evidence",
    modules: ["src/security/audit-signer.ts", "src/security/audit-verify.ts"],
    question: "Can this decision be proven after the fact, and would tampering show?",
    blocking: false, // records and proves; does not itself refuse an action
  },
] as const;

/**
 * The scanner is deliberately absent from the list above.
 *
 * `src/hygiene/scanner.ts` (the module that used to be called "XR Shield") is
 * NOT part of the boundary: it inspects the host and reports, and no agent
 * action is routed through it. Keeping it out of this enumeration is the whole
 * point of ADR-0027 — the name now follows the enforcement, not the branding.
 */
export const HYGIENE_IS_NOT_THE_BOUNDARY = true as const;
