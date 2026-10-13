/**
 * XR Cloud — password hashing.
 *
 * Email magic-link is the primary credential (brief §A). Passwords exist as an
 * opt-in alternative for operators who want them, and they are hashed with
 * **argon2id** via the Rust `@node-rs/argon2` binding — the OWASP-recommended
 * algorithm, not bcrypt, and not a hand-rolled PBKDF2 loop.
 *
 * Parameters are the OWASP minimum for argon2id: m=19 MiB, t=2, p=1. They are
 * recorded here in one place so a future tune is a one-line diff with an obvious
 * blast radius.
 *
 * The verify path is **constant-shape**: a user with no password hash still runs
 * a dummy verify so response timing does not disclose which accounts have
 * passwords. That is the same class of leak as "no such user" vs "wrong
 * password", and it costs one hash to close.
 */

import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

/**
 * `algorithm: 2` is argon2id. The numeric literal is used instead of
 * `Algorithm.Argon2id` because `@node-rs/argon2` declares `Algorithm` as an
 * ambient const enum, which `verbatimModuleSyntax` (on repo-wide) refuses to
 * read at runtime. Value 2 is fixed by the Argon2 spec, not by the binding.
 */
const PARAMS = {
  algorithm: 2 as const,
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

/** A real hash of a fixed string, computed once, for timing-equalisation. */
let dummyHashPromise: Promise<string> | undefined;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= argonHash("xr-cloud-timing-equaliser", PARAMS);
  return dummyHashPromise;
}

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, PARAMS);
}

export async function verifyPassword(password: string, storedHash: string | null): Promise<boolean> {
  if (!storedHash) {
    // Still burn a verify. Returns false regardless — we never fabricate success.
    await argonVerify(await dummyHash(), password).catch(() => false);
    return false;
  }
  try {
    return await argonVerify(storedHash, password);
  } catch {
    // A malformed stored hash is a data defect, not a valid credential.
    return false;
  }
}

/**
 * Minimum policy: length only. Composition rules ("one symbol") reduce entropy
 * in practice and are not enforced here; a 12-character minimum with no other
 * requirement is the current NIST-aligned guidance. Described as-is on the
 * signup form so the user is not surprised.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}
