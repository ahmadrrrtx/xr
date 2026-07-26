/**
 * XR 4.5 — Deterministic anti-poisoning for the context layer (§7.9).
 *
 * THE RULE: an LLM may help EXPLAIN content, but deterministic policy alone
 * controls authority, retention, scope, and trust. Nothing in this file calls a
 * model.
 *
 * Threats addressed:
 *   1. untrusted content becoming a standing instruction
 *   2. malicious memory insertion
 *   3. source spoofing (claiming a higher-trust provenance than reality)
 *   4. stale memory overriding newer evidence
 *   5. model-generated claims treated as user facts
 *   6. plugin/MCP content gaining authority through retrieval
 *   7. cross-workspace contamination (handled in policy.ts — the hard fence)
 *   8. unauthorized agent context access (handled in policy.ts)
 */

import { scanUntrusted } from "../security/guard.ts";
import {
  clampTrustToProvenance,
  maxTrustForProvenance,
  trustRank,
  type ActorKind,
  type ConsentState,
  type ContextItem,
  type ContextType,
  type ProvenanceKind,
  type TrustStatus,
} from "./types.ts";

// ── Injection signatures specific to MEMORY poisoning ──────────────────────

/**
 * Patterns that indicate text is trying to become a standing instruction rather
 * than being remembered as a fact. These extend (not replace) the existing
 * `scanUntrusted` signatures in `src/security/guard.ts`.
 */
const MEMORY_POISON_PATTERNS: Array<{ name: string; re: RegExp }> = [
  {
    name: "standing_instruction",
    re: /\b(always|never|from now on|going forward|in future|henceforth)\b[^.\n]{0,80}\b(do|run|execute|send|delete|approve|allow|disable|ignore|bypass|skip)\b/i,
  },
  {
    name: "self_persisting",
    re: /\b(remember (this|the following) (instruction|rule|command)|store this as (a )?(rule|instruction|system prompt)|add (this )?to (your )?(system prompt|instructions))/i,
  },
  {
    name: "authority_claim",
    re: /\b(as (the )?(system|admin|administrator|developer|owner)|i am (the )?(system|admin|administrator|developer)|on behalf of (the )?(system|xr))\b/i,
  },
  {
    name: "policy_override",
    re: /\b(disable|turn off|bypass|skip|ignore) (the )?(safety|security|approval|confirmation|guard|policy|shield|sandbox|isolation)\b/i,
  },
  {
    name: "consent_forgery",
    re: /\b(the user (has )?(already )?(approved|consented|authorized)|consent (was|is) (already )?(given|granted))\b/i,
  },
  {
    name: "exfil_instruction",
    re: /\b(send|post|upload|forward|email|transmit)\b[^.\n]{0,60}\b(api[_\s-]?key|token|secret|credential|password|\.env|private key)\b/i,
  },
  {
    name: "tool_directive",
    re: /\b(call|invoke|use) (the )?(tool|function|shell|bash|command)\b[^.\n]{0,60}\b(with|and)\b/i,
  },
];

export interface PoisonScan {
  /** True when any signature matched. */
  flagged: boolean;
  /** Signature names, safe to log and display. */
  signatures: string[];
  /** Deterministic severity derived from which signatures matched. */
  severity: "none" | "low" | "medium" | "high";
}

/** Signatures that always force quarantine rather than a trust downgrade. */
const HIGH_SEVERITY = new Set([
  "standing_instruction",
  "self_persisting",
  "authority_claim",
  "policy_override",
  "consent_forgery",
  "exfil_instruction",
  "instruction_override",
  "unrestricted_mode",
  "fake_system",
  "leak_keys",
]);

const MEDIUM_SEVERITY = new Set([
  "tool_directive",
  "prompt_extraction",
  "pipe_to_shell",
  "rm_rf",
  "secret_path",
  "exfil_url",
  "mass_delete",
  "zero_width",
]);

