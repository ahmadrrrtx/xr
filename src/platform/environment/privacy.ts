/**
 * XR 5.1 — Environment privacy: redaction, cloud consent, retention decisions.
 *
 * Rules enforced here (§9/§11):
 *   - no secret values in records, observations, transcripts, or logs;
 *   - no cloud audio/image transfer without explicit policy consent;
 *   - screenshots/transcripts are not persisted raw by default.
 */
import type { Action } from "../../control/types.ts";

// ── Secret redaction ──────────────────────────────────────────────────────

// Ordered most-structural first: a broad token pattern must never shred the
// delimiters of a more specific block (e.g. private-key armor) before the
// specific pattern has had its chance.
const SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "«redacted-private-key»"],
  [/\b(sk|pk|api|key|token|secret|password|passwd|pwd)[-_]?[A-Za-z0-9]{0,12}[-_]([A-Za-z0-9_\-]{16,})\b/gi, "$1-«redacted»"],
  [/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g, "«redacted-jwt»"],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "«redacted-aws-key»"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "«redacted-github-token»"],
  [/(\b(?:password|passwd|pwd|token|secret|api[_-]?key)\b\s*[:=]\s*)\S+/gi, "$1«redacted»"],
  [/(\b(?:session|sess|auth|jwt|csrf)[A-Za-z0-9_-]*=)[^\s;&]{8,}/gi, "$1«redacted»"], // cookie-ish
];

/** Redact credential-shaped content from any text destined for records/logs. */
export function redactSecrets(input: string): string {
  let out = input;
  for (const [re, sub] of SECRET_PATTERNS) out = out.replace(re, sub);
  return out;
}

/**
 * Redact an action for safe persistence/echo. Complements control/audit.ts
 * (which redacts `type.sensitive`) by also covering browser sensitive values
 * and scanning free-text fields.
 */
export function redactEnvironmentAction(action: Action): Record<string, unknown> {
  const clone: Record<string, unknown> = JSON.parse(JSON.stringify(action));
  if (clone.type === "type" && clone.sensitive) {
    clone.text = "«redacted»";
    clone.textLength = (action as { text: string }).text.length;
  }
  if (clone.type === "browser" && clone.sensitive && typeof clone.value === "string") {
    clone.valueLength = clone.value.length;
    clone.value = "«redacted»";
  }
  for (const k of ["value", "target", "path", "content", "text"] as const) {
    if (typeof clone[k] === "string" && clone[k] !== "«redacted»") {
      clone[k] = redactSecrets(clone[k] as string).slice(0, 2000);
    }
  }
  return clone;
}

// ── Cloud consent ─────────────────────────────────────────────────────────

export type CloudKind = "stt" | "tts" | "vision";

export interface CloudConsentDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Explicit-policy cloud gate. Consent must be present in BOTH settings (user
 * opt-in) and the effective session policy (caller cannot raise consent above
 * settings). There is no ambient or inferred consent.
 */
export function checkCloudConsent(
  kind: CloudKind,
  settingsAllow: boolean,
  sessionPolicyAllow: boolean,
): CloudConsentDecision {
  if (!settingsAllow) {
    const hint =
      kind === "vision"
        ? "set environment.vision.allowCloud=true in config after reviewing the privacy guide"
        : `run 'xr voice setup' and explicitly allow cloud ${kind.toUpperCase()}`;
    return { allowed: false, reason: `cloud ${kind} is not enabled in settings; ${hint}` };
  }
  if (!sessionPolicyAllow) {
    return { allowed: false, reason: `cloud ${kind} is disabled by this session's environment policy` };
  }
  return { allowed: true };
}

// ── Retention decisions ───────────────────────────────────────────────────

export interface RetentionDecision {
  retainRaw: boolean;
  reason: string;
}

/** Screenshots: raw bytes are never retained by the record layer. */
export function screenshotRetention(): RetentionDecision {
  return {
    retainRaw: false,
    reason: "screenshots are referenced by path+hash only; raw image data is never copied into records, logs, or transcripts",
  };
}

/** Transcripts: raw text persisted only under the existing local-private policy. */
export function transcriptRetention(policy: "off" | "session" | "local-private"): RetentionDecision {
  if (policy === "local-private") {
    return { retainRaw: true, reason: "local-private transcript policy; stored mode 0600 under XR home" };
  }
  return { retainRaw: false, reason: `transcript policy '${policy}': only metadata (backend, mode, timestamps) is recorded` };
}
