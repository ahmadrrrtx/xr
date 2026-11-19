/**
 * B1 — describe ANY thrown value without ever throwing.
 *
 * `(e as Error).message.slice(…)` is itself a TypeError when a dependency
 * throws a string, a number, null or a hostile object; inside a `catch` that
 * turns a handled failure into an unhandled one. Strings, numbers, null,
 * objects without a prototype and throwing getters/toString all land here.
 */
export function describeThrown(e: unknown, max = 200): string {
  let s: string;
  try {
    s = String(e instanceof Error ? e.message || e.name : e);
  } catch {
    s = "unprintable thrown value";
  }
  return s.slice(0, max);
}