/**
 * Scan content for memory/context poisoning. Combines XR's existing untrusted
 * scanner with context-specific signatures.
 */
export function scanForPoisoning(content: string): PoisonScan {
  const base = scanUntrusted(content);
  const signatures = [...base.signatures];

  for (const p of MEMORY_POISON_PATTERNS) {
    if (p.re.test(content)) signatures.push(p.name);
  }

  if (signatures.length === 0) return { flagged: false, signatures: [], severity: "none" };

  let severity: PoisonScan["severity"] = "low";
  if (signatures.some((s) => HIGH_SEVERITY.has(s))) severity = "high";
  else if (signatures.some((s) => MEDIUM_SEVERITY.has(s))) severity = "medium";

  return { flagged: true, signatures, severity };
}

// ── Admission control for durable writes ───────────────────────────────────

export interface AdmissionRequest {
  content: string;
  type: ContextType;
  /** Trust the caller CLAIMS. Never taken at face value. */
  requestedTrust: TrustStatus;
  provenanceKind: ProvenanceKind;
  actorKind: ActorKind;
  /** Consent state the caller requests. Policy may only downgrade it. */
  requestedConsent: ConsentState;
}

export interface AdmissionDecision {
  /** May this be stored at all? */
  admit: boolean;
  /** The trust status that will actually be recorded (never above the ceiling). */
  trustStatus: TrustStatus;
  /** The consent state that will actually be recorded. */
  consentState: ConsentState;
  /** Human-readable, deterministic explanation. */
  reason: string;
  /** Poison scan result, always attached. */
  scan: PoisonScan;
  /** Adjustments applied, for audit. */
  adjustments: string[];
}

/**
 * Actor kinds whose writes can never be `approved` without a user action.
 * (§4: do not silently enable automatic memory capture.)
 */
const CANNOT_SELF_APPROVE: ReadonlySet<ActorKind> = new Set<ActorKind>([
  "agent",
  "plugin",
  "mcp",
  "model",
  "unknown",
]);

/**
 * The deterministic admission gate for durable context writes.
 *
 * Applies, in order:
 *   1. source-spoofing clamp (trust ≤ provenance ceiling)
 *   2. model/plugin self-approval block (consent downgraded to `proposed`)
 *   3. poison scan → quarantine (high) or trust downgrade (medium)
 *   4. instruction-creation block (never via this path)
 */
export function admitContextWrite(req: AdmissionRequest): AdmissionDecision {
  const adjustments: string[] = [];
  const scan = scanForPoisoning(req.content);

  // 1. Instructions are never created through a context write.
  if (req.type === "instruction") {
    return {
      admit: false,
      trustStatus: "unknown",
      consentState: "not_eligible",
      reason: "instructions cannot be created through the context write path",
      scan,
      adjustments: ["blocked:instruction_creation"],
    };
  }

  // 2. ANTI-SPOOFING: clamp requested trust to the provenance ceiling.
  let trustStatus = clampTrustToProvenance(req.requestedTrust, req.provenanceKind);
  if (trustRank(trustStatus) < trustRank(req.requestedTrust)) {
    adjustments.push(
      `trust_clamped:${req.requestedTrust}->${trustStatus} (provenance "${req.provenanceKind}" ceiling ${maxTrustForProvenance(req.provenanceKind)})`,
    );
  }

  // 3. A model-authored claim is never a user fact.
  if (req.actorKind === "model" && trustRank(trustStatus) > trustRank("generated_synthesis")) {
    adjustments.push(`trust_clamped:${trustStatus}->generated_synthesis (model actor)`);
    trustStatus = "generated_synthesis";
  }

  // 4. Third-party code never produces approved memory.
  if (
    (req.actorKind === "plugin" || req.actorKind === "mcp") &&
    trustRank(trustStatus) > trustRank("untrusted_external")
  ) {
    adjustments.push(`trust_clamped:${trustStatus}->untrusted_external (${req.actorKind} actor)`);
    trustStatus = "untrusted_external";
  }

  // 5. Consent: nothing but a user/system action can produce `approved`.
  let consentState = req.requestedConsent;
  if (CANNOT_SELF_APPROVE.has(req.actorKind) && (consentState === "approved" || consentState === "limited")) {
    adjustments.push(`consent_downgraded:${consentState}->proposed (${req.actorKind} cannot self-approve)`);
    consentState = "proposed";
  }

  // 6. Poison handling.
  if (scan.severity === "high") {
    adjustments.push(`quarantined:${scan.signatures.join(",")}`);
    return {
      admit: true, // stored, but never retrievable until a human reviews it
      trustStatus: "untrusted_external",
      consentState: "quarantined",
      reason: `quarantined — high-severity signatures: ${scan.signatures.join(", ")}`,
      scan,
      adjustments,
    };
  }

  if (scan.severity === "medium" && trustRank(trustStatus) > trustRank("untrusted_external")) {
    adjustments.push(`trust_downgraded:${trustStatus}->untrusted_external (${scan.signatures.join(",")})`);
    trustStatus = "untrusted_external";
  }

  return {
    admit: true,
    trustStatus,
    consentState,
    reason:
      adjustments.length === 0
        ? "admitted without adjustment"
        : `admitted with adjustments: ${adjustments.join("; ")}`,
    scan,
    adjustments,
  };
}

