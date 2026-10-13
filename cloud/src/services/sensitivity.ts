/**
 * XR Cloud — sensitivity scanner (server-side twin of `src/context/memory/sensitivity.ts`).
 *
 * The desktop already runs the Phase 21 scanner before it uploads anything, and
 * it sends the resulting tags. This module exists because **the server must not
 * believe the client about whether the client's own payload is safe to store.**
 * A tags array is a claim; this is the verification. If the two disagree, the
 * server's answer wins, because the server is the one that will be holding the
 * data at rest and answering a compliance question about it.
 *
 * The rules are a deliberate port of the local scanner so that "what XR
 * considers sensitive" is one answer, not two:
 *
 *   - Payment cards — candidate runs of 12–19 digits (with separators), then
 *     **Luhn**, which is what keeps a 16-digit invoice number from being flagged.
 *   - US SSNs — the dashed form only. The undashed form collides with every
 *     other 9-digit number and flagging it would make the feature useless.
 *   - API keys — vendor-prefix shapes (`sk-`, `sk-ant-`, `ghp_`, `AKIA`, `xox`,
 *     `AIza`, …). Prefix-anchored because that is how these are actually
 *     recognisable.
 *   - Private keys — PEM `BEGIN ... PRIVATE KEY` headers.
 *
 * Deliberately **not** here: names, addresses, phone numbers, email addresses.
 * Those are PII, they are extremely common in perfectly legitimate team notes,
 * and a scanner that flags them turns into a scanner nobody reads. The docs say
 * this out loud rather than implying coverage we do not have.
 */

export type SensitiveKind = "credit-card" | "ssn" | "api-key" | "private-key";

export interface SensitiveMatch {
  kind: SensitiveKind;
  /** Never the matched value — only its shape, for the review UI. */
  label: string;
}

const LABELS: Record<SensitiveKind, string> = {
  "credit-card": "payment card number",
  ssn: "US social security number",
  "api-key": "API key or access token",
  "private-key": "private key",
};

export function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const code = digits.charCodeAt(i) - 48;
    if (code < 0 || code > 9) return false;
    let value = code;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum > 0 && sum % 10 === 0;
}

const CARD_CANDIDATE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
const SSN = /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/;
const API_KEYS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/, // OpenAI and many compatible gateways
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/, // Anthropic
  /\bghp_[A-Za-z0-9]{20,}\b/, // GitHub PAT (classic)
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/, // GitHub PAT (fine-grained)
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API key
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWT
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/, // Stripe
];
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |)PRIVATE KEY-----/;

export function scanSensitive(content: string): SensitiveMatch[] {
  const found = new Set<SensitiveKind>();

  for (const match of content.matchAll(CARD_CANDIDATE)) {
    const digits = match[0].replace(/[ -]/g, "");
    if (digits.length >= 12 && digits.length <= 19 && passesLuhn(digits)) {
      found.add("credit-card");
      break;
    }
  }
  if (SSN.test(content)) found.add("ssn");
  for (const pattern of API_KEYS) {
    if (pattern.test(content)) {
      found.add("api-key");
      break;
    }
  }
  if (PRIVATE_KEY.test(content)) found.add("private-key");

  return [...found].map((kind) => ({ kind, label: LABELS[kind] }));
}

/** Tags only, for storage. The order is fixed so a tag array is comparable. */
export function sensitiveTags(content: string): string[] {
  return scanSensitive(content)
    .map((m) => m.kind)
    .sort();
}

export function isSensitive(content: string): boolean {
  return scanSensitive(content).length > 0;
}

/** Copy for the review queue and the API error. Names the repair, honestly. */
export function sensitivityReason(matches: readonly SensitiveMatch[]): string {
  const labels = matches.map((m) => m.label).join(", ");
  return `This note looks like it contains ${labels}. Your organization blocks sensitive values from team memory.`;
}
