/**
 * Phase 21 — sensitive-content detection for memory entries.
 *
 * Pure and offline. It only *flags* content so the user can decide; the
 * write path (`/api/memory`) refuses flagged content unless the caller
 * explicitly acknowledges the warning. Patterns are deliberately narrow:
 * a warning that fires on everything teaches users to ignore it.
 */

export type SensitiveKind = "credit-card" | "ssn" | "api-key" | "private-key";

export interface SensitiveMatch {
  kind: SensitiveKind;
  label: string;
}

const LABELS: Record<SensitiveKind, string> = {
  "credit-card": "Looks like a payment card number",
  ssn: "Looks like a social security number",
  "api-key": "Looks like an API key or access token",
  "private-key": "Contains a private key block",
};

/** Luhn checksum — keeps random 16-digit strings from being flagged as cards. */
export function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

const CARD_CANDIDATE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
const SSN = /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/;
const API_KEYS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}/, // OpenAI-style secret keys
  /\bgh[pousr]_[A-Za-z0-9]{30,}/, // GitHub tokens
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API key
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
];
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/;

/** Scan free text. Returns one match per kind (never the matched value itself). */
export function scanSensitive(content: string): SensitiveMatch[] {
  const found = new Set<SensitiveKind>();
  if (PRIVATE_KEY.test(content)) found.add("private-key");
  if (API_KEYS.some((re) => re.test(content))) found.add("api-key");
  if (SSN.test(content)) found.add("ssn");
  for (const m of content.matchAll(CARD_CANDIDATE)) {
    const digits = m[0].replace(/[ -]/g, "");
    if (passesLuhn(digits)) {
      found.add("credit-card");
      break;
    }
  }
  return [...found].map((kind) => ({ kind, label: LABELS[kind] }));
}