// ── Retrieval-time conflict handling (§9.4 / §9.5) ─────────────────────────

export interface ConflictFinding {
  /** The item being reported on. */
  itemId: string;
  kind: "stale_vs_fresh" | "contradiction" | "superseded" | "synthesis_vs_evidence";
  /** The other item involved. */
  otherId: string;
  /** Which one retrieval should prefer, deterministically. */
  prefer: string;
  detail: string;
}

const FRESHNESS_ORDER: Record<string, number> = {
  fresh: 4,
  recent: 3,
  aging: 2,
  stale: 1,
  expired: 0,
  unknown: 1,
};

/**
 * Deterministic contradiction/staleness detection across a retrieved set.
 *
 * Rules:
 *   • A superseded item never outranks its successor.
 *   • Stale data never silently outranks fresher authoritative data —
 *     "authoritative" meaning higher trust rank, not higher similarity.
 *   • Model synthesis never outranks source evidence on the same subject.
 *
 * Returns findings; the caller decides presentation. Nothing is deleted.
 */
export function detectConflicts(items: readonly ContextItem[]): ConflictFinding[] {
  const findings: ConflictFinding[] = [];
  const byId = new Map(items.map((i) => [i.id, i]));

  for (const item of items) {
    // 1. Explicit supersession.
    if (item.supersededBy && byId.has(item.supersededBy)) {
      findings.push({
        itemId: item.id,
        kind: "superseded",
        otherId: item.supersededBy,
        prefer: item.supersededBy,
        detail: "item was explicitly corrected; the correction wins",
      });
    }

    // 2. Explicit contradictions recorded on the item.
    for (const otherId of item.uncertainty.contradictedBy) {
      const other = byId.get(otherId);
      if (!other) continue;
      const a = FRESHNESS_ORDER[item.freshness.label] ?? 1;
      const b = FRESHNESS_ORDER[other.freshness.label] ?? 1;
      // Prefer the more trusted; break ties by freshness; then by id for determinism.
      const trustDelta = trustRank(item.trustStatus) - trustRank(other.trustStatus);
      const prefer =
        trustDelta !== 0
          ? trustDelta > 0
            ? item.id
            : other.id
          : a !== b
            ? a > b
              ? item.id
              : other.id
            : item.id < other.id
              ? item.id
              : other.id;
      findings.push({
        itemId: item.id,
        kind: "contradiction",
        otherId,
        prefer,
        detail: "recorded contradiction — both are shown, neither is treated as settled",
      });
    }
  }

  // 3. Stale-vs-fresh and synthesis-vs-evidence across pairs sharing a link.
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      if (!sharesSubject(a, b)) continue;

      const af = FRESHNESS_ORDER[a.freshness.label] ?? 1;
      const bf = FRESHNESS_ORDER[b.freshness.label] ?? 1;
      if (Math.abs(af - bf) >= 2) {
        const fresher = af > bf ? a : b;
        const staler = af > bf ? b : a;
        findings.push({
          itemId: staler.id,
          kind: "stale_vs_fresh",
          otherId: fresher.id,
          prefer: fresher.id,
          detail: `"${staler.freshness.label}" must not outrank "${fresher.freshness.label}" on the same subject`,
        });
      }

      if (a.trustStatus !== b.trustStatus) {
        const synth = a.trustStatus === "generated_synthesis" ? a : b.trustStatus === "generated_synthesis" ? b : null;
        const evid = a.trustStatus === "source_evidence" ? a : b.trustStatus === "source_evidence" ? b : null;
        if (synth && evid) {
          findings.push({
            itemId: synth.id,
            kind: "synthesis_vs_evidence",
            otherId: evid.id,
            prefer: evid.id,
            detail: "model synthesis does not outrank source evidence",
          });
        }
      }
    }
  }

  return findings;
}

