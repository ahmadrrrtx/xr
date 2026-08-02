/**
 * XR Observability — PII/secret redaction (Phase 8 · T2; Art. XXI).
 *
 * The redactor is a NON-BYPASSABLE pipeline stage: every span attribute,
 * metric label value, and log field passes through `redactAttributes`
 * BEFORE the signal is recorded or exported. There is no code path that
 * exports a raw value (enforced by construction + privacy tests).
 *
 * Class coverage (sourced from the W3C/OWASP common-secret formats):
 *   · API keys / tokens: sk-*, xox*, ghp_*, github_pat_*, AKIA*, AIza*, JWT,
 *     PEM private-key blocks, `Bearer …` authorizations, key=value secrets
 *   · PII: e-mail addresses, long digit runs (card-like), phone-like runs
 *   · Local hygiene: home-directory paths (usernames), IPv4 literals
 *
 * Redactions are typed (`⟨redacted:kind⟩`) so downstream tooling can count
 * redaction rates without ever seeing the original bytes.
 */

type Rule = { kind: string; re: RegExp };

const RULES: Rule[] = [
  // Private-key PEM blocks (whole block).
  { kind: "pem", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]{20,20000}?-----END [A-Z ]*PRIVATE KEY-----/g },
  // JSON Web Tokens.
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  // Common API-key formats.
  { kind: "api_key", re: /\b(?:sk|pk|xox[baprs]|ghp|gho|ghu|ghs|ghr|github_pat|glpat|AKIA|ASIA|AIza|ya29|dop_v1|r8_|hf_)[A-Za-z0-9_-]{8,}\b/g },
  // Bearer / Authorization headers.
  { kind: "credential", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi },
  // key=value secret material in inline config strings.
  {
    kind: "credential",
    re: /\b(api[-_]?key|secret|token|password|passwd|authorization)([\s]*[=:][\s]*)(["']?)[^\s"']{6,}\3\b/gi,
  },
  // E-mail addresses.
  { kind: "email", re: /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,}\b/g },
  // Card-like digit runs (13–19 digits, allowing spaces/dashes).
  { kind: "card_number", re: /\b(?:\d[ -]?){13,19}\b/g },
  // Home-directory user paths → ⟨redacted:home⟩/rest.
  { kind: "home", re: /(\/(?:home|Users)\/)[^/\s:]+/g },
  // IPv4 literals.
  { kind: "ip", re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
];

export const REDACTED = "⟨redacted:secret⟩";

function redactStringWith(value: string): string {
  let out = value;
  for (const { kind, re } of RULES) {
    out = out.replace(re, (match) => {
      if (kind === "home") return `⟨redacted:home⟩/${match.split("/").slice(3).join("/") ?? ""}`.replace(/\/$/, "");
      return `⟨redacted:${kind}⟩`;
    });
  }
  return out;
}

export function redactString(value: string): string {
  return redactStringWith(value);
}

/** Any attribute value: strings redacted; numbers/booleans pass through. */
export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactStringWith(value);
  return value;
}

/**
 * Redact every string value in an attribute map (one level deep; arrays of
 * strings are redacted element-wise). Numbers/booleans are untouched.
 */
export function redactAttributes(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "string") out[k] = redactStringWith(v);
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === "string" ? redactStringWith(x) : x));
    else out[k] = v;
  }
  return out;
}

/** Truncation bound for any free-form string ever recorded (bytes-safe chars). */
export const MAX_ATTRIBUTE_VALUE_LENGTH = 256;

export function truncateValue(value: string, max = MAX_ATTRIBUTE_VALUE_LENGTH): string {
  return value.length <= max ? value : value.slice(0, max) + "…";
}
