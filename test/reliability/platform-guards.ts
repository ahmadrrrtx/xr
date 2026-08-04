/**
 * Shared platform guard used by the crash-injection matrix and asserted by
 * test/release/portability.test.ts. Kept in a non-test module so the guard can
 * be imported without re-registering the crash-injection suite (a test file
 * importing another test file would double-run it).
 */

/** POSIX-only semantics: children are SIGKILLed and the parent asserts exit state. */
export const POSIX_ONLY = process.platform === "win32";