/** Two items concern the same subject when they share a durable link. */
function sharesSubject(a: ContextItem, b: ContextItem): boolean {
  const la = a.links;
  const lb = b.links;
  if (la.claimId && la.claimId === lb.claimId) return true;
  if (la.researchSessionId && la.researchSessionId === lb.researchSessionId) return true;
  if (la.artifactId && la.artifactId === lb.artifactId) return true;
  if (la.taskId && la.taskId === lb.taskId) return true;
  if (a.supersededBy === b.id || b.supersededBy === a.id) return true;
  return false;
}

/**
 * Apply conflict findings as deterministic score penalties.
 * Never removes an item — honesty over tidiness (§9.4).
 */
export function conflictPenalty(itemId: string, findings: readonly ConflictFinding[]): { penalty: number; notes: string[] } {
  let penalty = 0;
  const notes: string[] = [];
  for (const f of findings) {
    if (f.itemId !== itemId) continue;
    if (f.prefer === itemId) continue;
    switch (f.kind) {
      case "superseded":
        penalty += 0.5;
        notes.push("superseded by a correction");
        break;
      case "stale_vs_fresh":
        penalty += 0.25;
        notes.push("staler than a competing item");
        break;
      case "synthesis_vs_evidence":
        penalty += 0.2;
        notes.push("synthesis ranked below source evidence");
        break;
      case "contradiction":
        penalty += 0.1;
        notes.push("contradicted by another item");
        break;
    }
  }
  return { penalty, notes };
}

// ── Secret redaction (§12) ─────────────────────────────────────────────────

const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, label: "[redacted:api-key]" },
  { re: /\bghp_[A-Za-z0-9]{20,}\b/g, label: "[redacted:token]" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, label: "[redacted:token]" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: "[redacted:aws-key]" },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, label: "[redacted:jwt]" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, label: "[redacted:private-key]" },
  { re: /\b(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*\S+/gi, label: "[redacted:credential]" },
];

/** Deterministically mask secret-looking substrings. */
export function maskSecrets(text: string): { text: string; masked: number } {
  let out = text;
  let masked = 0;
  for (const p of SECRET_PATTERNS) {
    out = out.replace(p.re, () => {
      masked++;
      return p.label;
    });
  }
  return { text: out, masked };
}

/** Replace absolute paths outside the workspace with a placeholder. */
export function maskExternalPaths(text: string, workspaceRoot: string): { text: string; masked: number } {
  let masked = 0;
  const out = text.replace(/(?:^|\s)(\/[^\s:'"]{3,})/g, (whole, path: string) => {
    if (workspaceRoot && path.startsWith(workspaceRoot)) return whole;
    masked++;
    return whole.replace(path, "[redacted:external-path]");
  });
  return { text: out, masked };
}
