/**
 * XR 6.1 — Verifiable audit redaction.
 *
 * The problem: redaction normally destroys tamper-evidence. If you strip a
 * field from an audit record, its hash no longer matches, and the chain breaks.
 *
 * The solution implemented here:
 *   - The record's original `hash`/`prevHash` are PRESERVED verbatim. Chain
 *     verification therefore still works over a redacted export.
 *   - Each removed/masked field carries `originalDigest` = SHA-256 of the
 *     original value. An auditor holding the source data can prove the
 *     redaction is faithful; one without it still verifies the chain.
 *   - Redaction is recorded (`redactedFields`) — never invisible.
 *
 * This gives: tamper-evident AND privacy-preserving, without exporting
 * unnecessary sensitive content (roadmap §6.3).
 */

import { createHash } from "node:crypto";
import {
  ENTERPRISE_BOUNDS,
  SENSITIVITY_ORDER,
  type AuditRecord,
  type RedactedAuditRecord,
  type RedactedField,
  type RedactionMode,
  type RedactionRule,
} from "../types.ts";

export function digestValue(value: unknown): string {
  const canonical = value === undefined ? "\u0000undefined" : JSON.stringify(value) ?? "\u0000null";
  return createHash("sha256").update(canonical).digest("hex");
}

/** Mask preserving shape but not content. */
function maskValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length <= 4) return "****";
    return `${value.slice(0, 2)}${"*".repeat(Math.min(value.length - 4, 16))}${value.slice(-2)}`;
  }
  if (typeof value === "number") return 0;
  if (typeof value === "boolean") return false;
  if (Array.isArray(value)) return `[redacted array of ${value.length}]`;
  if (value && typeof value === "object") return "[redacted object]";
  return "[redacted]";
}

function getPath(obj: Record<string, unknown>, path: string): { found: boolean; value: unknown } {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return { found: false, value: undefined };
    if (!Object.prototype.hasOwnProperty.call(cur, p)) return { found: false, value: undefined };
    cur = (cur as Record<string, unknown>)[p];
  }
  return { found: true, value: cur };
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const next = cur[p];
    if (next === null || typeof next !== "object") return;
    cur = next as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function deletePath(obj: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const next = cur[p];
    if (next === null || typeof next !== "object") return;
    cur = next as Record<string, unknown>;
  }
  delete cur[parts[parts.length - 1]!];
}

/** Default rules that protect obviously-sensitive fields. Always applied first. */
export const DEFAULT_REDACTION_RULES: readonly RedactionRule[] = Object.freeze([
  { ruleId: "default.token", path: "token", mode: "hash", reason: "Credential material must never be exported." },
  { ruleId: "default.secret", path: "secret", mode: "hash", reason: "Credential material must never be exported." },
  { ruleId: "default.password", path: "password", mode: "remove", reason: "Credential material must never be exported." },
  { ruleId: "default.apiKey", path: "apiKey", mode: "hash", reason: "Credential material must never be exported." },
  { ruleId: "default.authorization", path: "authorization", mode: "remove", reason: "Credential material must never be exported." },
  { ruleId: "default.credential", path: "credential", mode: "hash", reason: "Credential material must never be exported." },
  { ruleId: "default.privateKey", path: "privateKey", mode: "remove", reason: "Key material must never be exported." },
]);

export interface RedactionOptions {
  readonly rules: readonly RedactionRule[];
  /** Skip the built-in credential rules (requires an explicit, audited reason). */
  readonly skipDefaults?: boolean;
}

export interface RedactionOutcome {
  readonly record: RedactedAuditRecord;
  readonly appliedRuleIds: readonly string[];
}

/**
 * Apply redaction rules to one record.
 * The hash chain fields are never altered.
 */
export function redactRecord(record: AuditRecord, options: RedactionOptions): RedactionOutcome {
  const rules = options.skipDefaults
    ? [...options.rules]
    : [...DEFAULT_REDACTION_RULES, ...options.rules];

  const capped = rules.slice(0, ENTERPRISE_BOUNDS.MAX_REDACTION_RULES);
  const detail: Record<string, unknown> = structuredCloneSafe(record.detail);
  const redactedFields: RedactedField[] = [];
  const appliedRuleIds = new Set<string>();

  for (const rule of capped) {
    if (rule.appliesAtOrAbove && SENSITIVITY_ORDER[record.sensitivity] < SENSITIVITY_ORDER[rule.appliesAtOrAbove]) {
      continue;
    }

    if (rule.path === "*") {
      // Redact every top-level field.
      for (const key of Object.keys(detail)) {
        const original = detail[key];
        applyMode(detail, key, original, rule.mode);
        redactedFields.push({
          path: key,
          mode: rule.mode,
          originalDigest: digestValue(original),
          reason: rule.reason,
        });
        appliedRuleIds.add(rule.ruleId);
      }
      continue;
    }

    const { found, value } = getPath(detail, rule.path);
    if (!found) continue;

    applyMode(detail, rule.path, value, rule.mode);
    redactedFields.push({
      path: rule.path,
      mode: rule.mode,
      originalDigest: digestValue(value),
      reason: rule.reason,
    });
    appliedRuleIds.add(rule.ruleId);
  }

  const redacted: RedactedAuditRecord = {
    ...record,
    detail,
    redactedFields,
    originalHash: record.hash,
  };

  return { record: redacted, appliedRuleIds: [...appliedRuleIds] };
}

