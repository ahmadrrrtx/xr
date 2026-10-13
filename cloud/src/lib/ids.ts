/**
 * XR Cloud — identifiers.
 *
 * Two kinds, deliberately different, because conflating them is how internal
 * ordering leaks into public URLs:
 *
 *   - **Public ids** are prefixed and random (`org_`, `usr_`, `mem_`, …). They
 *     are opaque, they sort meaningfully nowhere, and a support engineer reading
 *     a log can tell what a value refers to at a glance. A sequential integer id
 *     in a URL is an enumeration oracle and a growth-rate disclosure.
 *   - **Sequence numbers** exist only inside the database, only where a chain
 *     needs one (the audit log's `seq`), and are never accepted from a client.
 *
 * Entropy: 16 random bytes → 22 base64url chars → ~128 bits. Guessing an id is
 * not a threat model we have to think about again.
 */

import { randomBytes } from "node:crypto";

export const ID_PREFIXES = {
  user: "usr",
  org: "org",
  member: "mbr",
  invite: "inv",
  session: "ses",
  sso: "sso",
  policy: "pol",
  subscription: "sub",
  invoice: "inv_",
  memory: "mem",
  memoryReview: "mrv",
  workspace: "wsp",
  audit: "aud",
  exportJob: "exp",
  license: "lic",
  apiKey: "key",
  usageEvent: "uev",
  relay: "rly",
  webhookEvent: "whk",
  magicLink: "mlk",
  request: "req",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export function newId(kind: IdKind): string {
  const prefix = ID_PREFIXES[kind];
  const body = randomBytes(16).toString("base64url");
  return `${prefix}_${body}`;
}

/** Slug for org and workspace URLs: lowercase, dashes, bounded, never empty. */
export function slugify(input: string, fallback = "team"): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length >= 2 ? slug : `${fallback}-${randomBytes(3).toString("hex")}`;
}

/**
 * Turn an email domain into the lookup key used for SSO routing. Lowercased;
 * everything after the final `@`. Returns null for an input that is not an email
 * rather than guessing at one.
 */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).toLowerCase().trim();
  return domain.length > 0 && domain.includes(".") ? domain : null;
}

/** Canonical email form. Emails are compared case-insensitively everywhere. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Slug generation that cannot collide.
 *
 * `slugify` alone is not enough: it maps every "Test Team" to `test-team`, and the
 * unique index on `orgs.slug` then turns the second signup with a common team name
 * into a 500. A team name is chosen by a human in a hurry, so collisions are the
 * normal case rather than an edge case — this test found it by signing up twice
 * with the same name.
 *
 * `taken` is supplied by the caller rather than queried here, because the check
 * belongs in the same transaction as the insert. A helper that did its own SELECT
 * would look safer and be slower without being correct.
 */
export async function uniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
  fallback = "team",
): Promise<string> {
  const root = slugify(base, fallback);
  if (!(await isTaken(root))) return root;
  // Short and stable-looking suffixes rather than a counter: `acme-4f2a` reads as
  // a name, `acme-2` reads as a mistake someone will try to "fix".
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = `${root.slice(0, 40)}-${randomBytes(2).toString("hex")}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  // Twelve failures is not a coincidence; fall back to full entropy.
  return `${root.slice(0, 32)}-${randomBytes(6).toString("hex")}`;
}

/** True when a driver error is a unique-index violation, for retry decisions. */
export function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate key value violates unique constraint|UNIQUE constraint failed/i.test(message);
}
