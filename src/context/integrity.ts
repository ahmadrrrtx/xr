/**
 * XR 4.6 — Phase 6 · T3: the injection-time integrity gate.
 *
 * WHY A SECOND GATE
 * ─────────────────
 * Write-time admission (`admitContextWrite`, poison.ts) scans content when it
 * is stored. That is necessary but not sufficient:
 *
 *   • Signature sets and policy evolve — a row written under yesterday's rules
 *     can become poison under today's.
 *   • Migrated legacy rows never passed a modern scanner at all.
 *   • Trust/consent state changes after storage (revocation, expiry).
 *
 * Memory-poisoning attacks (MINJA class; see research note R6) are *temporally
 * decoupled*: poison planted weeks ago fires on retrieval today. The only
 * enforcement point that can stop it is render time.
 *
 * THE RULE: nothing is rendered into a prompt block or returned from a memory
 * tool unless it passes this gate. Deterministic; no model is involved.
 * The gate NEVER upgrades content — it can only demote (to quarantine) or
 * drop (with a recorded, content-free rejection). Fail closed (Art. IV.4).
 */

import { scanForPoisoning } from "./poison.ts";
import {
  CONTEXT_BOUNDS,
  consentAllowsRetrieval,
  mayActAsInstruction,
  trustRank,
  type ContextItem,
  type ContextPackage,
  type RetrievedItem,
  type RejectedItem,
} from "./types.ts";

export interface IntegrityFinding {
  itemId: string;
  action: "quarantine" | "drop" | "keep";
  /** Deterministic rule that fired (safe to display; no content). */
  rule: string;
  /** Matched signature names (safe to display). */
  signatures: string[];
}

export interface IntegrityResult {
  /** Items that remain admissible for injection (possibly re-channelled). */
  admitted: RetrievedItem[];
  /** Items forced into the quarantine channel by the gate. */
  quarantined: RetrievedItem[];
  /** Content-free rejections produced by the gate. */
  rejected: RejectedItem[];
  findings: IntegrityFinding[];
}

/**
 * Re-validate one item at render time.
 *
 * Rules (any match forces an action; the FIRST applies, most severe first):
 *   1. poison signature at HIGH or MEDIUM severity → QUARANTINE
 *      (high) or stay demoted-only-if-untrusted-else-quarantine (medium).
 *      Whatever the tier, poisoned content renders quarantined, never as data.
 *   2. consent no longer permits retrieval (revoked folder, expired, etc.) → DROP
 *   3. hard expiry reached → DROP
 *   4. instruction-channel impossibility — trust is not trusted_instruction
 *      while the tier intends instruction → the caller's channelFor already
 *      prevents this; the gate asserts it as a belt-and-suspenders invariant
 *      and drops on violation (fail closed on a corrupt row).
 */
export function gateItem(ri: RetrievedItem, now: number = Date.now()): IntegrityFinding {
  const item = ri.item;

  // 1. Render-time poison scan.
  const scan = scanForPoisoning(item.content);
  if (scan.flagged && scan.severity !== "none") {
    if (trustRank(item.trustStatus) < trustRank("approved_memory") || scan.severity === "high") {
      return {
        itemId: item.id,
        action: "quarantine",
        rule: "poisoning_signature(injection-time)",
        signatures: scan.signatures,
      };
    }
    // Medium signature on user-approved memory: demote to quarantine as well —
    // approved memory that reads like a standing instruction is exactly the
    // MINJA payload, and rendering it as ordinary "fact" data lets it instruct.
    return {
      itemId: item.id,
      action: "quarantine",
      rule: `poisoning_signature(injection-time, ${scan.severity})`,
      signatures: scan.signatures,
    };
  }

  // 2–3. Consent/expiry drift since assembly.
  if (!consentAllowsRetrieval(item.consentState)) {
    return { itemId: item.id, action: "drop", rule: "consent_not_granted(injection-time)", signatures: [] };
  }
  if (item.revokedAt || item.deletedAt) {
    return { itemId: item.id, action: "drop", rule: "revoked_or_deleted(injection-time)", signatures: [] };
  }
  if (typeof item.freshness.expiresAt === "number" && item.freshness.expiresAt <= now) {
    return { itemId: item.id, action: "drop", rule: "expired(injection-time)", signatures: [] };
  }

  // 4. Instruction-channel invariant (fail closed).
  if (ri.tier === "instructions" && !mayActAsInstruction(item.type, item.trustStatus)) {
    return { itemId: item.id, action: "drop", rule: "instruction_channel_violation", signatures: [] };
  }

  return { itemId: item.id, action: "keep", rule: "admitted", signatures: [] };
}

/** Gate every item of an assembled tier. */
export function gateItems(items: readonly RetrievedItem[], now: number = Date.now()): IntegrityResult {
  const admitted: RetrievedItem[] = [];
  const quarantined: RetrievedItem[] = [];
  const rejected: RejectedItem[] = [];
  const findings: IntegrityFinding[] = [];

  for (const ri of items) {
    const finding = gateItem(ri, now);
    findings.push(finding);
    switch (finding.action) {
      case "keep":
        admitted.push(ri);
        break;
      case "quarantine":
        quarantined.push(ri);
        break;
      case "drop":
        if (rejected.length < CONTEXT_BOUNDS.maxRejectedRecorded) {
          rejected.push({
            itemId: ri.item.id,
            reason: finding.rule.startsWith("poisoning") ? "poisoning_signature" : finding.rule.startsWith("expired") ? "expired" : finding.rule.startsWith("revoked") ? "revoked" : "consent_not_granted",
            detail: `integrity gate: ${finding.rule}${finding.signatures.length ? ` · ${finding.signatures.join(",")}` : ""}`,
          });
        }
        break;
    }
  }

  return { admitted, quarantined, rejected, findings };
}

/**
 * Render-time gate for MEMORY-TOOL RESULTS (Phase 6 · T2).
 *
 * Tool results are data, never authority — but data can still *read like* an
 * instruction (MINJA indication prompts). Before a tool returns stored text to
 * the agent loop, it passes this gate; flagged content is returned only with
 * its signatures disclosed (the agent cannot act on it as memory "fact" without
 * being told it is quarantined). Returns the redacted/gated view.
 */
export function gateToolResult(
  item: ContextItem,
  now: number = Date.now(),
): { ok: boolean; gatedFlags: string[]; reason?: string } {
  const fakeRef: RetrievedItem = {
    item,
    tier: "long_term_memory",
    explanation: {
      queryIntent: "memory tool",
      scopeMatch: "",
      similarity: 0,
      matchMode: "lexical",
      freshness: item.freshness.label,
      trustStatus: item.trustStatus,
      consentState: item.consentState,
      provenance: "",
      policyReason: "",
      score: 0,
      legacy: item.consentState === "legacy_unknown",
    },
  };
  const f = gateItem(fakeRef, now);
  return {
    ok: f.action !== "drop",
    gatedFlags: f.action === "quarantine" ? f.signatures : [],
    ...(f.action !== "keep" ? { reason: `${f.rule}${f.signatures.length ? ` · ${f.signatures.join(",")}` : ""}` } : {}),
  };
}

/** Aggregate summary for audit/logging (content-free). */
export function summarizeGate(r: IntegrityResult): string {
  const q = r.quarantined.length;
  const d = r.rejected.length;
  return q === 0 && d === 0
    ? "integrity gate: all items admitted"
    : `integrity gate: ${q} quarantined, ${d} dropped at render time`;
}