function applyMode(detail: Record<string, unknown>, path: string, original: unknown, mode: RedactionMode): void {
  switch (mode) {
    case "remove":
      deletePath(detail, path);
      break;
    case "mask":
      setPath(detail, path, maskValue(original));
      break;
    case "hash":
      setPath(detail, path, `sha256:${digestValue(original).slice(0, 16)}`);
      break;
  }
}

function structuredCloneSafe(value: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return { ...value };
  }
}

/** Redact a batch, returning the union of applied rule ids. */
export function redactRecords(
  records: readonly AuditRecord[],
  options: RedactionOptions,
): { records: readonly RedactedAuditRecord[]; appliedRuleIds: readonly string[]; redactedFieldCount: number } {
  const out: RedactedAuditRecord[] = [];
  const applied = new Set<string>();
  let fieldCount = 0;

  for (const r of records) {
    const outcome = redactRecord(r, options);
    out.push(outcome.record);
    for (const id of outcome.appliedRuleIds) applied.add(id);
    fieldCount += outcome.record.redactedFields.length;
  }

  return { records: out, appliedRuleIds: [...applied], redactedFieldCount: fieldCount };
}

// ═══════════════════════════════════════════════════════════════════════════
// Redaction faithfulness proof
// ═══════════════════════════════════════════════════════════════════════════

export interface RedactionProofResult {
  readonly ok: boolean;
  readonly checked: number;
  readonly mismatches: readonly { readonly recordId: string; readonly path: string; readonly detail: string }[];
}

/**
 * Given the ORIGINAL records and their redacted counterparts, prove that every
 * redaction digest matches the original value.
 *
 * This is what an auditor with source access runs to confirm that redaction
 * removed only what it claimed to remove.
 */
export function proveRedactionFaithful(
  originals: readonly AuditRecord[],
  redacted: readonly RedactedAuditRecord[],
): RedactionProofResult {
  const byId = new Map(originals.map((r) => [r.recordId, r]));
  const mismatches: { recordId: string; path: string; detail: string }[] = [];
  let checked = 0;

  for (const r of redacted) {
    const original = byId.get(r.recordId);
    if (!original) {
      mismatches.push({ recordId: r.recordId, path: "-", detail: "No matching original record supplied." });
      continue;
    }
    if (original.hash !== r.originalHash) {
      mismatches.push({ recordId: r.recordId, path: "-", detail: "Original hash does not match source record." });
    }
    for (const f of r.redactedFields) {
      checked++;
      const { found, value } = getPath(original.detail, f.path);
      if (!found) {
        mismatches.push({ recordId: r.recordId, path: f.path, detail: "Field absent in original record." });
        continue;
      }
      if (digestValue(value) !== f.originalDigest) {
        mismatches.push({ recordId: r.recordId, path: f.path, detail: "Digest does not match original value." });
      }

      // The redaction must have ACTUALLY been applied. A record that claims a
      // field was redacted while still carrying the original value is a
      // redaction-bypass attempt, not a faithful redaction.
      const present = getPath(r.detail, f.path);
      if (f.mode === "remove") {
        if (present.found) {
          mismatches.push({
            recordId: r.recordId,
            path: f.path,
            detail: "Field claimed as removed is still present in the redacted record.",
          });
        }
      } else if (present.found && digestValue(present.value) === f.originalDigest) {
        mismatches.push({
          recordId: r.recordId,
          path: f.path,
          detail: `Field claimed as ${f.mode}ed still contains the original value.`,
        });
      }
    }
  }

  return { ok: mismatches.length === 0, checked, mismatches };
}

/**
 * Detect a redaction-bypass attempt: sensitive content still present in a
 * redacted record. Used by the security test suite and by export validation.
 */
export function detectRedactionBypass(
  records: readonly RedactedAuditRecord[],
  sensitivePatterns: readonly RegExp[] = DEFAULT_SENSITIVE_PATTERNS,
): readonly { readonly recordId: string; readonly match: string }[] {
  const findings: { recordId: string; match: string }[] = [];
  for (const r of records) {
    const serialized = JSON.stringify(r.detail);
    for (const pattern of sensitivePatterns) {
      const m = serialized.match(pattern);
      if (m) findings.push({ recordId: r.recordId, match: m[0].slice(0, 32) });
    }
  }
  return findings;
}

export const DEFAULT_SENSITIVE_PATTERNS: readonly RegExp[] = Object.freeze([
  /sk-[A-Za-z0-9]{16,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
]);
